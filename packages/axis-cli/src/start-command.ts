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
  runCommand,
  terminateProcess,
  vendorPath,
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
import {
  maybePromptLiteMigrationBeforeFullStart,
  runLiteToFullMigration,
} from "./lite-migration.js";
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
import { bilingualMessage, bilingualMessageLines, formatErrorMessage } from "./messages.js";
import { loadBuildStateHelpers } from "./build-state-loader.js";
import {
  buildDockerHostGatewayArgs,
  buildStackImage,
  cleanupManagedStackContainer,
  ensureDockerDaemonReady,
  ensureDockerInstalled,
  isDockerContainerRunning,
  prepareStackContext,
  pruneDanglingDockerImages,
  saveDockerContainerLogs,
} from "./docker-lifecycle.js";
import { npmCommand } from "./managed-process.js";
import { resolvePlatformUserId } from "./platform-user.js";
import {
  assertFixedServicePortsAvailable,
  DEFAULT_RUNTIME_PORT,
  DEFAULT_STORAGE_PORT,
  DEFAULT_VISUALIZATION_PORT,
  normalizeBindHost,
  parsePort,
  parsePortEnv,
  resolveLiteRuntimePort,
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
const WARNING_COLOR = "\u001b[33m";
const RESET_COLOR = "\u001b[0m";

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

function hasExplicitRuntimePort() {
  return process.env.RUNTIME_PORT !== undefined && process.env.RUNTIME_PORT.trim() !== "";
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
  return Boolean(persisted);
}

function writeMissingPrimaryProviderWarning() {
  writeWarning(
    "尚未配置主模型。请在 Agent 页面的设置面板中配置 provider，或通过 axis start --provider-kind <kind> --provider-model <model> 指定。",
    "Primary model is not configured. Configure a provider in the Agent settings panel, or specify one with axis start --provider-kind <kind> --provider-model <model>.",
  );
}

function writeMissingThirdPartyEmbeddingsWarning() {
  writeWarning(
    "third-party embeddings 未配置，可在页面中补充 EMBEDDING_BASE_URL 和 EMBEDDING_MODEL。",
    "Third-party embeddings are not configured. Add EMBEDDING_BASE_URL and EMBEDDING_MODEL in the UI.",
  );
}

function writeLiteUpgradeSuggestionWarning(healthBody: unknown) {
  const suggestion = typeof healthBody === "object" && healthBody !== null
    ? (healthBody as { upgrade_suggestion?: { should_upgrade?: unknown; message?: unknown; command?: unknown } }).upgrade_suggestion
    : undefined;

  if (!suggestion || suggestion.should_upgrade !== true) {
    return;
  }

  const message = typeof suggestion.message === "string"
    ? suggestion.message
    : "精简模式数据量较大，建议切换到完整平台。";
  const command = typeof suggestion.command === "string" ? suggestion.command : "axis start --full";
  writeWarning(
    `${message} 可运行 ${command}。`,
    `${message} Run ${command}.`,
  );
}

function writeWarning(message: string, english: string) {
  process.stdout.write(`${WARNING_COLOR}⚠ ${bilingualMessage(message, english)}${RESET_COLOR}\n`);
}

function writeNotice(message: string, english: string) {
  process.stdout.write(`- ${bilingualMessage(message, english)}\n`);
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
  process.stdout.write(`→ ${bilingualMessage(message, english)}\n`);
}

function writeProgressDone(message: string, english: string) {
  process.stdout.write(`✓ ${bilingualMessage(message, english)}\n`);
}

async function migrateLiteDataAfterFullStart(storageUrl: string) {
  try {
    writeProgress(
      "正在迁移精简模式记忆...",
      "Migrating lite mode memories...",
    );
    const result = await runLiteToFullMigration({ storageUrl });
    writeProgressDone(
      `精简模式迁移完成：提交 ${result.submitted} 条，跳过 ${result.skipped.length} 条。`,
      `Lite migration completed: submitted ${result.submitted}, skipped ${result.skipped.length}.`,
    );
  } catch (error) {
    writeWarning(
      `精简模式迁移失败：${formatErrorMessage(error)}。完整平台会继续启动，lite 数据已保留，可稍后运行 axis migrate --to full 重试。`,
      `Lite migration failed: ${formatErrorMessage(error)}. Full mode will continue; lite data is kept and you can retry with axis migrate --to full later.`,
    );
  }
}

function writeStartSummary(summary: {
  openUrl: string;
  mode: "managed" | "ui-dev" | "lite";
  backend?: "reused";
  container?: string;
  bindHost: string;
  postgres?: string;
  storageUrl?: string | null;
  runtimeUrl?: string | null;
  visualizationUrl?: string | null;
  visualizationLogPath?: string | null;
  mnaUrl?: string | null;
}) {
  process.stdout.write(`✓ ${bilingualMessage("Axis 已启动。", "Axis started.")}\n`);
  const lines: Array<[string, string | undefined | null]> = [
    ["open", summary.openUrl],
    ["mode", summary.mode],
    ["backend", summary.backend],
    ["container", summary.container],
    ["bind-host", summary.bindHost],
    ["postgres", summary.postgres],
    ["storage", summary.storageUrl],
    ["runtime", summary.runtimeUrl],
    ["visualization", summary.visualizationUrl],
    ["visualization-log", summary.visualizationLogPath],
    ["memory-native-agent", summary.mnaUrl],
  ];

  for (const [label, value] of lines) {
    if (value) {
      process.stdout.write(`  ${label}: ${value}\n`);
    }
  }
}

async function startLiteRuntime(options: {
  packageRoot: string;
  bindHost: string;
  accessibleHost: string;
  runtimePort: number;
  runtimeUrl: string;
  daemon: boolean;
  open: boolean;
  cliOptions: Record<string, string | boolean>;
}) {
  await migrateManagedConfigFiles();
  const existingMemoryLlmConfig = await readManagedMemoryLlmConfig();
  const mergedMemoryLlmConfig = mergeManagedConfig<ManagedWritebackLlmConfig>(
    existingMemoryLlmConfig,
    {
      version: 1,
      ...resolveOptionalManagedMemoryLlmEnvConfig(process.env),
    },
    resolveOptionalManagedMemoryLlmCliConfig(options.cliOptions),
  );
  await writeManagedMemoryLlmConfig(mergedMemoryLlmConfig);

  const healthUrl = `${options.runtimeUrl}/v1/lite/healthz`;
  const alreadyHealthy = await isHealthy(healthUrl, 1_000);
  let pid: number | undefined;
  const logPath = path.join(axisLogsDir(), "lite-runtime.log");

  if (!alreadyHealthy) {
    await assertFixedServicePortsAvailable(
      options.bindHost,
      [{ port: options.runtimePort, envName: "RUNTIME_PORT" }],
    );
    await mkdir(axisLogsDir(), { recursive: true });
    const stdoutHandle = await open(logPath, "a");
    const stderrHandle = await open(logPath, "a");
    const entryPath = vendorPath(options.packageRoot, "runtime", "dist", "src", "index.js");
    const child = spawn(process.execPath, [entryPath, "--lite"], {
      detached: true,
      windowsHide: true,
      stdio: ["ignore", stdoutHandle.fd, stderrHandle.fd],
      env: {
        ...process.env,
        HOST: options.bindHost,
        PORT: String(options.runtimePort),
        AXIS_MANAGED_CONFIG_PATH: axisManagedConfigPath(),
        AXIS_MANAGED_SECRETS_PATH: axisManagedSecretsPath(),
      },
    });
    child.unref();
    pid = child.pid;
    await waitForHealthy(healthUrl, {
      timeoutMs: 30_000,
      intervalMs: 500,
      fetcher: fetchJson,
    });
  }

  const latestManagedState = await readManagedState();
  const existingServices = latestManagedState.services.filter((service) =>
    service.name !== "lite-runtime" && service.name !== "retrieval-runtime"
  );
  await writeManagedState({
    ...latestManagedState,
    version: 1,
    services: [
      ...existingServices,
      {
        name: "lite-runtime",
        pid: pid ?? 0,
        logPath,
        url: options.runtimeUrl,
      },
      {
        name: "retrieval-runtime",
        pid: pid ?? 0,
        logPath,
        url: options.runtimeUrl,
      },
    ],
  });

  writeStartSummary({
    openUrl: options.runtimeUrl,
    mode: "lite",
    backend: alreadyHealthy ? "reused" : undefined,
    bindHost: options.bindHost,
    runtimeUrl: options.runtimeUrl,
    visualizationLogPath: logPath,
  });
  writeDaemonNotice(options.daemon);
  if (!mergedMemoryLlmConfig.baseUrl || !mergedMemoryLlmConfig.model) {
    writeWarning(
      "记忆模型未配置，lite 模式会使用规则降级。可运行 axis memory-model configure 配置。",
      "Memory model is not configured. Lite mode will use rule fallback. Run axis memory-model configure to configure it.",
    );
  }
  const healthAfterStart = await fetchJson(healthUrl, 1_000).catch(() => ({ ok: false as const }));
  if (healthAfterStart.ok) {
    writeLiteUpgradeSuggestionWarning(healthAfterStart.body);
  }

  if (options.open) {
    await openBrowser(options.runtimeUrl);
  }
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
    LITE_RUNTIME_API_BASE_URL: options.runtimeUrl,
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
    "-e",
    "AXIS_RUNTIME_CONTAINER=1",
    ...buildDockerHostGatewayArgs(),
  ];

  if (publishVisualizationPort) {
    dockerArgs.push("-p", `${bindHost}:${servicePorts.visualization}:3003`);
  } else {
    dockerArgs.push("-e", "AXIS_DISABLE_STACK_VISUALIZATION=1");
  }

  dockerArgs.push(imageName);

  const result = await runCommand("docker", dockerArgs, {
    captureOutput: true,
    env: process.env,
  });
  if (result.code !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(
      output
        ? bilingualMessage(
            `Docker 容器启动失败。${output}`,
            `Docker container failed to start. ${output}`,
          )
        : bilingualMessage(
            `docker run 失败，退出码 ${result.code}`,
            `docker run failed with exit code ${result.code}`,
          ),
    );
  }
}

