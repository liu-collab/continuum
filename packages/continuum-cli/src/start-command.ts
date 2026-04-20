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
  continuumManagedDir,
  DEFAULT_MANAGED_DATABASE_NAME,
  DEFAULT_MANAGED_DATABASE_PASSWORD,
  DEFAULT_MANAGED_DATABASE_USER,
  DEFAULT_MANAGED_LEGACY_POSTGRES_CONTAINER,
  DEFAULT_MANAGED_POSTGRES_PORT,
  DEFAULT_MANAGED_STACK_CONTAINER,
  DEFAULT_MANAGED_STACK_IMAGE,
  readManagedState,
  writeManagedState,
} from "./managed-state.js";
import {
  buildEmbeddingsEndpoint,
  resolveOptionalThirdPartyEmbeddingConfig,
} from "./embedding-config.js";
import { DEFAULT_MNA_PORT, startManagedMna } from "./mna-command.js";
import {
  continuumManagedEmbeddingConfigPath,
  readManagedEmbeddingConfig,
  writeManagedEmbeddingConfig,
} from "./managed-config.js";
import { stopLegacyContinuumProcesses } from "./process-cleanup.js";

const STAGE_DIR_NAME = "stack-stage";
const LOOPBACK_BIND_HOST = "127.0.0.1";
const WILDCARD_BIND_HOST = "0.0.0.0";

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
  if (process.platform !== "win32") {
    throw new Error(
      "continuum start 当前仅支持 Windows 平台。其他平台请手动运行各服务或使用 Docker Compose。",
    );
  }

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

function normalizeBindHost(rawValue: string | boolean | undefined) {
  const bindHost = typeof rawValue === "string" ? rawValue : LOOPBACK_BIND_HOST;

  if (bindHost !== LOOPBACK_BIND_HOST && bindHost !== WILDCARD_BIND_HOST) {
    throw new Error(
      `不支持的 --bind-host: ${bindHost}。当前仅支持 ${LOOPBACK_BIND_HOST} 或 ${WILDCARD_BIND_HOST}。`,
    );
  }

  return bindHost;
}

function resolveAccessibleHost(bindHost: string) {
  return bindHost === WILDCARD_BIND_HOST ? LOOPBACK_BIND_HOST : bindHost;
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

async function startStackContainer(
  port: number,
  bindHost: string,
  embeddingConfigPath: string,
) {
  const internalDatabaseUrl = `postgres://${DEFAULT_MANAGED_DATABASE_USER}:${DEFAULT_MANAGED_DATABASE_PASSWORD}@127.0.0.1:5432/${DEFAULT_MANAGED_DATABASE_NAME}`;
  const managedDir = continuumManagedDir();
  const managedMnaDir = path.join(managedDir, "mna");
  await mkdir(managedDir, { recursive: true });
  await mkdir(managedMnaDir, { recursive: true });

  // Container-internal loopback: all services run in same container
  const dockerArgs = [
    "run",
    "-d",
    "--name",
    DEFAULT_MANAGED_STACK_CONTAINER,
    "-p",
    `${bindHost}:${port}:5432`,
    "-p",
    `${bindHost}:3001:3001`,
    "-p",
    `${bindHost}:3002:3002`,
    "-p",
    `${bindHost}:3003:3003`,
    "-v",
    `${managedDir}:/opt/continuum/managed`,
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
    `STORAGE_READ_MODEL_DSN=${internalDatabaseUrl}`,
    "-e",
    "STORAGE_READ_MODEL_SCHEMA=storage_shared_v1",
    "-e",
    "STORAGE_READ_MODEL_TABLE=memory_read_model_v1",
    "-e",
    `STORAGE_API_BASE_URL=${DEFAULT_STORAGE_URL}`,
    "-e",
    `RUNTIME_API_BASE_URL=${DEFAULT_RUNTIME_URL}`,
    "-e",
    `NEXT_PUBLIC_MNA_BASE_URL=http://host.docker.internal:${DEFAULT_MNA_PORT}`,
    "-e",
    "MNA_TOKEN_PATH=/opt/continuum/managed/mna/token.txt",
    "-e",
    `CONTINUUM_EMBEDDING_CONFIG_PATH=${embeddingConfigPath}`,
  ];

  dockerArgs.push(DEFAULT_MANAGED_STACK_IMAGE);

  await runForeground("docker", dockerArgs);
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
  const bindHost = normalizeBindHost(options["bind-host"]);
  const accessibleHost = resolveAccessibleHost(bindHost);
  const open = options.open === true || options.open === "true";
  const storageUrl = `http://${accessibleHost}:3001`;
  const runtimeUrl = `http://${accessibleHost}:3002`;
  const uiUrl = `http://${accessibleHost}:3003`;
  const embeddingConfigPath = "/opt/continuum/managed/embedding-config.json";
  const existingEmbeddingConfig = await readManagedEmbeddingConfig();
  const requestedEmbeddingConfig = resolveOptionalThirdPartyEmbeddingConfig(options);
  const mergedEmbeddingConfig = {
    version: 1 as const,
    ...(existingEmbeddingConfig ?? {}),
    ...requestedEmbeddingConfig,
  };

  await writeManagedEmbeddingConfig(mergedEmbeddingConfig);

  await mkdir(continuumHomeDir(), { recursive: true });
  await ensureDockerInstalled();
  await ensureDockerDaemonReady();
  await stopLegacyContinuumProcesses();
  await stopLegacyPostgresContainer();

  const stageDir = await prepareStackContext(packageRoot);
  await buildStackImage(stageDir);

  // Remove old container only after successful build
  await runForegroundQuiet("docker", ["rm", "-f", DEFAULT_MANAGED_STACK_CONTAINER]).catch(
    () => undefined,
  );

  await startStackContainer(postgresPort, bindHost, embeddingConfigPath);

  await waitForHealthy(`${storageUrl}/health`, 120_000);
  await waitForHealthy(`${runtimeUrl}/healthz`, 120_000);
  await waitForHealthy(`${uiUrl}/api/health/readiness`, 120_000);
  const mna = await startManagedMna(
    {
      ...options,
      "runtime-url": runtimeUrl,
    },
    importMetaUrl,
  );

  await writeManagedState({
    version: 1,
    postgres: {
      containerName: DEFAULT_MANAGED_STACK_CONTAINER,
      port: postgresPort,
      database: DEFAULT_MANAGED_DATABASE_NAME,
      username: DEFAULT_MANAGED_DATABASE_USER,
    },
    services: (await readManagedState()).services,
  });

  process.stdout.write("Continuum 已启动。\n");
  process.stdout.write(`container: ${DEFAULT_MANAGED_STACK_CONTAINER}\n`);
  process.stdout.write(`bind-host: ${bindHost}\n`);
  process.stdout.write(`postgres: ${accessibleHost}:${postgresPort}\n`);
  process.stdout.write(`storage: ${storageUrl}\n`);
  process.stdout.write(`runtime: ${runtimeUrl}\n`);
  process.stdout.write(`visualization: ${uiUrl}\n`);
  process.stdout.write(`memory-native-agent: ${mna.url}\n`);
  if (mergedEmbeddingConfig.baseUrl && mergedEmbeddingConfig.model) {
    process.stdout.write(
      `third-party embeddings: ${buildEmbeddingsEndpoint(mergedEmbeddingConfig.baseUrl)} (${mergedEmbeddingConfig.model})\n`,
    );
  } else {
    process.stdout.write("third-party embeddings: 未配置，可在页面中补充 EMBEDDING_BASE_URL 和 EMBEDDING_MODEL。\n");
  }

  if (open) {
    await openBrowser(uiUrl);
  }
}
