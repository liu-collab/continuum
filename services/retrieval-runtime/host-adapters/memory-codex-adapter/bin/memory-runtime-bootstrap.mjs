#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const runtimeStartCommand = process.env.MEMORY_RUNTIME_START_COMMAND ?? "axis-runtime";
const mcpCommand = process.env.MEMORY_MCP_COMMAND ?? "off";
const codexServerCommand =
  process.env.CODEX_APP_SERVER_COMMAND ?? "codex app-server --listen ws://127.0.0.1:48777";
const configuredRuntimeBaseUrl = process.env.MEMORY_RUNTIME_BASE_URL;
const runtimeApiMode = process.env.MEMORY_RUNTIME_API_MODE ?? "lite";
const healthPath = process.env.MEMORY_RUNTIME_HEALTH_PATH ?? "/v1/lite/healthz";

function readManagedRuntimeUrl() {
  try {
    const statePath = path.join(process.env.AXIS_HOME ?? path.join(os.homedir(), ".axis"), "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    const services = Array.isArray(state?.services) ? state.services : [];
    const liteUrl = services.find((service) => service?.name === "lite-runtime")?.url;
    const fullUrl = services.find((service) => service?.name === "retrieval-runtime")?.url;
    return runtimeApiMode === "full" ? fullUrl ?? liteUrl : liteUrl ?? fullUrl;
  } catch {
    return undefined;
  }
}

function shouldRun(command) {
  return Boolean(command) && command !== "off" && command !== "false";
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

async function isHealthy() {
  try {
    const response = await fetch(new URL(healthPath, resolveRuntimeBaseUrl()));
    return response.ok;
  } catch {
    return false;
  }
}

function resolveRuntimeBaseUrl() {
  return configuredRuntimeBaseUrl ?? readManagedRuntimeUrl() ?? "http://127.0.0.1:3002";
}

async function main() {
  if (!(await isHealthy()) && shouldRun(runtimeStartCommand)) {
    startDetached(runtimeStartCommand);
  }

  if (shouldRun(mcpCommand)) {
    startDetached(mcpCommand);
  }

  if (shouldRun(codexServerCommand)) {
    startDetached(codexServerCommand);
  }
}

void main();
