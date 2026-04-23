import { EmptyState } from "@/components/empty-state";
import { FilterModalButton } from "@/components/filter-modal";
import { FormField } from "@/components/form-field";
import { HealthModalButton } from "@/components/health-modal";
import { SearchForm } from "@/components/search-form";
import { StatusBadge } from "@/components/status-badge";
import {
  getGovernanceExecutionDetail,
  getGovernanceHistory,
} from "@/features/memory-catalog/service";
import {
  formatTimestamp,
  governanceStatusTone,
  summarizeGovernanceTarget,
} from "@/lib/format";

function parseSearchParams(input: Record<string, string | string[] | undefined>) {
  const valueOf = (key: string) => {
    const value = input[key];
    return Array.isArray(value) ? value[0] : value;
  };

  return {
    workspaceId: valueOf("workspace_id"),
    proposalType: valueOf("proposal_type"),
    executionStatus: valueOf("execution_status"),
    executionId: valueOf("execution_id"),
    limit: Number.parseInt(valueOf("limit") ?? "50", 10) || 50,
  };
}

function renderJson(value: Record<string, unknown>) {
  return JSON.stringify(value, null, 2);
}

export default async function GovernancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = parseSearchParams(await searchParams);
  const response = await getGovernanceHistory({
    workspaceId: params.workspaceId,
    proposalType: params.proposalType,
    executionStatus: params.executionStatus,
    limit: params.limit,
  });
  const selectedId = params.executionId ?? response.items[0]?.executionId ?? null;
  const detailResult = selectedId
    ? await getGovernanceExecutionDetail(selectedId)
    : { detail: null, status: response.sourceStatus };
  const activeFilterCount = Object.values(params).filter(
    (value, index) => Boolean(value) && index < 4,
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">治理</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            自动治理提案、模型复核和执行结果。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterModalButton
            activeCount={activeFilterCount}
            title="筛选治理历史"
            description="按工作区、动作和执行状态过滤。"
          >
            <SearchForm
              action="/governance"
              initialValues={{
                workspace_id: params.workspaceId,
                proposal_type: params.proposalType,
                execution_status: params.executionStatus,
                limit: String(params.limit),
              }}
            >
              <FormField label="工作区" name="workspace_id" placeholder="workspace id" defaultValue={params.workspaceId} />
              <FormField
                label="动作"
                name="proposal_type"
                defaultValue={params.proposalType}
                options={[
                  { label: "归档", value: "archive" },
                  { label: "确认", value: "confirm" },
                  { label: "软删除", value: "delete" },
                  { label: "降级", value: "downgrade" },
                  { label: "合并", value: "merge" },
                  { label: "解决冲突", value: "resolve_conflict" },
                  { label: "摘要收敛", value: "summarize" },
                ]}
              />
              <FormField
                label="状态"
                name="execution_status"
                defaultValue={params.executionStatus}
                options={[
                  { label: "执行成功", value: "executed" },
                  { label: "执行失败", value: "failed" },
                  { label: "执行中", value: "executing" },
                  { label: "已提案", value: "proposed" },
                  { label: "已复核", value: "verified" },
                  { label: "已拦截", value: "rejected_by_guard" },
                ]}
              />
              <FormField label="数量" name="limit" placeholder="50" defaultValue={String(params.limit)} />
            </SearchForm>
          </FilterModalButton>
          <HealthModalButton
            sources={[response.sourceStatus, detailResult.status]}
            label="治理数据源"
          />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[24rem_minmax(0,1fr)]">
        <section className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            最近治理
          </div>
          <div className="space-y-2">
            {response.items.length > 0 ? (
              response.items.map((item) => {
                const href = `/governance?${new URLSearchParams({
                  ...(params.workspaceId ? { workspace_id: params.workspaceId } : {}),
                  ...(params.proposalType ? { proposal_type: params.proposalType } : {}),
                  ...(params.executionStatus ? { execution_status: params.executionStatus } : {}),
                  limit: String(params.limit),
                  execution_id: item.executionId,
                }).toString()}`;

                return (
                  <a
                    key={item.executionId}
                    href={href}
                    className={`block rounded-lg border bg-surface p-3 transition hover:border-border-strong ${
                      item.executionId === selectedId ? "border-accent bg-accent-soft" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">
                          {item.proposalTypeLabel}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {item.executionId}
                        </div>
                      </div>
                      <StatusBadge tone={governanceStatusTone(item.executionStatus)}>
                        {item.executionStatusLabel}
                      </StatusBadge>
                    </div>
                    <div className="mt-2 text-xs leading-5 text-muted-foreground line-clamp-2">
                      {item.reasonText}
                    </div>
                    {item.verificationBlocked ? (
                      <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
                        Verifier 阻塞: {item.verificationBlockedReason ?? "等待复核"}
                      </div>
                    ) : null}
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      {formatTimestamp(item.startedAt)}
                    </div>
                  </a>
                );
              })
            ) : (
              <EmptyState
                title="没有治理记录"
                description={response.sourceStatus.detail ?? "当前筛选条件下没有自动治理执行记录。"}
              />
            )}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                治理详情
              </div>
              <div className="mt-1 text-base font-semibold text-foreground">
                {detailResult.detail?.proposalTypeLabel ?? "未选择执行记录"}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {detailResult.detail?.reasonText ?? "从左侧选择一条治理执行记录。"}
              </p>
            </div>
            {detailResult.detail ? (
              <StatusBadge tone={governanceStatusTone(detailResult.detail.executionStatus)}>
                {detailResult.detail.executionStatusLabel}
              </StatusBadge>
            ) : null}
          </div>

          {detailResult.detail ? (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border bg-surface p-4">
                  <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Planner / Verifier
                  </div>
                  <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm">
                    <Row label="Planner 模型" value={detailResult.detail.plannerModel} />
                    <Row label="Planner 置信度" value={String(detailResult.detail.plannerConfidence ?? "—")} />
                    <Row label="Verifier 必需" value={detailResult.detail.verifierRequired ? "是" : "否"} />
                    <Row label="Verifier 结论" value={detailResult.detail.verifierDecision ?? "—"} />
                    <Row label="阻塞状态" value={detailResult.detail.verificationBlocked ? "已阻塞" : "未阻塞"} />
                    <Row label="Verifier 置信度" value={String(detailResult.detail.verifierConfidence ?? "—")} />
                    <Row label="Verifier 模型" value={detailResult.detail.verifierModel ?? "—"} />
                    <Row label="Verifier 备注" value={detailResult.detail.verifierNotes ?? "—"} />
                    <Row label="Policy" value={detailResult.detail.policyVersion} />
                  </dl>
                </div>

                <div className="rounded-lg border bg-surface p-4">
                  <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Storage 执行
                  </div>
                  {detailResult.detail.verificationBlocked ? (
                    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      当前治理动作被 verifier 阻塞: {detailResult.detail.verificationBlockedReason ?? "等待复核"}
                    </div>
                  ) : null}
                  <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm">
                    <Row label="Execution id" value={detailResult.detail.executionId} />
                    <Row label="Proposal id" value={detailResult.detail.proposalId} />
                    <Row label="工作区" value={detailResult.detail.workspaceId} />
                    <Row label="来源服务" value={detailResult.detail.sourceService} />
                    <Row label="开始" value={formatTimestamp(detailResult.detail.startedAt)} />
                    <Row label="结束" value={formatTimestamp(detailResult.detail.finishedAt)} />
                    <Row label="结果" value={detailResult.detail.resultSummary ?? "—"} />
                    <Row label="失败原因" value={detailResult.detail.errorMessage ?? "—"} />
                  </dl>
                </div>
              </div>

              <div className="rounded-lg border bg-surface p-4">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  命中目标
                </div>
                <div className="mt-3 rounded-md border bg-surface-muted/40 p-3 text-sm text-muted-foreground">
                  {summarizeGovernanceTarget(detailResult.detail.targets)}
                </div>
                <div className="mt-3 grid gap-2 text-sm">
                  {detailResult.detail.targets.map((target, index) => (
                    <div key={`${target.role}-${target.recordId ?? target.conflictId ?? index}`} className="rounded-md border px-3 py-2">
                      <div className="font-medium text-foreground">{target.role}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {target.recordId ?? target.conflictId ?? "未记录目标 id"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border bg-surface p-4">
                  <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Suggested Changes
                  </div>
                  <pre className="mt-3 overflow-x-auto rounded-md border bg-foreground p-3 text-xs leading-5 text-background">
                    {renderJson(detailResult.detail.suggestedChanges)}
                  </pre>
                </div>

                <div className="rounded-lg border bg-surface p-4">
                  <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Evidence
                  </div>
                  {detailResult.detail.deleteReason ? (
                    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      删除原因: {detailResult.detail.deleteReason}
                    </div>
                  ) : null}
                  <pre className="mt-3 overflow-x-auto rounded-md border bg-foreground p-3 text-xs leading-5 text-background">
                    {renderJson(detailResult.detail.evidence)}
                  </pre>
                </div>
              </div>
            </>
          ) : (
            <EmptyState
              title="未找到治理详情"
              description={detailResult.status.detail ?? "当前没有可展示的治理执行详情。"}
            />
          )}
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
