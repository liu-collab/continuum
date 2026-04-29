import { cp, mkdir, open, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import type { ChildProcess, StdioOptions } from "node:child_process";

import {
  DEFAULT_RUNTIME_URL,
  DEFAULT_STORAGE_URL,
  fetchJson,
  openBrowser,
  packageRootFromImportMeta,
  pathExists,
  spawnCrossPlatform,
  vendorPath,
} from "./utils.js";
import {
  continuumLogsDir,
  continuumHomeDir,
  continuumManagedDir,
  DEFAULT_MANAGED_DATABASE_NAME,
  DEFAULT_MANAGED_DATABASE_USER,
  DEFAULT_MANAGED_LEGACY_POSTGRES_CONTAINER,
  DEFAULT_MANAGED_POSTGRES_PORT,
  DEFAULT_MANAGED_STACK_CONTAINER,
  DEFAULT_MANAGED_STACK_IMAGE,
  type ManagedServiceRecord,
  readManagedState,
  resolveDatabasePasswordFromState,
  writeManagedState,
} from "./managed-state.js";
import {
  buildEmbeddingsEndpoint,
  resolveOptionalThirdPartyEmbeddingConfig,
} from "./embedding-config.js";
import { DEFAULT_MNA_PORT, startManagedMna } from "./mna-command.js";
import {
  continuumManagedMemoryLlmConfigPath,
  readManagedEmbeddingConfig,
  readManagedMemoryLlmConfig,
  readManagedWritebackLlmConfig,
  writeManagedEmbeddingConfig,
  writeManagedMemoryLlmConfig,
  writeManagedWritebackLlmConfig,
} from "./managed-config.js";
import { stopLegacyContinuumProcesses } from "./process-cleanup.js";
import { loadBuildStateHelpers } from "./build-state-loader.js";

const STAGE_DIR_NAME = "stack-stage";
const LOOPBACK_BIND_HOST = "127.0.0.1";
const WILDCARD_BIND_HOST = "0.0.0.0";
const POSTGRES_PORT_SCAN_LIMIT = 20;
const UI_DEV_SERVICE_NAME = "visualization-dev";
const UI_DEV_STACK_IMAGE = "continuum-local-ui-dev:latest";
const DEFAULT_UI_DEV_PORT = 3003;
const UI_DEV_PORT_SCAN_LIMIT = 20;

async function runForeground(command: string, args: string[], cwd?: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawnCrossPlatform(command, args, {
      cwd,
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
    const child = spawnCrossPlatform(command, args, {
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

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function isManagedVisualizationDevRecord(service: ManagedServiceRecord) {
  return (
    service.name === UI_DEV_SERVICE_NAME
    || service.name.startsWith(`${UI_DEV_SERVICE_NAME}:`)
  );
}

async function writeManagedVisualizationDevRecord(record: ManagedServiceRecord | null) {
  const state = await readManagedState();
  const services = state.services.filter((service) => !isManagedVisualizationDevRecord(service));
  if (record) {
    services.push(record);
  }

  await writeManagedState({
    ...state,
    services,
  });
}

async function terminateManagedProcess(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const child = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
        env: process.env,
      });

      child.on("exit", () => resolve());
      child.on("error", () => resolve());
    });
    return;
  }

  try {
    process.kill(pid, "SIGINT");
  } catch {
    return;
  }
}

async function stopManagedVisualizationDevServer() {
  const state = await readManagedState();
  const records = state.services.filter(isManagedVisualizationDevRecord);
  if (records.length === 0) {
    return false;
  }

  await Promise.all(records.map((service) => terminateManagedProcess(service.pid)));
  await writeManagedVisualizationDevRecord(null);
  return true;
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

async function isHealthy(url: string, timeoutMs: number) {
  const result = await fetchJson(url, timeoutMs);
  return result.ok;
}

async function managedBackendIsHealthy(storageUrl: string, runtimeUrl: string) {
  const [storageHealthy, runtimeHealthy] = await Promise.all([
    isHealthy(`${storageUrl}/health`, 1_500),
    isHealthy(`${runtimeUrl}/healthz`, 1_500),
  ]);

  return storageHealthy && runtimeHealthy;
}

function parsePort(rawValue: string | boolean | undefined, optionName: string) {
  if (typeof rawValue !== "string") {
    throw new Error(`不支持的 ${optionName}: ${rawValue}`);
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    throw new Error(`不支持的 ${optionName}: ${rawValue}`);
  }

  return parsed;
}

function buildUiDevReadModelDsn(
  options: Record<string, string | boolean>,
  managedState: { postgres?: { port: number }; dbPassword?: string },
  accessibleHost: string,
) {
  if (process.env.STORAGE_READ_MODEL_DSN) {
    return process.env.STORAGE_READ_MODEL_DSN;
  }

  const postgresPort =
    typeof options["postgres-port"] === "string"
      ? parsePort(options["postgres-port"], "--postgres-port")
      : managedState.postgres?.port ?? DEFAULT_MANAGED_POSTGRES_PORT;

  const databasePassword = resolveDatabasePasswordFromState(managedState);
  return `postgres://${DEFAULT_MANAGED_DATABASE_USER}:${databasePassword}@${accessibleHost}:${postgresPort}/${DEFAULT_MANAGED_DATABASE_NAME}`;
}

function resolveUiDevMna(
  options: Record<string, string | boolean>,
  managedState: { services: ManagedServiceRecord[] },
  accessibleHost: string,
) {
  const managedMna = managedState.services.find((service) => service.name === "memory-native-agent");
  const mnaHome =
    typeof options["mna-home"] === "string"
      ? options["mna-home"]
      : path.join(continuumManagedDir(), "mna");

  return {
    url:
      typeof options["mna-url"] === "string"
        ? options["mna-url"]
        : managedMna?.url ?? `http://${accessibleHost}:${DEFAULT_MNA_PORT}`,
    tokenPath:
      typeof options["mna-token-path"] === "string"
        ? options["mna-token-path"]
        : typeof options["mna-home"] === "string"
          ? path.join(mnaHome, "token.txt")
          : managedMna?.tokenPath ?? path.join(mnaHome, "token.txt"),
  };
}

async function waitForTcpAvailable(host: string, port: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const available = await isTcpPortAvailable(host, port);
    if (available) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `visualization dev 端口仍被占用: ${host}:${port}。旧的 --ui-dev 进程可能没有退出，请先运行 npm run stop，或手动结束占用 3003 的进程后重试。`,
  );
}

async function resolveUiDevPort(host: string, preferredPort = DEFAULT_UI_DEV_PORT) {
  for (let offset = 0; offset <= UI_DEV_PORT_SCAN_LIMIT; offset += 1) {
    const candidate = preferredPort + offset;
    if (await isTcpPortAvailable(host, candidate)) {
      if (candidate !== preferredPort) {
        process.stdout.write(`默认 visualization dev 端口 ${preferredPort} 不可用，自动切换到 ${candidate}。\n`);
      }

      return candidate;
    }
  }

  throw new Error(
    `未找到可用的 visualization dev 端口。已尝试 ${host}:${preferredPort}-${preferredPort + UI_DEV_PORT_SCAN_LIMIT}。`,
  );
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

async function isTcpPortAvailable(host: string, port: number) {
  return await new Promise<boolean>((resolve) => {
    const server = createServer();

    server.once("error", () => {
      server.close(() => resolve(false));
    });

    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    server.listen({
      host,
      port,
      exclusive: true,
    });
  });
}

export async function resolveManagedPostgresPort(
  options: Record<string, string | boolean>,
  bindHost: string,
  probePort: (host: string, port: number) => Promise<boolean> = isTcpPortAvailable,
) {
  const requestedPort =
    typeof options["postgres-port"] === "string"
      ? Number(options["postgres-port"])
      : DEFAULT_MANAGED_POSTGRES_PORT;
  const explicitPort = typeof options["postgres-port"] === "string";

  if (!Number.isInteger(requestedPort) || requestedPort <= 0 || requestedPort > 65_535) {
    throw new Error(`不支持的 --postgres-port: ${options["postgres-port"]}`);
  }

  if (explicitPort) {
    if (!(await probePort(bindHost, requestedPort))) {
      throw new Error(`postgres 端口不可用: ${bindHost}:${requestedPort}。请改用其他 --postgres-port。`);
    }

    return requestedPort;
  }

  for (let offset = 0; offset <= POSTGRES_PORT_SCAN_LIMIT; offset += 1) {
    const candidate = requestedPort + offset;
    if (!(await probePort(bindHost, candidate))) {
      continue;
    }

    if (candidate !== requestedPort) {
      process.stdout.write(
        `默认 postgres 端口 ${requestedPort} 不可用，自动切换到 ${candidate}。\n`,
      );
    }

    return candidate;
  }

  throw new Error(
    `未找到可用的 postgres 端口。已尝试 ${bindHost}:${requestedPort}-${requestedPort + POSTGRES_PORT_SCAN_LIMIT}。`,
  );
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

async function cleanupManagedStackContainer() {
  try {
    await runForegroundQuiet("docker", ["rm", "-f", DEFAULT_MANAGED_STACK_CONTAINER]);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("No such container")) {
      return false;
    }
    throw error;
  }
}

async function prepareStackContext(packageRoot: string, includeVisualization = true) {
  const stageDir = path.join(continuumHomeDir(), STAGE_DIR_NAME);
  await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });

  await cp(vendorPath(packageRoot, "storage"), path.join(stageDir, "storage"), {
    recursive: true,
  });
  await cp(vendorPath(packageRoot, "runtime"), path.join(stageDir, "runtime"), {
    recursive: true,
  });
  const visualizationTarget = path.join(stageDir, "visualization");
  if (includeVisualization) {
    await cp(vendorPath(packageRoot, "visualization", "standalone"), visualizationTarget, {
      recursive: true,
    });
  } else {
    await mkdir(visualizationTarget, { recursive: true });
  }
  await cp(vendorPath(packageRoot, "stack", "Dockerfile"), path.join(stageDir, "Dockerfile"));
  await cp(vendorPath(packageRoot, "stack", "entrypoint.mjs"), path.join(stageDir, "entrypoint.mjs"));

  return stageDir;
}

