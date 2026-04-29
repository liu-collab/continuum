import { mkdir, open } from "node:fs/promises";
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
  terminateProcess,
  waitForHealthy,
} from "./utils.js";
import {
  axisLogsDir,
  axisHomeDir,
  axisManagedDir,
  DEFAULT_MANAGED_DATABASE_NAME,
  DEFAULT_MANAGED_DATABASE_USER,
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
  axisManagedConfigPath,
  axisManagedSecretsPath,
  migrateManagedConfigFiles,
  mergeManagedConfig,
  readManagedEmbeddingConfig,
  readManagedMnaProviderConfig,
  readManagedMemoryLlmConfig,
  resolveOptionalManagedMemoryLlmCliConfig,
  resolveOptionalManagedMemoryLlmEnvConfig,
  type ManagedEmbeddingConfig,
  type ManagedWritebackLlmConfig,
  writeManagedEmbeddingConfig,
  writeManagedMemoryLlmConfig,
} from "./managed-config.js";
import { bilingualMessage } from "./messages.js";
import { stopLegacyAxisProcesses } from "./process-cleanup.js";
import { loadBuildStateHelpers } from "./build-state-loader.js";
import {
  buildDockerHostGatewayArgs,
  buildStackImage,
  cleanupManagedStackContainer,
  ensureDockerDaemonReady,
  ensureDockerInstalled,
  prepareStackContext,
  pruneDanglingDockerImages,
  saveDockerContainerLogs,
  stopLegacyPostgresContainer,
} from "./docker-lifecycle.js";
import { npmCommand, runForeground } from "./managed-process.js";
import { resolvePlatformUserId } from "./platform-user.js";
import {
  assertFixedServicePortsAvailable,
  DEFAULT_RUNTIME_PORT,
  DEFAULT_STORAGE_PORT,
  DEFAULT_VISUALIZATION_PORT,
  normalizeBindHost,
  parsePort,
  parsePortEnv,
  resolveAccessibleHost,
  resolveManagedPostgresPort,
  resolveUiDevPort,
} from "./port-utils.js";
import {
  refreshMemoryNativeAgentVendor,
  refreshVisualizationVendor,
} from "./vendor-refresh.js";
import { maybeWriteUpdateNotice } from "./version-check.js";

export { resolveManagedPostgresPort } from "./port-utils.js";

const UI_DEV_SERVICE_NAME = "visualization-dev";
const UI_DEV_STACK_IMAGE = "axis-local-ui-dev:latest";

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

