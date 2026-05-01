#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const bootstrapScript = path.join(scriptDir, "memory-runtime-bootstrap.mjs");
const proxyScript = path.join(scriptDir, "memory-codex-proxy.mjs");

const bootstrapCommand =
  process.env.MEMORY_CODEX_BOOTSTRAP_COMMAND ?? `"${process.execPath}" "${bootstrapScript}"`;
const proxyCommand = process.env.MEMORY_CODEX_PROXY_COMMAND ?? `"${process.execPath}" "${proxyScript}"`;
const codexClientCommand = process.env.MEMORY_CODEX_CLIENT_COMMAND ?? "codex --remote ws://127.0.0.1:48788";
const proxyListenUrl = process.env.MEMORY_CODEX_PROXY_LISTEN_URL ?? "ws://127.0.0.1:48788";
const appServerUrl = process.env.CODEX_APP_SERVER_URL ?? "ws://127.0.0.1:48777";
const appServerCommand =
  process.env.CODEX_APP_SERVER_COMMAND ?? "codex app-server --listen ws://127.0.0.1:48777";
const readyTimeoutMs = Number.parseInt(process.env.MEMORY_CODEX_READY_TIMEOUT_MS ?? "10000", 10);

const backgroundChildren = [];

function shouldRun(command) {
  return Boolean(command) && command !== "off" && command !== "false";
}

function startBackground(command, envOverrides = {}) {
  const child = spawn(command, {
    shell: true,
    stdio: "ignore",
    windowsHide: true,
    env: {
      ...process.env,
      ...envOverrides,
    },
  });
  backgroundChildren.push(child);
  return child;
}

function startForeground(command) {
  return spawn(command, {
    shell: true,
    stdio: "inherit",
  });
}

function cleanupBackgroundChildren() {
  for (const child of backgroundChildren.splice(0)) {
    if (process.platform === "win32" && child.pid) {
      spawnSync("taskkill", ["/pid", String(child.pid), "/f", "/t"], {
        stdio: "ignore",
        windowsHide: true,
      });
      continue;
    }

    if (!child.killed && child.exitCode === null) {
      child.kill();
    }
  }
}

function toHttpReadyUrl(wsUrl) {
  const url = new URL(wsUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/readyz";
  url.search = "";
  url.hash = "";
  return url;
}

function waitForTcp(url, timeoutMs) {
  const endpoint = new URL(url);
  const port = Number(endpoint.port || (endpoint.protocol === "wss:" ? 443 : 80));
  const host = endpoint.hostname;
  const deadline = Date.now() + Math.max(500, timeoutMs);

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({ host, port });
      let settled = false;

      function finish(error) {
        if (settled) {
          return;
        }
        settled = true;
        socket.destroy();
        if (!error) {
          resolve(true);
          return;
        }
        if (Date.now() >= deadline) {
          reject(error);
          return;
        }
        setTimeout(tryConnect, 100);
      }

      socket.once("connect", () => finish(null));
      socket.once("error", finish);
      socket.setTimeout(500, () => finish(new Error(`timed out waiting for ${url}`)));
    };

    tryConnect();
  });
}

async function waitForHttpOk(url, timeoutMs) {
  const deadline = Date.now() + Math.max(500, timeoutMs);
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`unexpected status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw lastError ?? new Error(`timed out waiting for ${url}`);
}

async function main() {
  if (shouldRun(bootstrapCommand)) {
    startBackground(bootstrapCommand, {
      CODEX_APP_SERVER_COMMAND: "off",
    });
  }
  if (shouldRun(appServerCommand)) {
    startBackground(appServerCommand);
  }
  await waitForTcp(appServerUrl, readyTimeoutMs);
  if (shouldRun(proxyCommand)) {
    startBackground(proxyCommand);
    await waitForHttpOk(toHttpReadyUrl(proxyListenUrl), readyTimeoutMs);
  }

  const client = startForeground(codexClientCommand);
  client.on("exit", (code, signal) => {
    cleanupBackgroundChildren();
    if (signal === "SIGINT") {
      process.exit(130);
      return;
    }
    process.exit(code ?? 0);
  });
  client.on("error", (error) => {
    cleanupBackgroundChildren();
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

process.on("exit", cleanupBackgroundChildren);
process.on("SIGINT", () => {
  cleanupBackgroundChildren();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanupBackgroundChildren();
  process.exit(143);
});

main().catch((error) => {
  cleanupBackgroundChildren();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