async function buildStackImage(stageDir: string, imageName = DEFAULT_MANAGED_STACK_IMAGE) {
  await runForeground("docker", ["build", "-t", imageName, stageDir]);
}

async function copyVisualizationVendorBundle(packageRoot: string) {
  const repoRoot = path.resolve(packageRoot, "..", "..");
  const visualizationDir = path.join(repoRoot, "services", "visualization");
  const standaloneSource = path.join(visualizationDir, ".next", "standalone");
  const staticSource = path.join(visualizationDir, ".next", "static");
  const publicSource = path.join(visualizationDir, "public");
  const visualizationVendorDir = vendorPath(packageRoot, "visualization");
  const targetDir = path.join(visualizationVendorDir, "standalone");

  await rm(visualizationVendorDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  await cp(standaloneSource, targetDir, { recursive: true });
  await cp(staticSource, path.join(targetDir, ".next", "static"), { recursive: true });
  if (await pathExists(publicSource)) {
    await cp(publicSource, path.join(targetDir, "public"), { recursive: true });
  }
}

async function refreshVisualizationVendor(
  packageRoot: string,
  buildState: Awaited<ReturnType<typeof loadBuildStateHelpers>>,
) {
  const vendorPlan = await buildState.planVendorBuild(packageRoot);
  const visualizationChanged = vendorPlan.changedEntries.includes("visualization");
  const visualizationNeedsBuild = vendorPlan.buildServices.includes("visualization");

  if (!visualizationChanged) {
    return {
      refreshed: false,
    };
  }

  process.stdout.write("检测到 visualization 变更，正在刷新前端产物...\n");
  if (visualizationNeedsBuild) {
    const repoRoot = path.resolve(packageRoot, "..", "..");
    const visualizationDir = path.join(repoRoot, "services", "visualization");
    await rm(path.join(visualizationDir, ".next"), { recursive: true, force: true }).catch(() => undefined);
    await runForeground("npm", ["run", "build"], visualizationDir);
  }
  await copyVisualizationVendorBundle(packageRoot);
  await buildState.writeBuildState({
    ...vendorPlan.currentState,
    vendor: {
      entries: {
        ...vendorPlan.currentState.vendor.entries,
        visualization: vendorPlan.nextState.vendor.entries.visualization,
      },
      builds: {
        ...vendorPlan.currentState.vendor.builds,
        visualization: vendorPlan.nextState.vendor.builds.visualization,
      },
    },
  });

  return {
    refreshed: true,
    visualizationNeedsBuild,
  };
}

async function copyMemoryNativeAgentVendorBundle(packageRoot: string) {
  const repoRoot = path.resolve(packageRoot, "..", "..");
  const sourceDir = path.join(repoRoot, "services", "memory-native-agent");
  const targetDir = vendorPath(packageRoot, "memory-native-agent");

  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  await cp(path.join(sourceDir, "bin"), path.join(targetDir, "bin"), { recursive: true });
  await cp(path.join(sourceDir, "dist"), path.join(targetDir, "dist"), { recursive: true });
  await cp(path.join(sourceDir, "node_modules"), path.join(targetDir, "node_modules"), { recursive: true });
  await cp(path.join(sourceDir, "package.json"), path.join(targetDir, "package.json"));
  if (await pathExists(path.join(sourceDir, "README.md"))) {
    await cp(path.join(sourceDir, "README.md"), path.join(targetDir, "README.md"));
  }
}

async function refreshMemoryNativeAgentVendor(
  packageRoot: string,
  buildState: Awaited<ReturnType<typeof loadBuildStateHelpers>>,
) {
  const vendorPlan = await buildState.planVendorBuild(packageRoot);
  const changed = vendorPlan.changedEntries.includes("memory-native-agent");
  const needsBuild = vendorPlan.buildServices.includes("memory-native-agent");

  if (!changed) {
    return {
      refreshed: false,
    };
  }

  process.stdout.write("检测到 memory-native-agent 变更，正在刷新 MNA 产物...\n");
  if (needsBuild) {
    const repoRoot = path.resolve(packageRoot, "..", "..");
    const serviceDir = path.join(repoRoot, "services", "memory-native-agent");
    await runForeground("npm", ["run", "build"], serviceDir);
  }
  await copyMemoryNativeAgentVendorBundle(packageRoot);
  await buildState.writeBuildState({
    ...vendorPlan.currentState,
    vendor: {
      entries: {
        ...vendorPlan.currentState.vendor.entries,
        "memory-native-agent": vendorPlan.nextState.vendor.entries["memory-native-agent"],
      },
      builds: {
        ...vendorPlan.currentState.vendor.builds,
        "memory-native-agent": vendorPlan.nextState.vendor.builds["memory-native-agent"],
      },
    },
  });

  return {
    refreshed: true,
    needsBuild,
  };
}

async function startManagedVisualizationDevServer(options: {
  packageRoot: string;
  bindHost: string;
  publicHost: string;
  readModelDsn: string;
  runtimeUrl: string;
  storageUrl: string;
  mnaUrl: string;
  mnaTokenPath: string;
}) {
  const repoRoot = path.resolve(options.packageRoot, "..", "..");
  const visualizationDir = path.join(repoRoot, "services", "visualization");
  const packageJsonPath = path.join(visualizationDir, "package.json");
  if (!(await pathExists(packageJsonPath))) {
    throw new Error("--ui-dev 仅支持在 Continuum 仓库源码目录中使用。");
  }

  await stopManagedVisualizationDevServer().catch(() => undefined);
  await mkdir(continuumLogsDir(), { recursive: true });

  const logPath = path.join(continuumLogsDir(), "visualization-dev.log");
  const port = String(await resolveUiDevPort(options.bindHost));
  const uiUrl = `http://${options.publicHost}:${port}`;
  const childEnv = {
    ...process.env,
    NODE_ENV: "development",
    STORAGE_API_BASE_URL: options.storageUrl,
    RUNTIME_API_BASE_URL: options.runtimeUrl,
    STORAGE_READ_MODEL_DSN: options.readModelDsn,
    STORAGE_READ_MODEL_SCHEMA: "storage_shared_v1",
    STORAGE_READ_MODEL_TABLE: "memory_read_model_v1",
    NEXT_PUBLIC_MNA_BASE_URL: options.mnaUrl,
    MNA_INTERNAL_BASE_URL: options.mnaUrl,
    MNA_TOKEN_PATH: options.mnaTokenPath,
  };
  const stdoutHandle = await open(logPath, "a");
  const stderrHandle = await open(logPath, "a");
  const stdio: StdioOptions = ["ignore", stdoutHandle.fd, stderrHandle.fd];
  const child: ChildProcess =
    process.platform === "win32"
      ? spawn(
          "cmd.exe",
          [
            "/d",
            "/s",
            "/c",
            npmCommand(),
            "run",
            "dev",
            "--",
            "--hostname",
            options.bindHost,
            "--port",
            port,
          ],
          {
            cwd: visualizationDir,
            detached: true,
            windowsHide: true,
            stdio,
            env: childEnv,
          },
        )
      : spawn(
          npmCommand(),
          ["run", "dev", "--", "--hostname", options.bindHost, "--port", port],
          {
            cwd: visualizationDir,
            detached: true,
            windowsHide: true,
            stdio,
            env: childEnv,
          },
        );
  child.unref();
  await stdoutHandle.close();
  await stderrHandle.close();

  const exitPromise = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => resolve(code));
    child.once("error", () => resolve(1));
  });

  try {
    await Promise.race([
      waitForHealthy(`${uiUrl}/api/health/readiness`, 30_000),
      exitPromise.then((code) => {
        throw new Error(`visualization dev 启动失败，退出码 ${code ?? 1}`);
      }),
    ]);
  } catch (error) {
    await writeManagedVisualizationDevRecord(null).catch(() => undefined);
    throw error;
  }

  await writeManagedVisualizationDevRecord({
    name: UI_DEV_SERVICE_NAME,
    pid: child.pid ?? 0,
    logPath,
    url: uiUrl,
  });

  return {
    url: uiUrl,
    logPath,
  };
}

