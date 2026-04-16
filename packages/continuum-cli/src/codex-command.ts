import process from "node:process";
import { spawn } from "node:child_process";

import { packageRootFromImportMeta, vendorPath } from "./utils.js";

export async function runCodexCommand(
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
  const mcpCommand = `"${process.execPath}" "${cliEntryPath}" mcp-server`;

  const child = spawn(process.execPath, [launcherPath], {
    stdio: "inherit",
    env: {
      ...process.env,
      MEMORY_RUNTIME_BASE_URL: runtimeUrl,
      MEMORY_RUNTIME_START_COMMAND: ensureRuntime ? runtimeCommand : "off",
      MEMORY_MCP_COMMAND: mcpCommand,
      MEMORY_CODEX_CLIENT_COMMAND:
        typeof options["client-command"] === "string"
          ? options["client-command"]
          : process.env.MEMORY_CODEX_CLIENT_COMMAND ?? "codex --remote ws://127.0.0.1:3788",
      CODEX_APP_SERVER_COMMAND:
        typeof options["app-server-command"] === "string"
          ? options["app-server-command"]
          : process.env.CODEX_APP_SERVER_COMMAND ?? "codex app-server",
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
