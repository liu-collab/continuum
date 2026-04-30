import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileMemoryStore, type LiteMemoryRecord } from "../src/lite/file-store.js";
import { LiteWritebackEngine, type LiteAfterResponseInput } from "../src/lite/writeback-engine.js";
import { LiteWritebackOutbox } from "../src/lite/writeback-outbox.js";
import type { LiteMemoryModelStatus } from "../src/lite/memory-model-config.js";
import type { WritebackPlanner } from "../src/memory-orchestrator/types.js";

const ids = {
  workspace: "550e8400-e29b-41d4-a716-446655440000",
  user: "550e8400-e29b-41d4-a716-446655440001",
  session: "550e8400-e29b-41d4-a716-446655440002",
  task: "550e8400-e29b-41d4-a716-446655440003",
};

const configuredMemoryModel: LiteMemoryModelStatus = {
  configured: true,
  status: "configured",
  baseUrl: "http://127.0.0.1:4000/v1",
  model: "memory-model",
  protocol: "openai-compatible",
  timeoutMs: 1_000,
  apiKeyConfigured: false,
  degraded: false,
};

function baseInput(overrides: Partial<LiteAfterResponseInput> = {}): LiteAfterResponseInput {
  return {
    trace_id: "trace-writeback",
    host: "codex_app_server",
    workspace_id: ids.workspace,
    user_id: ids.user,
    session_id: ids.session,
    current_input: "以后默认中文回复",
    assistant_output: "好的，已记住。",
    ...overrides,
  };
}

function record(overrides: Partial<LiteMemoryRecord> = {}): LiteMemoryRecord {
  return {
    id: "rec-existing",
    workspace_id: ids.workspace,
    user_id: ids.user,
    task_id: null,
    session_id: null,
    memory_type: "preference",
    scope: "user",
    status: "active",
    summary: "用户偏好：默认中文回复",
    details: {},
    importance: 5,
    confidence: 0.9,
    dedupe_key: "preference:user:default_chinese",
    created_at: "2026-04-30T10:00:00.000Z",
    updated_at: "2026-04-30T10:00:00.000Z",
    ...overrides,
  };
}

class StubWritebackPlanner implements Pick<WritebackPlanner, "extract"> {
  public lastInput: Parameters<WritebackPlanner["extract"]>[0] | undefined;

  async extract(input: Parameters<WritebackPlanner["extract"]>[0]) {
    this.lastInput = input;
    return {
      candidates: [
        {
          candidate_type: "task_state" as const,
          scope: "task" as const,
          summary: "任务状态：登录页表单校验已完成",
          importance: 4,
          confidence: 0.86,
          write_reason: "llm extracted task state from multi-turn context",
        },
      ],
    };
  }
}

class FailingStore {
  public records: LiteMemoryRecord[] = [];
  public failNextAppend = false;

  async load() {}

  listRecords() {
    return this.records;
  }

  async appendRecord(recordToAppend: LiteMemoryRecord) {
    if (this.failNextAppend) {
      this.failNextAppend = false;
      throw new Error("disk unavailable");
    }
    this.records.push(recordToAppend);
  }
}

