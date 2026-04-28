import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PageError } from "@/components/page-error-boundary";
import { PageSkeleton } from "@/components/page-skeleton";

describe("page boundary components", () => {
  it("renders a retryable page error", () => {
    const reset = vi.fn();

    render(
      <PageError
        error={new Error("database unavailable")}
        reset={reset}
        title="页面加载失败"
        retryLabel="重新加载"
        kicker="记忆库"
        heading="记忆目录"
        testId="route-error"
      />,
    );

    expect(screen.getByTestId("route-error")).toHaveTextContent("记忆目录");
    expect(screen.getByText("database unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("renders a stable loading skeleton", () => {
    render(
      <PageSkeleton
        kicker="运行"
        title="运行轨迹"
        subtitle="页面正在加载。"
        sections={[
          { title: "最近记录", count: 2 },
          { title: "详情", count: 1 }
        ]}
        testId="route-loading"
      />,
    );

    expect(screen.getByTestId("route-loading")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("运行轨迹")).toBeInTheDocument();
    expect(screen.getByText("最近记录")).toBeInTheDocument();
    expect(screen.getByText("详情")).toBeInTheDocument();
  });
});