async function stopManagedVisualizationDevServer() {
  const state = await readManagedState();
  const records = state.services.filter(isManagedVisualizationDevRecord);
  if (records.length === 0) {
    return false;
  }

  await Promise.all(records.map((service) => terminateProcess(service.pid)));
  await writeManagedVisualizationDevRecord(null);
  return true;
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
      : path.join(axisManagedDir(), "mna");

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

function hasExplicitMnaConnectionOptions(options: Record<string, string | boolean>) {
  return typeof options["mna-url"] === "string" || typeof options["mna-token-path"] === "string";
}

function resolveStoragePort() {
  return parsePortEnv(process.env.STORAGE_PORT, "STORAGE_PORT", DEFAULT_STORAGE_PORT);
}

function resolveRuntimePort() {
  return parsePortEnv(process.env.RUNTIME_PORT, "RUNTIME_PORT", DEFAULT_RUNTIME_PORT);
}

function resolveVisualizationPort() {
  if (process.env.UI_PORT !== undefined && process.env.UI_PORT.trim() !== "") {
    return parsePortEnv(process.env.UI_PORT, "UI_PORT", DEFAULT_VISUALIZATION_PORT);
  }

  return parsePortEnv(process.env.VISUALIZATION_PORT, "VISUALIZATION_PORT", DEFAULT_VISUALIZATION_PORT);
}

function buildServiceUrl(host: string, port: number) {
  return `http://${host}:${port}`;
}

async function isPrimaryProviderConfigured(options: Record<string, string | boolean>) {
  if (
    typeof options["provider-kind"] === "string"
    || typeof options["provider-model"] === "string"
    || typeof options["provider-base-url"] === "string"
    || typeof options["provider-api-key-env"] === "string"
  ) {
    return true;
  }

  const persisted = await readManagedMnaProviderConfig(path.join(axisManagedDir(), "mna")).catch(() => null);
  return Boolean(persisted && persisted.kind !== "demo");
}

function writeMissingPrimaryProviderWarning() {
  process.stdout.write(`${bilingualMessage(
    "⚠ 尚未配置主模型。请在 Agent 页面的设置面板中配置 provider，或通过 axis start --provider-kind <kind> --provider-model <model> 指定。",
    "⚠ Primary model is not configured. Configure a provider in the Agent settings panel, or specify one with axis start --provider-kind <kind> --provider-model <model>.",
  )}\n`);
}

async function writeLegacyContinuumNotice() {
  const legacyDir = path.join(path.dirname(axisHomeDir()), ".continuum");
  if (!(await pathExists(legacyDir)) || await pathExists(axisHomeDir())) {
    return;
  }

  process.stdout.write(`${bilingualMessage(
    `检测到旧版 ~/.continuum/ 数据目录。Axis 现在使用 ~/.axis/，如需保留旧数据，请先迁移后再启动。旧目录: ${legacyDir}`,
    `Detected the legacy ~/.continuum/ data directory. Axis now uses ~/.axis/. Migrate old data before starting if you need to keep it. Legacy directory: ${legacyDir}`,
  )}\n`);
}

function writeDaemonNotice(enabled: boolean) {
  if (!enabled) {
    return;
  }

  process.stdout.write(`${bilingualMessage(
    "daemon 模式已启用，服务会在后台运行。查看状态使用 axis status，查看 mna 日志使用 axis mna logs。",
    "Daemon mode is enabled. Services run in the background. Use axis status for status and axis mna logs for mna logs.",
  )}\n`);
}

function writeProgress(message: string, english: string) {
  process.stdout.write(`${bilingualMessage(message, english)}\n`);
}

function writeProgressDone(message: string, english: string) {
  process.stdout.write(`✓ ${bilingualMessage(message, english)}\n`);
}

async function startManagedVisualizationDevServer(options: {
  packageRoot: string;
  bindHost: string;
  publicHost: string;
  platformUserId: string;
  readModelDsn: string;
  runtimeUrl: string;
  storageUrl: string;
  mnaUrl: string;
  mnaTokenPath: string;
  storagePort: number;
  runtimePort: number;
}) {
  const repoRoot = path.resolve(options.packageRoot, "..", "..");
  const visualizationDir = path.join(repoRoot, "services", "visualization");
  const packageJsonPath = path.join(visualizationDir, "package.json");
  if (!(await pathExists(packageJsonPath))) {
    throw new Error(bilingualMessage(
      "--ui-dev 仅支持在 Axis 仓库源码目录中使用。",
      "--ui-dev is only supported from the Axis repository source directory.",
    ));
  }

  await stopManagedVisualizationDevServer().catch(() => undefined);
  await mkdir(axisLogsDir(), { recursive: true });

  const logPath = path.join(axisLogsDir(), "visualization-dev.log");
  const port = String(await resolveUiDevPort(options.bindHost));
  const uiUrl = `http://${options.publicHost}:${port}`;
  const childEnv = {
    ...process.env,
    NODE_ENV: "development",
    STORAGE_API_BASE_URL: options.storageUrl,
    RUNTIME_API_BASE_URL: options.runtimeUrl,
    STORAGE_PORT: String(options.storagePort),
    RUNTIME_PORT: String(options.runtimePort),
    PLATFORM_USER_ID: options.platformUserId,
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
      waitForHealthy(`${uiUrl}/api/health/readiness`, {
        timeoutMs: 30_000,
        intervalMs: 1_500,
        fetcher: fetchJson,
      }),
      exitPromise.then((code) => {
        throw new Error(bilingualMessage(
          `visualization dev 启动失败，退出码 ${code ?? 1}`,
          `visualization dev failed to start with exit code ${code ?? 1}`,
        ));
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
  platformUserId: string,
  databasePassword: string,
  managedConfigPath: string,
  managedSecretsPath: string,
  servicePorts: {
    storage: number;
    runtime: number;
    visualization: number;
  },
  publishVisualizationPort: boolean,
  imageName = DEFAULT_MANAGED_STACK_IMAGE,
) {
  const internalDatabaseUrl = `postgres://${DEFAULT_MANAGED_DATABASE_USER}:${databasePassword}@127.0.0.1:5432/${DEFAULT_MANAGED_DATABASE_NAME}`;
  const managedDir = axisManagedDir();
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
    `${bindHost}:${servicePorts.storage}:3001`,
    "-p",
    `${bindHost}:${servicePorts.runtime}:3002`,
    "-v",
    `${managedDir}:/opt/axis/managed`,
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
    `PLATFORM_USER_ID=${platformUserId}`,
    "-e",
    `NEXT_PUBLIC_MNA_BASE_URL=http://${publicHost}:${DEFAULT_MNA_PORT}`,
    "-e",
    `MNA_INTERNAL_BASE_URL=http://host.docker.internal:${DEFAULT_MNA_PORT}`,
    "-e",
    "MNA_TOKEN_PATH=/opt/axis/managed/mna/token.txt",
    "-e",
    `AXIS_MANAGED_CONFIG_PATH=${managedConfigPath}`,
    "-e",
    `AXIS_MANAGED_SECRETS_PATH=${managedSecretsPath}`,
    ...buildDockerHostGatewayArgs(),
  ];

  if (publishVisualizationPort) {
    dockerArgs.push("-p", `${bindHost}:${servicePorts.visualization}:3003`);
  } else {
    dockerArgs.push("-e", "AXIS_DISABLE_STACK_VISUALIZATION=1");
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
  const storagePort = resolveStoragePort();
  const runtimePort = resolveRuntimePort();
  const visualizationPort = resolveVisualizationPort();
  const uiDev = options["ui-dev"] === true;
  const open = options.open === true;
  const daemon = options.daemon === true;
  await writeLegacyContinuumNotice();
  const platformUserId = await resolvePlatformUserId();
  const initialManagedState = await readManagedState();
  const storageUrl = buildServiceUrl(accessibleHost, storagePort);
  const runtimeUrl = buildServiceUrl(accessibleHost, runtimePort);
  const uiUrl = buildServiceUrl(accessibleHost, visualizationPort);
  const uiDevBackendHealthy = uiDev
    ? await managedBackendIsHealthy(storageUrl, runtimeUrl)
    : false;
  const providerConfigured = await isPrimaryProviderConfigured(options);
  const localManagedConfigPath = axisManagedConfigPath();
  const localManagedSecretsPath = axisManagedSecretsPath();

  if (uiDev && uiDevBackendHealthy) {
    let mna = resolveUiDevMna(options, initialManagedState, accessibleHost);
    if (!hasExplicitMnaConnectionOptions(options)) {
      const buildState = await loadBuildStateHelpers(packageRoot);
      await refreshMemoryNativeAgentVendor(packageRoot, buildState);
      mna = await startManagedMna(
        {
          ...options,
          "runtime-url": runtimeUrl,
          "managed-config-path": localManagedConfigPath,
          "managed-secrets-path": localManagedSecretsPath,
        },
        importMetaUrl,
      );
    }
    const devServer = await startManagedVisualizationDevServer({
      packageRoot,
      bindHost,
      publicHost: accessibleHost,
      platformUserId,
      readModelDsn: buildUiDevReadModelDsn(options, initialManagedState, accessibleHost),
      runtimeUrl,
      storageUrl,
      mnaUrl: mna.url,
      mnaTokenPath: mna.tokenPath,
      storagePort,
      runtimePort,
    });

    process.stdout.write("Axis visualization dev 已启动。\n");
    process.stdout.write("backend: 复用现有 storage/runtime，未重启其他服务。\n");
    process.stdout.write(`bind-host: ${bindHost}\n`);
    process.stdout.write(`storage: ${storageUrl}\n`);
    process.stdout.write(`runtime: ${runtimeUrl}\n`);
    process.stdout.write(`visualization: ${devServer.url} (dev)\n`);
    process.stdout.write(`log: ${devServer.logPath}\n`);
    process.stdout.write(`memory-native-agent: ${mna.url}\n`);
    writeDaemonNotice(daemon);
    if (!providerConfigured) {
      writeMissingPrimaryProviderWarning();
    }
    await maybeWriteUpdateNotice().catch(() => undefined);

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
  const stackManagedConfigPath = "/opt/axis/managed/config.json";
  const stackManagedSecretsPath = "/opt/axis/managed/secrets.json";
  await migrateManagedConfigFiles();
  const existingEmbeddingConfig = await readManagedEmbeddingConfig();
  const existingMemoryLlmConfig = await readManagedMemoryLlmConfig();
  const requestedEmbeddingConfig = resolveOptionalThirdPartyEmbeddingConfig(options, {});
  const mergedEmbeddingConfig = mergeManagedConfig<ManagedEmbeddingConfig>(
    existingEmbeddingConfig,
    {
      version: 1,
      ...resolveOptionalThirdPartyEmbeddingConfig({}, process.env),
    },
    requestedEmbeddingConfig,
  );

  await writeManagedEmbeddingConfig(mergedEmbeddingConfig);
  const mergedMemoryLlmConfig = mergeManagedConfig<ManagedWritebackLlmConfig>(
    existingMemoryLlmConfig,
    {
      version: 1,
      ...resolveOptionalManagedMemoryLlmEnvConfig(process.env),
    },
    resolveOptionalManagedMemoryLlmCliConfig(options),
  );
  await writeManagedMemoryLlmConfig(mergedMemoryLlmConfig);

  await mkdir(axisHomeDir(), { recursive: true });
  writeProgress("正在检查 Docker...", "Checking Docker...");
  await ensureDockerInstalled();
  await ensureDockerDaemonReady();
  writeProgressDone("Docker 检查完成。", "Docker check completed.");
  await stopLegacyAxisProcesses();
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
    writeProgress(
      "正在构建服务镜像（首次约 3-8 分钟）...",
      "Building service image (first run usually takes 3-8 minutes)...",
    );
    const stageDir = await prepareStackContext(packageRoot, !uiDev);
    await buildStackImage(stageDir, stackImageName);
    writeProgressDone("服务镜像构建完成。", "Service image build completed.");
    await pruneDanglingDockerImages().catch((error) => {
      process.stderr.write(`${bilingualMessage(
        `Docker dangling 镜像清理失败：${error instanceof Error ? error.message : String(error)}`,
        `Failed to prune dangling Docker images: ${error instanceof Error ? error.message : String(error)}`,
      )}\n`);
    });
    if (!uiDev) {
      await buildState.writeBuildState(stackImagePlan.nextState);
    }
  } else {
    process.stdout.write(`docker image 已是最新，跳过 build: ${stackImageName}\n`);
    writeProgressDone("服务镜像已就绪。", "Service image is ready.");
    if (vendorRefresh.refreshed) {
      process.stdout.write("visualization 已刷新，沿用现有 stack image。\n");
    }
    if (mnaVendorRefresh.refreshed) {
      process.stdout.write("memory-native-agent 已刷新，沿用现有 stack image。\n");
    }
  }

  // Remove old container only after successful build.
  await cleanupManagedStackContainer().catch(() => undefined);
  await assertFixedServicePortsAvailable(
    bindHost,
    [
      { port: storagePort, envName: "STORAGE_PORT" },
      { port: runtimePort, envName: "RUNTIME_PORT" },
      ...(uiDev
        ? []
        : [{
            port: visualizationPort,
            envName:
              process.env.UI_PORT !== undefined && process.env.UI_PORT.trim() !== ""
                ? "UI_PORT"
                : "VISUALIZATION_PORT",
          }]),
    ],
  );

  try {
    let startedVisualizationUrl = uiUrl;
    let startedVisualizationLogPath: string | null = null;

    writeProgress("正在启动数据库...", "Starting database...");
    await startStackContainer(
      postgresPort,
      bindHost,
      accessibleHost,
      platformUserId,
      databasePassword,
      stackManagedConfigPath,
      stackManagedSecretsPath,
      {
        storage: storagePort,
        runtime: runtimePort,
        visualization: visualizationPort,
      },
      !uiDev,
      stackImageName,
    );
    writeProgressDone("数据库启动命令已提交。", "Database start command submitted.");

    writeProgress("正在等待服务就绪...", "Waiting for services to become ready...");
    await waitForHealthy(`${storageUrl}/health`, {
      timeoutMs: 120_000,
      intervalMs: 1_500,
      fetcher: fetchJson,
    });
    await waitForHealthy(`${runtimeUrl}/healthz`, {
      timeoutMs: 120_000,
      intervalMs: 1_500,
      fetcher: fetchJson,
    });
    const mna = await startManagedMna(
      {
        ...options,
        "runtime-url": runtimeUrl,
        "managed-config-path": localManagedConfigPath,
        "managed-secrets-path": localManagedSecretsPath,
      },
      importMetaUrl,
    );
    if (uiDev) {
      const devServer = await startManagedVisualizationDevServer({
        packageRoot,
        bindHost,
        publicHost: accessibleHost,
        platformUserId,
        readModelDsn,
        runtimeUrl,
        storageUrl,
        mnaUrl: mna.url,
        mnaTokenPath: mna.tokenPath,
        storagePort,
        runtimePort,
      });
      startedVisualizationUrl = devServer.url;
      startedVisualizationLogPath = devServer.logPath;
    } else {
      await waitForHealthy(`${uiUrl}/api/health/readiness`, {
        timeoutMs: 120_000,
        intervalMs: 1_500,
        fetcher: fetchJson,
      });
    }
    writeProgressDone("服务已就绪。", "Services are ready.");

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

    process.stdout.write(`${bilingualMessage(
      `Axis 已启动，打开 ${startedVisualizationUrl}`,
      `Axis started. Open ${startedVisualizationUrl}`,
    )}\n`);
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
    writeDaemonNotice(daemon);
    if (!providerConfigured) {
      writeMissingPrimaryProviderWarning();
    }
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
    await maybeWriteUpdateNotice().catch(() => undefined);
  } catch (error) {
    const startupLogPath = path.join(axisLogsDir(), "startup-failure.log");
    const savedLogs = await saveDockerContainerLogs(DEFAULT_MANAGED_STACK_CONTAINER, startupLogPath).catch(() => false);
    if (savedLogs) {
      process.stderr.write(`${bilingualMessage(
        `已保存启动失败日志: ${startupLogPath}`,
        `Saved startup failure logs: ${startupLogPath}`,
      )}\n`);
    }
    const cleaned = await cleanupManagedStackContainer().catch(() => false);
    if (cleaned) {
      process.stderr.write(`${bilingualMessage(
        `Axis 启动失败，已清理未完成容器: ${DEFAULT_MANAGED_STACK_CONTAINER}`,
        `Axis startup failed. Removed incomplete container: ${DEFAULT_MANAGED_STACK_CONTAINER}`,
      )}\n`);
    }
    throw error;
  }
}
