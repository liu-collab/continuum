#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";

const bootstrapCommand = process.env.MEMORY_CODEX_BOOTSTRAP_COMMAND ?? "node ./bin/memory-runtime-bootstrap.mjs";
const proxyCommand = process.env.MEMORY_CODEX_PROXY_COMMAND ?? "node ./bin/memory-codex-proxy.mjs";
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