async function startStackContainer(
  port: number,
  bindHost: string,
  publicHost: string,
  databasePassword: string,
  embeddingConfigPath: string,
  memoryLlmConfigPath: string,
  publishVisualizationPort: boolean,
  imageName = DEFAULT_MANAGED_STACK_IMAGE,
) {
  const internalDatabaseUrl = `postgres://${DEFAULT_MANAGED_DATABASE_USER}:${databasePassword}@127.0.0.1:5432/${DEFAULT_MANAGED_DATABASE_NAME}`;
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
    "-v",
    `${managedDir}:/opt/continuum/managed`,
    "-e",
    `POSTGRES_DB=${DEFAULT_MANAGED_DATABASE_NAME}`,
    "-e",
    `POSTGRES_USER=${DEFAULT_MANAGED_DATABASE_USER}`,
    "-e",
    `POSTGRES_PASSWORD=${databasePassword}`,
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
    `NEXT_PUBLIC_MNA_BASE_URL=http://${publicHost}:${DEFAULT_MNA_PORT}`,
    "-e",
    `MNA_INTERNAL_BASE_URL=http://host.docker.internal:${DEFAULT_MNA_PORT}`,
    "-e",
    "MNA_TOKEN_PATH=/opt/continuum/managed/mna/token.txt",
    "-e",
    `CONTINUUM_EMBEDDING_CONFIG_PATH=${embeddingConfigPath}`,
    "-e",
    `CONTINUUM_MEMORY_LLM_CONFIG_PATH=${memoryLlmConfigPath}`,
    "-e",
    "CONTINUUM_RUNTIME_CONFIG_PATH=/opt/continuum/managed/runtime-config.json",
  ];

  if (publishVisualizationPort) {
    dockerArgs.push("-p", `${bindHost}:3003:3003`);
  } else {
    dockerArgs.push("-e", "CONTINUUM_DISABLE_STACK_VISUALIZATION=1");
  }

  dockerArgs.push(imageName);

  await runForeground("docker", dockerArgs);
}

