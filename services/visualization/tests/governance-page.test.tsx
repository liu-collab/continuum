import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const {
  getGovernanceExecutionDetailMock,
  getGovernanceHistoryMock,
  fetchRuntimeGovernanceConfigMock,
  refreshMock
} = vi.hoisted(() => ({
  getGovernanceExecutionDetailMock: vi.fn<() => Promise<any>>(),
  getGovernanceHistoryMock: vi.fn<() => Promise<any>>(),
  fetchRuntimeGovernanceConfigMock: vi.fn<() => Promise<any>>(),
  refreshMock: vi.fn()
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock
  })
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

function createGovernanceDetail(overrides: Record<string, unknown> = {}) {
  return {
    executionId: "execution-1",
    proposalId: "proposal-1",
    workspaceId: "workspace-1",
    proposalType: "archive",
    proposalTypeLabel: "归档",
    executionStatus: "executed",
    executionStatusLabel: "已执行",
    reasonCode: "obsolete",
    reasonText: "清理旧记忆",
    deleteReason: null,
    startedAt: "2026-04-22T00:00:00Z",
    finishedAt: "2026-04-22T00:01:00Z",
    sourceService: "retrieval-runtime",
    plannerModel: "memory_llm",
    plannerConfidence: 0.9,
    verifierRequired: false,
    verifierModel: null,
    verifierDecision: null,
    verifierConfidence: null,
    verifierNotes: null,
    verificationBlocked: false,
    verificationBlockedReason: null,
    targetSummary: "memory-1",
    targetRecordIds: ["memory-1"],
    resultSummary: null,
    errorMessage: null,
    policyVersion: "memory-governance-v1",
    suggestedChanges: {},
    evidence: {},
    targets: [
      {
        recordId: "memory-1",
        conflictId: null,
        role: "target"
      }
    ],
    ...overrides
  };
}

describe("governance page", () => {
  it("opens automatic governance config in-place instead of linking to agent", async () => {
    const user = userEvent.setup();
    getGovernanceHistoryMock.mockResolvedValue({
      items: [],
      total: 0,
      sourceStatus
    });
    getGovernanceExecutionDetailMock.mockResolvedValue({
      detail: null,
      status: sourceStatus
    });
    fetchRuntimeGovernanceConfigMock.mockResolvedValue({
      governance: {
        WRITEBACK_MAINTENANCE_ENABLED: true,
        WRITEBACK_MAINTENANCE_INTERVAL_MS: 900000,
        WRITEBACK_GOVERNANCE_VERIFY_ENABLED: true,
        WRITEBACK_GOVERNANCE_SHADOW_MODE: false,
        WRITEBACK_MAINTENANCE_MAX_ACTIONS: 10
      },
      status: sourceStatus
    });

    const element = await GovernancePage({
      searchParams: Promise.resolve({})
    });
    render(element);

    expect(screen.queryByRole("link", { name: "配置" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "配置" }));

    expect(screen.getByTestId("governance-config-form")).toBeInTheDocument();
    expect(screen.getByLabelText("启用自动治理")).toBeChecked();
  });

  it("saves automatic governance config through the runtime config route", async () => {
    const user = userEvent.setup();
    refreshMock.mockClear();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        governance: {
          WRITEBACK_MAINTENANCE_ENABLED: false,
          WRITEBACK_MAINTENANCE_INTERVAL_MS: 1200000,
          WRITEBACK_GOVERNANCE_VERIFY_ENABLED: true,
          WRITEBACK_GOVERNANCE_SHADOW_MODE: false,
          WRITEBACK_MAINTENANCE_MAX_ACTIONS: 8
        }
      })
    } as Response);
    getGovernanceHistoryMock.mockResolvedValue({
      items: [],
      total: 0,
      sourceStatus
    });
    getGovernanceExecutionDetailMock.mockResolvedValue({
      detail: null,
      status: sourceStatus
    });
    fetchRuntimeGovernanceConfigMock.mockResolvedValue({
      governance: {
        WRITEBACK_MAINTENANCE_ENABLED: false,
        WRITEBACK_MAINTENANCE_INTERVAL_MS: 900000,
        WRITEBACK_GOVERNANCE_VERIFY_ENABLED: true,
        WRITEBACK_GOVERNANCE_SHADOW_MODE: false,
        WRITEBACK_MAINTENANCE_MAX_ACTIONS: 10
      },
      status: sourceStatus
    });

    const element = await GovernancePage({
      searchParams: Promise.resolve({})
    });
    render(element);

    await user.click(screen.getByRole("button", { name: "配置" }));
    await user.clear(screen.getByLabelText("扫描间隔（分钟）"));
    await user.type(screen.getByLabelText("扫描间隔（分钟）"), "20");
    await user.clear(screen.getByLabelText("最大动作数"));
    await user.type(screen.getByLabelText("最大动作数"), "8");
    await user.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
      "/api/runtime/config",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          governance: {
            WRITEBACK_MAINTENANCE_ENABLED: false,
            WRITEBACK_MAINTENANCE_INTERVAL_MS: 1200000,
            WRITEBACK_GOVERNANCE_VERIFY_ENABLED: true,
            WRITEBACK_GOVERNANCE_SHADOW_MODE: false,
            WRITEBACK_MAINTENANCE_MAX_ACTIONS: 8
          }
        })
      })
    ));
    expect(refreshMock).toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

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

  it("links target records to memory detail pages", async () => {
    getGovernanceHistoryMock.mockResolvedValue({
      items: [],
      total: 1,
      sourceStatus
    });
    getGovernanceExecutionDetailMock.mockResolvedValue({
      detail: createGovernanceDetail(),
      status: sourceStatus
    });
    fetchRuntimeGovernanceConfigMock.mockResolvedValue({
      governance: null,
      status: sourceStatus
    });

    const element = await GovernancePage({
      searchParams: Promise.resolve({
        execution_id: "execution-1"
      })
    });
    render(element);

    expect(screen.getByTitle("memory-1")).toHaveAttribute("href", "/memories/memory-1");
  });

  it("formats known governance evidence instead of showing raw JSON", async () => {
    getGovernanceHistoryMock.mockResolvedValue({
      items: [],
      total: 1,
      sourceStatus
    });
    getGovernanceExecutionDetailMock.mockResolvedValue({
      detail: createGovernanceDetail({
        proposalType: "delete",
        proposalTypeLabel: "删除",
        evidence: {
          delete_reason: "replaced by newer state"
        }
      }),
      status: sourceStatus
    });
    fetchRuntimeGovernanceConfigMock.mockResolvedValue({
      governance: null,
      status: sourceStatus
    });

    const element = await GovernancePage({
      searchParams: Promise.resolve({
        execution_id: "execution-1"
      })
    });
    render(element);

    expect(screen.getByTestId("governance-evidence-formatted")).toHaveTextContent("这次治理会删除目标记忆");
    expect(screen.getByTestId("governance-evidence-formatted")).toHaveTextContent("replaced by newer state");
    expect(screen.queryByText(/delete_reason/)).not.toBeInTheDocument();
  });

  it("keeps raw evidence collapsed for unknown proposal types", async () => {
    getGovernanceHistoryMock.mockResolvedValue({
      items: [],
      total: 1,
      sourceStatus
    });
    getGovernanceExecutionDetailMock.mockResolvedValue({
      detail: createGovernanceDetail({
        proposalType: "custom_action",
        proposalTypeLabel: "自定义动作",
        evidence: {
          custom_field: "custom value"
        }
      }),
      status: sourceStatus
    });
    fetchRuntimeGovernanceConfigMock.mockResolvedValue({
      governance: null,
      status: sourceStatus
    });

    const element = await GovernancePage({
      searchParams: Promise.resolve({
        execution_id: "execution-1"
      })
    });
    render(element);

    expect(screen.getByTestId("governance-evidence-raw")).toHaveTextContent("查看原始证据");
    expect(screen.getByTestId("governance-evidence-raw")).toHaveTextContent("custom_field");
  });
});
