import { EmptyState } from "@/components/empty-state";
import { FilterBar } from "@/components/filter-bar";
import { FormField } from "@/components/form-field";
import { SearchForm } from "@/components/search-form";
import { SourceHealthPanel } from "@/components/source-health-panel";
import { StatusBadge } from "@/components/status-badge";
import { MemoryTable } from "@/features/memory-catalog/memory-table";
import { describeCatalogEmptyState, getMemoryCatalog } from "@/features/memory-catalog/service";
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

  return (
    <div className="space-y-6">
      <FilterBar
        title="记忆目录"
        description="按当前工作区视图查看已发布的存储读模型记录。这个页面会解释一条记录为什么会出现在当前工作区，以及它属于全局记忆还是工作区记忆。"
      >
        <SearchForm
          action="/memories"
          initialValues={{
            workspace_id: filters.workspaceId,
            user_id: filters.userId,
            task_id: filters.taskId,
            memory_view_mode: filters.memoryViewMode,
            memory_type: filters.memoryType,
            scope: filters.scope,
            status: filters.status,
            updated_from: filters.updatedFrom,
            updated_to: filters.updatedTo
          }}
        >
          <FormField label="工作区" name="workspace_id" placeholder="workspace id" defaultValue={filters.workspaceId} />
          <FormField label="用户" name="user_id" placeholder="user id" defaultValue={filters.userId} />
          <FormField label="任务" name="task_id" placeholder="task id" defaultValue={filters.taskId} />
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
              { label: "全局", value: "user" },
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
      </FilterBar>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">目录结果</p>
            <h2 className="font-[var(--font-serif)] text-2xl text-slate-900">
              当前可见 {response.total} 条记录
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{response.viewSummary}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone={filters.memoryViewMode === "workspace_only" ? "warning" : "neutral"}>
              {memoryViewModeLabel(filters.memoryViewMode)}
            </StatusBadge>
            <StatusBadge
              tone={response.sourceStatus.status === "healthy" ? "success" : response.sourceStatus.status === "partial" ? "warning" : "danger"}
            >
              {response.sourceStatus.label}: {response.sourceStatus.status}
            </StatusBadge>
          </div>
        </div>
        <div className="panel-body space-y-4">
          {response.viewWarnings.length > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900">
              {response.viewWarnings.join(" ")}
            </div>
          ) : null}
          {response.items.length > 0 ? (
            <MemoryTable items={response.items} />
          ) : (
            <EmptyState title={emptyState.title} description={emptyState.description} />
          )}
        </div>
      </section>

      <SourceHealthPanel title="目录数据源健康" sources={[response.sourceStatus]} />
    </div>
  );
}