export async function runStartCommand(
  options: Record<string, string | boolean>,
  importMetaUrl: string,
) {
  const packageRoot = packageRootFromImportMeta(importMetaUrl);
  const bindHost = normalizeBindHost(options["bind-host"]);
  const accessibleHost = resolveAccessibleHost(bindHost);
  const uiDev = options["ui-dev"] === true || options["ui-dev"] === "true";
  const initialManagedState = await readManagedState();
  const open = options.open === true || options.open === "true";
  const storageUrl = `http://${accessibleHost}:3001`;
  const runtimeUrl = `http://${accessibleHost}:3002`;
  const uiUrl = `http://${accessibleHost}:3003`;
  const uiDevBackendHealthy = uiDev
    ? await managedBackendIsHealthy(storageUrl, runtimeUrl)
    : false;

  if (uiDev && uiDevBackendHealthy) {
    const mna = resolveUiDevMna(options, initialManagedState, accessibleHost);
    const devServer = await startManagedVisualizationDevServer({
      packageRoot,
      bindHost,
      publicHost: accessibleHost,
      readModelDsn: buildUiDevReadModelDsn(options, initialManagedState, accessibleHost),
      runtimeUrl,
      storageUrl,
      mnaUrl: mna.url,
      mnaTokenPath: mna.tokenPath,
    });

    process.stdout.write("Continuum visualization dev 已启动。\n");
    process.stdout.write("backend: 复用现有 storage/runtime，未重启其他服务。\n");
    process.stdout.write(`bind-host: ${bindHost}\n`);
    process.stdout.write(`storage: ${storageUrl}\n`);
    process.stdout.write(`runtime: ${runtimeUrl}\n`);
    process.stdout.write(`visualization: ${devServer.url} (dev)\n`);
    process.stdout.write(`log: ${devServer.logPath}\n`);

    if (open) {
      await openBrowser(devServer.url);
    }

    return;
  }

  const buildState = await loadBuildStateHelpers(packageRoot);
  const postgresPort = await resolveManagedPostgresPort(options, bindHost);
  const databasePassword = resolveDatabasePasswordFromState(initialManagedState);
  const readModelDsn =
    process.env.STORAGE_READ_MODEL_DSN
    ?? `postgres://${DEFAULT_MANAGED_DATABASE_USER}:${databasePassword}@${accessibleHost}:${postgresPort}/${DEFAULT_MANAGED_DATABASE_NAME}`;
  const embeddingConfigPath = "/opt/continuum/managed/embedding-config.json";
  const stackMemoryLlmConfigPath = "/opt/continuum/managed/memory-llm-config.json";
  const localMemoryLlmConfigPath = continuumManagedMemoryLlmConfigPath();
  const existingEmbeddingConfig = await readManagedEmbeddingConfig();
  const existingMemoryLlmConfig = await readManagedMemoryLlmConfig();
  const existingWritebackLlmConfig = await readManagedWritebackLlmConfig();
  const requestedEmbeddingConfig = resolveOptionalThirdPartyEmbeddingConfig(options);
  const mergedEmbeddingConfig = {
    version: 1 as const,
    ...(existingEmbeddingConfig ?? {}),
    ...requestedEmbeddingConfig,
  };

  await writeManagedEmbeddingConfig(mergedEmbeddingConfig);
  const mergedMemoryLlmConfig = {
    version: 1 as const,
    ...(existingWritebackLlmConfig ?? {}),
    ...(existingMemoryLlmConfig ?? {}),
  };
  await writeManagedMemoryLlmConfig(mergedMemoryLlmConfig);
  await writeManagedWritebackLlmConfig(mergedMemoryLlmConfig);

  await mkdir(continuumHomeDir(), { recursive: true });
  await ensureDockerInstalled();
  await ensureDockerDaemonReady();
  await stopLegacyContinuumProcesses();
  await stopLegacyPostgresContainer();
  await stopManagedVisualizationDevServer().catch(() => undefined);

  const vendorRefresh = uiDev
    ? { refreshed: false, visualizationNeedsBuild: false }
    : await refreshVisualizationVendor(packageRoot, buildState);
  const mnaVendorRefresh = await refreshMemoryNativeAgentVendor(packageRoot, buildState);
  let stackImageName = DEFAULT_MANAGED_STACK_IMAGE;

  const stackImagePlan = await buildState.planStackImageBuild(packageRoot);
  if (stackImagePlan.needsBuild) {
    stackImageName = uiDev ? UI_DEV_STACK_IMAGE : DEFAULT_MANAGED_STACK_IMAGE;
    const stageDir = await prepareStackContext(packageRoot, !uiDev);
    await buildStackImage(stageDir, stackImageName);
    if (!uiDev) {
      await buildState.writeBuildState(stackImagePlan.nextState);
    }
  } else {
    process.stdout.write(`docker image 已是最新，跳过 build: ${stackImageName}\n`);
    if (vendorRefresh.refreshed) {
      process.stdout.write("visualization 已刷新，沿用现有 stack image。\n");
    }
    if (mnaVendorRefresh.refreshed) {
      process.stdout.write("memory-native-agent 已刷新，沿用现有 stack image。\n");
    }
  }

  // Remove old container only after successful build.
  await cleanupManagedStackContainer().catch(() => undefined);

  try {
    let startedVisualizationUrl = uiUrl;
    let startedVisualizationLogPath: string | null = null;

    await startStackContainer(
      postgresPort,
      bindHost,
      accessibleHost,
      databasePassword,
      embeddingConfigPath,
      stackMemoryLlmConfigPath,
      !uiDev,
      stackImageName,
    );

    await waitForHealthy(`${storageUrl}/health`, 120_000);
    await waitForHealthy(`${runtimeUrl}/healthz`, 120_000);
    const mna = await startManagedMna(
      {
        ...options,
        "runtime-url": runtimeUrl,
        "memory-llm-config-path": localMemoryLlmConfigPath,
      },
      importMetaUrl,
    );
    if (uiDev) {
      const devServer = await startManagedVisualizationDevServer({
        packageRoot,
        bindHost,
        publicHost: accessibleHost,
        readModelDsn,
        runtimeUrl,
        storageUrl,
        mnaUrl: mna.url,
        mnaTokenPath: mna.tokenPath,
      });
      startedVisualizationUrl = devServer.url;
      startedVisualizationLogPath = devServer.logPath;
    } else {
      await waitForHealthy(`${uiUrl}/api/health/readiness`, 120_000);
    }

    const latestManagedState = await readManagedState();
    await writeManagedState({
      ...latestManagedState,
      version: 1,
      dbPassword: databasePassword,
      postgres: {
        containerName: DEFAULT_MANAGED_STACK_CONTAINER,
        port: postgresPort,
        database: DEFAULT_MANAGED_DATABASE_NAME,
        username: DEFAULT_MANAGED_DATABASE_USER,
      },
      services: latestManagedState.services,
    });

    process.stdout.write("Continuum 已启动。\n");
    process.stdout.write(`container: ${DEFAULT_MANAGED_STACK_CONTAINER}\n`);
    process.stdout.write(`bind-host: ${bindHost}\n`);
    process.stdout.write(`postgres: ${accessibleHost}:${postgresPort}\n`);
    process.stdout.write(`storage: ${storageUrl}\n`);
    process.stdout.write(`runtime: ${runtimeUrl}\n`);
    process.stdout.write(`visualization: ${startedVisualizationUrl}${uiDev ? " (dev)" : ""}\n`);
    if (startedVisualizationLogPath) {
      process.stdout.write(`visualization log: ${startedVisualizationLogPath}\n`);
    }
    process.stdout.write(`memory-native-agent: ${mna.url}\n`);
    if (mergedEmbeddingConfig.baseUrl && mergedEmbeddingConfig.model) {
      process.stdout.write(
        `third-party embeddings: ${buildEmbeddingsEndpoint(mergedEmbeddingConfig.baseUrl)} (${mergedEmbeddingConfig.model})\n`,
      );
    } else {
      process.stdout.write("third-party embeddings: 未配置，可在页面中补充 EMBEDDING_BASE_URL 和 EMBEDDING_MODEL。\n");
    }

    if (open) {
      await openBrowser(startedVisualizationUrl);
    }
  } catch (error) {
    const cleaned = await cleanupManagedStackContainer().catch(() => false);
    if (cleaned) {
      process.stderr.write(`Continuum 启动失败，已清理未完成容器: ${DEFAULT_MANAGED_STACK_CONTAINER}\n`);
    }
    throw error;
  }
}
