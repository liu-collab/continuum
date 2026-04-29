import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { getMemoryDetailMock } = vi.hoisted(() => ({
  getMemoryDetailMock: vi.fn<() => Promise<any>>()
}));

vi.mock("@/features/memory-catalog/service", () => ({
  getMemoryDetail: getMemoryDetailMock
}));

vi.mock("@/features/memory-catalog/governance-panel", () => ({
  GovernancePanel: () => <div data-testid="governance-panel" />
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  )
}));

import MemoryDetailPage from "@/app/memories/[id]/page";

function createMemoryDetail() {
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
    sourceRef: "turn-source-1",
    sourceServiceName: "retrieval-runtime",
    sourceSummary: "turn / turn-source-1",
    lastConfirmedAt: null,
    updatedAt: "2026-04-22T00:00:00Z",
    details: {},
    detailsFormatted: "{}",
    sourceFormatted: "turn / turn-source-1 / retrieval-runtime",
    sourceExcerpt: null,
    extractionBasis: null,
    sourceTurnId: "turn-source-1",
    createdAt: "2026-04-22T00:00:00Z",
    governanceHistory: [
      {
        executionId: "execution-1",
        proposalId: "proposal-1",
        proposalType: "archive",
        proposalTypeLabel: "归档",
        executionStatus: "executed",
        executionStatusLabel: "已执行",
        reasonCode: "obsolete",
        reasonText: "清理旧记忆",
        resultSummary: null,
        errorMessage: null,
        deleteReason: null,
        startedAt: "2026-04-22T00:00:00Z",
        finishedAt: null,
        plannerModel: "memory_llm",
        plannerConfidence: 0.9,
        verifierRequired: false,
        verifierDecision: null,
        verifierConfidence: null,
        verifierNotes: null,
        verificationBlocked: false,
        verificationBlockedReason: null,
        targetSummary: "memory-1"
      }
    ],
    governanceSummary: "最近 1 次自动治理命中过这条记忆。"
  };
}

describe("memory detail page", () => {
  it("links memory source and governance history to related pages", async () => {
    getMemoryDetailMock.mockResolvedValue(createMemoryDetail());

    const element = await MemoryDetailPage({
      params: Promise.resolve({ id: "memory-1" })
    });
    render(element);

    expect(screen.getAllByTitle("turn-source-1")[0]).toHaveAttribute("href", "/runs?turn_id=turn-source-1");
    expect(screen.getByText("清理旧记忆").closest("a")).toHaveAttribute(
      "href",
      "/governance?workspace_id=workspace-1&execution_id=execution-1"
    );
  });

  it("keeps technical memory fields collapsed by default", async () => {
    getMemoryDetailMock.mockResolvedValue(createMemoryDetail());

    const element = await MemoryDetailPage({
      params: Promise.resolve({ id: "memory-1" })
    });
    render(element);

    expect(screen.getByText("技术细节")).toBeInTheDocument();
    expect(screen.getByText("重要度").closest("details")).toBeInTheDocument();
    expect(screen.getByText("置信度").closest("details")).toBeInTheDocument();
    expect(screen.getByText("原始详情").closest("details")).toBeInTheDocument();
  });
});
