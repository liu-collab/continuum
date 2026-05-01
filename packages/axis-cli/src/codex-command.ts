import process from "node:process";
import { spawn } from "node:child_process";

import { bilingualMessage, formatErrorMessage } from "./messages.js";
import { writeMemoryModelConfigurationHint } from "./memory-model-command.js";
import { LOOPBACK_BIND_HOST, parsePort, resolveAvailableTcpPort } from "./port-utils.js";
import {
  DEFAULT_CODEX_MCP_SERVER_NAME,
  packageRootFromImportMeta,
  uninstallCodexMcpServer,
  vendorPath,
} from "./utils.js";

function resolveCodexHome(options: Record<string, string | boolean>) {
  return typeof options["codex-home"] === "string" ? options["codex-home"] : undefined;
}

function resolveCodexMcpServerName(options: Record<string, string | boolean>) {
  return typeof options["server-name"] === "string"
    ? options["server-name"]
    : DEFAULT_CODEX_MCP_SERVER_NAME;
}

const DEFAULT_CODEX_APP_SERVER_PORT = 48_777;
const DEFAULT_CODEX_PROXY_PORT = 48_788;
const CODEX_PORT_SCAN_LIMIT = 40;

function wsLoopbackUrl(port: number) {
  return `ws://${LOOPBACK_BIND_HOST}:${port}`;
}

async function resolveDefaultCodexPorts(options: Record<string, string | boolean>) {
  if (
    typeof options["client-command"] === "string"
    || typeof options["app-server-command"] === "string"
    || process.env.MEMORY_CODEX_CLIENT_COMMAND
    || process.env.CODEX_APP_SERVER_COMMAND
    || process.env.MEMORY_CODEX_PROXY_LISTEN_URL
    || process.env.CODEX_APP_SERVER_URL
  ) {
    return {
      proxyUrl: process.env.MEMORY_CODEX_PROXY_LISTEN_URL ?? wsLoopbackUrl(DEFAULT_CODEX_PROXY_PORT),
      appServerUrl: process.env.CODEX_APP_SERVER_URL ?? wsLoopbackUrl(DEFAULT_CODEX_APP_SERVER_PORT),
    };
  }

  const requestedProxyPort = typeof options["proxy-port"] === "string"
    ? parsePort(options["proxy-port"], "--proxy-port")
    : DEFAULT_CODEX_PROXY_PORT;
  const proxyPort = await resolveAvailableTcpPort({
    host: LOOPBACK_BIND_HOST,
    preferredPort: requestedProxyPort,
    scanLimit: CODEX_PORT_SCAN_LIMIT,
    label: "codex proxy",
  });
  const requestedAppServerPort = typeof options["app-server-port"] === "string"
    ? parsePort(options["app-server-port"], "--app-server-port")
    : DEFAULT_CODEX_APP_SERVER_PORT;
  const appServerPort = await resolveAvailableTcpPort({
    host: LOOPBACK_BIND_HOST,
    preferredPort: requestedAppServerPort,
    scanLimit: CODEX_PORT_SCAN_LIMIT,
    label: "codex app-server",
    excludedPorts: [proxyPort],
  });

  return {
    proxyUrl: wsLoopbackUrl(proxyPort),
    appServerUrl: wsLoopbackUrl(appServerPort),
  };
}

export async function runCodexUninstallCommand(options: Record<string, string | boolean>) {
  const codexHome = resolveCodexHome(options);
  const name = resolveCodexMcpServerName(options);
  const removed = await uninstallCodexMcpServer({ name, codexHome });

  if (removed) {
    process.stdout.write(`Codex MCP server removed: ${name}\n`);
    return;
  }

  process.stdout.write(`Codex MCP server is not installed: ${name}\n`);
}

export async function runCodexUseCommand(
  options: Record<string, string | boolean>,
  importMetaUrl: string,
) {
  const packageRoot = packageRootFromImportMeta(importMetaUrl);
  const cliEntryPath = vendorPath(packageRoot, "..", "dist", "src", "index.js");
  const launcherPath = vendorPath(
    packageRoot,
    "runtime",
    "host-adapters",
    "memory-codex-adapter",
    "bin",
    "memory-codex.mjs",
  );
  const runtimeUrl =
    typeof options["runtime-url"] === "string"
      ? options["runtime-url"]
      : process.env.MEMORY_RUNTIME_BASE_URL ?? "http://127.0.0.1:3002";
  const ensureRuntime = options["ensure-runtime"] !== false;
  const runtimeCommand = `"${process.execPath}" "${cliEntryPath}" runtime`;
  const codexHome = resolveCodexHome(options);
  const codexPorts = await resolveDefaultCodexPorts(options);
  await writeMemoryModelConfigurationHint();

  const child = spawn(process.execPath, [launcherPath], {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(codexHome ? { CODEX_HOME: codexHome } : {}),
      MEMORY_RUNTIME_BASE_URL: runtimeUrl,
      MEMORY_RUNTIME_START_COMMAND: ensureRuntime ? runtimeCommand : "off",
      MEMORY_RUNTIME_API_MODE: "lite",
      MEMORY_RUNTIME_HEALTH_PATH: "/v1/lite/healthz",
      MEMORY_MCP_COMMAND: "off",
      MEMORY_CODEX_PROXY_LISTEN_URL: codexPorts.proxyUrl,
      CODEX_APP_SERVER_URL: codexPorts.appServerUrl,
      MEMORY_CODEX_CLIENT_COMMAND:
        typeof options["client-command"] === "string"
          ? options["client-command"]
          : process.env.MEMORY_CODEX_CLIENT_COMMAND ?? `codex --remote ${codexPorts.proxyUrl}`,
      CODEX_APP_SERVER_COMMAND:
        typeof options["app-server-command"] === "string"
          ? options["app-server-command"]
          : process.env.CODEX_APP_SERVER_COMMAND ?? `codex app-server --listen ${codexPorts.appServerUrl}`,
    },
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    console.error(bilingualMessage(
      `Codex 启动失败：${formatErrorMessage(error)}`,
      `Failed to start Codex: ${formatErrorMessage(error)}`,
    ));
    process.exit(1);
  });
}
