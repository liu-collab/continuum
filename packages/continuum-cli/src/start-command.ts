import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

import {
  DEFAULT_RUNTIME_URL,
  DEFAULT_STORAGE_URL,
  DEFAULT_UI_URL,
  fetchJson,
  openBrowser,
  packageRootFromImportMeta,
  pathExists,
  vendorPath,
} from "./utils.js";
import {
  continuumHomeDir,
  DEFAULT_MANAGED_DATABASE_NAME,
  DEFAULT_MANAGED_DATABASE_PASSWORD,
  DEFAULT_MANAGED_DATABASE_USER,
  DEFAULT_MANAGED_EMBEDDINGS_URL,
  DEFAULT_MANAGED_LEGACY_POSTGRES_CONTAINER,
  DEFAULT_MANAGED_POSTGRES_PORT,
  DEFAULT_MANAGED_STACK_CONTAINER,
  DEFAULT_MANAGED_STACK_IMAGE,
  writeManagedState,
} from "./managed-state.js";

const STAGE_DIR_NAME = "stack-stage";

async function runForeground(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child =
      process.platform === "win32"
        ? spawn("cmd", ["/c", command, ...args], {
            stdio: "inherit",
            env: process.env,
          })
        : spawn(command, args, {
            stdio: "inherit",
            env: process.env,
          });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`command failed: ${command} ${args.join(" ")}`));
    });
    child.on("error", reject);
  });
}

async function runForegroundQuiet(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child =
      process.platform === "win32"
        ? spawn("cmd", ["/c", command, ...args], {
            stdio: "ignore",
            env: process.env,
          })
        : spawn(command, args, {
            stdio: "ignore",
            env: process.env,
          });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`command failed: ${command} ${args.join(" ")}`));
    });
    child.on("error", reject);
  });
}

async function waitForHealthy(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await fetchJson(url, 1_500);
    if (result.ok) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }

  throw new Error(`服务未在预期时间内就绪: ${url}`);
}

async function ensureDockerInstalled() {
  try {
    await runForegroundQuiet("docker", ["--version"]);
  } catch {
    process.stdout.write("Docker 未安装，开始尝试自动安装 Docker Desktop。\n");
    await runForeground("winget", [
      "install",
      "-e",
      "--id",
      "Docker.DockerDesktop",
      "--accept-package-agreements",
      "--accept-source-agreements",
    ]);
  }
}

async function ensureDockerDaemonReady() {
  try {
    await runForegroundQuiet("docker", ["version"]);
    return;
  } catch {
    process.stdout.write("Docker 已安装，但当前未启动，正在尝试启动 Docker Desktop。\n");
  }

  const dockerDesktopExe = "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe";
  if (await pathExists(dockerDesktopExe)) {
    spawn(dockerDesktopExe, [], {
      detached: true,
      stdio: "ignore",
    }).unref();
  }

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      await runForegroundQuiet("docker", ["version"]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }

  throw new Error("Docker daemon 未就绪，无法启动 Continuum。");
}

async function stopLegacyContinuumProcesses() {
  await runForegroundQuiet("powershell", [
    "-NoLogo",
    "-NoProfile",
    "-Command",
    "Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Where-Object { $_.CommandLine -like '*continuum*embeddings*' -or $_.CommandLine -like '*storage/dist/src/server.js*' -or $_.CommandLine -like '*storage/dist/src/worker.js*' -or $_.CommandLine -like '*retrieval-runtime/dist/src/index.js*' -or $_.CommandLine -like '*visualization/standalone/server.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }",
  ]).catch(() => undefined);
}

async function stopLegacyPostgresContainer() {
  await runForegroundQuiet("docker", ["rm", "-f", DEFAULT_MANAGED_LEGACY_POSTGRES_CONTAINER]).catch(
    () => undefined,
  );
}

async function prepareStackContext(packageRoot: string) {
  const stageDir = path.join(continuumHomeDir(), STAGE_DIR_NAME);
  await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });

  await cp(vendorPath(packageRoot, "stack", "storage-src"), path.join(stageDir, "storage"), {
    recursive: true,
  });
  await cp(vendorPath(packageRoot, "stack", "runtime-src"), path.join(stageDir, "runtime"), {
    recursive: true,
  });
  await cp(vendorPath(packageRoot, "stack", "visualization-src"), path.join(stageDir, "visualization"), {
    recursive: true,
  });
  await cp(vendorPath(packageRoot, "stack", "Dockerfile"), path.join(stageDir, "Dockerfile"));
  await cp(vendorPath(packageRoot, "stack", "entrypoint.mjs"), path.join(stageDir, "entrypoint.mjs"));

  return stageDir;
}

async function buildStackImage(stageDir: string) {
  await runForeground("docker", ["build", "-t", DEFAULT_MANAGED_STACK_IMAGE, stageDir]);
}

