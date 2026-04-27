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
  const views = buildMemoryCatalogQuickViews(filters);
  const hints = describeCatalogFilterHints(filters);
  const activeCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="app-page">
      <section className="tile tile-light">
        <div className="tile-inner">
          <div className="tile-head tile-head-row">
            <div>
              <div className="section-kicker">记忆库</div>
              <h1 className="tile-title">记忆目录</h1>
              <p className="tile-subtitle">
                查看已经结构化的偏好、任务状态和情景记忆。
              </p>
            </div>
            <div className="tile-actions">
              <FilterModalButton activeCount={activeCount} title="筛选记忆" description="按工作区、任务、类型、作用域、状态和更新时间筛选。">
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
                  <FormField label="视图" name="memory_view_mode" defaultValue={filters.memoryViewMode} options={[
                    { label: "工作区 + 平台", value: "workspace_plus_global" },
                    { label: "仅工作区", value: "workspace_only" }
                  ]} />
                  <FormField label="类型" name="memory_type" defaultValue={filters.memoryType} options={[
                    { label: "事实与偏好", value: "fact_preference" },
                    { label: "任务状态", value: "task_state" },
                    { label: "情景记忆", value: "episodic" }
                  ]} />
                  <FormField label="作用域" name="scope" defaultValue={filters.scope} options={[
                    { label: "会话", value: "session" },
                    { label: "任务", value: "task" },
                    { label: "平台", value: "user" },
                    { label: "工作区", value: "workspace" }
                  ]} />
                  <FormField label="状态" name="status" defaultValue={filters.status} options={[
                    { label: "生效中", value: "active" },
                    { label: "待确认", value: "pending_confirmation" },
                    { label: "已被替代", value: "superseded" },
                    { label: "已归档", value: "archived" },
                    { label: "已删除", value: "deleted" }
                  ]} />
                  <FormField label="更新开始" name="updated_from" type="date" defaultValue={filters.updatedFrom} />
                  <FormField label="更新结束" name="updated_to" type="date" defaultValue={filters.updatedTo} />
                </SearchForm>
              </FilterModalButton>
              <HealthModalButton sources={[response.sourceStatus]} label="数据源" />
            </div>
          </div>

          <div className="stat-grid">
            <SummaryCard label="记录总数" value={response.total.toLocaleString()} />
            <SummaryCard label="当前视图" value={memoryViewModeLabel(filters.memoryViewMode)} />
            <SummaryCard label="待确认" value={response.pendingConfirmationCount.toLocaleString()} tone={response.pendingConfirmationCount > 0 ? "warning" : "neutral"} />
          </div>

          {hints.length > 0 ? (
            <div className="notice notice-warning mt-6">{hints.join(" ")}</div>
          ) : null}
          {response.viewWarnings.length > 0 ? (
            <div className="notice notice-warning mt-3">{response.viewWarnings.join(" ")}</div>
          ) : null}
          {response.pendingConfirmationCount > 0 && filters.status !== "pending_confirmation" ? (
            <div className="notice notice-warning mt-3">
              还有 {response.pendingConfirmationCount} 条待确认记忆，可以切到待确认队列集中处理。
            </div>
          ) : null}
        </div>
      </section>

      <section className="tile tile-dark">
        <div className="tile-inner">
          <div className="tile-head">
            <div className="section-kicker">视图</div>
            <h2 className="tile-title">常用入口</h2>
            <p className="tile-subtitle">
              先按用户最常用的使用方式切换，再用筛选做精确定位。
            </p>
          </div>
          <div className="utility-grid">
            {views.map((view) => (
              <Link
                key={view.key}
                href={view.href}
                className={`record-link ${view.active ? "record-link-active" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-[21px] font-semibold leading-[1.19] text-text">{view.label}</h3>
                  {view.active ? <StatusBadge tone="success">当前</StatusBadge> : null}
                </div>
                <p className="mt-3 text-[17px] leading-[1.47] text-muted">{view.description}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="tile tile-parchment">
        <div className="tile-inner">
          <div className="tile-head tile-head-row">
            <div>
              <div className="section-kicker">记录</div>
              <h2 className="tile-title">当前结果</h2>
              <p className="tile-subtitle">{response.viewSummary}</p>
            </div>
            <StatusBadge tone={response.sourceStatus.status === "healthy" ? "success" : response.sourceStatus.status === "partial" ? "warning" : "danger"}>
              {response.sourceStatus.label}: {response.sourceStatus.status}
            </StatusBadge>
          </div>
          {response.items.length > 0 ? (
            <MemoryTable items={response.items} />
          ) : (
            <EmptyState title={emptyState.title} description={emptyState.description} />
          )}
        </div>
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warning";
}) {
  return (
    <div className="panel p-6">
      <div className="text-[14px] font-semibold leading-[1.29] text-muted-foreground">{label}</div>
      <div className="mt-4 text-[40px] font-semibold leading-[1.1] text-text">{value}</div>
      {tone === "warning" ? <div className="notice notice-warning mt-4">需要复核</div> : null}
    </div>
  );
}
