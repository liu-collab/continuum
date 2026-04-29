import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";

const repoRoot = process.cwd();
const isWindows = process.platform === "win32";
const npmExecutable = isWindows ? "npm.cmd" : "npm";
const defaultDatabaseUrl = "postgres://postgres:postgres@127.0.0.1:5432/agent_memory";
const defaultStorageUrl = "http://127.0.0.1:3001";
const defaultRuntimeUrl = "http://127.0.0.1:3002";
const defaultVisualizationUrl = "http://127.0.0.1:3003";
const defaultMnaUrl = "http://127.0.0.1:4193";
const defaultMnaHome = path.join(os.homedir(), ".mna");

const sharedEnv = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? defaultDatabaseUrl,
  STORAGE_READ_MODEL_DSN: process.env.STORAGE_READ_MODEL_DSN ?? process.env.DATABASE_URL ?? defaultDatabaseUrl,
  STORAGE_WRITEBACK_URL: process.env.STORAGE_WRITEBACK_URL ?? defaultStorageUrl,
  STORAGE_API_BASE_URL: process.env.STORAGE_API_BASE_URL ?? defaultStorageUrl,
  RUNTIME_API_BASE_URL: process.env.RUNTIME_API_BASE_URL ?? defaultRuntimeUrl,
  NEXT_PUBLIC_MNA_BASE_URL: process.env.NEXT_PUBLIC_MNA_BASE_URL ?? defaultMnaUrl,
  MNA_INTERNAL_BASE_URL: process.env.MNA_INTERNAL_BASE_URL ?? defaultMnaUrl,
  MNA_TOKEN_PATH: process.env.MNA_TOKEN_PATH ?? path.join(defaultMnaHome, "token.txt"),
  MNA_HOME: process.env.MNA_HOME ?? defaultMnaHome,
  RUNTIME_BASE_URL: process.env.RUNTIME_BASE_URL ?? defaultRuntimeUrl,
};

const serviceSpecs = [
  {
    name: "storage",
    cwd: path.join(repoRoot, "services", "storage"),
    script: "dev",
    env: {
      PORT: process.env.STORAGE_PORT ?? "3001",
      HOST: process.env.STORAGE_HOST ?? "127.0.0.1",
    },
  },
  {
    name: "storage-worker",
    cwd: path.join(repoRoot, "services", "storage"),
    script: "dev:worker",
    env: {},
  },
  {
    name: "runtime",
    cwd: path.join(repoRoot, "services", "retrieval-runtime"),
    script: "dev",
    env: {
      PORT: process.env.RUNTIME_PORT ?? "3002",
      HOST: process.env.RUNTIME_HOST ?? "127.0.0.1",
    },
  },
  {
    name: "visualization",
    cwd: path.join(repoRoot, "services", "visualization"),
    script: "dev",
    env: {
      PORT: process.env.VISUALIZATION_PORT ?? "3003",
      HOSTNAME: process.env.VISUALIZATION_HOST ?? "127.0.0.1",
    },
  },
  {
    name: "mna",
    cwd: path.join(repoRoot, "services", "memory-native-agent"),
    script: "dev",
    env: {
      MNA_HOST: process.env.MNA_HOST ?? "127.0.0.1",
      MNA_PORT: process.env.MNA_PORT ?? "4193",
      MNA_WORKSPACE_CWD: process.env.MNA_WORKSPACE_CWD ?? repoRoot,
    },
  },
];

const children = [];
let shuttingDown = false;

function prefixStream(stream, label, writer) {
  if (!stream) {
    return;
  }

  const lineReader = readline.createInterface({ input: stream });
  lineReader.on("line", (line) => {
    writer.write(`[${label}] ${line}\n`);
  });
}

function runBlockingStep(label, cwd, script, env) {
  process.stdout.write(`[${label}] 开始执行\n`);
  const result = isWindows
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", npmExecutable, "run", script], {
        cwd,
        env,
        stdio: "inherit",
        shell: false,
      })
    : spawnSync(npmExecutable, ["run", script], {
        cwd,
        env,
        stdio: "inherit",
        shell: false,
      });

  if (result.status !== 0) {
    throw new Error(`${label} 执行失败，请先确认本地数据库和依赖已经准备好。`);
  }
}

function killChildTree(child) {
  if (!child.pid) {
    return;
  }

  if (isWindows) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      shell: false,
    });
    return;
  }

  child.kill("SIGTERM");
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of children) {
    killChildTree(child);
  }

  setTimeout(() => {
    process.exit(exitCode);
  }, 300);
}

function spawnService(spec) {
  const child = isWindows
    ? spawn("cmd.exe", ["/d", "/s", "/c", npmExecutable, "run", spec.script], {
        cwd: spec.cwd,
        env: {
          ...sharedEnv,
          ...spec.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      })
    : spawn(npmExecutable, ["run", spec.script], {
        cwd: spec.cwd,
        env: {
          ...sharedEnv,
          ...spec.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });

  prefixStream(child.stdout, spec.name, process.stdout);
  prefixStream(child.stderr, spec.name, process.stderr);

  child.on("exit", (code) => {
    if (shuttingDown) {
      return;
    }

    process.stderr.write(`[${spec.name}] 已退出，退出码 ${code ?? 1}\n`);
    shutdown(code ?? 1);
  });

  child.on("error", (error) => {
    if (shuttingDown) {
      return;
    }

    process.stderr.write(`[${spec.name}] 启动失败：${error instanceof Error ? error.message : String(error)}\n`);
    shutdown(1);
  });

  children.push(child);
}

function printSummary() {
  process.stdout.write("Axis 开发栈已启动。\n");
  process.stdout.write(`storage: ${sharedEnv.STORAGE_API_BASE_URL}\n`);
  process.stdout.write(`retrieval-runtime: ${sharedEnv.RUNTIME_API_BASE_URL}\n`);
  process.stdout.write(`visualization: ${defaultVisualizationUrl}\n`);
  process.stdout.write(`memory-native-agent: ${sharedEnv.NEXT_PUBLIC_MNA_BASE_URL}\n`);
  process.stdout.write(`database: ${sharedEnv.DATABASE_URL}\n`);
}

try {
  if (process.env.AXIS_DEV_SKIP_MIGRATE !== "1") {
    runBlockingStep(
      "storage:migrate",
      path.join(repoRoot, "services", "storage"),
      "migrate",
      sharedEnv,
    );
    runBlockingStep(
      "runtime:migrate",
      path.join(repoRoot, "services", "retrieval-runtime"),
      "migrate",
      sharedEnv,
    );
  }

  for (const spec of serviceSpecs) {
    spawnService(spec);
  }

  printSummary();

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  shutdown(1);
}