async function startStackContainer(port: number) {
  const internalDatabaseUrl = `postgres://${DEFAULT_MANAGED_DATABASE_USER}:${DEFAULT_MANAGED_DATABASE_PASSWORD}@127.0.0.1:5432/${DEFAULT_MANAGED_DATABASE_NAME}`;

  await runForegroundQuiet("docker", ["rm", "-f", DEFAULT_MANAGED_STACK_CONTAINER]).catch(
    () => undefined,
  );

  await runForeground("docker", [
    "run",
    "-d",
    "--name",
    DEFAULT_MANAGED_STACK_CONTAINER,
    "-p",
    `${port}:5432`,
    "-p",
    "3001:3001",
    "-p",
    "3002:3002",
    "-p",
    "3003:3003",
    "-p",
    "31434:31434",
    "-e",
    `POSTGRES_DB=${DEFAULT_MANAGED_DATABASE_NAME}`,
    "-e",
    `POSTGRES_USER=${DEFAULT_MANAGED_DATABASE_USER}`,
    "-e",
    `POSTGRES_PASSWORD=${DEFAULT_MANAGED_DATABASE_PASSWORD}`,
    "-e",
    `DATABASE_URL=${internalDatabaseUrl}`,
    "-e",
    "STORAGE_SCHEMA_PRIVATE=storage_private",
    "-e",
    "STORAGE_SCHEMA_SHARED=storage_shared_v1",
    "-e",
    "READ_MODEL_SCHEMA=storage_shared_v1",
    "-e",
    "READ_MODEL_TABLE=memory_read_model_v1",
    "-e",
    "RUNTIME_SCHEMA=runtime_private",
    "-e",
    `STORAGE_WRITEBACK_URL=${DEFAULT_STORAGE_URL}`,
    "-e",
    `EMBEDDING_BASE_URL=${DEFAULT_MANAGED_EMBEDDINGS_URL}`,
    "-e",
    "EMBEDDING_MODEL=continuum-local-embed",
    "-e",
    `STORAGE_READ_MODEL_DSN=${internalDatabaseUrl}`,
    "-e",
    "STORAGE_READ_MODEL_SCHEMA=storage_shared_v1",
    "-e",
    "STORAGE_READ_MODEL_TABLE=memory_read_model_v1",
    "-e",
    `STORAGE_API_BASE_URL=${DEFAULT_STORAGE_URL}`,
    "-e",
    `RUNTIME_API_BASE_URL=${DEFAULT_RUNTIME_URL}`,
    DEFAULT_MANAGED_STACK_IMAGE,
  ]);
}

export async function runStartCommand(
  options: Record<string, string | boolean>,
  importMetaUrl: string,
) {
  const packageRoot = packageRootFromImportMeta(importMetaUrl);
  const postgresPort =
    typeof options["postgres-port"] === "string"
      ? Number(options["postgres-port"])
      : DEFAULT_MANAGED_POSTGRES_PORT;
  const open = options.open === true || options.open === "true";

  await mkdir(continuumHomeDir(), { recursive: true });
  await ensureDockerInstalled();
  await ensureDockerDaemonReady();
  await stopLegacyContinuumProcesses();
  await stopLegacyPostgresContainer();

  const stageDir = await prepareStackContext(packageRoot);
  await buildStackImage(stageDir);
  await startStackContainer(postgresPort);

  await waitForHealthy(`${DEFAULT_MANAGED_EMBEDDINGS_URL}/health`, 60_000);
  await waitForHealthy(`${DEFAULT_STORAGE_URL}/health`, 120_000);
  await waitForHealthy(`${DEFAULT_RUNTIME_URL}/healthz`, 120_000);
  await waitForHealthy(`${DEFAULT_UI_URL}/api/health/readiness`, 120_000);

  await writeManagedState({
    version: 1,
    postgres: {
      containerName: DEFAULT_MANAGED_STACK_CONTAINER,
      port: postgresPort,
      database: DEFAULT_MANAGED_DATABASE_NAME,
      username: DEFAULT_MANAGED_DATABASE_USER,
    },
    services: [],
  });

  process.stdout.write("Continuum 已启动。\n");
  process.stdout.write(`container: ${DEFAULT_MANAGED_STACK_CONTAINER}\n`);
  process.stdout.write(`postgres: 127.0.0.1:${postgresPort}\n`);
  process.stdout.write(`storage: ${DEFAULT_STORAGE_URL}\n`);
  process.stdout.write(`runtime: ${DEFAULT_RUNTIME_URL}\n`);
  process.stdout.write(`visualization: ${DEFAULT_UI_URL}\n`);
  process.stdout.write(`embeddings: ${DEFAULT_MANAGED_EMBEDDINGS_URL}\n`);

  if (open) {
    await openBrowser(DEFAULT_UI_URL);
  }
}