describe("LiteWritebackEngine", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "axis-lite-writeback-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("extracts rule candidates and stores recent turns in record details", async () => {
    const store = new FileMemoryStore({ memoryDir: tempDir });
    const engine = new LiteWritebackEngine({
      store,
      now: () => "2026-04-30T12:00:00.000Z",
      traceIdFactory: () => "trace-generated",
    });

    const result = await engine.process(baseInput({
      trace_id: undefined,
      recent_turns: [
        { role: "user", content: "上轮说默认英文" },
        { role: "assistant", content: "后续会改成中文" },
      ],
    }));

    expect(result).toMatchObject({
      trace_id: "trace-generated",
      writeback_status: "accepted",
      accepted_count: 1,
      extractor: {
        source: "rules",
        rules_count: 1,
        recent_turns_count: 2,
      },
    });
    const stored = store.listRecords()[0];
    expect(stored).toMatchObject({
      memory_type: "preference",
      scope: "user",
      summary: "默认中文回复",
      details: {
        extraction_method: "rules",
        recent_turns: [
          expect.objectContaining({ role: "user", summary: "上轮说默认英文" }),
          expect.objectContaining({ role: "assistant", summary: "后续会改成中文" }),
        ],
      },
    });
  });

  it("passes multi-turn summaries and rule hints to the memory model planner", async () => {
    const store = new FileMemoryStore({ memoryDir: tempDir });
    const planner = new StubWritebackPlanner();
    const engine = new LiteWritebackEngine({
      store,
      memoryModelStatus: configuredMemoryModel,
      writebackPlanner: planner,
      now: () => "2026-04-30T12:00:00.000Z",
    });

    const result = await engine.process(baseInput({
      task_id: ids.task,
      assistant_output: "接下来还剩登录页表单校验。",
      recent_turns: [
        { role: "user", summary: "用户要求继续登录页", turn_id: "turn-1" },
        { role: "assistant", content: "已完成邮箱字段", turn_id: "turn-2" },
      ],
    }));

    expect(planner.lastInput).toMatchObject({
      recent_turns: [
        { role: "user", summary: "用户要求继续登录页", turn_id: "turn-1" },
        { role: "assistant", summary: "已完成邮箱字段", turn_id: "turn-2" },
      ],
      rule_hints: [
        expect.objectContaining({
          candidate_type: "preference",
          summary: "默认中文回复",
        }),
        expect.objectContaining({
          candidate_type: "task_state",
          summary: "还剩登录页表单校验",
        }),
      ],
    });
    expect(result).toMatchObject({
      writeback_status: "accepted",
      accepted_count: 3,
      extractor: {
        source: "rules_and_llm",
        llm_attempted: true,
      },
    });
    expect(store.listRecords().map((item) => item.memory_type).sort()).toEqual([
      "preference",
      "task_state",
      "task_state",
    ]);
  });

  it("hard-filters invalid, sensitive, duplicate, and trivial candidates", async () => {
    const store = new FileMemoryStore({ memoryDir: tempDir });
    await store.appendRecord(record());
    const engine = new LiteWritebackEngine({ store });

    const result = await engine.process(baseInput({
      candidates: [
        { candidate_type: "preference", scope: "user", summary: "ok" },
        {
          candidate_type: "preference",
          scope: "user",
          summary: "用户偏好：默认中文回复",
          idempotency_key: "preference:user:default_chinese",
        },
        {
          candidate_type: "fact",
          scope: "workspace",
          summary: "api_key=sk-test-secret-token",
        },
        {
          candidate_type: "fact",
          scope: "workspace",
          summary: "项目事实：使用 PostgreSQL 16",
          importance: 5,
          confidence: 0.91,
        },
        { candidate_type: "unknown", scope: "user", summary: "无效类型" },
      ],
    }));

    expect(result).toMatchObject({
      writeback_status: "accepted",
      accepted_count: 1,
    });
    expect(result.filtered_reasons).toEqual([
      "invalid_candidate",
      "empty_or_trivial",
      "ignore_duplicate",
      "sensitive_content",
    ]);
    expect(store.listRecords().map((item) => item.summary).sort()).toEqual([
      "用户偏好：默认中文回复",
      "项目事实：使用 PostgreSQL 16",
    ]);
  });

  it("queues failed writes into outbox and retries them on the next turn", async () => {
    const store = new FailingStore();
    const outbox = new LiteWritebackOutbox({ memoryDir: tempDir });
    const engine = new LiteWritebackEngine({
      store,
      outbox,
      now: () => "2026-04-30T12:00:00.000Z",
    });

    store.failNextAppend = true;
    const queued = await engine.process(baseInput({
      candidates: [
        {
          candidate_type: "fact",
          scope: "workspace",
          summary: "项目事实：使用 PostgreSQL 16",
          importance: 5,
        },
      ],
    }));

    expect(queued).toMatchObject({
      writeback_status: "retry_queued",
      accepted_count: 0,
      outbox_queued_count: 1,
      filtered_reasons: ["write_retry_queued"],
    });
    expect(await outbox.pending()).toHaveLength(1);

    const retried = await engine.process(baseInput({
      trace_id: "trace-next",
      current_input: "普通问题",
      assistant_output: "好的",
    }));

    expect(retried.outbox_retry).toEqual({ attempted: 1, submitted: 1, failed: 0 });
    expect(store.records.map((item) => item.summary)).toEqual(["项目事实：使用 PostgreSQL 16"]);
    expect(await outbox.pending()).toHaveLength(0);
  });
});
