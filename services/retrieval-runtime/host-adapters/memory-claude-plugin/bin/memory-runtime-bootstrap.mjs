#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";

const runtimeBaseUrl = process.env.MEMORY_RUNTIME_BASE_URL ?? "http://127.0.0.1:3002";
const runtimeStartCommand = process.env.MEMORY_RUNTIME_START_COMMAND ?? "axis-runtime";
const mcpCommand = process.env.MEMORY_MCP_COMMAND ?? "off";
const mode = process.argv.includes("--mode") ? process.argv[process.argv.indexOf("--mode") + 1] : "runtime";
const healthPath = process.env.MEMORY_RUNTIME_HEALTH_PATH ?? "/v1/lite/healthz";

function shouldRun(command) {
  return Boolean(command) && command !== "off" && command !== "false";
}

async function isHealthy() {
  try {
    const response = await fetch(new URL(healthPath, runtimeBaseUrl));
    return response.ok;
  } catch {
    return false;
  }
}

function startDetached(command) {
  const child = spawn(command, {
    shell: true,
    stdio: "ignore",
    detached: true,
    windowsHide: true,
  });
  child.unref();
}

async function main() {
  if (!(await isHealthy()) && mode !== "mcp" && shouldRun(runtimeStartCommand)) {
    startDetached(runtimeStartCommand);
  }

  if (mode === "mcp" && shouldRun(mcpCommand)) {
    startDetached(mcpCommand);
  }
}

void main();
