"use client";

import React from "react";

import { ErrorState } from "@/components/error-state";

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="space-y-6" data-testid="dashboard-error-state">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">看板</h1>
          <p className="mt-1 text-sm text-muted-foreground">运行时与存储指标，按时间窗聚合。</p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="inline-flex w-fit items-center justify-center rounded-md border bg-surface px-3 py-1.5 text-sm font-medium text-foreground transition hover:border-border-strong"
        >
          重新加载
        </button>
      </div>

      <ErrorState
        title="看板加载失败"
        description="当前无法读取看板数据，请检查 runtime / storage 数据源状态后重试。"
      />
    </div>
  );
}
