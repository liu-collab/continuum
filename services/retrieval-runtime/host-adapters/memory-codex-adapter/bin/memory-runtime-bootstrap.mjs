#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";

const runtimeStartCommand = process.env.MEMORY_RUNTIME_START_COMMAND ?? "npm run dev";
const mcpCommand = process.env.MEMORY_MCP_COMMAND ?? "memory-mcp-server";
const codexServerCommand = process.env.CODEX_APP_SERVER_COMMAND ?? "codex app-server";

function startDetached(command) {
  const child = spawn(command, {
    shell: true,
    stdio: "ignore",
    detached: true
  });
  child.unref();
}

startDetached(runtimeStartCommand);
startDetached(mcpCommand);
startDetached(codexServerCommand);
