import process from "node:process";
import { spawn } from "node:child_process";

import { bilingualMessage, formatErrorMessage } from "./messages.js";
import { packageRootFromImportMeta, vendorPath } from "./utils.js";

export async function runMcpCommand(importMetaUrl: string) {
  const packageRoot = packageRootFromImportMeta(importMetaUrl);
  const entryPath = vendorPath(
    packageRoot,
    "runtime",
    "host-adapters",
    "memory-codex-adapter",
    "mcp",
    "memory-mcp-server.mjs",
  );

  const child = spawn(process.execPath, [entryPath], {
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    console.error(bilingualMessage(
      `MCP server 启动失败：${formatErrorMessage(error)}`,
      `Failed to start MCP server: ${formatErrorMessage(error)}`,
    ));
    process.exit(1);
  });
}
