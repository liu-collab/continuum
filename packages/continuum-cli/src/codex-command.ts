import process from "node:process";
import { spawn } from "node:child_process";

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

export async function runCodexInstallCommand(
  options: Record<string, string | boolean>,
  _importMetaUrl: string,
) {
  const runtimeUrl =
    typeof options["runtime-url"] === "string"
      ? options["runtime-url"]
      : process.env.MEMORY_RUNTIME_BASE_URL ?? "http://127.0.0.1:3002";
  const codexHome = resolveCodexHome(options);

  process.stdout.write("Codex uses platform forced memory injection; no MCP server install is required.\n");
  process.stdout.write(`Runtime URL: ${runtimeUrl}\n`);
  if (codexHome) {
    process.stdout.write(`CODEX_HOME=${codexHome}\n`);
  }
  process.stdout.write(`Start with: continuum codex use${codexHome ? ` --codex-home "${codexHome}"` : ""}\n`);
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
  const ensureRuntime =
    !(options["ensure-runtime"] === "false" || options["ensure-runtime"] === false);
  const runtimeCommand = `"${process.execPath}" "${cliEntryPath}" runtime`;
  const codexHome = resolveCodexHome(options);

  const child = spawn(process.execPath, [launcherPath], {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(codexHome ? { CODEX_HOME: codexHome } : {}),
      MEMORY_RUNTIME_BASE_URL: runtimeUrl,
      MEMORY_RUNTIME_START_COMMAND: ensureRuntime ? runtimeCommand : "off",
      MEMORY_MCP_COMMAND: "off",
      MEMORY_CODEX_CLIENT_COMMAND:
        typeof options["client-command"] === "string"
          ? options["client-command"]
          : process.env.MEMORY_CODEX_CLIENT_COMMAND ?? "codex --remote ws://127.0.0.1:3788",
      CODEX_APP_SERVER_COMMAND:
        typeof options["app-server-command"] === "string"
          ? options["app-server-command"]
          : process.env.CODEX_APP_SERVER_COMMAND ?? "codex app-server --listen ws://127.0.0.1:3777",
    },
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });
}