export async function runStartCommand(
  options: Record<string, string | boolean>,
  importMetaUrl: string,
) {
  const packageRoot = packageRootFromImportMeta(importMetaUrl);
  const bindHost = normalizeBindHost(options["bind-host"]);
  const accessibleHost = resolveAccessibleHost(bindHost);
  const storagePort = resolveStoragePort();
  const requestedRuntimePort = resolveRuntimePort();
  const visualizationPort = resolveVisualizationPort();
  const uiDev = options["ui-dev"] === true;
  const full = options.full === true || uiDev;
  const requestedRuntimeUrl = buildServiceUrl(accessibleHost, requestedRuntimePort);
  const requestedLiteRuntimeHealthy = !full
    ? await isHealthy(`${requestedRuntimeUrl}/v1/lite/healthz`, 1_000)
    : false;
  const runtimePort = !full && !hasExplicitRuntimePort()
    && !requestedLiteRuntimeHealthy
    ? await resolveLiteRuntimePort(bindHost, requestedRuntimePort)
    : requestedRuntimePort;
  const open = options.open === true;
  const daemon = options.daemon === true;
  const platformUserId = await resolvePlatformUserId();
  const initialManagedState = await readManagedState();
  const storageUrl = buildServiceUrl(accessibleHost, storagePort);
  const runtimeUrl = buildServiceUrl(accessibleHost, runtimePort);
  const uiUrl = buildServiceUrl(accessibleHost, visualizationPort);
  const uiDevBackendHealthy = uiDev
    ? await isDockerContainerRunning(DEFAULT_MANAGED_STACK_CONTAINER)
      && await managedBackendIsHealthy(storageUrl, runtimeUrl)
    : false;
  const providerConfigured = await isPrimaryProviderConfigured(options);
  const localManagedConfigPath = axisManagedConfigPath();
  const localManagedSecretsPath = axisManagedSecretsPath();

  if (!full) {
    await startLiteRuntime({
      packageRoot,
      bindHost,
      accessibleHost,
      runtimePort,
      runtimeUrl,
      daemon,
      open,
      cliOptions: options,
    });
    await maybeWriteUpdateNotice().catch(() => undefined);
    return;
  }

  const migrateLiteAfterFullStart = options["migrate-lite"] === true
    ? true
    : options["skip-lite-migration-prompt"] === true || options["skip-lite-migration"] === true
      ? false
      : options.full === true
        ? await maybePromptLiteMigrationBeforeFullStart()
        : false;

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

    writeStartSummary({
      openUrl: devServer.url,
      mode: "ui-dev",
      backend: "reused",
      container: DEFAULT_MANAGED_STACK_CONTAINER,
      bindHost,
      postgres: initialManagedState.postgres ? `${accessibleHost}:${initialManagedState.postgres.port}` : undefined,
      storageUrl,
      runtimeUrl,
      visualizationUrl: `${devServer.url} (dev)`,
      visualizationLogPath: devServer.logPath,
      mnaUrl: mna.url,
    });
    writeDaemonNotice(daemon);
    if (!providerConfigured) {
      writeMissingPrimaryProviderWarning();
    }
    if (migrateLiteAfterFullStart) {
      await migrateLiteDataAfterFullStart(storageUrl);
    }
    await maybeWriteUpdateNotice().catch(() => undefined);

    if (open) {
      await openBrowser(devServer.url);
    }

    return;
  }

  const buildState = await loadBuildStateHelpers(packageRoot);
  const databasePassword = resolveDatabasePasswordFromState(initialManagedState);
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
  await stopManagedVisualizationDevServer().catch(() => undefined);
  const postgresPort = await resolveManagedPostgresPort(options, bindHost);
  const readModelDsn =
    process.env.STORAGE_READ_MODEL_DSN
    ?? `postgres://${DEFAULT_MANAGED_DATABASE_USER}:${databasePassword}@${accessibleHost}:${postgresPort}/${DEFAULT_MANAGED_DATABASE_NAME}`;

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
    writeNotice(
      `docker image 已是最新，跳过 build: ${stackImageName}`,
      `Docker image is up to date, skipped build: ${stackImageName}`,
    );
    writeProgressDone("服务镜像已就绪。", "Service image is ready.");
    if (vendorRefresh.refreshed) {
      writeNotice(
        "visualization 已刷新，沿用现有 stack image。",
        "Visualization was refreshed; keeping the existing stack image.",
      );
    }
    if (mnaVendorRefresh.refreshed) {
      writeNotice(
        "memory-native-agent 已刷新，沿用现有 stack image。",
        "memory-native-agent was refreshed; keeping the existing stack image.",
      );
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

    if (migrateLiteAfterFullStart) {
      await migrateLiteDataAfterFullStart(storageUrl);
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
      services: [
        ...latestManagedState.services.filter((service) =>
          service.name !== "storage"
          && service.name !== "retrieval-runtime"
          && service.name !== "visualization"
        ),
        {
          name: "storage",
          pid: 0,
          logPath: "",
          url: storageUrl,
        },
        {
          name: "retrieval-runtime",
          pid: 0,
          logPath: "",
          url: runtimeUrl,
        },
        {
          name: "visualization",
          pid: 0,
          logPath: "",
          url: startedVisualizationUrl,
        },
      ],
    });

    writeStartSummary({
      openUrl: startedVisualizationUrl,
      mode: uiDev ? "ui-dev" : "managed",
      container: DEFAULT_MANAGED_STACK_CONTAINER,
      bindHost,
      postgres: `${accessibleHost}:${postgresPort}`,
      storageUrl,
      runtimeUrl,
      visualizationUrl: `${startedVisualizationUrl}${uiDev ? " (dev)" : ""}`,
      visualizationLogPath: startedVisualizationLogPath,
      mnaUrl: mna.url,
    });
    writeDaemonNotice(daemon);
    if (!providerConfigured) {
      writeMissingPrimaryProviderWarning();
    }
    if (mergedEmbeddingConfig.baseUrl && mergedEmbeddingConfig.model) {
      process.stdout.write(
        `- third-party embeddings: ${buildEmbeddingsEndpoint(mergedEmbeddingConfig.baseUrl)} (${mergedEmbeddingConfig.model})\n`,
      );
    } else {
      writeMissingThirdPartyEmbeddingsWarning();
    }

    if (open) {
      await openBrowser(startedVisualizationUrl);
    }
    await maybeWriteUpdateNotice().catch(() => undefined);
  } catch (error) {
    const startupLogPath = path.join(axisLogsDir(), "startup-failure.log");
    const savedLogs = await saveDockerContainerLogs(DEFAULT_MANAGED_STACK_CONTAINER, startupLogPath).catch(() => false);
    if (savedLogs) {
      process.stderr.write(`${bilingualMessageLines(
        `已保存启动失败日志: ${startupLogPath}`,
        `Saved startup failure logs: ${startupLogPath}`,
      )}\n`);
    }
    const cleaned = await cleanupManagedStackContainer().catch(() => false);
    if (cleaned) {
      process.stderr.write(`${bilingualMessageLines(
        `Axis 启动失败，已清理未完成容器: ${DEFAULT_MANAGED_STACK_CONTAINER}`,
        `Axis startup failed. Removed incomplete container: ${DEFAULT_MANAGED_STACK_CONTAINER}`,
      )}\n`);
    }
    throw error;
  }
}
