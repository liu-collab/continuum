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
  sourceStatusLabel
} from "@/lib/format";
import { parseDashboardWindow } from "@/lib/query-params";

const windows = [
  { label: "15m", value: "15m" },
  { label: "30m", value: "30m" },
  { label: "1h", value: "1h" },
  { label: "6h", value: "6h" },
  { label: "24h", value: "24h" }
];

function sourceSummary(source: SourceStatus) {
  if (source.detail) return source.detail;
  if (source.lastError) return source.lastError;
  return "Last check passed.";
}

export default async function DashboardPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const window = parseDashboardWindow(params);
  const [response, health] = await Promise.all([getDashboard(window), getSourceHealth()]);
  const partial = response.sourceStatus.filter((source) => source.status === "partial");
  const unavailable = response.sourceStatus.filter((source) =>
    ["unavailable", "timeout", "misconfigured"].includes(source.status)
  );

  return (
    <div className="app-page">
      <section className="tile tile-light">
        <div className="tile-inner">
          <div className="tile-head tile-head-row">
            <div>
              <div className="section-kicker">诊断</div>
              <h1 className="tile-title">运行时指标</h1>
              <p className="tile-subtitle">
                按时间窗查看召回、注入、写回和存储治理的主要信号。
              </p>
            </div>
            <div className="tile-actions">
              <div className="segment-control" aria-label="时间窗口">
                {windows.map((item) => (
                  <a
                    key={item.value}
                    href={`/dashboard?window=${item.value}`}
                    className={`segment-item ${item.value === window ? "segment-item-active" : ""}`}
                  >
                    {item.label}
                  </a>
                ))}
              </div>
              <HealthModalButton health={health} />
            </div>
          </div>

          <div className="detail-grid">
            <div className="panel p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-[21px] font-semibold leading-[1.19] text-text">
                    {response.diagnosis.title}
                  </h2>
                  <p className="mt-3 text-[17px] leading-[1.47] text-muted">
                    {response.diagnosis.summary}
                  </p>
                </div>
                <StatusBadge tone={dashboardSeverityTone(response.diagnosis.severity)}>
                  {dashboardSeverityLabel(response.diagnosis.severity)} · {response.trendWindow}
                </StatusBadge>
              </div>
            </div>

            <section className="panel p-6" aria-labelledby="dashboard-source-heading">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 id="dashboard-source-heading" className="text-[21px] font-semibold leading-[1.19] text-text">
                    数据源状态
                  </h2>
                  <p className="mt-2 text-[14px] leading-[1.43] text-muted">
                    只展示会影响页面可信度的依赖状态。
                  </p>
                </div>
                <HealthModalButton sources={response.sourceStatus} label="详情" />
              </div>

              {response.sourceStatus.length > 0 ? (
                <div className="record-list mt-5">
                  {response.sourceStatus.map((source) => (
                    <SourceCard key={source.name} source={source} />
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="暂无数据源状态"
                  description="当前窗口没有返回数据源健康信息。"
                  testId="dashboard-source-empty"
                  className="mt-5"
                />
              )}
            </section>
          </div>

          {unavailable.length > 0 ? (
            <div className="notice notice-danger mt-6">
              当前有 {unavailable.length} 个数据源不可用或已超时：{unavailable.map((source) => source.label).join("、")}。
            </div>
          ) : null}
          {partial.length > 0 ? (
            <div className="notice notice-warning mt-3">
              当前有 {partial.length} 个数据源只返回了部分结果：{partial.map((source) => source.label).join("、")}。
            </div>
          ) : null}
        </div>
      </section>

      <section className="tile tile-dark">
        <div className="tile-inner">
          <div className="tile-head">
            <div className="section-kicker">当前判断</div>
            <h2 className="tile-title">诊断卡片</h2>
          </div>
          {response.diagnosisCards.length > 0 ? (
            <div className="utility-grid">
              {response.diagnosisCards.map((card) => (
                <DiagnosisCard key={card.key} card={card} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="暂无诊断项"
              description="当前窗口没有足够数据生成诊断项。"
              testId="dashboard-diagnosis-empty"
            />
          )}
        </div>
      </section>

      <section className="tile tile-parchment">
        <div className="tile-inner">
          <div className="tile-head">
            <div className="section-kicker">runtime</div>
            <h2 className="tile-title">召回与注入</h2>
          </div>
          {response.retrievalMetrics.length > 0 ? (
            <div className="stat-grid">
              {response.retrievalMetrics.map((metric) => (
                <MetricCard key={metric.key} metric={metric} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="暂无 runtime 指标"
              description="当前窗口还没有运行时指标。"
              testId="dashboard-runtime-empty"
            />
          )}
        </div>
      </section>

      <section className="tile tile-light">
        <div className="tile-inner">
          <div className="tile-head">
            <div className="section-kicker">storage</div>
            <h2 className="tile-title">写回与治理</h2>
          </div>
          {response.storageMetrics.length > 0 ? (
            <div className="stat-grid">
              {response.storageMetrics.map((metric) => (
                <MetricCard key={metric.key} metric={metric} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="暂无 storage 指标"
              description="当前窗口还没有存储指标。"
              testId="dashboard-storage-empty"
            />
          )}
        </div>
      </section>

      <section className="tile tile-parchment">
        <div className="tile-inner">
          <div className="tile-head">
            <div className="section-kicker">趋势</div>
            <h2 className="tile-title">窗口变化</h2>
          </div>
          {response.trends.length > 0 ? (
            <div className="utility-grid">
              {response.trends.map((trend) => (
                <TrendCard key={trend.key} trend={trend} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="暂无趋势"
              description="当前窗口的数据点还不足以形成趋势。"
              testId="dashboard-trends-empty"
            />
          )}
        </div>
      </section>
    </div>
  );
}

function SourceCard({ source }: { source: SourceStatus }) {
  return (
    <div className="record-card">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate text-[17px] font-semibold leading-[1.24] text-text">{source.label}</div>
          <p className="mt-1 line-clamp-2 text-[14px] leading-[1.43] text-muted">{sourceSummary(source)}</p>
        </div>
        <StatusBadge tone={source.status === "healthy" ? "success" : source.status === "partial" ? "warning" : "danger"}>
          {sourceStatusLabel(source.status)}
        </StatusBadge>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[14px] leading-[1.43] text-muted-foreground">
        <span>{formatTimestamp(source.lastCheckedAt || source.checkedAt)}</span>
        <span>{source.responseTimeMs === null ? "未记录延迟" : `${source.responseTimeMs} ms`}</span>
      </div>
    </div>
  );
}

function DiagnosisCard({ card }: { card: DashboardDiagnosisCard }) {
  return (
    <div className="panel p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[21px] font-semibold leading-[1.19] text-text">{card.title}</h3>
          <p className="mt-1 text-[14px] leading-[1.43] text-muted">{card.source}</p>
        </div>
        <StatusBadge tone={dashboardSeverityTone(card.severity)}>{dashboardSeverityLabel(card.severity)}</StatusBadge>
      </div>
      <p className="mt-4 text-[17px] leading-[1.47] text-muted">{card.summary}</p>
    </div>
  );
}
