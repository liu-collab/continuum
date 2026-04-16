import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/storage-read-model-client", () => ({
  queryMemoryReadModel: vi.fn(async () => ({
    rows: [],
    total: 0,
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
  })),
  fetchMemoryById: vi.fn(async (id: string) => ({
    id,
    workspace_id: "ws-1",
    user_id: "user-1",
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
      service_name: "retrieval-runtime"
    },
    last_confirmed_at: "2026-04-16T00:00:00Z",
    created_at: null,
    updated_at: "2026-04-16T00:00:00Z"
  })),
  mapSource: vi.fn((source: Record<string, unknown> | null) => ({
    sourceType: typeof source?.source_type === "string" ? source.source_type : null,
    sourceRef: typeof source?.source_ref === "string" ? source.source_ref : null,
    sourceServiceName: typeof source?.service_name === "string" ? source.service_name : null
  }))
}));

import {
  describeCatalogEmptyState,
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
        userId: undefined,
        taskId: undefined,
        memoryType: undefined,
        scope: undefined,
        status: undefined,
        updatedFrom: undefined,
        updatedTo: undefined,
        page: 1,
        pageSize: 20
      },
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
        detail: "connection failed"
      }
    } satisfies MemoryCatalogResponse;

    const state = describeCatalogEmptyState(response);

    expect(state.title).toContain("Memory source unavailable");
    expect(state.description).toContain("connection failed");
  });

  it("formats memory detail from the published read model", async () => {
    const detail = await getMemoryDetail("memory-1");

    expect(detail).not.toBeNull();
    expect(detail?.statusExplanation).toContain("eligible for automatic recall");
    expect(detail?.detailsFormatted).toContain('"subject": "user"');
    expect(detail?.sourceFormatted).toBe("user_input / turn-1 / retrieval-runtime");
    expect(detail?.sourceServiceName).toBe("retrieval-runtime");
  });
});
