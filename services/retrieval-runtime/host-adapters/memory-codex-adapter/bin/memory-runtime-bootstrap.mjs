#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";

const runtimeStartCommand = process.env.MEMORY_RUNTIME_START_COMMAND ?? "continuum-runtime";
const mcpCommand = process.env.MEMORY_MCP_COMMAND ?? "continuum-mcp-server";
const codexServerCommand =
  process.env.CODEX_APP_SERVER_COMMAND ?? "codex app-server --listen ws://127.0.0.1:3777";

function shouldRun(command) {
  return Boolean(command) && command !== "off" && command !== "false";
}

function startDetached(command) {
  const child = spawn(command, {
    shell: true,
    stdio: "ignore",
    detached: true
  });
  child.unref();
}

if (shouldRun(runtimeStartCommand)) {
  startDetached(runtimeStartCommand);
}

if (shouldRun(mcpCommand)) {
  startDetached(mcpCommand);
}

if (shouldRun(codexServerCommand)) {
  startDetached(codexServerCommand);
}
