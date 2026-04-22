import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createServer } from "../../server.js";
import type { AgentConfig } from "../../config/index.js";
import type { ChatChunk } from "../../providers/index.js";
import { __expireSessionEventsForTest, createSessionState, pushSessionEvent } from "../state.js";

const runtimeCalls = {
  healthz: vi.fn(async () => ({
    liveness: { status: "alive" as const },
    readiness: { status: "ready" as const },
    dependencies: {
      read_model: { name: "read_model" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
      embeddings: { name: "embeddings" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
      storage_writeback: { name: "storage_writeback" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
      writeback_llm: { name: "writeback_llm" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
    },
  })),
  dependencyStatus: vi.fn(async () => ({
    read_model: { name: "read_model" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
    embeddings: { name: "embeddings" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
    storage_writeback: { name: "storage_writeback" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
    writeback_llm: { name: "writeback_llm" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
  })),
  sessionStartContext: vi.fn(async () => ({
    trace_id: "trace-session",
    additional_context: "",
    active_task_summary: null,
    injection_block: null,
    memory_mode: "workspace_plus_global" as const,
    dependency_status: {
      read_model: { name: "read_model" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
      embeddings: { name: "embeddings" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
      storage_writeback: { name: "storage_writeback" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
      writeback_llm: { name: "writeback_llm" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
    },
    degraded: false,
  })),
  prepareContext: vi.fn(async ({ phase }: { phase: string }) => ({
    trace_id: `trace-${phase}`,
    trigger: true,
    trigger_reason: phase,
    memory_packet: null,
    injection_block: null,
    degraded: false,
    dependency_status: {
      read_model: { name: "read_model" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
      embeddings: { name: "embeddings" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
      storage_writeback: { name: "storage_writeback" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
      writeback_llm: { name: "writeback_llm" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
    },
    budget_used: 0,
    memory_packet_ids: [],
  })),
  finalizeTurn: vi.fn(async () => ({
    trace_id: "trace-finalize",
    write_back_candidates: [],
    submitted_jobs: [],
    memory_mode: "workspace_plus_global" as const,
    candidate_count: 0,
    filtered_count: 0,
    filtered_reasons: [],
    writeback_submitted: false,
    degraded: false,
    dependency_status: {
      read_model: { name: "read_model" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
      embeddings: { name: "embeddings" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
      storage_writeback: { name: "storage_writeback" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
      writeback_llm: { name: "writeback_llm" as const, status: "healthy" as const, detail: "", last_checked_at: "now" },
    },
  })),
};
let providerChatImpl: (request: { signal?: AbortSignal }) => AsyncIterableIterator<ChatChunk> = async function* () {
  yield { type: "text_delta", text: "reply chunk" } as const;
  yield {
    type: "end",
    finish_reason: "stop" as const,
    usage: {
      prompt_tokens: 3,
      completion_tokens: 5,
    },
  };
};

vi.mock("../../memory-client/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../memory-client/index.js")>();
  return {
    ...actual,
    MemoryClient: vi.fn().mockImplementation(() => runtimeCalls),
  };
});

vi.mock("../../providers/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../providers/index.js")>();
  return {
    ...actual,
    createProvider: vi.fn(() => ({
      id: () => "ollama",
      model: () => "qwen2.5-coder",
      chat: (request: { signal?: AbortSignal }) => providerChatImpl(request),
    })),
  };
});

function createTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mna-ws-"));
}

function createConfig(workspaceRoot: string): AgentConfig {
  return {
    runtime: {
      baseUrl: "http://127.0.0.1:4100",
      requestTimeoutMs: 800,
      finalizeTimeoutMs: 1_500,
    },
    provider: {
      kind: "ollama",
      model: "qwen2.5-coder",
      baseUrl: "http://127.0.0.1:11434",
      temperature: 0.2,
    },
    memory: {
      mode: "workspace_plus_global",
      userId: "550e8400-e29b-41d4-a716-446655440001",
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
      cwd: workspaceRoot,
    },
    mcp: {
      servers: [],
    },
    tools: {
      maxOutputChars: 8_192,
      approvalMode: "confirm",
      shellExec: {
        enabled: true,
        timeoutMs: 30_000,
        denyPatterns: [],
      },
    },
    cli: {
      systemPrompt: null,
    },
    context: {
      maxTokens: null,
      reserveTokens: 4_096,
      compactionStrategy: "truncate",
    },
    planning: {
      planMode: "advisory",
    },
    logging: {
      level: "info",
      format: "json",
    },
    streaming: {
      flushChars: 4,
      flushIntervalMs: 1,
    },
    skills: {
      enabled: true,
      autoDiscovery: false,
      discoveryPaths: [],
    },
    locale: "zh-CN",
  };
}

function waitForMessages(target: string[], count: number) {
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 5_000;
    const timer = setInterval(() => {
      if (target.length >= count) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() > deadline) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for ${count} websocket messages.`));
      }
    }, 10);
  });
}

function waitForMessage(target: string[], predicate: (payload: Record<string, unknown>) => boolean) {
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 5_000;
    const timer = setInterval(() => {
      if (target.some((item) => predicate(JSON.parse(item) as Record<string, unknown>))) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() > deadline) {
        clearInterval(timer);
        reject(new Error("Timed out waiting for websocket message."));
      }
    }, 10);
  });
}

describe("session websocket routes", () => {
  const apps: Array<ReturnType<typeof createServer>> = [];
  const homes: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    providerChatImpl = async function* () {
      yield { type: "text_delta", text: "reply chunk" } as const;
      yield {
        type: "end",
        finish_reason: "stop" as const,
        usage: {
          prompt_tokens: 3,
          completion_tokens: 5,
        },
      };
    };
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    for (const home of homes.splice(0)) {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("streams turn events and replays buffered events on reconnect", async () => {
    const home = createTempHome();
    homes.push(home);
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(workspaceRoot), {
      homeDirectory: home,
    });
    apps.push(app);
    await app.listen({
      host: "127.0.0.1",
      port: 0,
    });

    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("server address is not available");
    }

    const createResponse = await fetch(`http://127.0.0.1:${address.port}/v1/agent/sessions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${app.mnaToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspace_id: "project-alpha",
      }),
    });

    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as { session_id: string };

    const wsUrl = `ws://127.0.0.1:${address.port}/v1/agent/sessions/${created.session_id}/ws?token=${app.mnaToken}`;
    const messages: string[] = [];
    const ws = new WebSocket(wsUrl);
    ws.addEventListener("message", (event) => {
      messages.push(String(event.data));
    });
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("websocket open failed")), { once: true });
    });

    ws.send(JSON.stringify({
      kind: "user_input",
      turn_id: "turn-1",
      text: "hello",
    }));

    await waitForMessages(messages, 5);
    const parsed = messages.map((item) => JSON.parse(item) as Record<string, unknown>);
    expect(parsed[0]).toMatchObject({
      kind: "session_started",
      session_id: created.session_id,
      workspace_id: "project-alpha",
    });
    expect(parsed.some((item) => item.kind === "assistant_delta")).toBe(true);
    expect(parsed.some((item) => item.kind === "turn_end")).toBe(true);

    const lastEventId = Number(parsed.at(-1)?.event_id ?? 0);
    ws.close();

    const replayMessages: string[] = [];
    const replayWs = new WebSocket(`${wsUrl}&last_event_id=${lastEventId - 2}`);
    replayWs.addEventListener("message", (event) => {
      replayMessages.push(String(event.data));
    });
    await new Promise<void>((resolve, reject) => {
      replayWs.addEventListener("open", () => resolve(), { once: true });
      replayWs.addEventListener("error", () => reject(new Error("websocket replay open failed")), { once: true });
    });

    await waitForMessages(replayMessages, 2);
    const replayParsed = replayMessages.map((item) => JSON.parse(item) as Record<string, unknown>);
    expect(replayParsed[0]).toMatchObject({
      kind: "session_started",
      session_id: created.session_id,
    });
    expect(replayParsed.some((item) => item.kind === "assistant_delta" || item.kind === "trace")).toBe(true);
    expect(replayParsed.some((item) => item.kind === "assistant_delta" || item.kind === "trace" || item.kind === "turn_end")).toBe(true);
    replayWs.close();
  }, 15_000);

  it("skips tool confirmation events when approval mode is yolo", async () => {
    const home = createTempHome();
    homes.push(home);
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    providerChatImpl = async function* () {
      yield {
        type: "tool_call",
        call: {
          id: "call-yolo",
          name: "fs_write",
          args: {
            path: "note.txt",
            content: "hello",
          },
        },
      } as const;
      yield {
        type: "end",
        finish_reason: "tool_use" as const,
        usage: {
          prompt_tokens: 3,
          completion_tokens: 5,
        },
      };
      yield {
        type: "text_delta",
        text: "done",
      } as const;
      yield {
        type: "end",
        finish_reason: "stop" as const,
        usage: {
          prompt_tokens: 4,
          completion_tokens: 6,
        },
      };
    };

    const config = createConfig(workspaceRoot);
    config.tools.approvalMode = "yolo";

    const app = createServer(config, {
      homeDirectory: home,
    });
    apps.push(app);
    await app.listen({
      host: "127.0.0.1",
      port: 0,
    });

    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("server address is not available");
    }

    const createResponse = await fetch(`http://127.0.0.1:${address.port}/v1/agent/sessions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${app.mnaToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspace_id: "project-alpha",
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as { session_id: string };

    const wsUrl = `ws://127.0.0.1:${address.port}/v1/agent/sessions/${created.session_id}/ws?token=${app.mnaToken}`;
    const messages: string[] = [];
    const ws = new WebSocket(wsUrl);
    ws.addEventListener("message", (event) => {
      messages.push(String(event.data));
    });
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("websocket open failed")), { once: true });
    });

    ws.send(JSON.stringify({
      kind: "user_input",
      turn_id: "turn-yolo",
      text: "创建一个文件",
    }));

    await waitForMessage(messages, (payload) => payload.kind === "turn_end" && payload.turn_id === "turn-yolo");

    expect(messages.some((item) => {
      const payload = JSON.parse(item) as Record<string, unknown>;
      return payload.kind === "tool_confirm_needed";
    })).toBe(false);

    ws.close();
  });

  it("emits plan confirmation events when plan mode is confirm", async () => {
    const home = createTempHome();
    homes.push(home);
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const config = createConfig(workspaceRoot);
    config.planning = {
      planMode: "confirm",
    };

    const app = createServer(config, {
      homeDirectory: home,
    });
    apps.push(app);
    await app.listen({
      host: "127.0.0.1",
      port: 0,
    });

    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("server address is not available");
    }

    const createResponse = await fetch(`http://127.0.0.1:${address.port}/v1/agent/sessions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${app.mnaToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspace_id: "project-alpha",
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as { session_id: string };

    const wsUrl = `ws://127.0.0.1:${address.port}/v1/agent/sessions/${created.session_id}/ws?token=${app.mnaToken}`;
    const messages: string[] = [];
    const ws = new WebSocket(wsUrl);
    ws.addEventListener("message", (event) => {
      messages.push(String(event.data));
    });
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("websocket open failed")), { once: true });
    });

    ws.send(JSON.stringify({
      kind: "user_input",
      turn_id: "turn-plan-confirm",
      text: "给我一个方案，先做 A，再做 B，再做 C",
    }));

    await waitForMessage(messages, (payload) => payload.kind === "plan_confirm_needed");
    const planConfirm = messages
      .map((item) => JSON.parse(item) as Record<string, unknown>)
      .find((payload) => payload.kind === "plan_confirm_needed");
    expect(planConfirm).toMatchObject({
      kind: "plan_confirm_needed",
      turn_id: "turn-plan-confirm",
    });

    ws.send(JSON.stringify({
      kind: "plan_confirm",
      confirm_id: String(planConfirm?.confirm_id),
      decision: "approve",
    }));

    await waitForMessage(messages, (payload) => payload.kind === "turn_end" && payload.turn_id === "turn-plan-confirm");
    ws.close();
  });

  it("rejects websocket with invalid token", async () => {
    const home = createTempHome();
    homes.push(home);
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(workspaceRoot), {
      homeDirectory: home,
    });
    apps.push(app);
    await app.listen({
      host: "127.0.0.1",
      port: 0,
    });

    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("server address is not available");
    }

    const createResponse = await fetch(`http://127.0.0.1:${address.port}/v1/agent/sessions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${app.mnaToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspace_id: "project-alpha",
      }),
    });
    const created = await createResponse.json() as { session_id: string };

    const rejection = await new Promise<{ statusCode?: number; body: string }>((resolve, reject) => {
      const request = http.request({
        host: "127.0.0.1",
        port: address.port,
        path: `/v1/agent/sessions/${created.session_id}/ws?token=bad-token`,
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Key": "test-key",
          "Sec-WebSocket-Version": "13"
        }
      });

      request.on("response", (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode,
            body: Buffer.concat(chunks).toString("utf8")
          });
        });
      });
      request.on("upgrade", () => reject(new Error("websocket unexpectedly upgraded")));
      request.on("error", reject);
      request.end();
    });

    expect(rejection.statusCode).toBe(401);
    expect(JSON.parse(rejection.body)).toEqual({
      error: {
        code: "token_invalid",
        message: "Invalid or missing token."
      }
    });
  }, 15_000);

  it("responds to ping with pong", async () => {
    const home = createTempHome();
    homes.push(home);
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(workspaceRoot), {
      homeDirectory: home,
    });
    apps.push(app);
    await app.listen({
      host: "127.0.0.1",
      port: 0,
    });

    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("server address is not available");
    }

    const createResponse = await fetch(`http://127.0.0.1:${address.port}/v1/agent/sessions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${app.mnaToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspace_id: "project-alpha",
      }),
    });
    const created = await createResponse.json() as { session_id: string };

    const wsUrl = `ws://127.0.0.1:${address.port}/v1/agent/sessions/${created.session_id}/ws?token=${app.mnaToken}`;
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("websocket open failed")), { once: true });
    });

    const pong = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for pong.")), 1_000);
      ws.addEventListener("message", (event) => {
        const payload = JSON.parse(String(event.data)) as Record<string, unknown>;
        if (payload.kind === "pong") {
          clearTimeout(timer);
          resolve(payload);
        }
      });
      ws.send(JSON.stringify({ kind: "ping" }));
    });

    expect(pong).toMatchObject({
      kind: "pong"
    });
    ws.close();
  }, 15_000);

  it("reports replay gaps when buffered events have already been evicted", async () => {
    const home = createTempHome();
    homes.push(home);
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(workspaceRoot), {
      homeDirectory: home,
    });
    apps.push(app);
    await app.listen({
      host: "127.0.0.1",
      port: 0,
    });

    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("server address is not available");
    }

    const createResponse = await fetch(`http://127.0.0.1:${address.port}/v1/agent/sessions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${app.mnaToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspace_id: "project-alpha",
      }),
    });
    const created = await createResponse.json() as { session_id: string };
    const session = await createSessionState(app.runtimeState, created.session_id);

    for (let index = 0; index < 205; index += 1) {
      pushSessionEvent(session, {
        kind: "assistant_delta",
        turn_id: "turn-gap",
        text: `chunk-${index}`,
      });
    }

    const replayMessages: string[] = [];
    const replayWs = new WebSocket(
      `ws://127.0.0.1:${address.port}/v1/agent/sessions/${created.session_id}/ws?token=${app.mnaToken}&last_event_id=1`,
    );
    replayWs.addEventListener("message", (event) => {
      replayMessages.push(String(event.data));
    });

    await new Promise<void>((resolve, reject) => {
      replayWs.addEventListener("open", () => resolve(), { once: true });
      replayWs.addEventListener("error", () => reject(new Error("websocket replay open failed")), { once: true });
    });

    await waitForMessages(replayMessages, 3);
    const replayParsed = replayMessages.map((item) => JSON.parse(item) as Record<string, unknown>);

    expect(replayParsed[0]).toMatchObject({
      kind: "session_started",
      session_id: created.session_id,
    });
    expect(replayParsed[1]).toMatchObject({
      kind: "replay_gap",
      last_event_id: 1,
    });
    expect(replayParsed[2]).toMatchObject({
      kind: "assistant_delta",
      event_id: 6,
      text: "chunk-5",
    });

    replayWs.close();
  }, 15_000);

  it("drops replay events that are older than the buffer ttl window", async () => {
    const home = createTempHome();
    homes.push(home);
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(workspaceRoot), {
      homeDirectory: home,
    });
    apps.push(app);
    await app.listen({
      host: "127.0.0.1",
      port: 0,
    });

    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("server address is not available");
    }

    const createResponse = await fetch(`http://127.0.0.1:${address.port}/v1/agent/sessions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${app.mnaToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspace_id: "project-alpha",
      }),
    });
    const created = await createResponse.json() as { session_id: string };
    const session = await createSessionState(app.runtimeState, created.session_id);

    pushSessionEvent(session, {
      kind: "assistant_delta",
      turn_id: "turn-ttl",
      text: "expired-chunk",
    });
    __expireSessionEventsForTest(session, Date.now() + 1);

    const replayMessages: string[] = [];
    const replayWs = new WebSocket(
      `ws://127.0.0.1:${address.port}/v1/agent/sessions/${created.session_id}/ws?token=${app.mnaToken}&last_event_id=0`,
    );
    replayWs.addEventListener("message", (event) => {
      replayMessages.push(String(event.data));
    });

    await new Promise<void>((resolve, reject) => {
      replayWs.addEventListener("open", () => resolve(), { once: true });
      replayWs.addEventListener("error", () => reject(new Error("websocket replay open failed")), { once: true });
    });

    await waitForMessages(replayMessages, 1);
    const replayParsed = replayMessages.map((item) => JSON.parse(item) as Record<string, unknown>);

    expect(replayParsed).toEqual([
      expect.objectContaining({
        kind: "session_started",
        session_id: created.session_id,
      }),
    ]);

    replayWs.close();
  }, 15_000);

  it("finishes a turn with abort and drops late provider chunks", async () => {
    providerChatImpl = async function* ({ signal }) {
      yield { type: "text_delta", text: "partial" } as const;
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (signal?.aborted) {
        yield { type: "text_delta", text: "ignored-after-abort" } as const;
      }
      yield {
        type: "end",
        finish_reason: "stop" as const,
        usage: {
          prompt_tokens: 3,
          completion_tokens: 5,
        },
      };
    };

    const home = createTempHome();
    homes.push(home);
    const workspaceRoot = path.join(home, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const app = createServer(createConfig(workspaceRoot), {
      homeDirectory: home,
    });
    apps.push(app);
    await app.listen({
      host: "127.0.0.1",
      port: 0,
    });

    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("server address is not available");
    }

    const createResponse = await fetch(`http://127.0.0.1:${address.port}/v1/agent/sessions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${app.mnaToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspace_id: "project-alpha",
      }),
    });
    const created = await createResponse.json() as { session_id: string };

    const wsUrl = `ws://127.0.0.1:${address.port}/v1/agent/sessions/${created.session_id}/ws?token=${app.mnaToken}`;
    const messages: string[] = [];
    const ws = new WebSocket(wsUrl);
    ws.addEventListener("message", (event) => {
      messages.push(String(event.data));
    });
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("websocket open failed")), { once: true });
    });

    ws.send(JSON.stringify({
      kind: "user_input",
      turn_id: "turn-abort",
      text: "hello",
    }));

    await waitForMessages(messages, 3);
    ws.send(JSON.stringify({
      kind: "abort",
      turn_id: "turn-abort",
    }));

    await waitForMessage(messages, (item) => item.kind === "turn_end" && item.finish_reason === "abort");
    const parsed = messages.map((item) => JSON.parse(item) as Record<string, unknown>);

    expect(parsed.some((item) => item.kind === "assistant_delta" && item.text === "partial")).toBe(true);
    expect(parsed.some((item) => item.kind === "assistant_delta" && item.text === "ignored-after-abort")).toBe(false);
    expect(parsed.some((item) => item.kind === "turn_end" && item.finish_reason === "abort")).toBe(true);

    ws.close();
  }, 15_000);
});
