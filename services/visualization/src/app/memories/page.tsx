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
  const emptyState = describeCatalogEmptyState(response);
  const quickViews = buildMemoryCatalogQuickViews(filters);
  const filterHints = describeCatalogFilterHints(filters);

  const activeFilterCount = Object.values(filters).filter((value) => Boolean(value)).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">记忆</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            共 {response.total} 条
            <span className="ml-2 text-xs">· {memoryViewModeLabel(filters.memoryViewMode)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterModalButton
            activeCount={activeFilterCount}
            title="筛选记忆"
            description="按工作区、任务、类型、作用域、状态与更新时间过滤。"
          >
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
              <FormField label="工作区" name="workspace_id" placeholder="workspace id" defaultValue={filters.workspaceId} />
              <FormField label="任务" name="task_id" placeholder="task id" defaultValue={filters.taskId} />
              <FormField label="会话" name="session_id" placeholder="session id" defaultValue={filters.sessionId} />
              <FormField label="来源引用" name="source_ref" placeholder="turn id / source ref" defaultValue={filters.sourceRef} />
              <FormField
                label="视图模式"
                name="memory_view_mode"
                defaultValue={filters.memoryViewMode}
                options={[
                  { label: "工作区 + 全局", value: "workspace_plus_global" },
                  { label: "仅工作区", value: "workspace_only" }
                ]}
              />
              <FormField
                label="记忆类型"
                name="memory_type"
                defaultValue={filters.memoryType}
                options={[
                  { label: "事实与偏好", value: "fact_preference" },
                  { label: "任务状态", value: "task_state" },
                  { label: "情景记忆", value: "episodic" }
                ]}
              />
              <FormField
                label="作用域"
                name="scope"
                defaultValue={filters.scope}
                options={[
                  { label: "会话", value: "session" },
                  { label: "任务", value: "task" },
                  { label: "平台", value: "user" },
                  { label: "工作区", value: "workspace" }
                ]}
              />
              <FormField
                label="状态"
                name="status"
                defaultValue={filters.status}
                options={[
                  { label: "生效中", value: "active" },
                  { label: "待确认", value: "pending_confirmation" },
                  { label: "已被替代", value: "superseded" },
                  { label: "已归档", value: "archived" },
                  { label: "已删除", value: "deleted" }
                ]}
              />
              <FormField label="起始更新时间" name="updated_from" type="date" defaultValue={filters.updatedFrom} />
              <FormField label="结束更新时间" name="updated_to" type="date" defaultValue={filters.updatedTo} />
            </SearchForm>
          </FilterModalButton>
          <HealthModalButton sources={[response.sourceStatus]} label="数据源" />
        </div>
      </div>

      <section className="rounded-lg border bg-surface p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-sm font-medium text-foreground">快捷视图</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              不用手动改查询参数，直接切到常用的记忆视图。
            </p>
          </div>
          {filterHints.length > 0 ? (
            <div className="text-xs text-amber-700">
              {filterHints.join(" ")}
            </div>
          ) : null}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {quickViews.map((view) => (
            <Link
              key={view.key}
              href={view.href}
              className={`rounded-lg border px-4 py-3 text-left transition hover:border-border-strong ${
                view.active ? "border-accent bg-accent-soft" : "bg-surface"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">{view.label}</span>
                {view.active ? <StatusBadge tone="success">当前</StatusBadge> : null}
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{view.description}</p>
            </Link>
          ))}
        </div>
      </section>

      {response.viewWarnings.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {response.viewWarnings.join(" ")}
        </div>
      ) : null}

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <StatusBadge
            tone={
              response.sourceStatus.status === "healthy"
                ? "success"
                : response.sourceStatus.status === "partial"
                  ? "warning"
                  : "danger"
            }
          >
            {response.sourceStatus.label}: {response.sourceStatus.status}
          </StatusBadge>
          <span>{response.viewSummary}</span>
        </div>
        {response.items.length > 0 ? (
          <MemoryTable items={response.items} />
        ) : (
          <EmptyState title={emptyState.title} description={emptyState.description} />
        )}
      </div>
    </div>
  );
}
