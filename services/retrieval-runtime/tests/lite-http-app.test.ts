import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileMemoryStore, type LiteMemoryRecord } from "../src/lite/file-store.js";
import { createLiteRuntimeApp } from "../src/lite/http-app.js";

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

describe("lite runtime HTTP app", () => {
  let tempDir: string;
  let store: FileMemoryStore;
  let app: FastifyInstance;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "axis-lite-http-"));
    store = new FileMemoryStore({ memoryDir: tempDir });
    app = createLiteRuntimeApp({
      memoryDir: tempDir,
      store,
      configSource: {
        AXIS_MANAGED_CONFIG_PATH: path.join(tempDir, "missing-config.json"),
        AXIS_MANAGED_SECRETS_PATH: path.join(tempDir, "missing-secrets.json"),
      },
    });
  });

  afterEach(async () => {
    await app.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("serves healthz with storage and memory model status", async () => {
    await store.appendRecord(record());

    const response = await app.inject({
      method: "GET",
      url: "/v1/lite/healthz",
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      mode: "lite",
      storage: { records: 1 },
      memory_model_status: { degraded: true, degradationReason: "memory_model_not_configured" },
      upgrade_suggestion: { should_upgrade: false, threshold: 5000 },
    });
  });

  it("suggests full mode when lite memory volume is high", async () => {
    await writeFile(
      path.join(tempDir, "records.jsonl"),
      `${Array.from({ length: 5001 }, (_, index) => JSON.stringify(record({
        id: `rec-${index}`,
        summary: `用户偏好中文回复 ${index}`,
        updated_at: `2026-04-30T10:${String(index % 60).padStart(2, "0")}:00.000Z`,
      }))).join("\n")}\n`,
      "utf8",
    );

    const response = await app.inject({
      method: "GET",
      url: "/v1/lite/healthz",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().upgrade_suggestion).toMatchObject({
      should_upgrade: true,
      reason_code: "record_count_exceeded",
      command: "axis start --full",
    });
  });

  it("prepares context with an injection block and stores trace", async () => {
    await store.appendRecord(record());

    const response = await app.inject({
      method: "POST",
      url: "/v1/lite/prepare-context",
      payload: {
        host: "codex_app_server",
        workspace_id: ids.workspace,
        user_id: ids.user,
        session_id: ids.session,
        phase: "before_response",
        current_input: "上次中文回复的约定是什么",
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.injection_block.memory_records).toHaveLength(1);
    expect(body.injection_block.memory_records[0].id).toBe("rec-default");
    expect(body.trace.function_calls[0].name).toBe("memory_search");

    const traceResponse = await app.inject({
      method: "GET",
      url: `/v1/lite/traces/${body.trace_id}`,
    });
    expect(traceResponse.statusCode).toBe(200);
    expect(traceResponse.json().prepare.trace_id).toBe(body.trace_id);
  });

  it("writes after-response candidates with hard filtering and trace", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/lite/after-response",
      payload: {
        trace_id: "trace-lite-write",
        host: "claude_code_plugin",
        workspace_id: ids.workspace,
        user_id: ids.user,
        session_id: ids.session,
        current_input: "以后默认中文回复",
        assistant_output: "好的，已记住：默认中文回复。",
        candidates: [
          {
            candidate_type: "preference",
            scope: "user",
            summary: "用户偏好：默认中文回复",
            details: { preference_axis: "response_language", preference_value: "zh" },
            importance: 5,
            confidence: 0.92,
            idempotency_key: "preference:user:response_language:zh",
          },
          {
            candidate_type: "preference",
            scope: "user",
            summary: "sk-test-secret-token",
            details: {},
            importance: 5,
            confidence: 0.9,
          },
        ],
      },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      trace_id: "trace-lite-write",
      writeback_status: "accepted",
      accepted_count: 1,
      filtered_reasons: ["sensitive_content"],
    });
    expect(store.listRecords().map((item) => item.summary)).toEqual(["用户偏好：默认中文回复"]);

    const traceResponse = await app.inject({
      method: "GET",
      url: "/v1/lite/traces/trace-lite-write",
    });
    expect(traceResponse.json().writebacks[0]).toMatchObject({
      accepted_count: 1,
      accepted_record_ids: body.accepted_record_ids,
    });
  });

  it("returns validation errors for invalid prepare-context payloads", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/lite/prepare-context",
      payload: {
        host: "codex_app_server",
        current_input: "missing ids",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_prepare_context");
  });
});
