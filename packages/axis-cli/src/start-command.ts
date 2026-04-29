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
  axisManagedMemoryLlmConfigPath,
  readManagedEmbeddingConfig,
  readManagedMemoryLlmConfig,
  readManagedWritebackLlmConfig,
  writeManagedEmbeddingConfig,
  writeManagedMemoryLlmConfig,
} from "./managed-config.js";
import { stopLegacyAxisProcesses } from "./process-cleanup.js";
import { loadBuildStateHelpers } from "./build-state-loader.js";
import {
  buildDockerHostGatewayArgs,
  buildStackImage,
  cleanupManagedStackContainer,
  ensureDockerDaemonReady,
  ensureDockerInstalled,
  prepareStackContext,
  stopLegacyPostgresContainer,
} from "./docker-lifecycle.js";
import { npmCommand, runForeground } from "./managed-process.js";
import {
  normalizeBindHost,
  parsePort,
  resolveAccessibleHost,
  resolveManagedPostgresPort,
  resolveUiDevPort,
} from "./port-utils.js";
import {
  refreshMemoryNativeAgentVendor,
  refreshVisualizationVendor,
} from "./vendor-refresh.js";

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
    throw new Error("--ui-dev 仅支持在 Axis 仓库源码目录中使用。");
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
      waitForHealthy(`${uiUrl}/api/health/readiness`, { timeoutMs: 30_000 }),
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
    `${bindHost}:3001:3001`,
    "-p",
    `${bindHost}:3002:3002`,
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
    `NEXT_PUBLIC_MNA_BASE_URL=http://${publicHost}:${DEFAULT_MNA_PORT}`,
    "-e",
    `MNA_INTERNAL_BASE_URL=http://host.docker.internal:${DEFAULT_MNA_PORT}`,
    "-e",
    "MNA_TOKEN_PATH=/opt/axis/managed/mna/token.txt",
    "-e",
    `AXIS_EMBEDDING_CONFIG_PATH=${embeddingConfigPath}`,
    "-e",
    `AXIS_MEMORY_LLM_CONFIG_PATH=${memoryLlmConfigPath}`,
    "-e",
    "AXIS_RUNTIME_CONFIG_PATH=/opt/axis/managed/runtime-config.json",
    ...buildDockerHostGatewayArgs(),
  ];

  if (publishVisualizationPort) {
    dockerArgs.push("-p", `${bindHost}:3003:3003`);
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
  const uiDev = options["ui-dev"] === true;
  const initialManagedState = await readManagedState();
  const open = options.open === true;
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

    process.stdout.write("Axis visualization dev 已启动。\n");
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
  const embeddingConfigPath = "/opt/axis/managed/embedding-config.json";
  const stackMemoryLlmConfigPath = "/opt/axis/managed/memory-llm-config.json";
  const localMemoryLlmConfigPath = axisManagedMemoryLlmConfigPath();
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

  await mkdir(axisHomeDir(), { recursive: true });
  await ensureDockerInstalled();
  await ensureDockerDaemonReady();
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

    await waitForHealthy(`${storageUrl}/health`, { timeoutMs: 120_000, intervalMs: 1_500 });
    await waitForHealthy(`${runtimeUrl}/healthz`, { timeoutMs: 120_000, intervalMs: 1_500 });
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
      await waitForHealthy(`${uiUrl}/api/health/readiness`, {
        timeoutMs: 120_000,
        intervalMs: 1_500,
      });
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

    process.stdout.write("Axis 已启动。\n");
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
      process.stderr.write(`Axis 启动失败，已清理未完成容器: ${DEFAULT_MANAGED_STACK_CONTAINER}\n`);
    }
    throw error;
  }
}
