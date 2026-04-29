import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import process from "node:process";

const children = [];
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
  const postgres = startProcess("/usr/local/bin/docker-entrypoint.sh", ["postgres"]);
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

  const storage = startProcess(process.execPath, ["/opt/axis/storage/dist/src/server.js"], {
    cwd: "/opt/axis/storage",
    env: {
      ...sharedEnv,
      PORT: "3001",
      HOST: "0.0.0.0",
    },
  });
  const worker = startProcess(process.execPath, ["/opt/axis/storage/dist/src/worker.js"], {
    cwd: "/opt/axis/storage",
  });
  const runtime = startProcess(process.execPath, ["/opt/axis/runtime/dist/src/index.js"], {
    cwd: "/opt/axis/runtime",
    env: {
      ...sharedEnv,
      PORT: "3002",
      HOST: "0.0.0.0",
    },
  });
  const visualization = process.env.AXIS_DISABLE_STACK_VISUALIZATION === "1"
    ? null
    : startProcess(process.execPath, ["/opt/axis/visualization-standalone/server.js"], {
        cwd: "/opt/axis/visualization-standalone",
        env: {
          ...sharedEnv,
          PORT: "3003",
          HOSTNAME: "0.0.0.0",
        },
      });

  for (const child of [storage, worker, runtime, visualization].filter(Boolean)) {
    child.on("exit", () => {
      stopAll();
      postgres.kill("SIGTERM");
    });
  }
}

void main().catch((error) => {
  console.error(error);
  stopAll();
  process.exit(1);
});
