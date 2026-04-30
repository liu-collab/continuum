import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import type { FastifyInstance } from "fastify";
import { WebSocket, WebSocketServer } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileMemoryStore, type LiteMemoryRecord } from "../../src/lite/file-store.js";
import { createLiteRuntimeApp } from "../../src/lite/http-app.js";

const ids = {
  workspace: "550e8400-e29b-41d4-a716-446655440000",
  user: "550e8400-e29b-41d4-a716-446655440001",
  session: "550e8400-e29b-41d4-a716-446655440002",
};

const adapterRoot = path.resolve(process.cwd(), "host-adapters");
const claudeBridgeScript = path.join(
  adapterRoot,
  "memory-claude-plugin",
  "bin",
  "memory-bridge.mjs",
);
const claudeBootstrapScript = path.join(
  adapterRoot,
  "memory-claude-plugin",
  "bin",
  "memory-runtime-bootstrap.mjs",
);
const codexBootstrapScript = path.join(
  adapterRoot,
  "memory-codex-adapter",
  "bin",
  "memory-runtime-bootstrap.mjs",
);
const codexProxyScript = path.join(
  adapterRoot,
  "memory-codex-adapter",
  "bin",
  "memory-codex-proxy.mjs",
);

function record(overrides: Partial<LiteMemoryRecord> = {}): LiteMemoryRecord {
  return {
    id: "rec-default",
    workspace_id: ids.workspace,
    user_id: ids.user,
    task_id: null,
    session_id: ids.session,
    memory_type: "preference",
    scope: "user",
    status: "active",
    summary: "用户偏好中文回复",
    details: { preference_axis: "response_language", preference_value: "zh" },
    importance: 5,
    confidence: 0.9,
    created_at: "2026-04-30T10:00:00.000Z",
    updated_at: "2026-04-30T10:00:00.000Z",
    ...overrides,
  };
}

async function getFreePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
          return;
        }
        reject(new Error("failed to allocate free port"));
      });
    });
  });
}

async function runNodeScript(scriptPath: string, args: string[], input: unknown, env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    stdio: ["pipe", "pipe", "pipe"],
    env,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdin.end(JSON.stringify(input));

  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  return { code, stdout, stderr };
}

async function waitForHttpOk(url: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${url}`);
}

async function waitFor<T>(callback: () => T | undefined | null): Promise<T> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const value = callback();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("timed out waiting for condition");
}

async function waitForAsync<T>(callback: () => Promise<T | undefined | null>): Promise<T> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const value = await callback();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("timed out waiting for async condition");
}

async function runBootstrap(scriptPath: string, tempDir: string) {
  const markerPath = path.join(tempDir, `${path.basename(path.dirname(scriptPath))}-started.txt`);
  const starterPath = path.join(tempDir, "mark-started.mjs");
  await writeFile(
    starterPath,
    "import { writeFileSync } from 'node:fs'; writeFileSync(process.env.MARKER_PATH, 'started');\n",
    "utf8",
  );
  const command = `"${process.execPath}" "${starterPath}"`;

  const child = spawn(process.execPath, [scriptPath], {
    stdio: "ignore",
    env: {
      ...process.env,
      MARKER_PATH: markerPath,
      MEMORY_RUNTIME_BASE_URL: `http://127.0.0.1:${await getFreePort()}`,
      MEMORY_RUNTIME_START_COMMAND: command,
      MEMORY_RUNTIME_API_MODE: "lite",
      MEMORY_RUNTIME_HEALTH_PATH: "/v1/lite/healthz",
      MEMORY_MCP_COMMAND: "off",
      CODEX_APP_SERVER_COMMAND: "off",
    },
  });

  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", () => resolve());
  });
  await waitForAsync(async () => {
    try {
      return await readFile(markerPath, "utf8");
    } catch {
      return null;
    }
  });
}

