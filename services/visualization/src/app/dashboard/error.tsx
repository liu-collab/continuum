"use client";

import React from "react";

import { ErrorState } from "@/components/error-state";

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="app-page" data-testid="dashboard-error-state">
      <section className="tile tile-light">
        <div className="tile-inner">
          <div className="tile-head tile-head-row">
            <div>
              <div className="section-kicker">诊断</div>
              <h1 className="tile-title">运行时指标</h1>
              <p className="tile-subtitle">运行时与存储指标，按时间窗聚合。</p>
            </div>
            <button type="button" onClick={reset} className="button-primary">
              重新加载
            </button>
          </div>
          <ErrorState
            title="看板加载失败"
            description="当前无法读取看板数据，请检查 runtime / storage 数据源状态后重试。"
          />
        </div>
      </section>
    </div>
  );
}
