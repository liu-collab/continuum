import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("pg", () => {
  class MockPool {
    query = queryMock;
  }

  return { Pool: MockPool };
});

vi.mock("@/lib/env", () => ({
  getAppConfig: () => ({
    values: {
      STORAGE_READ_MODEL_DSN: "postgres://test",
      STORAGE_READ_MODEL_SCHEMA: "storage_shared_v1",
      STORAGE_READ_MODEL_TABLE: "memory_read_model_v1",
      STORAGE_READ_MODEL_TIMEOUT_MS: 1000,
      DATABASE_POOL_MAX: 5,
      PLATFORM_USER_ID: "00000000-0000-4000-8000-000000000001"
    },
    issues: []
  })
}));

import {
  fetchMemoryById,
  getReadModelPoolStats,
  queryCatalogView,
  StorageReadModelUnavailableError
} from "@/lib/server/storage-read-model-client";

describe("storage read model catalog view", () => {
  beforeEach(() => {
    queryMock.mockReset();
    globalThis.__AXIS_VIZ_PG_POOL__ = undefined;
  });

  afterEach(() => {
    globalThis.__AXIS_VIZ_PG_POOL__ = undefined;
  });

  it("exposes connection pool stats", () => {
    const stats = getReadModelPoolStats();
    expect(stats.connectionLimit).toBe(5);
  });

  it("workspace_only with scope=user returns no global rows", async () => {
    const result = await queryCatalogView({
      workspaceId: "ws-1",
      taskId: undefined,
      sessionId: undefined,
      memoryViewMode: "workspace_only",
      memoryType: undefined,
      scope: "user",
      status: undefined,
      updatedFrom: undefined,
      updatedTo: undefined,
      page: 1,
      pageSize: 20
    });

    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
    expect(queryMock).toHaveBeenCalledTimes(0);
  });

  it("workspace_plus_global with scope=user deduplicates repeated global rows", async () => {
    const duplicatedRow = {
      id: "memory-1",
      workspace_id: "ws-1",
      user_id: "user-1",
      task_id: null,
      session_id: null,
      memory_type: "preference",
      scope: "user",
      status: "active",
      summary: "global memory",
      details: null,
      importance: 4,
      confidence: 0.9,
      source: null,
      last_confirmed_at: null,
      created_at: "2026-04-16T00:00:00Z",
      updated_at: "2026-04-16T00:00:00Z"
    };

    queryMock
      .mockResolvedValueOnce({ rows: [duplicatedRow] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });

    const result = await queryCatalogView({
      workspaceId: "ws-1",
      taskId: undefined,
      sessionId: undefined,
      memoryViewMode: "workspace_plus_global",
      memoryType: undefined,
      scope: "user",
      status: undefined,
      updatedFrom: undefined,
      updatedTo: undefined,
      page: 1,
      pageSize: 20
    });

    expect(result.rows).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it("does not warn about missing workspace_id for the global memory view", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });

    const result = await queryCatalogView({
      workspaceId: undefined,
      taskId: undefined,
      sessionId: undefined,
      memoryViewMode: "workspace_plus_global",
      memoryType: undefined,
      scope: "user",
      status: undefined,
      updatedFrom: undefined,
      updatedTo: undefined,
      page: 1,
      pageSize: 20
    });

    expect(result.warnings).toEqual([]);
    expect(result.status.status).toBe("healthy");
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it("does not warn about missing workspace_id for bare /memories", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });

    const result = await queryCatalogView({
      workspaceId: undefined,
      taskId: undefined,
      sessionId: undefined,
      sourceRef: undefined,
      memoryViewMode: "workspace_plus_global",
      memoryType: undefined,
      scope: undefined,
      status: undefined,
      updatedFrom: undefined,
      updatedTo: undefined,
      page: 1,
      pageSize: 20
    });

    expect(result.warnings).toEqual([]);
    expect(result.status.status).toBe("healthy");
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it("workspace_plus_global with scope=workspace does not query the global branch", async () => {
    const workspaceRow = {
      id: "memory-2",
      workspace_id: "ws-1",
      user_id: "user-1",
      task_id: null,
      session_id: null,
      memory_type: "task_state",
      scope: "workspace",
      status: "active",
      summary: "workspace memory",
      details: null,
      importance: 3,
      confidence: 0.8,
      source: null,
      last_confirmed_at: null,
      created_at: "2026-04-16T00:00:00Z",
      updated_at: "2026-04-16T00:00:00Z"
    };

    queryMock
      .mockResolvedValueOnce({ rows: [workspaceRow] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });

    const result = await queryCatalogView({
      workspaceId: "ws-1",
      taskId: undefined,
      sessionId: undefined,
      memoryViewMode: "workspace_plus_global",
      memoryType: undefined,
      scope: "workspace",
      status: undefined,
      updatedFrom: undefined,
      updatedTo: undefined,
      page: 1,
      pageSize: 20
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.scope).toBe("workspace");
    expect(result.total).toBe(1);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it("passes session_id through to the workspace query", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });

    await queryCatalogView({
      workspaceId: "ws-1",
      taskId: undefined,
      sessionId: "session-1",
      memoryViewMode: "workspace_plus_global",
      memoryType: undefined,
      scope: undefined,
      status: undefined,
      updatedFrom: undefined,
      updatedTo: undefined,
      page: 1,
      pageSize: 20
    });

    const firstCallParams = queryMock.mock.calls[0]?.[1] as unknown[];
    expect(firstCallParams).toContain("session-1");
  });

  it("passes source_ref through to workspace and global queries", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });

    await queryCatalogView({
      workspaceId: "ws-1",
      taskId: undefined,
      sessionId: undefined,
      sourceRef: "turn-123",
      memoryViewMode: "workspace_plus_global",
      memoryType: undefined,
      scope: undefined,
      status: undefined,
      updatedFrom: undefined,
      updatedTo: undefined,
      page: 1,
      pageSize: 20
    });

    const firstCallParams = queryMock.mock.calls[0]?.[1] as unknown[];
    const thirdCallParams = queryMock.mock.calls[2]?.[1] as unknown[];
    expect(firstCallParams).toContain("turn-123");
    expect(thirdCallParams).toContain("turn-123");
  });

  it("returns null when a memory record is not found", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await expect(fetchMemoryById("missing-memory")).resolves.toBeNull();
  });

  it("throws an explicit read model error when memory detail lookup fails", async () => {
    const cause = new Error("database unavailable");
    queryMock.mockRejectedValue(cause);

    await expect(fetchMemoryById("memory-1")).rejects.toMatchObject({
      name: "StorageReadModelUnavailableError",
      recordId: "memory-1",
      cause
    });
    await expect(fetchMemoryById("memory-1")).rejects.toBeInstanceOf(StorageReadModelUnavailableError);
  });
});
