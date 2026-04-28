import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

describe("runs page", () => {
  it("links recent run cards by trace id instead of turn id", async () => {
    getRunTraceMock.mockResolvedValue({
      items: [
        {
          turnId: "turn-a",
          traceId: "a048c6c0-900a-443e-9d34-d8db2981c2bf",
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
  });
});
