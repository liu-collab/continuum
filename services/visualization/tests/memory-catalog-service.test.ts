import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  queryCatalogViewMock,
  fetchGovernanceExecutionsMock,
  fetchGovernanceExecutionDetailMock,
  shouldUseLiteRuntimeCatalogMock,
  fetchLiteRuntimeMemoriesMock,
  fetchLiteRuntimeMemoryByIdMock
} = vi.hoisted(() => ({
  queryCatalogViewMock: vi.fn<() => Promise<any>>(),
  fetchGovernanceExecutionsMock: vi.fn<() => Promise<any>>(),
  fetchGovernanceExecutionDetailMock: vi.fn<() => Promise<any>>(),
  shouldUseLiteRuntimeCatalogMock: vi.fn(() => false),
  fetchLiteRuntimeMemoriesMock: vi.fn<() => Promise<any>>(),
  fetchLiteRuntimeMemoryByIdMock: vi.fn<() => Promise<any>>(),
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
    memory_type: "preference",
    scope: "user",
    status: "active",
    summary: "User prefers concise answers",
    details: {
      subject: "user",
      predicate: "prefers concise answers",
      origin_trace: {
        source_turn_id: "turn-1",
        source_excerpt: "Please keep answers concise by default.",
        extraction_basis: "user stated a stable preference explicitly",
      }
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

fetchGovernanceExecutionsMock.mockImplementation(async () => ({
  status: {
    name: "storage_governance_executions",
    label: "Storage governance executions",
    kind: "dependency",
    status: "healthy",
    checkedAt: new Date().toISOString(),
    lastCheckedAt: new Date().toISOString(),
    lastOkAt: new Date().toISOString(),
    lastError: null,
    responseTimeMs: 10,
    detail: null,
  },
  items: [
    {
      executionId: "execution-1",
      proposalId: "proposal-1",
      workspaceId: "ws-1",
      proposalType: "delete",
      proposalTypeLabel: "软删除",
      executionStatus: "executed",
      executionStatusLabel: "执行成功",
      reasonCode: "obsolete_task_state",
      reasonText: "delete obsolete task state",
      deleteReason: "replaced by newer state",
      startedAt: "2026-04-22T00:00:00Z",
      finishedAt: "2026-04-22T00:01:00Z",
      sourceService: "retrieval-runtime",
      plannerModel: "memory_llm",
      plannerConfidence: 0.95,
      verifierRequired: true,
      verifierDecision: "approve",
      verifierConfidence: 0.91,
      targetSummary: "target:memory-1",
      targetRecordIds: ["memory-1"],
      resultSummary: "delete executed",
      errorMessage: null,
    },
  ],
}));

fetchGovernanceExecutionDetailMock.mockImplementation(async () => ({
  status: {
    name: "storage_governance_execution_detail",
    label: "Storage governance execution detail",
    kind: "dependency",
    status: "healthy",
    checkedAt: new Date().toISOString(),
    lastCheckedAt: new Date().toISOString(),
    lastOkAt: new Date().toISOString(),
    lastError: null,
    responseTimeMs: 10,
    detail: null,
  },
  detail: null,
}));

vi.mock("@/lib/server/storage-governance-executions-client", () => ({
  fetchGovernanceExecutions: fetchGovernanceExecutionsMock,
  fetchGovernanceExecutionDetail: fetchGovernanceExecutionDetailMock,
}));

vi.mock("@/lib/server/lite-runtime-client", () => ({
  shouldUseLiteRuntimeCatalog: shouldUseLiteRuntimeCatalogMock,
  fetchLiteRuntimeMemories: fetchLiteRuntimeMemoriesMock,
  fetchLiteRuntimeMemoryById: fetchLiteRuntimeMemoryByIdMock,
}));

import {
  buildMemoryCatalogFilterChips,
  buildMemoryCatalogQuickViews,
  describeCatalogFilterHints,
  describeCatalogEmptyState,
  getGovernanceHistory,
  getMemoryCatalog,
  getMemoryDetail
} from "@/features/memory-catalog/service";
import { MemoryCatalogResponse } from "@/lib/contracts";

describe("memory catalog service", () => {
  beforeEach(() => {
    shouldUseLiteRuntimeCatalogMock.mockReturnValue(false);
    fetchLiteRuntimeMemoriesMock.mockReset();
    fetchLiteRuntimeMemoryByIdMock.mockReset();
  });

  it("uses lite runtime memory list when the full read model is not configured", async () => {
    shouldUseLiteRuntimeCatalogMock.mockReturnValue(true);
    fetchLiteRuntimeMemoriesMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "lite-rec-1",
            workspace_id: "ws-1",
            user_id: "user-1",
            task_id: null,
            session_id: null,
            memory_type: "preference",
            scope: "user",
            status: "active",
            summary: "用户偏好：默认中文回复",
            details: { extraction_method: "rules" },
            source: {
              source_type: "lite_runtime",
              source_ref: "lite-rec-1",
              service_name: "lite-runtime",
            },
            importance: 5,
            confidence: 0.9,
            last_confirmed_at: null,
            created_at: "2026-04-30T10:00:00.000Z",
            updated_at: "2026-04-30T10:00:00.000Z",
          },
        ],
        total: 1,
        status: {
          name: "lite_runtime",
          label: "Lite runtime",
          kind: "dependency",
          status: "healthy",
          checkedAt: "2026-04-30T10:00:00.000Z",
          lastCheckedAt: "2026-04-30T10:00:00.000Z",
          lastOkAt: "2026-04-30T10:00:00.000Z",
          lastError: null,
          responseTimeMs: 10,
          detail: null,
        },
      })
      .mockResolvedValueOnce({
        rows: [],
        total: 0,
        status: {
          name: "lite_runtime",
          label: "Lite runtime",
          kind: "dependency",
          status: "healthy",
          checkedAt: "2026-04-30T10:00:00.000Z",
          lastCheckedAt: "2026-04-30T10:00:00.000Z",
          lastOkAt: "2026-04-30T10:00:00.000Z",
          lastError: null,
          responseTimeMs: 10,
          detail: null,
        },
      });

    const response = await getMemoryCatalog({
      workspaceId: "ws-1",
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

    expect(response.sourceStatus.name).toBe("lite_runtime");
    expect(response.items[0]?.summary).toBe("用户偏好：默认中文回复");
    expect(fetchLiteRuntimeMemoriesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        memoryViewMode: "workspace_plus_global",
      }),
      expect.any(Object),
    );
  });

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
      pendingConfirmationCount: 0,
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
    expect(detail?.sourceFormatted).toBe("user_input / 来源 turn-1 / retrieval-runtime");
    expect(detail?.sourceTurnId).toBe("turn-1");
    expect(detail?.sourceExcerpt).toContain("concise");
    expect(detail?.extractionBasis).toContain("stable preference");
    expect(detail?.governanceHistory).toHaveLength(1);
    expect(detail?.governanceSummary).toContain("自动治理");
  });

  it("exposes pending confirmation quick view and count in catalog response", async () => {
    queryCatalogViewMock
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
        rows: [],
        total: 2,
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
    const views = buildMemoryCatalogQuickViews(response.appliedFilters);

    expect(response.pendingConfirmationCount).toBe(2);
    expect(response.viewSummary).toContain("待确认记忆");
    expect(views.some((view) => view.label === "待确认队列" && view.href.includes("status=pending_confirmation"))).toBe(true);
  });

  it("builds one-click memory filter chips with counts and active state", () => {
    const chips = buildMemoryCatalogFilterChips({
      workspaceId: "ws-1",
      taskId: undefined,
      sessionId: undefined,
      sourceRef: undefined,
      memoryViewMode: "workspace_plus_global",
      memoryType: undefined,
      scope: undefined,
      status: "pending_confirmation",
      updatedFrom: undefined,
      updatedTo: undefined,
      page: 2,
      pageSize: 20
    }, 3);

    expect(chips.map((chip) => chip.label)).toEqual([
      "全部活跃",
      "待确认 (3)",
      "事实",
      "偏好",
      "任务状态",
      "事件记忆"
    ]);
    expect(chips.find((chip) => chip.key === "pending")?.active).toBe(true);
    expect(chips.find((chip) => chip.key === "active")?.href).toContain("status=active");
    expect(chips.find((chip) => chip.key === "fact")?.href).toContain("memory_type=fact");
    expect(chips.find((chip) => chip.key === "preference")?.href).toContain("memory_type=preference");
    expect(chips.find((chip) => chip.key === "preference")?.href).toContain("page=1");
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

    expect(response.viewSummary).toContain("当前会话 session-1");
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

    const globalView = views.find((view) => view.label === "全局记忆");
    expect(globalView?.href).toContain("workspace_id=ws-1");
    expect(globalView?.href).toContain("scope=user");
    expect(views.some((view) => view.label === "去掉会话限制")).toBe(true);
  });

  it("keeps workspace quick views after opening global memory from a workspace page", () => {
    const views = buildMemoryCatalogQuickViews({
      workspaceId: "ws-1",
      taskId: undefined,
      sessionId: undefined,
      sourceRef: undefined,
      memoryViewMode: "workspace_plus_global",
      memoryType: undefined,
      scope: "user",
      status: undefined,
      updatedFrom: undefined,
      updatedTo: undefined,
      page: 1,
      pageSize: 20
    });

    expect(views.map((view) => view.label)).toEqual([
      "全局记忆",
      "待确认队列",
      "当前工作区 + 全局",
      "仅当前工作区"
    ]);
    expect(views.find((view) => view.label === "全局记忆")?.active).toBe(true);
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

    expect(hints.join(" ")).toContain("会话筛选");
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
    expect(hints.join(" ")).toContain("工作区筛选");
  });

  it("returns governance history response from storage governance client", async () => {
    const response = await getGovernanceHistory({
      workspaceId: "ws-1",
      proposalType: undefined,
      executionStatus: undefined,
      limit: 20,
    });

    expect(response.items).toHaveLength(1);
    expect(response.items[0]?.proposalTypeLabel).toBe("软删除");
    expect(response.sourceStatus.status).toBe("healthy");
  });
});
