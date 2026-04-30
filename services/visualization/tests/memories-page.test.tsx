import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getMemoryCatalogMock } = vi.hoisted(() => ({
  getMemoryCatalogMock: vi.fn<() => Promise<any>>()
}));

vi.mock("@/features/memory-catalog/service", () => ({
  getMemoryCatalog: getMemoryCatalogMock
}));

vi.mock("@/components/health-modal", () => ({
  HealthModalButton: ({ label }: { label?: string }) => <button type="button">{label ?? "健康"}</button>
}));

import MemoriesPage from "@/app/memories/page";
import { AppI18nProvider } from "@/lib/i18n/client";

const sourceStatus = {
  name: "storage_read_model",
  label: "Storage read model",
  kind: "dependency" as const,
  status: "healthy" as const,
  checkedAt: "2026-04-16T00:00:00Z",
  lastCheckedAt: "2026-04-16T00:00:00Z",
  lastOkAt: "2026-04-16T00:00:00Z",
  lastError: null,
  responseTimeMs: 20,
  detail: null,
  activeConnections: null,
  connectionLimit: null
};

function createMemoryResponse(overrides: Record<string, unknown> = {}) {
  return {
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    appliedFilters: {
      workspaceId: "workspace-1",
      taskId: undefined,
      sessionId: undefined,
      sourceRef: undefined,
      memoryViewMode: "workspace_plus_global",
      memoryType: undefined,
      scope: undefined,
      status: "active",
      updatedFrom: undefined,
      updatedTo: undefined,
      page: 1,
      pageSize: 20
    },
    viewSummary: "当前结果摘要",
    viewWarnings: [],
    pendingConfirmationCount: 3,
    sourceStatus,
    ...overrides
  };
}

function renderZh(element: React.ReactNode) {
  return render(<AppI18nProvider defaultLocale="zh-CN">{element}</AppI18nProvider>);
}

describe("memories page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("switches quick filters in place", async () => {
    const user = userEvent.setup();
    getMemoryCatalogMock.mockResolvedValue(createMemoryResponse());
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => createMemoryResponse({
        total: 3,
        appliedFilters: {
          workspaceId: "workspace-1",
          taskId: undefined,
          sessionId: undefined,
          sourceRef: undefined,
          memoryViewMode: "workspace_plus_global",
          memoryType: undefined,
          scope: undefined,
          status: "pending_confirmation",
          updatedFrom: undefined,
          updatedTo: undefined,
          page: 1,
          pageSize: 20
        },
        viewSummary: "待确认结果摘要",
        pendingConfirmationCount: 3
      })
    } as Response);

    const element = await MemoriesPage({
      searchParams: Promise.resolve({ workspace_id: "workspace-1", status: "active" })
    });
    renderZh(element);

    await user.click(screen.getByTestId("memory-filter-chip-pending"));

    await waitFor(() => {
      expect(screen.getByText("待确认结果摘要")).toBeInTheDocument();
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/memories?workspace_id=workspace-1&memory_view_mode=workspace_plus_global&status=pending_confirmation&page=1&page_size=20",
      {
        headers: {
          accept: "application/json",
        },
      }
    );
    expect(window.location.pathname).toBe("/memories");
    expect(window.location.search).toBe("?workspace_id=workspace-1&memory_view_mode=workspace_plus_global&status=pending_confirmation&page=1&page_size=20");
  });
});
