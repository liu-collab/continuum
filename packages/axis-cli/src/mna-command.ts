import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

import {
  axisLogsDir,
  axisManagedDir,
  readManagedState,
  type ManagedServiceRecord,
  writeManagedState
} from "./managed-state.js";
import {
  readManagedMnaProviderConfig,
} from "./managed-config.js";
import { bilingualMessage } from "./messages.js";
import {
  DEFAULT_RUNTIME_URL,
  DEFAULT_TIMEOUT_MS,
  fetchJson,
  packageRootFromImportMeta,
  pathExists,
  terminateProcess,
  vendorPath,
  waitForHealthy,
} from "./utils.js";
import {
  hasManagedMnaProviderOptionOverrides,
  resolveManagedMnaProviderConfig,
  type ManagedMnaProviderConfig,
} from "./mna-provider-config.js";

export const DEFAULT_MNA_URL = "http://127.0.0.1:4193";
export const DEFAULT_MNA_HOST = "127.0.0.1";
export const DEFAULT_MNA_PORT = 4193;
export const DEFAULT_MNA_HOME_DIR = path.join(axisManagedDir(), "mna");

type ManagedMnaInfo = {
  pid: number;
  url: string;
  logPath: string;
  tokenPath: string;
  artifactsPath: string;
  version?: string;
};

function getManagedMnaRecord(services: ManagedServiceRecord[]) {
  return services.find((service) => service.name === "memory-native-agent") ?? null;
}

function buildMnaRecord(input: ManagedMnaInfo): ManagedServiceRecord {
  return {
    name: "memory-native-agent",
    pid: input.pid,
    logPath: input.logPath,
    url: input.url,
    tokenPath: input.tokenPath,
    artifactsPath: input.artifactsPath,
    version: input.version
  };
}

async function writeManagedMnaRecord(record: ManagedServiceRecord | null) {
  const state = await readManagedState();
  const services = state.services.filter((service) => service.name !== "memory-native-agent");
  if (record) {
    services.push(record);
  }

  await writeManagedState({
    ...state,
    services
  });
}

function parseMnaBaseUrl(options: Record<string, string | boolean>) {
  return typeof options["mna-url"] === "string" ? options["mna-url"] : DEFAULT_MNA_URL;
}

function parseMnaHost(options: Record<string, string | boolean>) {
  return typeof options["mna-host"] === "string" ? options["mna-host"] : DEFAULT_MNA_HOST;
}

function parseMnaPort(options: Record<string, string | boolean>) {
  return typeof options["mna-port"] === "string" ? Number(options["mna-port"]) : DEFAULT_MNA_PORT;
}

function parseMnaHome(options: Record<string, string | boolean>) {
  return typeof options["mna-home"] === "string" ? options["mna-home"] : DEFAULT_MNA_HOME_DIR;
}

function isUiManagedProviderConfig(config: ManagedMnaProviderConfig | null) {
  if (!config) {
    return false;
  }

  if (config.kind === "ollama") {
    return true;
  }

  return Boolean(config.apiKey || config.apiKeyEnv);
}

function readTailLines(content: string, lineCount: number) {
  if (lineCount <= 0) {
    return "";
  }

  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const trailingEmpty = lines.at(-1) === "";
  const selected = lines.slice(trailingEmpty ? -(lineCount + 1) : -lineCount);
  const result = trailingEmpty ? selected.slice(0, -1) : selected;
  return result.join("\n");
}

