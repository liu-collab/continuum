import { describe, expect, it, vi } from "vitest";

const { queryCatalogViewMock } = vi.hoisted(() => ({
  queryCatalogViewMock: vi.fn<() => Promise<any>>()
}));

queryCatalogViewMock.mockImplementation(async () => ({
  rows: [],
  total: 0,
  warnings: [],
  status: {
    name: "storage_read_model",
    label: "Storage read model",
    kind: "dependency",
    status: "unavailable",
    checkedAt: new Date().toISOString(),
    lastCheckedAt: new Date().toISOString(),
    lastOkAt: null,
    lastError: "connection failed",
    responseTimeMs: 200,
    detail: "connection failed"
  }
}));

vi.mock("@/lib/server/storage-read-model-client", () => ({
  queryCatalogView: queryCatalogViewMock,
  fetchMemoryById: vi.fn(async (id: string) => ({
    id,
    workspace_id: "ws-1",
    task_id: "task-1",
    session_id: "session-1",
    memory_type: "fact_preference",
    scope: "user",
    status: "active",
    summary: "User prefers concise answers",
    details: {
      subject: "user",
      predicate: "prefers concise answers"
    },
    importance: 4,
    confidence: 0.9,
    source: {
      source_type: "user_input",
      source_ref: "turn-1",
      service_name: "retrieval-runtime",
      origin_workspace_id: "ws-origin"
    },
    last_confirmed_at: "2026-04-16T00:00:00Z",
    created_at: "2026-04-15T00:00:00Z",
    updated_at: "2026-04-16T00:00:00Z"
  })),
  mapSource: vi.fn((source: Record<string, unknown> | null) => ({
    sourceType: typeof source?.source_type === "string" ? source.source_type : null,
    sourceRef: typeof source?.source_ref === "string" ? source.source_ref : null,
    sourceServiceName: typeof source?.service_name === "string" ? source.service_name : null,
    originWorkspaceId:
      typeof source?.origin_workspace_id === "string" ? source.origin_workspace_id : null
  }))
}));

import {
  buildMemoryCatalogQuickViews,
  describeCatalogFilterHints,
  describeCatalogEmptyState,
  getMemoryCatalog,
  getMemoryDetail
} from "@/features/memory-catalog/service";
import { MemoryCatalogResponse } from "@/lib/contracts";

describe("memory catalog service", () => {
  it("explains degraded source state", () => {
    const response = {
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      appliedFilters: {
        workspaceId: undefined,
        taskId: undefined,
        sessionId: undefined,
        memoryViewMode: "workspace_plus_global",
        memoryType: undefined,
        scope: undefined,
        status: undefined,
        updatedFrom: undefined,
        updatedTo: undefined,
        page: 1,
        pageSize: 20
      },
      viewSummary: "summary",
      viewWarnings: [],
      sourceStatus: {
        name: "storage_read_model",
        label: "Storage read model",
        kind: "dependency",
        status: "unavailable",
        checkedAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
        lastOkAt: null,
        lastError: "connection failed",
        responseTimeMs: 200,
        detail: "connection failed",
        activeConnections: null,
        connectionLimit: null
      }
    } satisfies MemoryCatalogResponse;

    const state = describeCatalogEmptyState(response);

    expect(state.title).toContain("记忆数据源暂不可用");
    expect(state.description).toContain("connection failed");
  });

  it("formats memory detail from the published read model", async () => {
    const detail = await getMemoryDetail("memory-1");

    expect(detail).not.toBeNull();
    expect(detail?.scopeLabel).toBe("平台");
    expect(detail?.scopeExplanation).toContain("平台级记忆");
    expect(detail?.originWorkspaceId).toBe("ws-origin");
    expect(detail?.detailsFormatted).toContain('"subject": "user"');
    expect(detail?.sourceFormatted).toBe("user_input / turn-1 / retrieval-runtime");
  });

  it("returns workspace-only catalog view summary", async () => {
    queryCatalogViewMock.mockResolvedValueOnce({
      rows: [],
      total: 0,
      warnings: [],
      status: {
        name: "storage_read_model",
        label: "Storage read model",
        kind: "dependency",
        status: "healthy",
        checkedAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
        lastOkAt: new Date().toISOString(),
        lastError: null,
        responseTimeMs: 20,
        detail: null
      }
    });

    const response = await getMemoryCatalog({
      workspaceId: "ws-1",
      taskId: undefined,
      sessionId: undefined,
      memoryViewMode: "workspace_only",
      memoryType: undefined,
      scope: undefined,
      status: undefined,
      updatedFrom: undefined,
      updatedTo: undefined,
      page: 1,
      pageSize: 20
    });

    expect(response.viewSummary).toContain("当前工作区");
    expect(response.appliedFilters.memoryViewMode).toBe("workspace_only");
  });

  it("workspace_only does not keep global scope when scope=user is requested", async () => {
    queryCatalogViewMock.mockResolvedValueOnce({
      rows: [],
      total: 0,
      warnings: [],
      status: {
        name: "storage_read_model",
        label: "Storage read model",
        kind: "dependency",
        status: "healthy",
        checkedAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
        lastOkAt: new Date().toISOString(),
        lastError: null,
        responseTimeMs: 20,
        detail: null
      }
    });

    const response = await getMemoryCatalog({
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

    expect(response.items).toEqual([]);
    expect(response.total).toBe(0);
  });

  it("includes session in the view summary when session_id is provided", async () => {
    queryCatalogViewMock.mockResolvedValueOnce({
      rows: [],
      total: 0,
      warnings: [],
      status: {
        name: "storage_read_model",
        label: "Storage read model",
        kind: "dependency",
        status: "healthy",
        checkedAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
        lastOkAt: new Date().toISOString(),
        lastError: null,
        responseTimeMs: 20,
        detail: null
      }
    });

    const response = await getMemoryCatalog({
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

    expect(response.viewSummary).toContain("session-1");
  });

  it("exposes a visible quick view for global user memory", () => {
    const views = buildMemoryCatalogQuickViews({
      workspaceId: "ws-1",
      taskId: undefined,
      sessionId: "session-1",
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

    expect(views.some((view) => view.label === "全局记忆" && view.href.includes("scope=user"))).toBe(true);
    expect(views.some((view) => view.label === "去掉会话限制")).toBe(true);
  });

  it("explains why session_id can hide global memory", () => {
    const hints = describeCatalogFilterHints({
      workspaceId: "ws-1",
      taskId: undefined,
      sessionId: "session-1",
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

    expect(hints.join(" ")).toContain("session_id");
    expect(hints.join(" ")).toContain("全局记忆");
  });

  it("treats bare /memories as the implicit global view", () => {
    const views = buildMemoryCatalogQuickViews({
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

    const globalView = views.find((view) => view.label === "全局记忆");
    expect(globalView?.active).toBe(true);
    expect(globalView?.href).toContain("scope=user");
  });

  it("tells users that bare /memories already shows global memory", () => {
    const hints = describeCatalogFilterHints({
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

    expect(hints.join(" ")).toContain("平台级记忆");
    expect(hints.join(" ")).toContain("workspace_id");
  });
});
