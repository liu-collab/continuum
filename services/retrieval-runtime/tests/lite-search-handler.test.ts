import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileMemoryStore, type LiteMemoryRecord } from "../src/lite/file-store.js";
import { LiteMemoryFunctionHandler, type LiteMemoryFunctionContext } from "../src/lite/search-handler.js";

const ids = {
  workspace: "550e8400-e29b-41d4-a716-446655440000",
  otherWorkspace: "550e8400-e29b-41d4-a716-446655440099",
  user: "550e8400-e29b-41d4-a716-446655440001",
  otherUser: "550e8400-e29b-41d4-a716-446655440098",
  session: "550e8400-e29b-41d4-a716-446655440002",
  otherSession: "550e8400-e29b-41d4-a716-446655440097",
  task: "550e8400-e29b-41d4-a716-446655440003",
  otherTask: "550e8400-e29b-41d4-a716-446655440096",
};

const context: LiteMemoryFunctionContext = {
  workspace_id: ids.workspace,
  user_id: ids.user,
  session_id: ids.session,
  task_id: ids.task,
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

describe("LiteMemoryFunctionHandler", () => {
  let tempDir: string;
  let store: FileMemoryStore;
  let handler: LiteMemoryFunctionHandler;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "axis-lite-search-handler-"));
    store = new FileMemoryStore({ memoryDir: tempDir });
    handler = new LiteMemoryFunctionHandler({ store });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("cleans memory_search arguments and applies caller identity boundaries", async () => {
    await store.appendRecord(record({
      id: "rec-user",
      summary: "用户偏好中文回复",
    }));
    await store.appendRecord(record({
      id: "rec-workspace",
      user_id: null,
      scope: "workspace",
      memory_type: "fact",
      summary: "项目事实：中文文档优先",
    }));
    await store.appendRecord(record({
      id: "rec-other-user",
      user_id: ids.otherUser,
      summary: "其他用户偏好中文回复",
    }));

    const result = handler.memorySearch(context, {
      query: "  中文  ",
      memory_types: ["preference", "fact", "unknown"],
      scopes: ["user", "workspace", "bad-scope"],
      importance_min: 9,
      limit: 100,
    });

    expect(result.effective_query.query).toBe("中文");
    expect(result.effective_query.memory_types).toEqual(["preference", "fact"]);
    expect(result.effective_query.scopes).toEqual(["user", "workspace"]);
    expect(result.effective_query.importance_min).toBe(5);
    expect(result.effective_query.limit).toBe(30);
    expect(result.records.map((item) => item.id).sort()).toEqual(["rec-user", "rec-workspace"]);
    expect(result.records[0]).toMatchObject({
      summary: expect.any(String),
      details: expect.any(Object),
      status: "active",
    });
  });

  it("returns only records visible to the current context from memory_get", async () => {
    await store.appendRecord(record({
      id: "rec-visible-user",
      scope: "user",
      user_id: ids.user,
    }));
    await store.appendRecord(record({
      id: "rec-hidden-user",
      scope: "user",
      user_id: ids.otherUser,
    }));
    await store.appendRecord(record({
      id: "rec-hidden-task",
      scope: "task",
      task_id: ids.otherTask,
    }));

    expect(handler.memoryGet(context, { record_id: "rec-visible-user" })?.id).toBe("rec-visible-user");
    expect(handler.memoryGet(context, { record_id: "rec-hidden-user" })).toBeNull();
    expect(handler.memoryGet(context, { record_id: "rec-hidden-task" })).toBeNull();
    expect(handler.memoryGet(context, { record_id: "" })).toBeNull();
  });

  it("dispatches internal function calls without exposing extra tools", async () => {
    await store.appendRecord(record({ id: "rec-search", summary: "用户偏好中文回复" }));

    const searchResult = handler.call(context, "memory_search", { query: "中文", limit: 1 });
    const getResult = handler.call(context, "memory_get", { record_id: "rec-search" });

    expect(searchResult).toMatchObject({ total: 1 });
    expect(getResult).toMatchObject({ id: "rec-search" });
  });
});
