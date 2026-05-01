import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
const codexLauncherScript = path.join(
  adapterRoot,
  "memory-codex-adapter",
  "bin",
  "memory-codex.mjs",
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

async function writeManagedState(axisHome: string, runtimeUrl: string) {
  await mkdir(axisHome, { recursive: true });
  await writeFile(
    path.join(axisHome, "state.json"),
    `${JSON.stringify({
      version: 1,
      services: [
        {
          name: "lite-runtime",
          pid: 0,
          logPath: "",
          url: runtimeUrl,
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
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

async function writeLiteRuntimeStarter(tempDir: string) {
  const runtimePort = await getFreePort();
  const memoryDir = path.join(tempDir, "recovered-memory");
  const pidPath = path.join(tempDir, "recovered-lite-runtime.pid");
  const starterPath = path.join(tempDir, "start-lite-runtime.mjs");
  const appModuleUrl = pathToFileURL(path.resolve(process.cwd(), "src", "lite", "http-app.ts")).href;
  await writeFile(
    starterPath,
    [
      `import { createLiteRuntimeApp } from ${JSON.stringify(appModuleUrl)};`,
      "import { writeFileSync } from 'node:fs';",
      "import process from 'node:process';",
      "writeFileSync(process.env.LITE_RUNTIME_PID_PATH, String(process.pid));",
      "const app = createLiteRuntimeApp({ memoryDir: process.env.AXIS_LITE_MEMORY_DIR });",
      "await app.listen({ host: '127.0.0.1', port: Number(process.env.LITE_RUNTIME_PORT) });",
    ].join("\n"),
    "utf8",
  );

  return {
    runtimePort,
    memoryDir,
    pidPath,
    startCommand: `"${process.execPath}" --import tsx "${starterPath}"`,
    baseUrl: `http://127.0.0.1:${runtimePort}`,
  };
}

async function killPidFile(pidPath: string) {
  try {
    const pid = Number.parseInt(await readFile(pidPath, "utf8"), 10);
    if (Number.isInteger(pid) && pid > 0) {
      process.kill(pid);
    }
  } catch {
    // Process may have already exited.
  }
}

describe("lite host adapter E2E", () => {
  let tempDir: string;
  let store: FileMemoryStore;
  let liteApp: FastifyInstance;
  let liteBaseUrl: string;
  const children: ChildProcess[] = [];
  const recoveryPidPaths: string[] = [];

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
    await Promise.all(recoveryPidPaths.splice(0).map((pidPath) => killPidFile(pidPath)));
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

  it("Claude bridge reads the managed lite runtime URL when no runtime URL is configured", async () => {
    const axisHome = path.join(tempDir, "axis-home");
    await writeManagedState(axisHome, liteBaseUrl);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      AXIS_HOME: axisHome,
      MEMORY_RUNTIME_API_MODE: "lite",
    };
    delete env.MEMORY_RUNTIME_BASE_URL;

    const result = await runNodeScript(
      claudeBridgeScript,
      ["prepare-context"],
      {
        workspace_id: ids.workspace,
        user_id: ids.user,
        session_id: ids.session,
        turn_id: "turn-lite-managed-state",
        user_prompt: "上次中文回复的约定是什么",
      },
      env,
    );

    expect(result.code).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.additionalContext).toContain("用户偏好中文回复");
  });

  it("Claude and Codex bootstraps start lite runtime command when health check misses", async () => {
    await runBootstrap(claudeBootstrapScript, tempDir);
    await runBootstrap(codexBootstrapScript, tempDir);
  });

  it("Claude bridge recovers a stopped lite runtime and retries prepare-context", async () => {
    const recovery = await writeLiteRuntimeStarter(tempDir);
    recoveryPidPaths.push(recovery.pidPath);
    const result = await runNodeScript(
      claudeBridgeScript,
      ["prepare-context"],
      {
        workspace_id: ids.workspace,
        user_id: ids.user,
        session_id: ids.session,
        turn_id: "turn-lite-recovery",
        user_prompt: "普通问题",
      },
      {
        ...process.env,
        MEMORY_RUNTIME_BASE_URL: recovery.baseUrl,
        MEMORY_RUNTIME_API_MODE: "lite",
        MEMORY_RUNTIME_START_COMMAND: recovery.startCommand,
        MEMORY_RUNTIME_RECOVERY_TIMEOUT_MS: "5000",
        AXIS_LITE_MEMORY_DIR: recovery.memoryDir,
        LITE_RUNTIME_PORT: String(recovery.runtimePort),
        LITE_RUNTIME_PID_PATH: recovery.pidPath,
      },
    );

    expect(result.code).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.traceId).toBeTruthy();
    expect(output.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
  });

  it("Codex proxy injects lite prepared context into the upstream thread without MCP calls", async () => {
    const upstreamPort = await getFreePort();
    const proxyPort = await getFreePort();
    await writeManagedState(tempDir, liteBaseUrl);
    const upstreamMessages: Array<Record<string, unknown>> = [];
    const upstreamHttp = http.createServer();
    const upstream = new WebSocketServer({ server: upstreamHttp });
    upstream.on("connection", (socket) => {
      socket.on("message", (message) => {
        upstreamMessages.push(JSON.parse(message.toString()));
      });
    });
    await new Promise<void>((resolve) => upstreamHttp.listen(upstreamPort, "127.0.0.1", () => resolve()));

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      MEMORY_RUNTIME_API_MODE: "lite",
      MEMORY_WORKSPACE_ID: ids.workspace,
      MEMORY_USER_ID: ids.user,
      AXIS_HOME: tempDir,
      CODEX_APP_SERVER_URL: `ws://127.0.0.1:${upstreamPort}`,
      MEMORY_CODEX_PROXY_LISTEN_URL: `ws://127.0.0.1:${proxyPort}`,
    };
    delete env.MEMORY_RUNTIME_BASE_URL;
    const proxy = spawn(process.execPath, [codexProxyScript], {
      stdio: "ignore",
      env,
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

  it("Codex launcher runs internal services in the background and keeps the client foreground", async () => {
    const proxyPort = await getFreePort();
    const appServerPort = await getFreePort();
    const markerPath = path.join(tempDir, "codex-client-foreground.json");
    const clientScript = path.join(tempDir, "codex-client-foreground.mjs");
    await writeFile(
      clientScript,
      [
        "import { writeFileSync } from 'node:fs';",
        "writeFileSync(process.env.MARKER_PATH, JSON.stringify({",
        "  clientCommandRan: true,",
        "  proxyUrl: process.env.MEMORY_CODEX_PROXY_LISTEN_URL,",
        "  appServerUrl: process.env.CODEX_APP_SERVER_URL,",
        "}));",
      ].join("\n"),
      "utf8",
    );

    const appServer = new WebSocketServer({ port: appServerPort, host: "127.0.0.1" });
    children.push({
      kill: () => {
        appServer.close();
        return true;
      },
    } as ChildProcess);
    await new Promise<void>((resolve, reject) => {
      appServer.once("listening", resolve);
      appServer.once("error", reject);
    });

    const launcher = spawn(process.execPath, [codexLauncherScript], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        MEMORY_RUNTIME_BASE_URL: liteBaseUrl,
        MEMORY_RUNTIME_API_MODE: "lite",
        MEMORY_RUNTIME_START_COMMAND: "off",
        MEMORY_CODEX_PROXY_LISTEN_URL: `ws://127.0.0.1:${proxyPort}`,
        CODEX_APP_SERVER_URL: `ws://127.0.0.1:${appServerPort}`,
        CODEX_APP_SERVER_COMMAND: "off",
        MEMORY_CODEX_BOOTSTRAP_COMMAND: "off",
        MEMORY_CODEX_CLIENT_COMMAND: `"${process.execPath}" "${clientScript}"`,
        MARKER_PATH: markerPath,
      },
    });
    children.push(launcher);
    let stdout = "";
    let stderr = "";
    launcher.stdout?.setEncoding("utf8");
    launcher.stderr?.setEncoding("utf8");
    launcher.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    launcher.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });

    await new Promise<void>((resolve, reject) => {
      launcher.once("error", reject);
      launcher.once("exit", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`launcher exited with ${code}; stdout=${stdout}; stderr=${stderr}`));
      });
    });

    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    expect(marker).toEqual({
      clientCommandRan: true,
      proxyUrl: `ws://127.0.0.1:${proxyPort}`,
      appServerUrl: `ws://127.0.0.1:${appServerPort}`,
    });

    await expect(fetch(`http://127.0.0.1:${proxyPort}/readyz`)).rejects.toThrow();
  });
});