describe("lite host adapter E2E", () => {
  let tempDir: string;
  let store: FileMemoryStore;
  let liteApp: FastifyInstance;
  let liteBaseUrl: string;
  const children: ChildProcess[] = [];

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "axis-lite-host-e2e-"));
    store = new FileMemoryStore({ memoryDir: tempDir });
    await store.appendRecord(record());
    liteApp = createLiteRuntimeApp({
      memoryDir: tempDir,
      store,
      configSource: {
        AXIS_MANAGED_CONFIG_PATH: path.join(tempDir, "missing-config.json"),
        AXIS_MANAGED_SECRETS_PATH: path.join(tempDir, "missing-secrets.json"),
      },
    });
    await liteApp.listen({ host: "127.0.0.1", port: 0 });
    const address = liteApp.server.address();
    if (!address || typeof address !== "object") {
      throw new Error("lite runtime did not expose a TCP address");
    }
    liteBaseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    for (const child of children.splice(0)) {
      child.kill();
    }
    await liteApp.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("Claude bridge injects memory through lite HTTP and does not register MCP tools", async () => {
    const result = await runNodeScript(
      claudeBridgeScript,
      ["prepare-context"],
      {
        workspace_id: ids.workspace,
        user_id: ids.user,
        session_id: ids.session,
        turn_id: "turn-lite-claude",
        user_prompt: "上次中文回复的约定是什么",
      },
      {
        ...process.env,
        MEMORY_RUNTIME_BASE_URL: liteBaseUrl,
        MEMORY_RUNTIME_API_MODE: "lite",
      },
    );

    expect(result.code).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.additionalContext).toContain("用户偏好中文回复");
    expect(output.memoryModelStatus).toMatchObject({ degraded: true });

    const mcpConfig = JSON.parse(
      await readFile(path.join(adapterRoot, "memory-claude-plugin", ".mcp.json"), "utf8"),
    );
    expect(mcpConfig).toEqual({ mcpServers: {} });
  });

  it("Claude and Codex bootstraps start lite runtime command when health check misses", async () => {
    await runBootstrap(claudeBootstrapScript, tempDir);
    await runBootstrap(codexBootstrapScript, tempDir);
  });

  it("Codex proxy injects lite prepared context into the upstream thread without MCP calls", async () => {
    const upstreamPort = await getFreePort();
    const proxyPort = await getFreePort();
    const upstreamMessages: Array<Record<string, unknown>> = [];
    const upstreamHttp = http.createServer();
    const upstream = new WebSocketServer({ server: upstreamHttp });
    upstream.on("connection", (socket) => {
      socket.on("message", (message) => {
        upstreamMessages.push(JSON.parse(message.toString()));
      });
    });
    await new Promise<void>((resolve) => upstreamHttp.listen(upstreamPort, "127.0.0.1", () => resolve()));

    const proxy = spawn(process.execPath, [codexProxyScript], {
      stdio: "ignore",
      env: {
        ...process.env,
        MEMORY_RUNTIME_BASE_URL: liteBaseUrl,
        MEMORY_RUNTIME_API_MODE: "lite",
        MEMORY_WORKSPACE_ID: ids.workspace,
        MEMORY_USER_ID: ids.user,
        CODEX_APP_SERVER_URL: `ws://127.0.0.1:${upstreamPort}`,
        MEMORY_CODEX_PROXY_LISTEN_URL: `ws://127.0.0.1:${proxyPort}`,
      },
    });
    children.push(proxy);
    await waitForHttpOk(`http://127.0.0.1:${proxyPort}/readyz`);

    const client = new WebSocket(`ws://127.0.0.1:${proxyPort}`);
    await new Promise<void>((resolve, reject) => {
      client.once("open", resolve);
      client.once("error", reject);
    });
    client.send(JSON.stringify({
      jsonrpc: "2.0",
      id: "turn-start-1",
      method: "turn/start",
      params: {
        threadId: "thread-lite-codex",
        cwd: tempDir,
        input: [
          {
            type: "text",
            text: "上次中文回复的约定是什么",
          },
        ],
      },
    }));

    const injectionMessage = await waitFor(() =>
      upstreamMessages.find((message) => message.method === "thread/inject_items"),
    );
    expect(JSON.stringify(injectionMessage)).toContain("用户偏好中文回复");
    expect(upstreamMessages.some((message) => String(message.method).toLowerCase().includes("mcp"))).toBe(false);

    client.close();
    upstream.close();
    await new Promise<void>((resolve) => upstreamHttp.close(() => resolve()));
  });
});
