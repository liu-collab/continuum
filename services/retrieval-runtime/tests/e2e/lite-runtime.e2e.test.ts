import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileMemoryStore, type LiteMemoryRecord } from "../../src/lite/file-store.js";
import { createLiteRuntimeApp } from "../../src/lite/http-app.js";

const ids = {
  workspace: "550e8400-e29b-41d4-a716-446655440000",
  user: "550e8400-e29b-41d4-a716-446655440001",
  session: "550e8400-e29b-41d4-a716-446655440002",
};

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

async function postJson(baseUrl: string, url: string, payload: unknown) {
  const response = await fetch(`${baseUrl}${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function getJson(baseUrl: string, url: string) {
  const response = await fetch(`${baseUrl}${url}`);
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

describe("Lite runtime E2E", () => {
  let tempDir: string;
  let store: FileMemoryStore;
  let app: FastifyInstance;
  let baseUrl: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "axis-lite-runtime-e2e-"));
    store = new FileMemoryStore({ memoryDir: tempDir });
    app = createLiteRuntimeApp({
      memoryDir: tempDir,
      store,
      configSource: {
        AXIS_MANAGED_CONFIG_PATH: path.join(tempDir, "missing-config.json"),
        AXIS_MANAGED_SECRETS_PATH: path.join(tempDir, "missing-secrets.json"),
      },
    });

    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address !== "object") {
      throw new Error("lite runtime e2e server did not expose a TCP address");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await app.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns degraded rule-triggered injection and a readable trace", async () => {
    await store.appendRecord(record());

    const prepare = await postJson(baseUrl, "/v1/lite/prepare-context", {
      host: "codex_app_server",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      phase: "before_response",
      current_input: "上次中文回复的约定是什么",
    });

    expect(prepare.status).toBe(200);
    expect(prepare.body.memory_model_status).toMatchObject({
      degraded: true,
      degradationReason: "memory_model_not_configured",
    });
    expect(prepare.body.injection_block).toMatchObject({
      memory_records: [
        expect.objectContaining({
          id: "rec-default",
          summary: "用户偏好中文回复",
        }),
      ],
    });

    const traceId = String(prepare.body.trace_id);
    const trace = await getJson(baseUrl, `/v1/lite/traces/${traceId}`);
    expect(trace.status).toBe(200);
    expect(trace.body.prepare).toMatchObject({
      trace_id: traceId,
      rule_trigger: { trigger_type: "history_reference" },
      selected_record_ids: ["rec-default"],
    });
  });

  it("returns empty injection when before_response has no history cue", async () => {
    await store.appendRecord(record());

    const prepare = await postJson(baseUrl, "/v1/lite/prepare-context", {
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      phase: "before_response",
      current_input: "帮我写一个单元测试",
    });

    expect(prepare.status).toBe(200);
    expect(prepare.body.injection_block).toBeNull();
    expect(prepare.body.trace).toMatchObject({
      injected: false,
      function_calls: [],
    });
  });

  it("writes after-response candidates, filters secrets, and recalls the new memory", async () => {
    const writeback = await postJson(baseUrl, "/v1/lite/after-response", {
      trace_id: "trace-lite-e2e-write",
      host: "codex_app_server",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      current_input: "以后默认中文回复",
      assistant_output: "好的，已记住。",
      candidates: [
        {
          candidate_type: "preference",
          scope: "user",
          summary: "用户偏好：默认中文回复",
          details: { preference_axis: "response_language", preference_value: "zh" },
          importance: 5,
          confidence: 0.92,
          idempotency_key: "preference:user:default_chinese",
        },
        {
          candidate_type: "fact",
          scope: "workspace",
          summary: "api_key=sk-test-secret-token",
          details: {},
          importance: 5,
          confidence: 0.9,
        },
      ],
    });

    expect(writeback.status).toBe(200);
    expect(writeback.body).toMatchObject({
      writeback_status: "accepted",
      accepted_count: 1,
      filtered_reasons: ["sensitive_content"],
    });

    const prepare = await postJson(baseUrl, "/v1/lite/prepare-context", {
      host: "codex_app_server",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      phase: "before_response",
      current_input: "按上次约定继续中文回复",
    });

    expect(prepare.status).toBe(200);
    expect(prepare.body.injection_block).toMatchObject({
      memory_records: [
        expect.objectContaining({
          summary: "用户偏好：默认中文回复",
        }),
      ],
    });

    const trace = await getJson(baseUrl, "/v1/lite/traces/trace-lite-e2e-write");
    expect(trace.status).toBe(200);
    expect(trace.body.writebacks).toMatchObject([
      expect.objectContaining({
        accepted_count: 1,
      }),
    ]);
  });
});
