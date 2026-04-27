import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { FilterModalButton } from "@/components/filter-modal";
import { FormField } from "@/components/form-field";
import { HealthModalButton } from "@/components/health-modal";
import { SearchForm } from "@/components/search-form";
import { StatusBadge } from "@/components/status-badge";
import { MemoryTable } from "@/features/memory-catalog/memory-table";
import {
  buildMemoryCatalogQuickViews,
  describeCatalogEmptyState,
  describeCatalogFilterHints,
  getMemoryCatalog
} from "@/features/memory-catalog/service";
import { memoryViewModeLabel } from "@/lib/format";
import { parseMemoryCatalogFilters } from "@/lib/query-params";

export default async function MemoriesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseMemoryCatalogFilters(params);
  const response = await getMemoryCatalog(filters);
  const es = describeCatalogEmptyState(response);
  const views = buildMemoryCatalogQuickViews(filters);
  const hints = describeCatalogFilterHints(filters);
  const activeCount = Object.values(filters).filter(Boolean).length;

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div>
          <h1 style={{ fontSize: "1.375rem", fontWeight: 500, fontFamily: "var(--font-mono)", color: "var(--text)", letterSpacing: "-0.01em" }}>
            Memories
          </h1>
          <p style={{ marginTop: "0.25rem", fontSize: "0.8125rem", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
            {response.total.toLocaleString()} records
            <span style={{ marginLeft: "0.5rem", fontSize: "0.6875rem" }}>· {memoryViewModeLabel(filters.memoryViewMode)}</span>
            {response.pendingConfirmationCount > 0 ? (
              <span style={{ marginLeft: "0.5rem", fontSize: "0.6875rem", color: "var(--amber)" }}>
                · {response.pendingConfirmationCount} pending
              </span>
            ) : null}
          </p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" }}>
          <FilterModalButton activeCount={activeCount} title="Filter Memories" description="Filter by workspace, task, type, scope, status, or date.">
            <SearchForm
              action="/memories"
              initialValues={{
                workspace_id: filters.workspaceId,
                task_id: filters.taskId,
                session_id: filters.sessionId,
                source_ref: filters.sourceRef,
                memory_view_mode: filters.memoryViewMode,
                memory_type: filters.memoryType,
                scope: filters.scope,
                status: filters.status,
                updated_from: filters.updatedFrom,
                updated_to: filters.updatedTo
              }}
            >
              <FormField label="Workspace" name="workspace_id" placeholder="workspace id" defaultValue={filters.workspaceId} />
              <FormField label="Task" name="task_id" placeholder="task id" defaultValue={filters.taskId} />
              <FormField label="Session" name="session_id" placeholder="session id" defaultValue={filters.sessionId} />
              <FormField label="Source Ref" name="source_ref" placeholder="source ref" defaultValue={filters.sourceRef} />
              <FormField label="View" name="memory_view_mode" defaultValue={filters.memoryViewMode} options={[
                { label: "Workspace + Global", value: "workspace_plus_global" },
                { label: "Workspace Only", value: "workspace_only" }
              ]} />
              <FormField label="Type" name="memory_type" defaultValue={filters.memoryType} options={[
                { label: "Fact / Preference", value: "fact_preference" },
                { label: "Task State", value: "task_state" },
                { label: "Episodic", value: "episodic" }
              ]} />
              <FormField label="Scope" name="scope" defaultValue={filters.scope} options={[
                { label: "Session", value: "session" },
                { label: "Task", value: "task" },
                { label: "Global", value: "user" },
                { label: "Workspace", value: "workspace" }
              ]} />
              <FormField label="Status" name="status" defaultValue={filters.status} options={[
                { label: "Active", value: "active" },
                { label: "Pending", value: "pending_confirmation" },
                { label: "Superseded", value: "superseded" },
                { label: "Archived", value: "archived" },
                { label: "Deleted", value: "deleted" }
              ]} />
              <FormField label="Updated From" name="updated_from" type="date" defaultValue={filters.updatedFrom} />
              <FormField label="Updated To" name="updated_to" type="date" defaultValue={filters.updatedTo} />
            </SearchForm>
          </FilterModalButton>
          <HealthModalButton sources={[response.sourceStatus]} label="Source" />
        </div>
      </div>

      <section className="panel p-4">
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <div>
            <h2 className="text-[13px] font-[var(--font-mono)] font-medium text-text">Quick Views</h2>
            <p className="mt-0.5 text-[11px] font-[var(--font-mono)] text-muted">Switch between common memory views without manual filtering.</p>
          </div>
          {hints.length > 0 ? <div className="text-[11px] font-[var(--font-mono)] text-amber">{hints.join(" ")}</div> : null}
        </div>
        <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
          {views.map((view) => (
            <Link
              key={view.key}
              href={view.href}
              style={{
                borderRadius: "var(--radius-md)",
                border: view.active ? "1px solid var(--amber-dim)" : "1px solid var(--border)",
                background: view.active ? "var(--amber-bg)" : "var(--surface)",
                padding: "0.75rem 0.875rem",
                transition: "all 80ms ease",
                textAlign: "left"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
                <span className="text-[12px] font-[var(--font-mono)] font-medium text-text">{view.label}</span>
                {view.active ? <StatusBadge tone="success">active</StatusBadge> : null}
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{view.description}</p>
            </Link>
          ))}
        </div>
      </section>

      {response.viewWarnings.length > 0 ? (
        <div style={{ border: "1px solid rgba(240,168,76,0.3)", borderRadius: "var(--radius-lg)", background: "var(--amber-bg)", padding: "0.625rem 0.875rem", fontSize: "0.8125rem", fontFamily: "var(--font-mono)", color: "var(--amber)" }}>
          {response.viewWarnings.join(" ")}
        </div>
      ) : null}
      {response.pendingConfirmationCount > 0 && filters.status !== "pending_confirmation" ? (
        <div style={{ border: "1px solid rgba(240,168,76,0.3)", borderRadius: "var(--radius-lg)", background: "var(--amber-bg)", padding: "0.625rem 0.875rem", fontSize: "0.8125rem", fontFamily: "var(--font-mono)", color: "var(--amber)" }}>
          {response.pendingConfirmationCount} pending confirmation(s). Switch to the pending queue to review.
        </div>
      ) : null}

      <div>
        <div style={{ marginBottom: "0.5rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
          <StatusBadge tone={response.sourceStatus.status === "healthy" ? "success" : response.sourceStatus.status === "partial" ? "warning" : "danger"}>
            {response.sourceStatus.label}: {response.sourceStatus.status}
          </StatusBadge>
          <span>{response.viewSummary}</span>
        </div>
        {response.items.length > 0 ? (
          <MemoryTable items={response.items} />
        ) : (
          <EmptyState title={es.title} description={es.description} />
        )}
      </div>
    </div>
  );
}
