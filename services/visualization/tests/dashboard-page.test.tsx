import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { getDashboardMock, getSourceHealthMock } = vi.hoisted(() => ({
  getDashboardMock: vi.fn<() => Promise<any>>(),
  getSourceHealthMock: vi.fn<() => Promise<any>>()
}));

vi.mock("@/features/dashboard/service", () => ({
  getDashboard: getDashboardMock
}));

vi.mock("@/features/source-health/service", () => ({
  getSourceHealth: getSourceHealthMock
}));

vi.mock("@/components/health-modal", () => ({
  HealthModalButton: ({ label }: { label?: string }) => <button type="button">{label ?? "健康"}</button>
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    onClick,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
  }) => (
    <a
      href={href}
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

import DashboardPage from "@/app/dashboard/page";
import DashboardError from "@/app/dashboard/error";
import DashboardLoading from "@/app/dashboard/loading";
import { AppI18nProvider } from "@/lib/i18n/client";

const healthyStatus = {
  name: "runtime_api",
  label: "Runtime observe API",
  kind: "dependency" as const,
  status: "healthy" as const,
  checkedAt: "2026-04-16T00:00:00Z",
  lastCheckedAt: "2026-04-16T00:00:00Z",
  lastOkAt: "2026-04-16T00:00:00Z",
  lastError: null,
  responseTimeMs: 25,
  detail: null,
  activeConnections: null,
  connectionLimit: null
};

function renderZh(element: React.ReactNode) {
  return render(<AppI18nProvider defaultLocale="zh-CN">{element}</AppI18nProvider>);
}

describe("dashboard page", () => {
  it("renders explicit empty states for missing dashboard sections", async () => {
    getDashboardMock.mockResolvedValue({
      retrievalMetrics: [],
      storageMetrics: [],
      trendWindow: "15m",
      diagnosis: {
        title: "暂无足够信号",
        summary: "当前窗口还没有足够数据。",
        severity: "info"
      },
      diagnosisCards: [],
      trends: [],
      sourceStatus: []
    });
    getSourceHealthMock.mockResolvedValue({
      liveness: {
        status: "ok",
        checkedAt: "2026-04-16T00:00:00Z"
      },
      readiness: {
        status: "ready",
        checkedAt: "2026-04-16T00:00:00Z",
        summary: "ready"
      },
      service: {
        name: "visualization",
        summary: "ready"
      },
      dependencies: []
    });

    const element = await DashboardPage({
      searchParams: Promise.resolve({ window: "15m" })
    });
    renderZh(element);

    expect(screen.getByTestId("dashboard-diagnosis-empty")).toHaveTextContent("暂无诊断项");
    expect(screen.getByTestId("dashboard-source-empty")).toHaveTextContent("暂无数据源状态");
    expect(screen.getByTestId("dashboard-runtime-empty")).toHaveTextContent("暂无运行时指标");
    expect(screen.getByTestId("dashboard-storage-empty")).toHaveTextContent("暂无存储指标");
    expect(screen.getByTestId("dashboard-trends-empty")).toHaveTextContent("暂无趋势");
  });

  it("renders diagnosis cards and source statuses", async () => {
    getDashboardMock.mockResolvedValue({
      retrievalMetrics: [],
      storageMetrics: [],
      trendWindow: "30m",
      diagnosis: {
        title: "当前主要问题来自依赖",
        summary: "一个或多个上游数据源已经降级：Storage observe API。",
        severity: "danger"
      },
      diagnosisCards: [
        {
          key: "writeback_backlog",
          source: "storage",
          title: "写回积压",
          summary: "当前半窗口内，排队和处理中作业正在积压。",
          severity: "warning"
        },
        {
          key: "scope_mix",
          source: "cross",
          title: "全局 / 工作区使用情况",
          summary: "运行时还没有暴露足够的作用域数据，所以这张卡片目前只能用部分信号。",
          severity: "info"
        }
      ],
      trends: [],
      sourceStatus: [
        healthyStatus,
        {
          ...healthyStatus,
          name: "storage_api",
          label: "Storage observe API",
          status: "unavailable",
          lastOkAt: null,
          responseTimeMs: null,
          detail: "storage observe api unavailable"
        }
      ]
    });
    getSourceHealthMock.mockResolvedValue({
      liveness: {
        status: "ok",
        checkedAt: "2026-04-16T00:00:00Z"
      },
      readiness: {
        status: "degraded",
        checkedAt: "2026-04-16T00:00:00Z",
        summary: "degraded"
      },
      service: {
        name: "visualization",
        summary: "degraded"
      },
      dependencies: []
    });

    const element = await DashboardPage({
      searchParams: Promise.resolve({ window: "30m" })
    });
    renderZh(element);

    expect(screen.getByText("写回积压")).toBeInTheDocument();
    expect(screen.getByText("全局 / 工作区使用情况")).toBeInTheDocument();
    expect(screen.getByText("数据源状态")).toBeInTheDocument();
    expect(screen.getByText("Runtime observe API")).toBeInTheDocument();
    expect(screen.getByText("Storage observe API")).toBeInTheDocument();
    expect(screen.getByText("storage observe api unavailable")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("dashboard-window-15m"));

    expect(screen.getByTestId("dashboard-window-pending")).toHaveTextContent("正在切换时间窗口");
  });

  it("renders degraded and partial source banners", async () => {
    getDashboardMock.mockResolvedValue({
      retrievalMetrics: [],
      storageMetrics: [],
      trendWindow: "30m",
      diagnosis: {
        title: "当前主要问题来自依赖",
        summary: "一个或多个上游数据源已经降级。",
        severity: "danger"
      },
      diagnosisCards: [],
      trends: [],
      sourceStatus: [
        {
          ...healthyStatus,
          name: "runtime_api",
          label: "Runtime observe API",
          status: "timeout",
          lastOkAt: null,
          responseTimeMs: null,
          detail: "runtime timed out"
        },
        {
          ...healthyStatus,
          name: "storage_governance_executions",
          label: "Storage governance executions",
          status: "partial",
          detail: "partial data returned"
        }
      ]
    });
    getSourceHealthMock.mockResolvedValue({
      liveness: {
        status: "ok",
        checkedAt: "2026-04-16T00:00:00Z"
      },
      readiness: {
        status: "degraded",
        checkedAt: "2026-04-16T00:00:00Z",
        summary: "degraded"
      },
      service: {
        name: "visualization",
        summary: "degraded"
      },
      dependencies: []
    });

    const element = await DashboardPage({
      searchParams: Promise.resolve({ window: "30m" })
    });
    renderZh(element);

    expect(screen.getByText(/当前有 1 个数据源不可用或已超时/)).toBeInTheDocument();
    expect(screen.getAllByText(/Runtime observe API/).length).toBeGreaterThan(0);
    expect(screen.getByText(/当前有 1 个数据源只返回了部分结果/)).toBeInTheDocument();
    expect(screen.getAllByText(/Storage governance executions/).length).toBeGreaterThan(0);
  });

  it("renders the loading state", () => {
    renderZh(<DashboardLoading />);

    expect(screen.getByTestId("dashboard-loading-state")).toHaveTextContent("正在读取运行时与存储指标");
    expect(screen.getByText("retrieval-runtime")).toBeInTheDocument();
    expect(screen.getByText("storage")).toBeInTheDocument();
  });

  it("renders the error state and supports retry", () => {
    const reset = vi.fn();

    renderZh(<DashboardError error={new Error("boom")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));

    expect(screen.getByTestId("dashboard-error-state")).toHaveTextContent("看板加载失败");
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
