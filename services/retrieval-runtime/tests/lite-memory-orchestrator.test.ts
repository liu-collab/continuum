import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileMemoryStore, type LiteMemoryRecord } from "../src/lite/file-store.js";
import { MemoryOrchestrator } from "../src/lite/memory-orchestrator.js";

const ids = {
  workspace: "550e8400-e29b-41d4-a716-446655440000",
  user: "550e8400-e29b-41d4-a716-446655440001",
  session: "550e8400-e29b-41d4-a716-446655440002",
  task: "550e8400-e29b-41d4-a716-446655440003",
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

describe("MemoryOrchestrator", () => {
  let tempDir: string;
  let store: FileMemoryStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "axis-lite-orchestrator-"));
    store = new FileMemoryStore({ memoryDir: tempDir });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("builds an injection block and trace when a history reference hits", async () => {
    await store.appendRecord(record());
    const orchestrator = new MemoryOrchestrator({
      store,
      traceIdFactory: () => "trace-lite-1",
      now: () => "2026-04-30T12:00:00.000Z",
    });

    const result = await orchestrator.prepareContext({
      host: "codex_app_server",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      phase: "before_response",
      current_input: "上次 中文 回复 的约定是什么",
    });

    expect(result.trace_id).toBe("trace-lite-1");
    expect(result.memory_model_status.degraded).toBe(true);
    expect(result.injection_block?.memory_records.map((item) => item.id)).toEqual(["rec-default"]);
    expect(result.injection_block?.memory_summary).toContain("用户偏好中文回复");
    expect(result.trace.rule_trigger.trigger_type).toBe("history_reference");
    expect(result.trace.function_calls).toHaveLength(1);
    expect(result.trace.function_calls[0]?.name).toBe("memory_search");
    expect(result.trace.selected_record_ids).toEqual(["rec-default"]);
  });

  it("returns an empty injection block when no rule trigger hits", async () => {
    await store.appendRecord(record());
    const orchestrator = new MemoryOrchestrator({ store });

    const result = await orchestrator.prepareContext({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      phase: "before_response",
      current_input: "帮我写一个单元测试",
    });

    expect(result.injection_block).toBeNull();
    expect(result.trace.injected).toBe(false);
    expect(result.trace.function_calls).toEqual([]);
  });

  it("restores workspace memory on session start even when user id is present", async () => {
    await store.appendRecord(record({
      id: "rec-workspace",
      user_id: null,
      memory_type: "fact",
      scope: "workspace",
      summary: "项目事实：所有接口使用 PostgreSQL 16",
    }));
    const orchestrator = new MemoryOrchestrator({ store });

    const result = await orchestrator.prepareContext({
      host: "custom_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      phase: "session_start",
      current_input: "session start",
    });

    expect(result.injection_block?.memory_records.map((item) => item.id)).toEqual(["rec-workspace"]);
    expect(result.trace.rule_trigger.requested_scopes).toEqual(["workspace", "user"]);
  });

  it("uses broad local fallback for terse continuation turns after scoped filtering", async () => {
    await store.appendRecord(record({
      id: "rec-task",
      memory_type: "task_state",
      scope: "task",
      task_id: ids.task,
      summary: "任务状态：lite runtime 正在实现 prepare-context",
    }));
    const orchestrator = new MemoryOrchestrator({ store });

    const result = await orchestrator.prepareContext({
      host: "codex_app_server",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      phase: "before_response",
      current_input: "继续",
    });

    expect(result.injection_block?.memory_records.map((item) => item.id)).toEqual(["rec-task"]);
    expect(result.trace.function_calls).toHaveLength(2);
    expect(result.trace.function_calls[1]?.arguments.query).toBe("");
  });
});
