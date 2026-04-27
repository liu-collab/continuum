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
import { formatTimestamp, memoryViewModeLabel } from "@/lib/format";
import { parseRunTraceFilters } from "@/lib/query-params";

function sectionStatusTone(value: string) {
  if (["completed","submitted","injected","healthy","ready"].includes(value)) return "success";
  if (["rejected","degraded","empty","no_candidates","trimmed_to_zero","partial"].includes(value)) return "warning";
  if (["failed","unavailable","timeout"].includes(value)) return "danger";
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
  const es = describeRunTraceEmptyState(response);
  const activeCount = Object.values(filters).filter(Boolean).length;

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div>
          <h1 style={{ fontSize: "1.375rem", fontWeight: 500, fontFamily: "var(--font-mono)", color: "var(--text)", letterSpacing: "-0.01em" }}>
            Runs
          </h1>
          <p style={{ marginTop: "0.25rem", fontSize: "0.8125rem", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
            Per-turn trigger / recall / inject / writeback traces.
          </p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" }}>
          <FilterModalButton activeCount={activeCount} title="Filter Runs" description="Search by turn, session, or trace id.">
            <SearchForm action="/runs" initialValues={{ turn_id: filters.turnId, session_id: filters.sessionId, trace_id: filters.traceId }}>
              <FormField label="Turn ID" name="turn_id" placeholder="turn id" defaultValue={filters.turnId} />
              <FormField label="Session ID" name="session_id" placeholder="session id" defaultValue={filters.sessionId} />
              <FormField label="Trace ID" name="trace_id" placeholder="trace id" defaultValue={filters.traceId} />
            </SearchForm>
          </FilterModalButton>
          <HealthModalButton health={health} />
        </div>
      </div>

      <div style={{ display: "grid", gap: "1.25rem", gridTemplateColumns: "20rem minmax(0,1fr)" }}>
        <section style={{ display: "grid", gap: "0.5rem", alignContent: "start" }}>
          <div className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.16em] text-muted-foreground">Recent Runs</div>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {response.items.length > 0 ? (
              response.items.map((item) => (
                <Link
                  key={item.traceId}
                  href={`/runs?trace_id=${encodeURIComponent(item.traceId)}` as Route}
                  className="panel p-3 transition hover:border-border-hover block"
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem" }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="text-[12px] font-[var(--font-mono)] font-medium text-text truncate">{item.turnId}</div>
                      <div className="mt-0.5 text-[10px] font-[var(--font-mono)] text-muted truncate">{item.traceId}</div>
                    </div>
                    <StatusBadge tone={item.degraded ? "warning" : "success"}>{item.degraded ? "deg" : "ok"}</StatusBadge>
                  </div>
                  <div className="mt-1.5 text-[11px] leading-relaxed text-muted line-clamp-2">{item.summary}</div>
                  <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] font-[var(--font-mono)] text-muted-foreground">
                    <span>{item.memoryMode ? memoryViewModeLabel(item.memoryMode) : "—"}</span>
                    <span>{item.triggerLabel}</span>
                    <span>{item.recallOutcome}</span>
                    <span>inj {item.injectedCount}</span>
                    <span>wb {item.writeBackStatus}</span>
                  </div>
                  <div className="mt-1 text-[10px] font-[var(--font-mono)] text-muted-foreground">{formatTimestamp(item.createdAt)}</div>
                </Link>
              ))
            ) : (
              <EmptyState title={es.title} description={es.description} />
            )}
          </div>
        </section>

        <section style={{ display: "grid", gap: "0.75rem", alignContent: "start" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" }}>
            <div style={{ minWidth: 0 }}>
              <div className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.16em] text-muted-foreground">Selected Trace</div>
              <div className="mt-0.5 text-[15px] font-[var(--font-mono)] font-medium text-text">
                {response.selectedTurn?.turn.turnId ?? "No turn selected"}
              </div>
              <p className="mt-0.5 text-[12px] font-[var(--font-mono)] text-muted">
                {response.selectedTurn?.narrative.explanation ?? es.description}
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
              <div className="panel p-4">
                <div className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.16em] text-muted-foreground">Turn</div>
                <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.375rem", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", fontSize: "0.75rem", fontFamily: "var(--font-mono)" }}>
                  <KV label="Trace ID" value={response.selectedTurn.turn.traceId} />
                  <KV label="Turn ID" value={response.selectedTurn.turn.turnId} />
                  <KV label="Phase" value={response.selectedTurn.turn.phase ?? "—"} />
                  <KV label="Host" value={response.selectedTurn.turn.host ?? "—"} />
                  <KV label="Session" value={response.selectedTurn.turn.sessionId ?? "—"} />
                  <KV label="Workspace" value={response.selectedTurn.turn.workspaceId ?? "—"} />
                  <KV label="Task" value={response.selectedTurn.turn.taskId ?? "—"} />
                  <KV label="Thread" value={response.selectedTurn.turn.threadId ?? "—"} />
                  <KV label="Created" value={formatTimestamp(response.selectedTurn.turn.createdAt)} />
                </div>
                <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border)", display: "grid", gap: "0.5rem", fontSize: "0.8125rem", fontFamily: "var(--font-mono)" }}>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-0.5">Input</div>
                    <div className="text-text">{response.selectedTurn.turn.inputSummary ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-0.5">Output</div>
                    <div className="text-text">{response.selectedTurn.turn.assistantOutputSummary ?? "—"}</div>
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gap: "0.5rem" }}>
                {response.selectedTurn.phaseNarratives.map((phase) => (
                  <div key={phase.key} className="panel p-4">
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem" }}>
                      <div className="text-[13px] font-[var(--font-mono)] font-medium text-text">{phase.title}</div>
                      <StatusBadge tone="neutral">{phase.key}</StatusBadge>
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-muted">{phase.summary}</p>
                    {phase.details.length > 0 ? (
                      <ul style={{ marginTop: "0.5rem", display: "grid", gap: "0.125rem", fontSize: "0.75rem", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                        {phase.details.map((d, i) => <li key={i}>· {d}</li>)}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="panel p-4">
                <div className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.16em] text-muted-foreground mb-3">Dependencies</div>
                <div style={{ display: "grid", gap: "0.5rem", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
                  {response.selectedTurn.dependencyStatus.map((dep) => (
                    <div key={dep.name} style={{ borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--surface-hover)", padding: "0.625rem 0.75rem" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem" }}>
                        <div className="text-[12px] font-[var(--font-mono)] font-medium text-text">{dep.label}</div>
                        <StatusBadge tone={sectionStatusTone(dep.status)}>{dep.status}</StatusBadge>
                      </div>
                      <div className="mt-0.5 text-[11px] leading-relaxed text-muted line-clamp-2">{dep.detail}</div>
                      <div className="mt-0.5 text-[10px] font-[var(--font-mono)] text-muted-foreground">{formatTimestamp(dep.checkedAt)}</div>
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

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", borderBottom: "1px dashed var(--border)", paddingBottom: "0.25rem" }}>
      <span style={{ color: "var(--text-muted)", fontSize: "0.6875rem" }}>{label}</span>
      <span style={{ color: "var(--text)", textAlign: "right" }} className="truncate">{value}</span>
    </div>
  );
}
