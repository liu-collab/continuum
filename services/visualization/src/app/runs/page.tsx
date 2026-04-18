import type { Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { FilterBar } from "@/components/filter-bar";
import { FormField } from "@/components/form-field";
import { SearchForm } from "@/components/search-form";
import { SourceHealthPanel } from "@/components/source-health-panel";
import { StatusBadge } from "@/components/status-badge";
import { describeRunTraceEmptyState, getRunTrace } from "@/features/run-trace/service";
import { getSourceHealth } from "@/features/source-health/service";
import { formatTimestamp, memoryViewModeLabel } from "@/lib/format";
import { parseRunTraceFilters } from "@/lib/query-params";

function sectionStatusTone(value: string) {
  if (["completed", "submitted", "injected", "healthy", "ready"].includes(value)) {
    return "success";
  }

  if (
    ["rejected", "degraded", "empty", "no_candidates", "trimmed_to_zero", "partial"].includes(value)
  ) {
    return "warning";
  }

  if (["failed", "unavailable", "timeout"].includes(value)) {
    return "danger";
  }

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

  return (
    <div className="space-y-6">
      <FilterBar
        title="运行轨迹"
        description="查看单轮在 turn、trigger、recall、injection 和 write-back 之间发生了什么。当前阶段只保留正式支持的运行时筛选项：turn id、session id、trace id 和分页。"
      >
        <SearchForm
          action="/runs"
          initialValues={{
            turn_id: filters.turnId,
            session_id: filters.sessionId,
            trace_id: filters.traceId
          }}
        >
          <FormField label="Turn id" name="turn_id" placeholder="turn id" defaultValue={filters.turnId} />
          <FormField label="Session id" name="session_id" placeholder="session id" defaultValue={filters.sessionId} />
          <FormField label="Trace id" name="trace_id" placeholder="trace id" defaultValue={filters.traceId} />
        </SearchForm>
      </FilterBar>

      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">最近运行</p>
              <h2 className="font-[var(--font-serif)] text-2xl text-slate-900">轨迹列表</h2>
            </div>
          </div>
          <div className="panel-body space-y-3">
            {response.items.length > 0 ? (
              response.items.map((item) => (
                <Link
                  key={item.traceId}
                  href={`/runs?turn_id=${encodeURIComponent(item.turnId)}` as Route}
                  className="block rounded-xl border bg-white/80 p-4 transition hover:border-accent"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-900">{item.turnId}</div>
                      <div className="mt-1 text-xs text-slate-500">Trace {item.traceId}</div>
                      <div className="mt-1 text-xs text-slate-500">{formatTimestamp(item.createdAt)}</div>
                    </div>
                    <StatusBadge tone={item.degraded ? "warning" : "success"}>
                      {item.degraded ? "已降级" : "健康"}
                    </StatusBadge>
                  </div>
                  <div className="mt-3 text-sm text-slate-700">{item.summary}</div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                    <span>{item.memoryMode ? memoryViewModeLabel(item.memoryMode) : "模式未知"}</span>
                    <span>{item.scopeSummary}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                    <span>{item.triggerLabel}</span>
                    <span>{item.recallOutcome}</span>
                    <span>注入 {item.injectedCount}</span>
                    <span>写回 {item.writeBackStatus}</span>
                  </div>
                </Link>
              ))
            ) : (
              <EmptyState title={emptyState.title} description={emptyState.description} />
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">当前轨迹</p>
              <h2 className="font-[var(--font-serif)] text-2xl text-slate-900">
                {response.selectedTurn?.turn.turnId ?? "尚未选择 turn"}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                {response.selectedTurn?.narrative.explanation ?? emptyState.description}
              </p>
            </div>
            {response.selectedTurn ? (
              <StatusBadge tone={response.selectedTurn.narrative.incomplete ? "warning" : "success"}>
                {response.selectedTurn.narrative.outcomeLabel}
              </StatusBadge>
            ) : null}
          </div>
          <div className="panel-body space-y-4">
            {response.selectedTurn ? (
              <>
                <div className="rounded-xl border bg-white/80 p-4">
                  <div className="text-sm font-semibold text-slate-900">Turn</div>
                  <dl className="mt-3 grid gap-3 text-sm text-slate-600 md:grid-cols-2">
                    <div>
                      <dt className="font-medium text-slate-900">Trace id</dt>
                      <dd>{response.selectedTurn.turn.traceId}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-900">Turn id</dt>
                      <dd>{response.selectedTurn.turn.turnId}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-900">Phase</dt>
                      <dd>{response.selectedTurn.turn.phase ?? "Not recorded"}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-900">Host</dt>
                      <dd>{response.selectedTurn.turn.host ?? "Not recorded"}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-900">Session id</dt>
                      <dd>{response.selectedTurn.turn.sessionId ?? "Not recorded"}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-900">Workspace id</dt>
                      <dd>{response.selectedTurn.turn.workspaceId ?? "未记录"}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-900">User id</dt>
                      <dd>{response.selectedTurn.turn.userId ?? "未记录"}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-900">Task id</dt>
                      <dd>{response.selectedTurn.turn.taskId ?? "未记录"}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-900">Thread id</dt>
                      <dd>{response.selectedTurn.turn.threadId ?? "未记录"}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-900">创建时间</dt>
                      <dd>{formatTimestamp(response.selectedTurn.turn.createdAt)}</dd>
                    </div>
                    <div className="md:col-span-2">
                      <dt className="font-medium text-slate-900">当前输入</dt>
                      <dd>{response.selectedTurn.turn.inputSummary ?? "未记录"}</dd>
                    </div>
                    <div className="md:col-span-2">
                      <dt className="font-medium text-slate-900">助手输出</dt>
                      <dd>{response.selectedTurn.turn.assistantOutputSummary ?? "未记录"}</dd>
                    </div>
                  </dl>
                </div>

                <div className="grid gap-4">
                  {response.selectedTurn.phaseNarratives.map((phase) => (
                    <div key={phase.key} className="rounded-xl border bg-white/80 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{phase.title}</div>
                          <p className="mt-2 text-sm leading-6 text-slate-600">{phase.summary}</p>
                        </div>
                        <StatusBadge tone="neutral">{phase.key}</StatusBadge>
                      </div>
                      <ul className="mt-4 space-y-2 text-sm text-slate-600">
                        {phase.details.map((detail, index) => (
                          <li key={`${phase.key}-${index}`}>{detail}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border bg-white/80 p-4">
                  <div className="text-sm font-semibold text-slate-900">依赖快照</div>
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    {response.selectedTurn.dependencyStatus.map((dependency) => (
                      <div key={dependency.name} className="rounded-xl border bg-slate-50/70 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-sm font-medium text-slate-900">{dependency.label}</div>
                          <StatusBadge tone={sectionStatusTone(dependency.status)}>
                            {dependency.status}
                          </StatusBadge>
                        </div>
                        <div className="mt-2 text-sm leading-6 text-slate-600">{dependency.detail}</div>
                        <div className="mt-2 text-xs text-slate-500">
                          检查时间：{formatTimestamp(dependency.checkedAt)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <EmptyState title={emptyState.title} description={emptyState.description} />
            )}
          </div>
        </section>
      </div>

      <SourceHealthPanel title="服务与依赖健康" health={health} />
    </div>
  );
}
