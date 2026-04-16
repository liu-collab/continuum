#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const bootstrapScript = path.join(scriptDir, "memory-runtime-bootstrap.mjs");
const proxyScript = path.join(scriptDir, "memory-codex-proxy.mjs");

const bootstrapCommand =
  process.env.MEMORY_CODEX_BOOTSTRAP_COMMAND ?? `"${process.execPath}" "${bootstrapScript}"`;
const proxyCommand = process.env.MEMORY_CODEX_PROXY_COMMAND ?? `"${process.execPath}" "${proxyScript}"`;
const codexClientCommand = process.env.MEMORY_CODEX_CLIENT_COMMAND ?? "codex --remote ws://127.0.0.1:3788";

function start(command) {
  return spawn(command, {
    shell: true,
    stdio: "inherit"
  });
}

async function main() {
  start(bootstrapCommand);
  start(proxyCommand);
  start(codexClientCommand);
}

void main();
