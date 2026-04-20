import type { Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { FilterModalButton } from "@/components/filter-modal";
import { FormField } from "@/components/form-field";
import { HealthModalButton } from "@/components/health-modal";
import { SearchForm } from "@/components/search-form";
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
  const activeFilterCount = Object.values(filters).filter((value) => Boolean(value)).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">运行</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            单轮的触发 / 召回 / 注入 / 写回。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterModalButton
            activeCount={activeFilterCount}
            title="筛选运行"
            description="按 turn / session / trace id 过滤。"
          >
            {({ close }) => (
              <SearchForm
                action="/runs"
                onSubmitted={close}
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
            )}
          </FilterModalButton>
          <HealthModalButton health={health} />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <section className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            最近运行
          </div>
          <div className="space-y-2">
            {response.items.length > 0 ? (
              response.items.map((item) => (
                <Link
                  key={item.traceId}
                  href={`/runs?turn_id=${encodeURIComponent(item.turnId)}` as Route}
                  className="block rounded-lg border bg-surface p-3 transition hover:border-border-strong"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{item.turnId}</div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">{item.traceId}</div>
                    </div>
                    <StatusBadge tone={item.degraded ? "warning" : "success"}>
                      {item.degraded ? "降级" : "健康"}
                    </StatusBadge>
                  </div>
                  <div className="mt-2 text-xs leading-5 text-muted-foreground line-clamp-2">{item.summary}</div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span>{item.memoryMode ? memoryViewModeLabel(item.memoryMode) : "—"}</span>
                    <span>{item.triggerLabel}</span>
                    <span>{item.recallOutcome}</span>
                    <span>注入 {item.injectedCount}</span>
                    <span>写回 {item.writeBackStatus}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">{formatTimestamp(item.createdAt)}</div>
                </Link>
              ))
            ) : (
              <EmptyState title={emptyState.title} description={emptyState.description} />
            )}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                当前轨迹
              </div>
              <div className="mt-1 text-base font-semibold text-foreground">
                {response.selectedTurn?.turn.turnId ?? "未选择 turn"}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {response.selectedTurn?.narrative.explanation ?? emptyState.description}
              </p>
            </div>
            {response.selectedTurn ? (
              <StatusBadge tone={response.selectedTurn.narrative.incomplete ? "warning" : "success"}>
                {response.selectedTurn.narrative.outcomeLabel}
              </StatusBadge>
            ) : null}
          </div>

          {response.selectedTurn ? (
            <>
              <div className="rounded-lg border bg-surface p-4">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Turn
                </div>
                <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm md:grid-cols-2">
                  <Row label="Trace id" value={response.selectedTurn.turn.traceId} />
                  <Row label="Turn id" value={response.selectedTurn.turn.turnId} />
                  <Row label="Phase" value={response.selectedTurn.turn.phase ?? "—"} />
                  <Row label="Host" value={response.selectedTurn.turn.host ?? "—"} />
                  <Row label="Session" value={response.selectedTurn.turn.sessionId ?? "—"} />
                  <Row label="Workspace" value={response.selectedTurn.turn.workspaceId ?? "—"} />
                  <Row label="User" value={response.selectedTurn.turn.userId ?? "—"} />
                  <Row label="Task" value={response.selectedTurn.turn.taskId ?? "—"} />
                  <Row label="Thread" value={response.selectedTurn.turn.threadId ?? "—"} />
                  <Row label="创建" value={formatTimestamp(response.selectedTurn.turn.createdAt)} />
                </dl>
                <div className="mt-3 space-y-2 border-t pt-3 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">输入</div>
                    <div className="mt-0.5 text-foreground">{response.selectedTurn.turn.inputSummary ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">输出</div>
                    <div className="mt-0.5 text-foreground">
                      {response.selectedTurn.turn.assistantOutputSummary ?? "—"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                {response.selectedTurn.phaseNarratives.map((phase) => (
                  <div key={phase.key} className="rounded-lg border bg-surface p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-sm font-medium text-foreground">{phase.title}</div>
                      <StatusBadge tone="neutral">{phase.key}</StatusBadge>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{phase.summary}</p>
                    {phase.details.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {phase.details.map((detail, index) => (
                          <li key={`${phase.key}-${index}`}>· {detail}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="rounded-lg border bg-surface p-4">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  依赖快照
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  {response.selectedTurn.dependencyStatus.map((dependency) => (
                    <div key={dependency.name} className="rounded-md border bg-surface-muted/40 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-medium text-foreground">{dependency.label}</div>
                        <StatusBadge tone={sectionStatusTone(dependency.status)}>{dependency.status}</StatusBadge>
                      </div>
                      <div className="mt-1 text-xs leading-5 text-muted-foreground line-clamp-2">
                        {dependency.detail}
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {formatTimestamp(dependency.checkedAt)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-dashed py-1 last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-right text-sm text-foreground">{value}</dd>
    </div>
  );
}
