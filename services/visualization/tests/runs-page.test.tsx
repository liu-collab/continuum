import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getRunTraceMock, getSourceHealthMock } = vi.hoisted(() => ({
  getRunTraceMock: vi.fn<() => Promise<any>>(),
  getSourceHealthMock: vi.fn<() => Promise<any>>()
}));

vi.mock("@/features/run-trace/service", () => ({
  describeRunTraceEmptyState: vi.fn(() => ({
    title: "当前筛选条件下没有找到轨迹",
    description: "运行时观测接口可访问，但没有返回对应轮次或调试标识的轨迹。"
  })),
  getRunTrace: getRunTraceMock
}));

vi.mock("@/features/source-health/service", () => ({
  getSourceHealth: getSourceHealthMock
}));

vi.mock("@/components/health-modal", () => ({
  HealthModalButton: () => <button type="button">健康</button>
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    scroll,
    onClick,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    scroll?: boolean;
  }) => (
    <a
      href={href}
      data-scroll={String(scroll)}
      onClick={(event) => {
        onClick?.(event);
        event.preventDefault();
      }}
      {...props}
    >
      {children}
    </a>
  )
}));

import RunsPage from "@/app/runs/page";

const healthyStatus = {
  name: "runtime_api",
  label: "Runtime observe API",
  kind: "dependency" as const,
  status: "healthy" as const,
  checkedAt: new Date().toISOString(),
  lastCheckedAt: new Date().toISOString(),
  lastOkAt: new Date().toISOString(),
  lastError: null,
  responseTimeMs: 20,
  detail: null,
  activeConnections: null,
  connectionLimit: null
};

function createSelectedTurn(traceId: string, narrative = `trace ${traceId} loaded`) {
  return {
    turn: {
      traceId,
      turnId: `turn-${traceId}`,
      workspaceId: "workspace-1",
      taskId: null,
      sessionId: "session-1",
      threadId: null,
      host: "agent",
      phase: "before_response",
      inputSummary: "input",
      assistantOutputSummary: "output",
      turnStatus: "completed",
      createdAt: "2026-04-22T00:00:00Z",
      completedAt: "2026-04-22T00:00:01Z"
    },
    turns: [],
    triggerRuns: [],
    recallRuns: [],
    injectionRuns: [],
    memoryPlanRuns: [],
    writeBackRuns: [],
    dependencyStatus: [],
    phaseNarratives: [],
    narrative: {
      outcomeCode: "completed",
      outcomeLabel: "轨迹完成",
      explanation: narrative,
      incomplete: false
    }
  };
}

