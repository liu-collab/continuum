import { EmptyState } from "@/components/empty-state";
import { FilterModalButton } from "@/components/filter-modal";
import { FormField } from "@/components/form-field";
import { HealthModalButton } from "@/components/health-modal";
import { SearchForm } from "@/components/search-form";
import { StatusBadge } from "@/components/status-badge";
import { getGovernanceExecutionDetail, getGovernanceHistory } from "@/features/memory-catalog/service";
import { formatDebugReference, formatTimestamp, formatWorkspaceReference, governanceStatusTone, summarizeGovernanceTarget } from "@/lib/format";

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
    limit: params.limit
  });
  const selectedId = params.executionId ?? response.items[0]?.executionId ?? null;
  const detailResponse = selectedId
    ? await getGovernanceExecutionDetail(selectedId)
    : { detail: null, status: response.sourceStatus };
  const activeCount = [params.workspaceId, params.proposalType, params.executionStatus, params.executionId].filter(Boolean).length;

  return (
    <div className="app-page">
      <section className="tile tile-light">
        <div className="tile-inner">
          <div className="tile-head tile-head-row">
            <div>
              <div className="section-kicker">治理</div>
              <h1 className="tile-title">记忆治理</h1>
              <p className="tile-subtitle">
                查看自动提案、复核决策和最终执行结果。
              </p>
            </div>
            <div className="tile-actions">
              <FilterModalButton activeCount={activeCount} title="筛选治理记录" description="按工作区、动作和执行状态筛选。">
                <SearchForm action="/governance" initialValues={{
                  workspace_id: params.workspaceId,
                  proposal_type: params.proposalType,
                  execution_status: params.executionStatus,
                  limit: String(params.limit)
                }}>
                  <FormField label="工作区" name="workspace_id" placeholder="工作区文件夹或标识" defaultValue={params.workspaceId} />
                  <FormField label="动作" name="proposal_type" defaultValue={params.proposalType} options={[
                    { label: "归档", value: "archive" },
                    { label: "确认", value: "confirm" },
                    { label: "删除", value: "delete" },
                    { label: "降级", value: "downgrade" },
                    { label: "合并", value: "merge" },
                    { label: "解决冲突", value: "resolve_conflict" },
                    { label: "摘要收敛", value: "summarize" }
                  ]} />
                  <FormField label="状态" name="execution_status" defaultValue={params.executionStatus} options={[
                    { label: "执行成功", value: "executed" },
                    { label: "执行失败", value: "failed" },
                    { label: "执行中", value: "executing" },
                    { label: "已提案", value: "proposed" },
                    { label: "已复核", value: "verified" },
                    { label: "已拦截", value: "rejected_by_guard" }
                  ]} />
                  <FormField label="数量" name="limit" type="number" placeholder="50" defaultValue={String(params.limit)} />
                </SearchForm>
              </FilterModalButton>
              <HealthModalButton sources={[response.sourceStatus, detailResponse.status]} label="数据源" />
            </div>
          </div>
        </div>
      </section>

      <section className="tile tile-parchment">
        <div className="tile-inner">
          <div className="master-detail-grid">
            <aside className="panel p-5">
              <div className="section-kicker">最近治理</div>
              {response.items.length > 0 ? (
                <div className="record-list mt-4">
                  {response.items.map((item) => {
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
                        className={`record-link ${item.executionId === selectedId ? "record-link-active" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-[17px] font-semibold leading-[1.24] text-text">{item.proposalTypeLabel}</div>
                            <p className="mt-2 line-clamp-2 text-[14px] leading-[1.43] text-muted">{item.reasonText}</p>
                          </div>
                          <StatusBadge tone={governanceStatusTone(item.executionStatus)}>{item.executionStatusLabel}</StatusBadge>
                        </div>
                        {item.verificationBlocked ? (
                          <div className="notice notice-warning mt-3">
                            阻塞：{item.verificationBlockedReason ?? "等待复核"}
                          </div>
                        ) : null}
                        <div className="mt-3 text-[14px] leading-[1.43] text-muted-foreground">
                          {formatTimestamp(item.startedAt)}
                        </div>
                      </a>
                    );
                  })}
                </div>
              ) : (
                <EmptyState title="没有治理记录" description={response.sourceStatus.detail ?? "当前筛选条件下没有治理记录。"} />
              )}
            </aside>

            <section className="grid gap-6">
              {detailResponse.detail ? (
                <>
                  <div className="panel p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="section-kicker">详情</div>
                        <h2 className="mt-3 text-[34px] font-semibold leading-[1.12] text-text">
                          {detailResponse.detail.proposalTypeLabel}
                        </h2>
                        <p className="mt-4 text-[17px] leading-[1.47] text-muted">
                          {detailResponse.detail.reasonText}
                        </p>
                      </div>
                      <StatusBadge tone={governanceStatusTone(detailResponse.detail.executionStatus)}>
                        {detailResponse.detail.executionStatusLabel}
                      </StatusBadge>
                    </div>
                  </div>

                  <div className="detail-grid">
                    <section className="panel p-6">
                      <div className="section-kicker">规划与复核</div>
                      <dl className="kv-grid mt-4">
                        <Row label="规划模型" value={detailResponse.detail.plannerModel} />
                        <Row label="规划置信度" value={String(detailResponse.detail.plannerConfidence ?? "未记录")} />
                        <Row label="需要复核" value={detailResponse.detail.verifierRequired ? "需要" : "不需要"} />
                        <Row label="复核结论" value={detailResponse.detail.verifierDecision ?? "未记录"} />
                        <Row label="已阻塞" value={detailResponse.detail.verificationBlocked ? "是" : "否"} />
                        <Row label="复核模型" value={detailResponse.detail.verifierModel ?? "未记录"} />
                        <Row label="策略版本" value={detailResponse.detail.policyVersion} />
                      </dl>
                    </section>

                    <section className="panel p-6">
                      <div className="section-kicker">执行</div>
                      {detailResponse.detail.verificationBlocked ? (
                        <div className="notice notice-warning mt-4">
                          阻塞：{detailResponse.detail.verificationBlockedReason ?? "等待复核"}
                        </div>
                      ) : null}
                      <dl className="kv-grid mt-4">
                        <Row label="执行记录" value={formatDebugReference(detailResponse.detail.executionId)} />
                        <Row label="提案记录" value={formatDebugReference(detailResponse.detail.proposalId)} />
                        <Row label="工作区" value={formatWorkspaceReference(detailResponse.detail.workspaceId)} />
                        <Row label="开始时间" value={formatTimestamp(detailResponse.detail.startedAt)} />
                        <Row label="完成时间" value={formatTimestamp(detailResponse.detail.finishedAt)} />
                        <Row label="结果" value={detailResponse.detail.resultSummary ?? "未记录"} />
                        <Row label="错误" value={detailResponse.detail.errorMessage ?? "无"} />
                      </dl>
                    </section>
                  </div>

                  <section className="panel p-6">
                    <div className="section-kicker">目标</div>
                    <p className="mt-4 text-[17px] leading-[1.47] text-muted">
                      {summarizeGovernanceTarget(detailResponse.detail.targets)}
                    </p>
                    <div className="record-list mt-5">
                      {detailResponse.detail.targets.map((target, index) => (
                        <div key={`${target.role}-${index}`} className="record-card">
                          <Row label={target.role} value={formatDebugReference(target.recordId ?? target.conflictId)} />
                        </div>
                      ))}
                    </div>
                  </section>

                  <details className="panel p-6">
                    <summary className="cursor-pointer text-[21px] font-semibold leading-[1.19] text-text">
                      内部证据
                    </summary>
                    <div className="detail-grid mt-5">
                      <div>
                        <div className="section-kicker mb-3">建议变更</div>
                        <pre className="quiet-code">{JSON.stringify(detailResponse.detail.suggestedChanges, null, 2)}</pre>
                      </div>
                      <div>
                        <div className="section-kicker mb-3">证据</div>
                        <pre className="quiet-code">{JSON.stringify(detailResponse.detail.evidence, null, 2)}</pre>
                      </div>
                    </div>
                  </details>
                </>
              ) : (
                <EmptyState title="未选择治理记录" description={detailResponse.status.detail ?? "请选择左侧一条治理记录查看详情。"} />
              )}
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="kv-row">
      <dt className="kv-label">{label}</dt>
      <dd className="kv-value">{value}</dd>
    </div>
  );
}
