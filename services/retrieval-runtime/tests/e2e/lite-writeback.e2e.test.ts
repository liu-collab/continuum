import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileMemoryStore, type LiteMemoryRecord } from "../../src/lite/file-store.js";
import { createLiteRuntimeApp } from "../../src/lite/http-app.js";
import { LiteWritebackOutbox } from "../../src/lite/writeback-outbox.js";

const ids = {
  workspace: "550e8400-e29b-41d4-a716-446655440000",
  user: "550e8400-e29b-41d4-a716-446655440001",
  session: "550e8400-e29b-41d4-a716-446655440002",
  task: "550e8400-e29b-41d4-a716-446655440003",
};

class OneShotFailingStore extends FileMemoryStore {
  public failNextAppend = false;

  override async appendRecord(record: LiteMemoryRecord): Promise<void> {
    if (this.failNextAppend) {
      this.failNextAppend = false;
      throw new Error("disk unavailable");
    }
    await super.appendRecord(record);
  }
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

function afterResponsePayload(overrides: Record<string, unknown> = {}) {
  return {
    trace_id: "trace-lite-writeback-e2e",
    host: "codex_app_server",
    workspace_id: ids.workspace,
    user_id: ids.user,
    session_id: ids.session,
    current_input: "以后默认中文回复",
    assistant_output: "好的，已记住。",
    ...overrides,
  };
}

describe("Lite writeback E2E", () => {
  let tempDir: string;
  let store: OneShotFailingStore;
  let outbox: LiteWritebackOutbox;
  let app: FastifyInstance;
  let baseUrl: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "axis-lite-writeback-e2e-"));
    store = new OneShotFailingStore({ memoryDir: tempDir });
    outbox = new LiteWritebackOutbox({ memoryDir: tempDir });
    app = createLiteRuntimeApp({
      memoryDir: tempDir,
      store,
      outbox,
      configSource: {
        AXIS_MANAGED_CONFIG_PATH: path.join(tempDir, "missing-config.json"),
        AXIS_MANAGED_SECRETS_PATH: path.join(tempDir, "missing-secrets.json"),
      },
    });

    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address !== "object") {
      throw new Error("lite writeback e2e server did not expose a TCP address");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await app.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("extracts multi-turn rule candidates through after-response and stores trace", async () => {
    const response = await postJson(baseUrl, "/v1/lite/after-response", afterResponsePayload({
      trace_id: "trace-multi-turn",
      task_id: ids.task,
      assistant_output: "接下来还剩登录页表单校验。",
      recent_turns: [
        { role: "user", summary: "用户要求延续登录页任务", turn_id: "turn-1" },
        { role: "assistant", content: "已完成邮箱字段", turn_id: "turn-2" },
      ],
    }));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      writeback_status: "accepted",
      accepted_count: 2,
      extractor: {
        source: "rules",
        rules_count: 2,
        recent_turns_count: 2,
      },
    });
    await store.load();
    expect(store.listRecords().map((record) => record.memory_type).sort()).toEqual([
      "preference",
      "task_state",
    ]);
    expect(store.listRecords()[0]?.details).toMatchObject({
      recent_turns: expect.arrayContaining([
        expect.objectContaining({ turn_id: "turn-1" }),
      ]),
    });

    const trace = await getJson(baseUrl, "/v1/lite/traces/trace-multi-turn");
    expect(trace.status).toBe(200);
    expect(trace.body.writebacks).toMatchObject([
      expect.objectContaining({
        accepted_count: 2,
        extractor: expect.objectContaining({ recent_turns_count: 2 }),
      }),
    ]);
  });

  it("filters sensitive provided candidates before writing records", async () => {
    const response = await postJson(baseUrl, "/v1/lite/after-response", afterResponsePayload({
      trace_id: "trace-sensitive-filter",
      candidates: [
        {
          candidate_type: "fact",
          scope: "workspace",
          summary: "api_key=sk-test-secret-token",
          importance: 5,
        },
        {
          candidate_type: "fact",
          scope: "workspace",
          summary: "项目事实：使用 PostgreSQL 16",
          importance: 5,
          confidence: 0.9,
        },
      ],
    }));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      writeback_status: "accepted",
      accepted_count: 1,
      filtered_reasons: ["sensitive_content"],
    });
    await store.load();
    expect(store.listRecords().map((record) => record.summary)).toEqual([
      "项目事实：使用 PostgreSQL 16",
    ]);
  });

  it("serializes concurrent after-response writes into valid JSONL lines", async () => {
    const requests = Array.from({ length: 20 }, (_, index) =>
      postJson(baseUrl, "/v1/lite/after-response", afterResponsePayload({
        trace_id: `trace-concurrent-${index}`,
        candidates: [
          {
            candidate_type: "fact",
            scope: "workspace",
            summary: `项目事实：并发写入 ${index}`,
            importance: 4,
            confidence: 0.85,
          },
        ],
      })),
    );

    const responses = await Promise.all(requests);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(responses.map((response) => response.body.accepted_count)).toEqual(Array(20).fill(1));

    const content = await readFile(path.join(tempDir, "records.jsonl"), "utf8");
    const parsed = content.trim().split(/\r?\n/).map((line) => JSON.parse(line) as LiteMemoryRecord);
    expect(parsed).toHaveLength(20);
    expect(parsed.map((record) => record.summary).sort()).toEqual(
      Array.from({ length: 20 }, (_, index) => `项目事实：并发写入 ${index}`).sort(),
    );
    expect(store.writeQueueStats().pending).toBe(0);
  });

  it("queues failed writes in outbox and retries them on the next after-response", async () => {
    store.failNextAppend = true;
    const queued = await postJson(baseUrl, "/v1/lite/after-response", afterResponsePayload({
      trace_id: "trace-outbox-queued",
      candidates: [
        {
          candidate_type: "fact",
          scope: "workspace",
          summary: "项目事实：使用 PostgreSQL 16",
          importance: 5,
        },
      ],
    }));

    expect(queued.status).toBe(200);
    expect(queued.body).toMatchObject({
      writeback_status: "retry_queued",
      accepted_count: 0,
      outbox_queued_count: 1,
      filtered_reasons: ["write_retry_queued"],
    });
    expect(await outbox.pending()).toHaveLength(1);

    const retried = await postJson(baseUrl, "/v1/lite/after-response", afterResponsePayload({
      trace_id: "trace-outbox-retried",
      current_input: "普通问题",
      assistant_output: "好的",
    }));

    expect(retried.status).toBe(200);
    expect(retried.body).toMatchObject({
      outbox_retry: {
        attempted: 1,
        submitted: 1,
        failed: 0,
      },
    });
    await store.load();
    expect(store.listRecords().map((record) => record.summary)).toEqual([
      "项目事实：使用 PostgreSQL 16",
    ]);
    expect(await outbox.pending()).toHaveLength(0);
  });
});