async function fetchMnaDependency(url: string, tokenPath: string, timeoutMs: number) {
  const token = (await readFile(tokenPath, "utf8").catch(() => "")).trim();
  if (!token) {
    return {
      ok: false,
      error: "missing token",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${url}/v1/agent/dependency-status`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    return {
      ok: response.ok,
      status: response.status,
      body: await response.json().catch(() => null),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function isDependencyAuthorized(dependency: {
  ok: boolean;
  status?: number;
  body?: unknown;
  error?: string;
}) {
  return dependency.status !== 401 && dependency.error !== "missing token";
}

async function isProcessAlive(pid: number) {
  if (process.platform === "win32") {
    const child = spawn("powershell", [
      "-NoLogo",
      "-NoProfile",
      "-Command",
      `Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id`
    ], {
      stdio: ["ignore", "pipe", "ignore"]
    });

    const chunks: Buffer[] = [];
    child.stdout?.on("data", (chunk) => chunks.push(Buffer.from(chunk)));

    const code = await new Promise<number>((resolve) => {
      child.on("exit", (exitCode) => resolve(exitCode ?? 1));
      child.on("error", () => resolve(1));
    });

    return code === 0 && Buffer.concat(chunks).toString("utf8").trim() === String(pid);
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function getManagedMnaStatus(options: Record<string, string | boolean> = {}) {
  const managedState = await readManagedState();
  const record = getManagedMnaRecord(managedState.services);
  const url = record?.url ?? parseMnaBaseUrl(options);
  const tokenPath = record?.tokenPath ?? path.join(parseMnaHome(options), "token.txt");
  const artifactsPath = record?.artifactsPath ?? path.join(parseMnaHome(options), "artifacts");
  const logPath = record?.logPath ?? path.join(axisLogsDir(), "mna.log");
  const timeoutMs = typeof options.timeout === "string" ? Number(options.timeout) : DEFAULT_TIMEOUT_MS;
  const health = await fetchJson(`${url}/healthz`, timeoutMs);
  const dependency = await fetchMnaDependency(url, tokenPath, timeoutMs);

  return {
    record,
    url,
    tokenPath,
    logPath,
    artifactsPath,
    health,
    dependency
  };
}

export async function startManagedMna(
  options: Record<string, string | boolean>,
  importMetaUrl: string
) {
  const packageRoot = packageRootFromImportMeta(importMetaUrl);
  const vendorDir = vendorPath(packageRoot, "memory-native-agent");
  const entryPath = path.join(vendorDir, "bin", "mna-server.mjs");

  if (!(await pathExists(entryPath))) {
    throw new Error(bilingualMessage(
      `memory-native-agent vendor 产物不存在: ${entryPath}`,
      `memory-native-agent vendor artifact does not exist: ${entryPath}`,
    ));
  }

  const existing = await getManagedMnaStatus(options);
  if (existing.health.ok && existing.record && isDependencyAuthorized(existing.dependency)) {
    return {
      url: existing.url,
      tokenPath: existing.tokenPath,
      artifactsPath: existing.artifactsPath,
      version: (existing.health.body as { version?: string } | undefined)?.version ?? existing.record?.version
    };
  }

  if (existing.record && (await isProcessAlive(existing.record.pid))) {
    await terminateProcess(existing.record.pid);
    await writeManagedMnaRecord(null);
  } else if (existing.record) {
    await writeManagedMnaRecord(null);
  }

  const host = parseMnaHost(options);
  const port = parseMnaPort(options);
  const homeDir = parseMnaHome(options);
  const runtimeUrl = typeof options["runtime-url"] === "string" ? options["runtime-url"] : DEFAULT_RUNTIME_URL;
  const managedConfigPath =
    typeof options["managed-config-path"] === "string"
      ? options["managed-config-path"]
      : undefined;
  const managedSecretsPath =
    typeof options["managed-secrets-path"] === "string"
      ? options["managed-secrets-path"]
      : undefined;
  const hasProviderOverrides = hasManagedMnaProviderOptionOverrides(options);
  const persistedProviderConfig = await readManagedMnaProviderConfig(homeDir);
  const uiManagedProviderConfig = isUiManagedProviderConfig(persistedProviderConfig)
    ? persistedProviderConfig
    : null;
  const providerConfig = hasProviderOverrides
    ? resolveManagedMnaProviderConfig(options)
    : uiManagedProviderConfig;
  const url = `http://${host}:${port}`;
  const logPath = path.join(axisLogsDir(), "mna.log");
  const tokenPath = path.join(homeDir, "token.txt");
  const artifactsPath = path.join(homeDir, "artifacts");

  await mkdir(axisLogsDir(), { recursive: true });
  await mkdir(homeDir, { recursive: true });
  const stdoutHandle = await open(logPath, "a");
  const stderrHandle = await open(logPath, "a");

  const child = spawn(process.execPath, [entryPath], {
    cwd: vendorDir,
    detached: true,
    stdio: ["ignore", stdoutHandle.fd, stderrHandle.fd],
    windowsHide: true,
    env: {
      ...process.env,
      NODE_ENV: "production",
      MNA_HOST: host,
      MNA_PORT: String(port),
      MNA_HOME: homeDir,
      MNA_WORKSPACE_CWD: process.cwd(),
      RUNTIME_BASE_URL: runtimeUrl,
      ...(managedConfigPath ? { AXIS_MANAGED_CONFIG_PATH: managedConfigPath } : {}),
      ...(managedSecretsPath ? { AXIS_MANAGED_SECRETS_PATH: managedSecretsPath } : {}),
      ...(providerConfig ? { MNA_PROVIDER_KIND: providerConfig.kind } : {}),
      ...(providerConfig ? { MNA_PROVIDER_MODEL: providerConfig.model } : {}),
      ...(providerConfig?.baseUrl ? { MNA_PROVIDER_BASE_URL: providerConfig.baseUrl } : {}),
      ...(providerConfig?.apiKey ? { MNA_PROVIDER_API_KEY: providerConfig.apiKey } : {}),
      ...(providerConfig?.apiKeyEnv ? { MNA_PROVIDER_API_KEY_ENV: providerConfig.apiKeyEnv } : {}),
    }
  });
  child.unref();
  await stdoutHandle.close();
  await stderrHandle.close();

  const exitPromise = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => resolve(code));
    child.once("error", () => resolve(1));
  });

  let healthy;
  try {
    healthy = await Promise.race([
      waitForHealthy(`${url}/healthz`, {
        timeoutMs: 60_000,
        intervalMs: 1_000,
        extractBody: true,
        timeoutMessage: bilingualMessage(
          `memory-native-agent 未在预期时间内就绪: ${url}。查看日志：axis mna logs`,
          `memory-native-agent did not become ready in time: ${url}. View logs: axis mna logs`,
        ),
        fetcher: fetchJson,
      }) as Promise<{ version?: string } | undefined>,
      exitPromise.then((code) => {
        throw new Error(bilingualMessage(
          `memory-native-agent 启动失败，退出码 ${code ?? 1}。查看日志：axis mna logs`,
          `memory-native-agent failed to start with exit code ${code ?? 1}. View logs: axis mna logs`,
        ));
      })
    ]);
  } catch (error) {
    await writeManagedMnaRecord(null);
    throw error;
  }

  await writeManagedMnaRecord(
    buildMnaRecord({
      pid: child.pid ?? 0,
      url,
      logPath,
      tokenPath,
      artifactsPath,
      version: healthy?.version
    })
  );

  return {
    url,
    tokenPath,
    artifactsPath,
    version: healthy?.version
  };
}

