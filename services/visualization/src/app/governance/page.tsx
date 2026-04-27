import { EmptyState } from "@/components/empty-state";
import { FilterModalButton } from "@/components/filter-modal";
import { FormField } from "@/components/form-field";
import { HealthModalButton } from "@/components/health-modal";
import { SearchForm } from "@/components/search-form";
import { StatusBadge } from "@/components/status-badge";
import { getGovernanceExecutionDetail, getGovernanceHistory } from "@/features/memory-catalog/service";
import { formatTimestamp, governanceStatusTone, summarizeGovernanceTarget } from "@/lib/format";

function parseSearchParams(input: Record<string, string | string[] | undefined>) {
  const v = (k: string) => { const val = input[k]; return Array.isArray(val) ? val[0] : val; };
  return {
    workspaceId: v("workspace_id"),
    proposalType: v("proposal_type"),
    executionStatus: v("execution_status"),
    executionId: v("execution_id"),
    limit: Number.parseInt(v("limit") ?? "50", 10) || 50,
  };
}

const mono = { fontFamily: "var(--font-mono)" } as const;

export default async function GovernancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = parseSearchParams(await searchParams);
  const response = await getGovernanceHistory({ workspaceId: p.workspaceId, proposalType: p.proposalType, executionStatus: p.executionStatus, limit: p.limit });
  const selectedId = p.executionId ?? response.items[0]?.executionId ?? null;
  const dr = selectedId ? await getGovernanceExecutionDetail(selectedId) : { detail: null, status: response.sourceStatus };
  const activeCount = Object.values(p).filter((v, i) => Boolean(v) && i < 4).length;

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div>
          <h1 style={{ fontSize: "1.375rem", fontWeight: 500, ...mono, color: "var(--text)", letterSpacing: "-0.01em" }}>Governance</h1>
          <p style={{ marginTop: "0.25rem", fontSize: "0.8125rem", ...mono, color: "var(--text-muted)" }}>Auto governance proposals, model verification, and execution results.</p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" }}>
          <FilterModalButton activeCount={activeCount} title="Filter Governance" description="Filter by workspace, action, and execution status.">
            <SearchForm action="/governance" initialValues={{ workspace_id: p.workspaceId, proposal_type: p.proposalType, execution_status: p.executionStatus, limit: String(p.limit) }}>
              <FormField label="Workspace" name="workspace_id" placeholder="workspace id" defaultValue={p.workspaceId} />
              <FormField label="Action" name="proposal_type" defaultValue={p.proposalType} options={[
                { label: "Archive", value: "archive" }, { label: "Confirm", value: "confirm" },
                { label: "Delete", value: "delete" }, { label: "Downgrade", value: "downgrade" },
                { label: "Merge", value: "merge" }, { label: "Resolve conflict", value: "resolve_conflict" },
                { label: "Summarize", value: "summarize" }
              ]} />
              <FormField label="Status" name="execution_status" defaultValue={p.executionStatus} options={[
                { label: "Executed", value: "executed" }, { label: "Failed", value: "failed" },
                { label: "Executing", value: "executing" }, { label: "Proposed", value: "proposed" },
                { label: "Verified", value: "verified" }, { label: "Rejected", value: "rejected_by_guard" }
              ]} />
              <FormField label="Limit" name="limit" placeholder="50" defaultValue={String(p.limit)} />
            </SearchForm>
          </FilterModalButton>
          <HealthModalButton sources={[response.sourceStatus, dr.status]} label="Gov Source" />
        </div>
      </div>

      <div style={{ display: "grid", gap: "1.25rem", gridTemplateColumns: "22rem minmax(0,1fr)" }}>
        <section style={{ display: "grid", gap: "0.5rem", alignContent: "start" }}>
          <div style={{ fontSize: "0.625rem", fontWeight: 500, ...mono, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-muted)" }}>Recent Governance</div>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {response.items.length > 0 ? (
              response.items.map((item) => {
                const href = `/governance?${new URLSearchParams({
                  ...(p.workspaceId ? { workspace_id: p.workspaceId } : {}),
                  ...(p.proposalType ? { proposal_type: p.proposalType } : {}),
                  ...(p.executionStatus ? { execution_status: p.executionStatus } : {}),
                  limit: String(p.limit), execution_id: item.executionId,
                }).toString()}`;
                return (
                  <a key={item.executionId} href={href} className="panel p-3 transition hover:border-border-hover block"
                    style={item.executionId === selectedId ? { borderColor: "var(--cyan-dim)", background: "var(--cyan-bg)" } : undefined}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem" }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="text-[12px] text-text truncate" style={mono}>{item.proposalTypeLabel}</div>
                        <div className="mt-0.5 text-[10px] text-muted truncate" style={mono}>{item.executionId}</div>
                      </div>
                      <StatusBadge tone={governanceStatusTone(item.executionStatus)}>{item.executionStatusLabel}</StatusBadge>
                    </div>
                    <div className="mt-1.5 text-[11px] leading-relaxed text-muted line-clamp-2" style={mono}>{item.reasonText}</div>
                    {item.verificationBlocked ? (
                      <div style={{ marginTop: "0.5rem", borderRadius: "var(--radius-sm)", border: "1px solid rgba(240,168,76,0.3)", background: "var(--amber-bg)", padding: "0.25rem 0.5rem", fontSize: "0.6875rem", ...mono, color: "var(--amber)" }}>
                        Blocked: {item.verificationBlockedReason ?? "pending review"}
                      </div>
                    ) : null}
                    <div className="mt-1.5 text-[10px] text-muted-foreground" style={mono}>{formatTimestamp(item.startedAt)}</div>
                  </a>
                );
              })
            ) : (
              <EmptyState title="No records" description={response.sourceStatus.detail ?? "No governance records for this filter."} />
            )}
          </div>
        </section>

        <section style={{ display: "grid", gap: "0.75rem", alignContent: "start" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "0.625rem", fontWeight: 500, ...mono, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-muted)" }}>Detail</div>
              <div className="mt-0.5 text-[15px] text-text" style={mono}>{dr.detail?.proposalTypeLabel ?? "No selection"}</div>
              <p className="mt-0.5 text-[12px] text-muted" style={mono}>{dr.detail?.reasonText ?? "Select an execution from the list."}</p>
            </div>
            {dr.detail ? <StatusBadge tone={governanceStatusTone(dr.detail.executionStatus)}>{dr.detail.executionStatusLabel}</StatusBadge> : null}
          </div>

          {dr.detail ? (
            <>
              <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
                <div className="panel p-4">
                  <div style={{ fontSize: "0.625rem", ...mono, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.75rem" }}>Planner / Verifier</div>
                  <div style={{ display: "grid", gap: "0.25rem", fontSize: "0.75rem", ...mono }}>
                    <KV label="Planner model" value={dr.detail.plannerModel} />
                    <KV label="Planner confidence" value={String(dr.detail.plannerConfidence ?? "—")} />
                    <KV label="Verifier required" value={dr.detail.verifierRequired ? "Yes" : "No"} />
                    <KV label="Verifier decision" value={dr.detail.verifierDecision ?? "—"} />
                    <KV label="Blocked" value={dr.detail.verificationBlocked ? "Yes" : "No"} />
                    <KV label="Verifier model" value={dr.detail.verifierModel ?? "—"} />
                    <KV label="Policy" value={dr.detail.policyVersion} />
                  </div>
                </div>
                <div className="panel p-4">
                  <div style={{ fontSize: "0.625rem", ...mono, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.75rem" }}>Execution</div>
                  {dr.detail.verificationBlocked ? (
                    <div style={{ marginBottom: "0.5rem", borderRadius: "var(--radius-sm)", border: "1px solid rgba(240,168,76,0.3)", background: "var(--amber-bg)", padding: "0.375rem 0.5rem", fontSize: "0.75rem", ...mono, color: "var(--amber)" }}>
                      Blocked: {dr.detail.verificationBlockedReason ?? "pending"}
                    </div>
                  ) : null}
                  <div style={{ display: "grid", gap: "0.25rem", fontSize: "0.75rem", ...mono }}>
                    <KV label="Execution ID" value={dr.detail.executionId} />
                    <KV label="Proposal ID" value={dr.detail.proposalId} />
                    <KV label="Workspace" value={dr.detail.workspaceId} />
                    <KV label="Started" value={formatTimestamp(dr.detail.startedAt)} />
                    <KV label="Finished" value={formatTimestamp(dr.detail.finishedAt)} />
                    <KV label="Result" value={dr.detail.resultSummary ?? "—"} />
                    <KV label="Error" value={dr.detail.errorMessage ?? "—"} />
                  </div>
                </div>
              </div>

              <div className="panel p-4">
                <div style={{ fontSize: "0.625rem", ...mono, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.5rem" }}>Targets</div>
                <div style={{ borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--surface-hover)", padding: "0.5rem 0.75rem", fontSize: "0.8125rem", ...mono, color: "var(--text-secondary)" }}>
                  {summarizeGovernanceTarget(dr.detail.targets)}
                </div>
                <div style={{ marginTop: "0.5rem", display: "grid", gap: "0.375rem" }}>
                  {dr.detail.targets.map((t, i) => (
                    <div key={`${t.role}-${i}`} style={{ borderRadius: "var(--radius-md)", border: "1px solid var(--border)", padding: "0.375rem 0.625rem", fontSize: "0.75rem", ...mono }}>
                      <span style={{ color: "var(--text)" }}>{t.role}</span>
                      <span className="ml-2 text-muted">{t.recordId ?? t.conflictId ?? "—"}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
                <div className="panel p-4">
                  <div style={{ fontSize: "0.625rem", ...mono, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.5rem" }}>Changes</div>
                  <pre style={{
                    overflow: "auto", borderRadius: "var(--radius-md)", border: "1px solid var(--border)",
                    background: "var(--bg)", padding: "0.625rem 0.75rem",
                    fontSize: "0.6875rem", lineHeight: "1.5", ...mono, color: "var(--text-secondary)"
                  }}>
                    {JSON.stringify(dr.detail.suggestedChanges, null, 2)}
                  </pre>
                </div>
                <div className="panel p-4">
                  <div style={{ fontSize: "0.625rem", ...mono, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.5rem" }}>Evidence</div>
                  <pre style={{
                    overflow: "auto", borderRadius: "var(--radius-md)", border: "1px solid var(--border)",
                    background: "var(--bg)", padding: "0.625rem 0.75rem",
                    fontSize: "0.6875rem", lineHeight: "1.5", ...mono, color: "var(--text-secondary)"
                  }}>
                    {JSON.stringify(dr.detail.evidence, null, 2)}
                  </pre>
                </div>
              </div>
            </>
          ) : (
            <EmptyState title="No detail" description={dr.status.detail ?? "No governance detail available."} />
          )}
        </section>
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", borderBottom: "1px dashed var(--border)", paddingBottom: "0.125rem" }}>
      <span style={{ color: "var(--text-muted)", fontSize: "0.6875rem" }}>{label}</span>
      <span style={{ color: "var(--text)", textAlign: "right" }} className="truncate">{value}</span>
    </div>
  );
}