describe("runs page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("switches recent run details in place by trace id", async () => {
    const traceId = "a048c6c0-900a-443e-9d34-d8db2981c2bf";
    getRunTraceMock.mockResolvedValue({
      items: [
        {
          turnId: "turn-a",
          traceId,
          phase: "before_response",
          createdAt: "2026-04-22T00:00:00Z",
          memoryMode: "workspace_plus_global",
          scopeSummary: "请求作用域：平台；最终选择：平台。",
          triggerLabel: "phase",
          recallOutcome: "已触发但为空",
          injectedCount: 0,
          writeBackStatus: "not_recorded",
          degraded: false,
          summary: "最近运行摘要"
        }
      ],
      total: 1,
      selectedTurn: null,
      appliedFilters: {
        turnId: undefined,
        sessionId: undefined,
        traceId: undefined,
        page: 1,
        pageSize: 20
      },
      sourceStatus: healthyStatus
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [],
        total: 1,
        selectedTurn: createSelectedTurn(traceId, "client detail loaded"),
        appliedFilters: {
          turnId: undefined,
          sessionId: undefined,
          traceId,
          page: 1,
          pageSize: 20
        },
        sourceStatus: healthyStatus
      })
    } as Response);
    getSourceHealthMock.mockResolvedValue({
      liveness: {
        status: "ok",
        checkedAt: new Date().toISOString()
      },
      readiness: {
        status: "ready",
        checkedAt: new Date().toISOString(),
        summary: "ready"
      },
      service: {
        name: "visualization",
        summary: "ready"
      },
      dependencies: [healthyStatus]
    });

    const element = await RunsPage({
      searchParams: Promise.resolve({})
    });
    render(element);

    expect(screen.getByText("最近运行摘要").closest("a")).toHaveAttribute(
      "href",
      "/runs?trace_id=a048c6c0-900a-443e-9d34-d8db2981c2bf"
    );

    fireEvent.click(screen.getByText("最近运行摘要").closest("a")!);

    expect(screen.getByTestId("run-detail-pending")).toHaveTextContent("正在加载轨迹详情");
    await waitFor(() => {
      expect(screen.getByText("client detail loaded")).toBeInTheDocument();
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(`/api/runs?trace_id=${encodeURIComponent(traceId)}`, {
      headers: {
        accept: "application/json",
      },
    });
    expect(window.location.pathname).toBe("/runs");
    expect(window.location.search).toBe(`?trace_id=${encodeURIComponent(traceId)}`);
  });

  it("links injected record ids to memory detail pages", async () => {
    getRunTraceMock.mockResolvedValue({
      items: [],
      total: 1,
      selectedTurn: {
        turn: {
          traceId: "trace-selected",
          turnId: "turn-selected",
          workspaceId: "workspace-1",
          taskId: null,
          sessionId: "session-1",
          threadId: null,
          host: "agent",
          phase: "before_response",
          inputSummary: "input",
          assistantOutputSummary: "output",
          turnStatus: "completed",
          createdAt: "2026-04-22T00:00:00Z",
          completedAt: "2026-04-22T00:00:01Z"
        },
        turns: [],
        triggerRuns: [],
        recallRuns: [],
        injectionRuns: [
          {
            traceId: "trace-selected",
            injected: true,
            injectedCount: 1,
            memoryMode: "workspace_plus_global",
            requestedScopes: ["workspace"],
            selectedScopes: ["workspace"],
            keptRecordIds: ["memory-kept-1"],
            injectionReason: "matched preference",
            memorySummary: "injected memory",
            resultState: "injected",
            dropReasons: [],
            tokenEstimate: 120,
            droppedRecordIds: ["memory-trimmed-1"],
            latencyMs: 42,
            createdAt: "2026-04-22T00:00:00Z"
          }
        ],
        memoryPlanRuns: [],
        writeBackRuns: [],
        dependencyStatus: [],
        phaseNarratives: [
          {
            key: "injection",
            title: "注入 / before_response",
            summary: "injected memory",
            details: ["保留记录：memory-kept-1", "裁剪记录：memory-trimmed-1"]
          }
        ],
        narrative: {
          outcomeCode: "completed",
          outcomeLabel: "轨迹完成",
          explanation: "trace completed",
          incomplete: false
        }
      },
      appliedFilters: {
        turnId: undefined,
        sessionId: undefined,
        traceId: "trace-selected",
        page: 1,
        pageSize: 20
      },
      sourceStatus: healthyStatus
    });
    getSourceHealthMock.mockResolvedValue({
      liveness: {
        status: "ok",
        checkedAt: new Date().toISOString()
      },
      readiness: {
        status: "ready",
        checkedAt: new Date().toISOString(),
        summary: "ready"
      },
      service: {
        name: "visualization",
        summary: "ready"
      },
      dependencies: [healthyStatus]
    });

    const element = await RunsPage({
      searchParams: Promise.resolve({ trace_id: "trace-selected" })
    });
    render(element);

    expect(screen.getByTitle("memory-kept-1")).toHaveAttribute("href", "/memories/memory-kept-1");
    expect(screen.getByTitle("memory-trimmed-1")).toHaveAttribute("href", "/memories/memory-trimmed-1");
  });
});
