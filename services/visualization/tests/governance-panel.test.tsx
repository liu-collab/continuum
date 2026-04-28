import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GovernancePanel } from "@/features/memory-catalog/governance-panel";
import type { MemoryCatalogDetail } from "@/lib/contracts";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh
  })
}));

function createMemoryDetail(): MemoryCatalogDetail {
  return {
    id: "memory-1",
    workspaceId: "workspace-1",
    taskId: null,
    sessionId: null,
    memoryType: "fact_preference",
    memoryTypeLabel: "事实偏好",
    scope: "workspace",
    scopeLabel: "工作区",
    scopeExplanation: "工作区记忆",
    status: "active",
    statusLabel: "活跃",
    statusExplanation: "当前可召回",
    summary: "User prefers concise answers",
    importance: 3,
    confidence: 0.9,
    originWorkspaceId: "workspace-1",
    originWorkspaceLabel: "Workspace workspace-1",
    visibilitySummary: "当前工作区可见",
    sourceType: "turn",
    sourceRef: "turn-1",
    sourceServiceName: "retrieval-runtime",
    sourceSummary: "turn / turn-1",
    lastConfirmedAt: null,
    updatedAt: "2026-04-22T00:00:00Z",
    details: {},
    detailsFormatted: "{}",
    sourceFormatted: "turn / turn-1 / retrieval-runtime",
    sourceExcerpt: null,
    extractionBasis: null,
    sourceTurnId: "turn-1",
    createdAt: "2026-04-22T00:00:00Z",
    governanceHistory: [],
    governanceSummary: "当前还没有自动治理命中这条记忆。"
  };
}

describe("GovernancePanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    refresh.mockReset();
  });

  it("requires confirmation before submitting destructive memory actions", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ message: "deleted" })
    } as Response);

    render(<GovernancePanel detail={createMemoryDetail()} />);

    await user.type(screen.getByPlaceholderText("说明为什么需要执行这次治理动作。"), "过期记忆");
    await user.click(screen.getByTestId("memory-governance-delete-trigger"));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("确认删除");

    await user.click(screen.getByTestId("memory-governance-delete-confirm"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/memories/memory-1/delete",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ reason: "过期记忆" })
        })
      );
    });
  });

  it("submits non-destructive confirm action directly", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ message: "confirmed" })
    } as Response);

    render(<GovernancePanel detail={createMemoryDetail()} />);

    await user.type(screen.getByPlaceholderText("说明为什么需要执行这次治理动作。"), "人工复核通过");
    await user.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/memories/memory-1/confirm",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ reason: "人工复核通过" })
        })
      );
    });
  });
});
