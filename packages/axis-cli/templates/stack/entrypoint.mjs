import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import process from "node:process";

const children = [];
const managedProcesses = new Map();
const controlDir = process.env.AXIS_STACK_CONTROL_DIR ?? "/opt/axis/managed/control";
const restartRequestPath = path.join(controlDir, "restart-request.txt");
const sharedEnv = {
  ...process.env,
  NODE_ENV: "production",
};

function startProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: sharedEnv,
    ...options,
  });
  children.push(child);
  return child;
}

function removeChild(child) {
  const index = children.indexOf(child);
  if (index >= 0) {
    children.splice(index, 1);
  }
}

function startManagedProcess(name, command, args, options = {}) {
  const child = startProcess(command, args, options);
  managedProcesses.set(name, {
    command,
    args,
    options,
    child,
  });
  child.on("exit", () => {
    if (managedProcesses.get(name)?.child === child) {
      stopAll();
      managedProcesses.get("postgres")?.child.kill("SIGTERM");
    }
  });
  return child;
}

function waitForProcessExit(child) {
  return new Promise((resolve) => {
    child.once("exit", resolve);
    child.once("error", resolve);
    setTimeout(resolve, 3000);
  });
}

async function restartManagedProcess(name) {
  const record = managedProcesses.get(name);
  if (!record) {
    await writeFile(path.join(controlDir, "restart-last-error.txt"), `unknown service: ${name}\n`, "utf8");
    return;
  }

  const previous = record.child;
  managedProcesses.delete(name);
  if (!previous.killed) {
    previous.kill("SIGTERM");
  }
  await waitForProcessExit(previous);
  removeChild(previous);

  const next = startManagedProcess(name, record.command, record.args, record.options);
  await writeFile(path.join(controlDir, "restart-last-ok.txt"), `${name} ${new Date().toISOString()} pid=${next.pid ?? ""}\n`, "utf8");
}

function stopAll() {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
}

process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);

async function waitForPostgresReady() {
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    const checker = spawn(
      "pg_isready",
      ["-U", process.env.POSTGRES_USER ?? "axis_user", "-d", process.env.POSTGRES_DB ?? "axis_db"],
      {
        stdio: "ignore",
        env: sharedEnv,
      },
    );

    const ok = await new Promise((resolve) => {
      checker.on("exit", (code) => resolve(code === 0));
      checker.on("error", () => resolve(false));
    });

    if (ok) {
      return;
    }

    await delay(1500);
  }

  throw new Error("postgres did not become ready in time");
}

async function waitForExit(child, label) {
  await new Promise((resolve, reject) => {
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(new Error(`${label} failed`));
    });
    child.on("error", reject);
  });
}

async function main() {
  await mkdir(controlDir, { recursive: true });
  const postgres = startManagedProcess("postgres", "/usr/local/bin/docker-entrypoint.sh", ["postgres"]);
  postgres.on("exit", (code) => {
    process.exit(code ?? 1);
  });

  await waitForPostgresReady();

  const storageMigrate = startProcess(process.execPath, ["/opt/axis/storage/dist/src/db/migrate.js"], {
    cwd: "/opt/axis/storage",
  });
  await waitForExit(storageMigrate, "storage migration");
  children.pop(); // Remove completed migration from children array

  const runtimeMigrate = startProcess(process.execPath, ["/opt/axis/runtime/dist/src/db/migrate.js"], {
    cwd: "/opt/axis/runtime",
  });
  await waitForExit(runtimeMigrate, "runtime migration");
  children.pop(); // Remove completed migration from children array

  const storage = startManagedProcess("storage", process.execPath, ["/opt/axis/storage/dist/src/server.js"], {
    cwd: "/opt/axis/storage",
    env: {
      ...sharedEnv,
      PORT: "3001",
      HOST: "0.0.0.0",
    },
  });
  const worker = startManagedProcess("storage-worker", process.execPath, ["/opt/axis/storage/dist/src/worker.js"], {
    cwd: "/opt/axis/storage",
  });
  const runtime = startManagedProcess("runtime", process.execPath, ["/opt/axis/runtime/dist/src/index.js"], {
    cwd: "/opt/axis/runtime",
    env: {
      ...sharedEnv,
      PORT: "3002",
      HOST: "0.0.0.0",
    },
  });
  const visualization = process.env.AXIS_DISABLE_STACK_VISUALIZATION === "1"
    ? null
    : startManagedProcess("visualization", process.execPath, ["/opt/axis/visualization-standalone/server.js"], {
        cwd: "/opt/axis/visualization-standalone",
        env: {
          ...sharedEnv,
          PORT: "3003",
          HOSTNAME: "0.0.0.0",
        },
      });

  watch(controlDir, async () => {
    const request = (await readFile(restartRequestPath, "utf8").catch(() => "")).trim();
    if (!request) {
      return;
    }
    await rm(restartRequestPath, { force: true }).catch(() => undefined);
    if (request === "storage") {
      await restartManagedProcess("storage");
      await restartManagedProcess("storage-worker");
      return;
    }
    await restartManagedProcess(request);
  });
}

void main().catch((error) => {
  console.error(error);
  stopAll();
  process.exit(1);
});