export async function stopManagedMna() {
  const managedState = await readManagedState();
  const record = getManagedMnaRecord(managedState.services);

  if (!record) {
    return false;
  }

  await terminateProcess(record.pid);
  await writeManagedMnaRecord(null);
  return true;
}

export async function runMnaCommand(
  subcommand: string | undefined,
  options: Record<string, string | boolean>,
  importMetaUrl: string
) {
  if (subcommand === "install") {
    const packageRoot = packageRootFromImportMeta(importMetaUrl);
    const vendorDir = vendorPath(packageRoot, "memory-native-agent");
    if (!(await pathExists(vendorDir))) {
      throw new Error(bilingualMessage(
        `memory-native-agent vendor 目录不存在: ${vendorDir}`,
        `memory-native-agent vendor directory does not exist: ${vendorDir}`,
      ));
    }
    process.stdout.write(`memory-native-agent vendor 已就绪: ${vendorDir}\n`);
    return 0;
  }

  if (subcommand === "start") {
    const result = await startManagedMna(options, importMetaUrl);
    process.stdout.write(`memory-native-agent started at ${result.url}\n`);
    process.stdout.write(`token: ${result.tokenPath}\n`);
    return 0;
  }

  if (subcommand === "stop") {
    const stopped = await stopManagedMna();
    process.stdout.write(stopped ? "memory-native-agent 已停止。\n" : "memory-native-agent 当前未运行。\n");
    return 0;
  }

  if (subcommand === "logs") {
    const managedState = await readManagedState();
    const record = getManagedMnaRecord(managedState.services);
    if (!record) {
      throw new Error(bilingualMessage(
        "memory-native-agent 尚未由 axis 管理启动。",
        "memory-native-agent has not been started by axis.",
      ));
    }

    const content = (await readFile(record.logPath, "utf8").catch(() => "")) || "";
    const tailOption = typeof options.tail === "string" ? Number.parseInt(options.tail, 10) : undefined;
    process.stdout.write(Number.isFinite(tailOption) ? readTailLines(content, tailOption ?? 0) : content);
    return 0;
  }

  if (subcommand === "token") {
    const homeDir = parseMnaHome(options);
    const tokenPath = path.join(homeDir, "token.txt");
    if (options.rotate === true) {
      process.stdout.write("token 轮换依赖 memory-native-agent 重新启动后自生成，当前请执行 `axis mna stop` 后再执行 `axis mna start`。\n");
      return 0;
    }

    const token = await readFile(tokenPath, "utf8").catch(() => "");
    process.stdout.write(`${token.trim()}\n`);
    return 0;
  }

  throw new Error(bilingualMessage(
    `未知的 mna 命令: ${subcommand ?? ""}`,
    `Unknown mna command: ${subcommand ?? ""}`,
  ));
}
