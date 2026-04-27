import type { Route } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { GovernancePanel } from "@/features/memory-catalog/governance-panel";
import { getMemoryDetail } from "@/features/memory-catalog/service";
import {
  formatTimestamp,
  governanceStatusTone,
} from "@/lib/format";

function statusTone(status: string) {
  if (status === "active") return "success";
  if (status === "pending_confirmation") return "warning";
  if (status === "deleted") return "danger";
  return "neutral";
}

export default async function MemoryDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getMemoryDetail(id);

  if (!detail) {
    return (
      <div className="app-page">
        <section className="tile tile-light">
          <div className="tile-inner-narrow">
            <Link href={"/memories" as Route} className="button-secondary-pill mb-6">
              <ArrowLeft className="h-4 w-4" />
              返回记忆
            </Link>
            <EmptyState title="未找到这条记忆" description="请求的记录不在已发布的存储读模型里。" />
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="app-page">
      <section className="tile tile-light">
        <div className="tile-inner">
          <Link href={"/memories" as Route} className="button-secondary-pill mb-8">
            <ArrowLeft className="h-4 w-4" />
            返回记忆
          </Link>
          <div className="tile-head tile-head-row">
            <div>
              <div className="section-kicker">记忆详情</div>
              <h1 className="tile-title">{detail.summary}</h1>
              <p className="tile-subtitle">{detail.visibilitySummary}</p>
            </div>
            <StatusBadge tone={statusTone(detail.status)}>{detail.statusLabel}</StatusBadge>
          </div>

          <div className="detail-grid">
            <section className="panel p-6">
              <div className="section-kicker">状态</div>
              <p className="mt-4 text-[21px] font-semibold leading-[1.19] text-text">
                {detail.statusExplanation}
              </p>
              <p className="mt-3 text-[17px] leading-[1.47] text-muted">
                {detail.scopeExplanation}
              </p>
            </section>

            <section className="panel p-6">
              <div className="section-kicker">属性</div>
              <dl className="kv-grid mt-4">
                <Row label="类型" value={detail.memoryTypeLabel} />
                <Row label="作用域" value={detail.scopeLabel} />
                <Row label="来源工作区" value={detail.originWorkspaceLabel} />
                <Row label="重要度" value={detail.importance != null ? String(detail.importance) : "未记录"} />
                <Row label="置信度" value={detail.confidence != null ? String(detail.confidence) : "未记录"} />
                <Row label="最近确认" value={formatTimestamp(detail.lastConfirmedAt)} />
                <Row label="创建" value={formatTimestamp(detail.createdAt)} />
                <Row label="更新" value={formatTimestamp(detail.updatedAt)} />
              </dl>
            </section>
          </div>
        </div>
      </section>

      <section className="tile tile-parchment">
        <div className="tile-inner">
          <div className="tile-head">
            <div className="section-kicker">来源</div>
            <h2 className="tile-title">写入依据</h2>
          </div>
          <div className="detail-grid">
            <section className="panel p-6">
              <dl className="kv-grid">
                <Row label="摘要" value={detail.sourceFormatted} />
                <Row label="类型" value={detail.sourceType ?? "未记录"} />
                <Row label="引用" value={detail.sourceRef ?? "未记录"} />
                <Row label="服务" value={detail.sourceServiceName ?? "未记录"} />
                <Row label="来源轮次" value={detail.sourceTurnId ?? "未记录"} />
                <Row label="提取依据" value={detail.extractionBasis ?? "未记录"} />
              </dl>
            </section>
            {detail.sourceExcerpt ? (
              <section className="panel p-6">
                <div className="section-kicker">片段</div>
                <p className="mt-4 text-[17px] leading-[1.47] text-muted">{detail.sourceExcerpt}</p>
              </section>
            ) : null}
          </div>
        </div>
      </section>

      <section className="tile tile-light">
        <div className="tile-inner">
          <div className="tile-head">
            <div className="section-kicker">手动治理</div>
            <h2 className="tile-title">复核与修正</h2>
          </div>
          <GovernancePanel detail={detail} />
        </div>
      </section>

      <section className="tile tile-parchment">
        <div className="tile-inner">
          <div className="tile-head tile-head-row">
            <div>
              <div className="section-kicker">自动治理</div>
              <h2 className="tile-title">历史记录</h2>
              <p className="tile-subtitle">{detail.governanceSummary}</p>
            </div>
            <Link
              href={`/governance?workspace_id=${encodeURIComponent(detail.workspaceId ?? "")}` as Route}
              className="button-secondary-pill"
            >
              查看全部
            </Link>
          </div>

          {detail.governanceHistory.length > 0 ? (
            <div className="record-list">
              {detail.governanceHistory.map((item) => (
                <div key={item.executionId} className="record-card">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-[21px] font-semibold leading-[1.19] text-text">{item.proposalTypeLabel}</h3>
                      <p className="mt-2 text-[17px] leading-[1.47] text-muted">{item.reasonText}</p>
                    </div>
                    <StatusBadge tone={governanceStatusTone(item.executionStatus)}>
                      {item.executionStatusLabel}
                    </StatusBadge>
                  </div>
                  <div className="mt-4 detail-grid">
                    <Row label="目标" value={item.targetSummary} />
                    <Row label="Planner" value={`${item.plannerModel} / ${item.plannerConfidence ?? "未记录"}`} />
                    <Row label="Verifier" value={item.verifierRequired ? item.verifierDecision ?? "待复核" : "不需要"} />
                    <Row label="执行时间" value={formatTimestamp(item.startedAt)} />
                    {item.errorMessage ? <Row label="失败原因" value={item.errorMessage} /> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="还没有治理记录" description="自动治理暂时没有命中过这条记忆。" />
          )}
        </div>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="kv-row">
      <dt className="kv-label">{label}</dt>
      <dd className="kv-value">{String(value)}</dd>
    </div>
  );
}
