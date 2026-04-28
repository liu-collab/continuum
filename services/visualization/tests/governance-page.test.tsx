import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const {
  getGovernanceExecutionDetailMock,
  getGovernanceHistoryMock,
  fetchRuntimeGovernanceConfigMock
} = vi.hoisted(() => ({
  getGovernanceExecutionDetailMock: vi.fn<() => Promise<any>>(),
  getGovernanceHistoryMock: vi.fn<() => Promise<any>>(),
  fetchRuntimeGovernanceConfigMock: vi.fn<() => Promise<any>>()
}));

vi.mock("@/features/memory-catalog/service", () => ({
  getGovernanceExecutionDetail: getGovernanceExecutionDetailMock,
  getGovernanceHistory: getGovernanceHistoryMock
}));

vi.mock("@/lib/server/runtime-observe-client", () => ({
  fetchRuntimeGovernanceConfig: fetchRuntimeGovernanceConfigMock
}));

vi.mock("@/components/health-modal", () => ({
  HealthModalButton: ({ label }: { label?: string }) => <button type="button">{label ?? "健康"}</button>
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    scroll,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    scroll?: boolean;
  }) => (
    <a href={href} data-scroll={String(scroll)} {...props}>
      {children}
    </a>
  )
}));

import GovernancePage from "@/app/governance/page";

const sourceStatus = {
  name: "storage_governance_executions",
  label: "Storage governance executions",
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

describe("governance page", () => {
  it("uses client navigation links for execution cards", async () => {
    getGovernanceHistoryMock.mockResolvedValue({
      items: [
        {
          executionId: "execution-1",
          proposalType: "archive",
          proposalTypeLabel: "归档",
          reasonText: "清理旧记忆",
          executionStatus: "executed",
          executionStatusLabel: "已执行",
          verificationBlocked: false,
          verificationBlockedReason: null,
          startedAt: "2026-04-22T00:00:00Z"
        }
      ],
      total: 1,
      sourceStatus
    });
    getGovernanceExecutionDetailMock.mockResolvedValue({
      detail: null,
      status: sourceStatus
    });
    fetchRuntimeGovernanceConfigMock.mockResolvedValue({
      governance: null,
      status: sourceStatus
    });

    const element = await GovernancePage({
      searchParams: Promise.resolve({
        workspace_id: "workspace-1",
        proposal_type: "archive",
        execution_status: "executed",
        limit: "25"
      })
    });
    render(element);

    const link = screen.getByText("清理旧记忆").closest("a");

    expect(link).toHaveAttribute(
      "href",
      "/governance?workspace_id=workspace-1&proposal_type=archive&execution_status=executed&limit=25&execution_id=execution-1"
    );
    expect(link).toHaveAttribute("data-scroll", "false");
  });
});
