import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileMemoryStore, type LiteMemoryRecord } from "../src/lite/file-store.js";

const baseRecord: LiteMemoryRecord = {
  id: "rec-a",
  workspace_id: "550e8400-e29b-41d4-a716-446655440000",
  user_id: "550e8400-e29b-41d4-a716-446655440001",
  task_id: null,
  session_id: "550e8400-e29b-41d4-a716-446655440002",
  memory_type: "preference",
  scope: "user",
  status: "active",
  summary: "用户偏好中文回复",
  details: {
    preference_axis: "response_language",
    preference_value: "zh",
  },
  importance: 5,
  confidence: 0.9,
  dedupe_key: "preference:user:response_language:zh",
  created_at: "2026-04-30T10:00:00.000Z",
  updated_at: "2026-04-30T10:00:00.000Z",
};

describe("FileMemoryStore", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "axis-lite-store-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loads JSONL records, keeps the latest version, and applies tombstones", async () => {
    const recordsPath = path.join(tempDir, "records.jsonl");
    const older = {
      ...baseRecord,
      summary: "旧的中文偏好",
      updated_at: "2026-04-30T09:00:00.000Z",
    };
    const newer = {
      ...baseRecord,
      summary: "新的中文偏好",
      updated_at: "2026-04-30T11:00:00.000Z",
    };
    const taskRecord: LiteMemoryRecord = {
      ...baseRecord,
      id: "rec-task",
      memory_type: "task_state",
      scope: "task",
      task_id: "550e8400-e29b-41d4-a716-446655440003",
      summary: "任务状态：接口测试进行中",
      updated_at: "2026-04-30T10:30:00.000Z",
    };
    await writeFile(
      recordsPath,
      [
        JSON.stringify(older),
        "not json",
        JSON.stringify(taskRecord),
        JSON.stringify(newer),
        JSON.stringify({ action: "delete", record_id: "rec-task", deleted_at: "2026-04-30T12:00:00.000Z" }),
        "",
      ].join("\n"),
      "utf8",
    );

    const store = new FileMemoryStore({ memoryDir: tempDir });
    const result = await store.load();

    expect(result).toEqual({ loaded: 3, deleted: 1, skipped: 1 });
    expect(store.size()).toBe(1);
    expect(store.get("rec-a")?.summary).toBe("新的中文偏好");
    expect(store.get("rec-task")).toBeUndefined();
    expect(store.idsForMemoryType("preference")).toEqual(["rec-a"]);
    expect(store.idsForScope("user")).toEqual(["rec-a"]);
    expect(store.idsForWorkspace(baseRecord.workspace_id)).toEqual(["rec-a"]);
  });

  it("appends records and deletes them with tombstone entries", async () => {
    const store = new FileMemoryStore({ memoryDir: tempDir });

    await store.appendRecord(baseRecord);
    await store.deleteRecord(baseRecord.id, "2026-04-30T12:00:00.000Z");

    expect(store.size()).toBe(0);
    expect(store.get(baseRecord.id)).toBeUndefined();

    const content = await readFile(path.join(tempDir, "records.jsonl"), "utf8");
    expect(content).toContain("\"id\":\"rec-a\"");
    expect(content).toContain("\"action\":\"delete\"");
  });

  it("searches by text, filters, and stable ranking", async () => {
    const store = new FileMemoryStore({ memoryDir: tempDir });
    await store.appendRecord({
      ...baseRecord,
      id: "rec-low",
      summary: "用户偏好英文回复",
      details: { preference_value: "en" },
      importance: 2,
      updated_at: "2026-04-30T11:00:00.000Z",
    });
    await store.appendRecord({
      ...baseRecord,
      id: "rec-high",
      summary: "用户偏好中文回复，所有总结保持中文",
      details: { preference_value: "zh", note: "中文总结" },
      importance: 5,
      updated_at: "2026-04-30T10:00:00.000Z",
    });
    await store.appendRecord({
      ...baseRecord,
      id: "rec-task",
      memory_type: "task_state",
      scope: "task",
      task_id: "550e8400-e29b-41d4-a716-446655440003",
      summary: "任务状态：继续接口测试",
      importance: 5,
      updated_at: "2026-04-30T12:00:00.000Z",
    });

    const result = store.search({
      query: "中文 总结",
      workspace_id: baseRecord.workspace_id,
      user_id: baseRecord.user_id ?? undefined,
      memory_types: ["preference"],
      scopes: ["user"],
      importance_min: 3,
      limit: 10,
    });

    expect(result.total).toBe(1);
    expect(result.records[0]?.id).toBe("rec-high");
    expect(result.records[0]?.score).toBe(2);
  });

  it("matches identity by scope instead of requiring every id on every record", async () => {
    const store = new FileMemoryStore({ memoryDir: tempDir });
    await store.appendRecord({
      ...baseRecord,
      id: "rec-workspace",
      user_id: null,
      scope: "workspace",
      memory_type: "fact",
      summary: "项目事实：使用 PostgreSQL 16",
      importance: 5,
    });
    await store.appendRecord({
      ...baseRecord,
      id: "rec-user",
      workspace_id: "550e8400-e29b-41d4-a716-446655440099",
      scope: "user",
      summary: "用户偏好：中文回复",
      importance: 5,
    });

    const result = store.search({
      workspace_id: baseRecord.workspace_id,
      user_id: baseRecord.user_id ?? undefined,
      scopes: ["workspace", "user"],
      limit: 10,
    });

    expect(result.records.map((record) => record.id).sort()).toEqual(["rec-user", "rec-workspace"]);
  });

  it("limits results and excludes inactive records by default", async () => {
    const store = new FileMemoryStore({ memoryDir: tempDir });
    for (let index = 0; index < 35; index += 1) {
      await store.appendRecord({
        ...baseRecord,
        id: `rec-${index}`,
        status: index === 0 ? "archived" : "active",
        summary: `中文偏好 ${index}`,
        updated_at: `2026-04-30T10:${String(index).padStart(2, "0")}:00.000Z`,
      });
    }

    const result = store.search({ query: "中文", limit: 100 });

    expect(result.total).toBe(34);
    expect(result.records).toHaveLength(30);
    expect(result.records[0]?.id).toBe("rec-34");
    expect(result.records.some((record) => record.id === "rec-0")).toBe(false);
  });

  it("loads an empty store when the records file does not exist", async () => {
    const store = new FileMemoryStore({ memoryDir: tempDir });

    await expect(store.load()).resolves.toEqual({ loaded: 0, deleted: 0, skipped: 0 });
    expect(store.listRecords()).toEqual([]);
  });
});
