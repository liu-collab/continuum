import type { Route } from "next";
import Link from "next/link";
import React from "react";
import { EmptyState } from "@/components/empty-state";
import { FilterModalButton } from "@/components/filter-modal";
import { FormField } from "@/components/form-field";
import { HealthModalButton } from "@/components/health-modal";
import { SearchForm } from "@/components/search-form";
import { StatusBadge } from "@/components/status-badge";
import { describeRunTraceEmptyState, getRunTrace } from "@/features/run-trace/service";
import { getSourceHealth } from "@/features/source-health/service";
import { formatDebugReference, formatRunTraceTitle, formatTimestamp, memoryViewModeLabel } from "@/lib/format";
import { parseRunTraceFilters } from "@/lib/query-params";

function sectionStatusTone(value: string) {
  if (["completed", "submitted", "injected", "healthy", "ready"].includes(value)) return "success";
  if (["rejected", "degraded", "empty", "no_candidates", "trimmed_to_zero", "partial"].includes(value)) return "warning";
  if (["failed", "unavailable", "timeout"].includes(value)) return "danger";
  return "neutral";
}

export default async function RunsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseRunTraceFilters(params);
  const [response, health] = await Promise.all([getRunTrace(filters), getSourceHealth()]);
  const emptyState = describeRunTraceEmptyState(response);
  const activeCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="app-page">
      <section className="tile tile-light">
        <div className="tile-inner">
          <div className="tile-head tile-head-row">
            <div>
              <div className="section-kicker">运行</div>
              <h1 className="tile-title">运行轨迹</h1>
              <p className="tile-subtitle">
                查看一轮对话中触发、召回、注入和写回的结果。
              </p>
            </div>
            <div className="tile-actions">
              <FilterModalButton activeCount={activeCount} title="筛选轨迹" description="按轮次、会话或调试标识定位一条运行轨迹。">
                <SearchForm action="/runs" initialValues={{ turn_id: filters.turnId, session_id: filters.sessionId, trace_id: filters.traceId }}>
                  <FormField label="轮次" name="turn_id" placeholder="轮次标识" defaultValue={filters.turnId} />
                  <FormField label="会话" name="session_id" placeholder="会话标识" defaultValue={filters.sessionId} />
                  <FormField label="调试标识" name="trace_id" placeholder="trace 标识" defaultValue={filters.traceId} />
                </SearchForm>
              </FilterModalButton>
              <HealthModalButton health={health} />
            </div>
          </div>
        </div>
      </section>

      <section className="tile tile-parchment">
        <div className="tile-inner">
          <div className="master-detail-grid">
            <aside className="panel p-5">
              <div className="section-kicker">最近轨迹</div>
              {response.items.length > 0 ? (
                <div className="record-list mt-4">
                  {response.items.map((item) => (
                    <Link
                      key={item.traceId}
                      href={`/runs?trace_id=${encodeURIComponent(item.traceId)}` as Route}
                      className={`record-link ${response.selectedTurn?.turn.traceId === item.traceId ? "record-link-active" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-[17px] font-semibold leading-[1.24] text-text" title={item.turnId}>
                            {formatRunTraceTitle(item.createdAt)}
                          </div>
                          <div className="mt-1 text-[14px] leading-[1.43] text-muted">
                            {item.memoryMode ? memoryViewModeLabel(item.memoryMode) : "未记录记忆模式"}
                          </div>
                        </div>
                        <StatusBadge tone={item.degraded ? "warning" : "success"}>
                          {item.degraded ? "降级" : "正常"}
                        </StatusBadge>
                      </div>
                      <p className="mt-3 line-clamp-2 text-[14px] leading-[1.43] text-muted">{item.summary}</p>
                      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[14px] leading-[1.43] text-muted-foreground">
                        <span>{item.triggerLabel}</span>
                        <span>注入 {item.injectedCount}</span>
                        <span>{formatTimestamp(item.createdAt)}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState title={emptyState.title} description={emptyState.description} />
              )}
            </aside>

            <section className="grid gap-6">
              {response.selectedTurn ? (
                <>
                  <div className="panel p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="section-kicker">选中轨迹</div>
                        <h2 className="mt-3 break-all text-[34px] font-semibold leading-[1.12] text-text">
                          {formatRunTraceTitle(response.selectedTurn.turn.createdAt)}
                        </h2>
                        <p className="mt-4 text-[17px] leading-[1.47] text-muted">
                          {response.selectedTurn.narrative.explanation}
                        </p>
                      </div>
                      <StatusBadge tone={response.selectedTurn.narrative.incomplete ? "warning" : "success"}>
                        {response.selectedTurn.narrative.outcomeLabel}
                      </StatusBadge>
                    </div>
                    <dl className="kv-grid mt-6">
                      <Row label="调试标识" value={formatDebugReference(response.selectedTurn.turn.traceId)} />
                      <Row label="轮次" value={formatDebugReference(response.selectedTurn.turn.turnId)} />
                      <Row label="阶段" value={response.selectedTurn.turn.phase ?? "未记录"} />
                      <Row label="宿主" value={response.selectedTurn.turn.host ?? "未记录"} />
                      <Row label="创建" value={formatTimestamp(response.selectedTurn.turn.createdAt)} />
                    </dl>
                    <div className="detail-grid mt-6">
                      <TextBlock label="输入" value={response.selectedTurn.turn.inputSummary ?? "未记录"} />
                      <TextBlock label="输出" value={response.selectedTurn.turn.assistantOutputSummary ?? "未记录"} />
                    </div>
                  </div>

                  <div className="detail-grid">
                    {response.selectedTurn.phaseNarratives.map((phase, index) => (
                      <div key={`${phase.key}-${index}-${phase.title}`} className="panel p-6">
                        <div className="flex items-start justify-between gap-4">
                          <h3 className="text-[21px] font-semibold leading-[1.19] text-text">{phase.title}</h3>
                          <StatusBadge tone="neutral">{phase.key}</StatusBadge>
                        </div>
                        <p className="mt-3 text-[17px] leading-[1.47] text-muted">{phase.summary}</p>
                        {phase.details.length > 0 ? (
                          <ul className="mt-4 grid gap-2 text-[14px] leading-[1.43] text-muted-foreground">
                            {phase.details.slice(0, 3).map((detail, detailIndex) => (
                              <li key={detailIndex}>{detail}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ))}
                  </div>

                  <div className="panel p-6">
                    <div className="section-kicker">依赖</div>
                    <div className="utility-grid mt-4">
                      {response.selectedTurn.dependencyStatus.map((dependency) => (
                        <div key={dependency.name} className="record-card">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-[17px] font-semibold leading-[1.24] text-text">{dependency.label}</div>
                              <p className="mt-2 line-clamp-2 text-[14px] leading-[1.43] text-muted">{dependency.detail}</p>
                            </div>
                            <StatusBadge tone={sectionStatusTone(dependency.status)}>{dependency.status}</StatusBadge>
                          </div>
                          <div className="mt-3 text-[14px] leading-[1.43] text-muted-foreground">
                            {formatTimestamp(dependency.checkedAt)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <EmptyState title="未选择轨迹" description={emptyState.description} />
              )}
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="kv-row">
      <dt className="kv-label">{label}</dt>
      <dd className="kv-value">{value}</dd>
    </div>
  );
}

function TextBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="record-card">
      <div className="section-kicker">{label}</div>
      <p className="mt-3 text-[17px] leading-[1.47] text-muted">{value}</p>
    </div>
  );
}
