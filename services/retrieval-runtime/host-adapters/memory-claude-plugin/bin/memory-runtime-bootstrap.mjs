#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";

const runtimeBaseUrl = process.env.MEMORY_RUNTIME_BASE_URL ?? "http://127.0.0.1:3002";
const runtimeStartCommand = process.env.MEMORY_RUNTIME_START_COMMAND ?? "npm run dev";
const mcpCommand = process.env.MEMORY_MCP_COMMAND ?? "memory-mcp-server";
const mode = process.argv.includes("--mode") ? process.argv[process.argv.indexOf("--mode") + 1] : "runtime";

async function isHealthy() {
  try {
    const response = await fetch(new URL("/healthz", runtimeBaseUrl));
    return response.ok;
  } catch {
    return false;
  }
}

function startDetached(command) {
  const child = spawn(command, {
    shell: true,
    stdio: "ignore",
    detached: true
  });
  child.unref();
}

async function main() {
  if (!(await isHealthy()) && mode !== "mcp") {
    startDetached(runtimeStartCommand);
  }

  if (mode === "mcp") {
    startDetached(mcpCommand);
  }
}

void main();
