import React from "react";

import { EmptyState } from "@/components/empty-state";
import { MetricCard } from "@/components/metric-card";
import { HealthModalButton } from "@/components/health-modal";
import { StatusBadge } from "@/components/status-badge";
import { TrendCard } from "@/components/trend-card";
import { getDashboard } from "@/features/dashboard/service";
import { getSourceHealth } from "@/features/source-health/service";
import type { DashboardDiagnosisCard, SourceStatus } from "@/lib/contracts";
import {
  dashboardSeverityLabel,
  dashboardSeverityTone,
  formatTimestamp,
  sourceStatusLabel,
  sourceStatusTone
} from "@/lib/format";
import { parseDashboardWindow } from "@/lib/query-params";

const windows = [
  { label: "15m", value: "15m" },
  { label: "30m", value: "30m" },
  { label: "1h", value: "1h" },
  { label: "6h", value: "6h" },
  { label: "24h", value: "24h" }
];

function sourceTone(status: SourceStatus["status"]): "success" | "warning" | "danger" {
  return sourceStatusTone(status);
}

function sourceSummary(source: SourceStatus) {
  if (source.detail) return source.detail;
  if (source.lastError) return source.lastError;
  if (source.status === "healthy") return "最近检查正常。";
  if (source.status === "partial") return "数据源部分可用，部分指标可能缺失。";
  if (source.status === "misconfigured") return "配置异常，检查连接地址或凭据。";
  if (source.status === "timeout") return "最近检查超时，当前指标可能延迟更新。";
  return "当前数据源状态异常，部分指标可能不可用。";
}

export default async function DashboardPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const window = parseDashboardWindow(params);
  const [response, health] = await Promise.all([getDashboard(window), getSourceHealth()]);
  const degradedSources = response.sourceStatus.filter((source) => source.status !== "healthy");
  const partialSources = degradedSources.filter((source) => source.status === "partial");
  const unavailableSources = degradedSources.filter((source) => source.status !== "partial");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">看板</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            运行时与存储指标，按时间窗聚合。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-md border bg-surface p-0.5">
            {windows.map((item) => (
              <a
                key={item.value}
                href={`/dashboard?window=${item.value}`}
                className={`rounded px-3 py-1 text-xs font-medium transition ${
                  item.value === window
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.label}
              </a>
            ))}
          </div>
          <HealthModalButton health={health} />
        </div>
      </div>

      <div className="rounded-lg border bg-surface px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">{response.diagnosis.title}</div>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{response.diagnosis.summary}</p>
          </div>
          <StatusBadge tone={dashboardSeverityTone(response.diagnosis.severity)}>
            {dashboardSeverityLabel(response.diagnosis.severity)} · {response.trendWindow}
          </StatusBadge>
        </div>
      </div>

      {unavailableSources.length > 0 ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          当前有 {unavailableSources.length} 个数据源不可用或已超时，部分指标可能无法计算。
          {` ${unavailableSources.map((source) => source.label).join("、")}。`}
        </div>
      ) : null}

      {partialSources.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          当前有 {partialSources.length} 个数据源只返回了部分结果，页面已按现有数据继续展示。
          {` ${partialSources.map((source) => source.label).join("、")}。`}
        </div>
      ) : null}

      <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {response.diagnosisCards.length > 0 ? (
            response.diagnosisCards.map((card) => (
              <DiagnosisCard key={card.key} card={card} />
            ))
          ) : (
            <EmptyState
              title="暂无诊断项"
              description="当前窗口还没有足够的诊断信号。"
              testId="dashboard-diagnosis-empty"
              className="md:col-span-2 xl:col-span-3"
            />
          )}
        </div>
        <div className="rounded-lg border bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-foreground">数据源状态</div>
            <HealthModalButton sources={response.sourceStatus} label="详情" />
          </div>
          <div className="mt-3 space-y-2">
            {response.sourceStatus.length > 0 ? (
              response.sourceStatus.map((source) => (
                <div key={source.name} className="rounded-md border bg-surface-muted/40 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{source.label}</div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">{source.name}</div>
                    </div>
                    <StatusBadge tone={sourceTone(source.status)}>{sourceStatusLabel(source.status)}</StatusBadge>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {sourceSummary(source)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span>检查 {formatTimestamp(source.lastCheckedAt || source.checkedAt)}</span>
                    <span>响应 {source.responseTimeMs === null ? "不可用" : `${source.responseTimeMs} ms`}</span>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState
                title="暂无数据源状态"
                description="当前窗口还没有返回 runtime 或 storage 的健康状态。"
                testId="dashboard-source-empty"
              />
            )}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            retrieval-runtime
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {response.retrievalMetrics.length > 0 ? (
            response.retrievalMetrics.map((metric) => (
              <MetricCard key={metric.key} metric={metric} />
            ))
          ) : (
            <EmptyState
              title="暂无 runtime 指标"
              description="当前窗口还没有 retrieval-runtime 指标。"
              testId="dashboard-runtime-empty"
              className="md:col-span-2 xl:col-span-4"
            />
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            storage
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {response.storageMetrics.length > 0 ? (
            response.storageMetrics.map((metric) => (
              <MetricCard key={metric.key} metric={metric} />
            ))
          ) : (
            <EmptyState
              title="暂无 storage 指标"
              description="当前窗口还没有 storage 指标。"
              testId="dashboard-storage-empty"
              className="md:col-span-2 xl:col-span-4"
            />
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            趋势
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {response.trends.length > 0 ? (
            response.trends.map((trend) => (
              <TrendCard key={trend.key} trend={trend} />
            ))
          ) : (
            <EmptyState
              title="暂无趋势"
              description="当前窗口还没有足够的数据点生成趋势。"
              testId="dashboard-trends-empty"
              className="md:col-span-2"
            />
          )}
        </div>
      </section>
    </div>
  );
}

function DiagnosisCard({ card }: { card: DashboardDiagnosisCard }) {
  return (
    <div className="rounded-lg border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">{card.title}</div>
          <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {card.source}
          </div>
        </div>
        <StatusBadge tone={dashboardSeverityTone(card.severity)}>
          {dashboardSeverityLabel(card.severity)}
        </StatusBadge>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">{card.summary}</p>
    </div>
  );
}
