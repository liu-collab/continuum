import { EmptyState } from "@/components/empty-state";
import { FilterBar } from "@/components/filter-bar";
import { FormField } from "@/components/form-field";
import { SearchForm } from "@/components/search-form";
import { SourceHealthPanel } from "@/components/source-health-panel";
import { StatusBadge } from "@/components/status-badge";
import { MemoryTable } from "@/features/memory-catalog/memory-table";
import { describeCatalogEmptyState, getMemoryCatalog } from "@/features/memory-catalog/service";
import { parseMemoryCatalogFilters } from "@/lib/query-params";

export default async function MemoriesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseMemoryCatalogFilters(params);
  const response = await getMemoryCatalog(filters);
  const emptyState = describeCatalogEmptyState(response);

  return (
    <div className="space-y-6">
      <FilterBar
        title="Memory catalog"
        description="Use the published storage read model to inspect structured memory by workspace, user, task, type, scope, status, and update window."
      >
        <SearchForm
          action="/memories"
          initialValues={{
            workspace_id: filters.workspaceId,
            user_id: filters.userId,
            task_id: filters.taskId,
            memory_type: filters.memoryType,
            scope: filters.scope,
            status: filters.status,
            updated_from: filters.updatedFrom,
            updated_to: filters.updatedTo
          }}
        >
          <FormField label="Workspace" name="workspace_id" placeholder="workspace uuid" defaultValue={filters.workspaceId} />
          <FormField label="User" name="user_id" placeholder="user uuid" defaultValue={filters.userId} />
          <FormField label="Task" name="task_id" placeholder="task uuid" defaultValue={filters.taskId} />
          <FormField
            label="Memory type"
            name="memory_type"
            defaultValue={filters.memoryType}
            options={[
              { label: "Facts & preferences", value: "fact_preference" },
              { label: "Task state", value: "task_state" },
              { label: "Episodic", value: "episodic" }
            ]}
          />
          <FormField
            label="Scope"
            name="scope"
            defaultValue={filters.scope}
            options={[
              { label: "Session", value: "session" },
              { label: "Task", value: "task" },
              { label: "User", value: "user" },
              { label: "Workspace", value: "workspace" }
            ]}
          />
          <FormField
            label="Status"
            name="status"
            defaultValue={filters.status}
            options={[
              { label: "Active", value: "active" },
              { label: "Pending confirmation", value: "pending_confirmation" },
              { label: "Superseded", value: "superseded" },
              { label: "Archived", value: "archived" }
            ]}
          />
          <FormField label="Updated from" name="updated_from" type="date" defaultValue={filters.updatedFrom} />
          <FormField label="Updated to" name="updated_to" type="date" defaultValue={filters.updatedTo} />
        </SearchForm>
      </FilterBar>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Catalog results</p>
            <h2 className="font-[var(--font-serif)] text-2xl text-slate-900">
              {response.total} records visible
            </h2>
          </div>
          <StatusBadge
            tone={response.sourceStatus.status === "healthy" ? "success" : "danger"}
          >
            {response.sourceStatus.label}: {response.sourceStatus.status}
          </StatusBadge>
        </div>
        <div className="panel-body">
          {response.items.length > 0 ? (
            <MemoryTable items={response.items} />
          ) : (
            <EmptyState title={emptyState.title} description={emptyState.description} />
          )}
        </div>
      </section>

      <SourceHealthPanel title="Catalog source health" sources={[response.sourceStatus]} />
    </div>
  );
}
