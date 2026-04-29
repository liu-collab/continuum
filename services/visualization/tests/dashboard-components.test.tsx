import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MetricCard } from "@/components/metric-card";
import { TrendCard } from "@/components/trend-card";
import type { DashboardMetric, DashboardTrend } from "@/lib/contracts";

describe("dashboard cards", () => {
  it("renders metric state explicitly", () => {
    const metric: DashboardMetric = {
      key: "recall_p95_ms",
      label: "召回 P95",
      value: null,
      unit: "ms",
      source: "runtime",
      description: "运行时召回查询的 P95 延迟。",
      severity: "unknown",
      formattedValue: "不可用"
    };

    render(<MetricCard metric={metric} locale="zh-CN" />);

    expect(screen.getByText("召回 P95")).toBeInTheDocument();
    expect(screen.getByText("未知")).toBeInTheDocument();
    expect(screen.getByText("不可用")).toBeInTheDocument();
  });

  it("renders unavailable trend points as placeholders", () => {
    const trend: DashboardTrend = {
      key: "empty_recall_shift",
      title: "空召回随时间变化",
      summary: "用来判断最近空召回是否开始变多。",
      source: "runtime",
      unit: "percent",
      currentValue: null,
      previousValue: 0.2,
      currentFormatted: "不可用",
      previousFormatted: "20.0%",
      deltaFormatted: "不可用",
      severity: "unknown",
      points: [
        { label: "-30m", value: null },
        { label: "-20m", value: 0.2 },
        { label: "-10m", value: null },
        { label: "now", value: null }
      ]
    };

    render(<TrendCard trend={trend} locale="zh-CN" />);

    expect(screen.getByText("空召回随时间变化")).toBeInTheDocument();
    expect(screen.getByText("未知")).toBeInTheDocument();
    expect(screen.getByLabelText("-30m: 不可用")).toHaveClass("border-dashed");
    expect(screen.getByLabelText("-20m: 20.0%")).toHaveClass("bg-foreground/80");
  });
});
