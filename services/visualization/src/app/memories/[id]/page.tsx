import type { Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { GovernancePanel } from "@/features/memory-catalog/governance-panel";
import { getMemoryDetail } from "@/features/memory-catalog/service";
import { formatTimestamp } from "@/lib/format";

function statusTone(status: string) {
  if (status === "active") {
    return "success";
  }

  if (status === "pending_confirmation") {
    return "warning";
  }

  if (status === "deleted") {
    return "danger";
  }

  return "neutral";
}

export default async function MemoryDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getMemoryDetail(id);

  return (
    <div className="space-y-6">
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">记忆详情</p>
            <h2 className="font-[var(--font-serif)] text-2xl text-slate-900">
              {detail?.summary ?? "未找到这条记忆"}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              查看已发布的记忆记录，理解它属于全局还是工作区记忆，并在这里执行最基本的治理动作。
            </p>
          </div>
          <Link
            href={"/memories" as Route}
            className="rounded-full border bg-white px-4 py-2 text-sm font-semibold text-slate-700"
          >
            返回目录
          </Link>
        </div>
      </section>

      {detail ? (
        <>
          <section className="panel">
            <div className="panel-body grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-xl border bg-white/80 p-4">
                <div className="text-sm font-semibold text-slate-900">摘要</div>
                <p className="mt-3 text-sm leading-7 text-slate-700">{detail.summary}</p>
                <div className="mt-4 rounded-xl bg-slate-50/80 p-3 text-sm leading-6 text-slate-600">
                  {detail.visibilitySummary}
                </div>
              </div>
              <div className="rounded-xl border bg-white/80 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">状态</div>
                    <div className="mt-1 text-xs text-slate-500">{detail.statusLabel}</div>
                  </div>
                  <StatusBadge tone={statusTone(detail.status)}>{detail.status}</StatusBadge>
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-600">{detail.statusExplanation}</p>
                <div className="mt-4 rounded-xl bg-slate-50/80 p-3 text-sm leading-6 text-slate-600">
                  {detail.scopeExplanation}
                </div>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-body grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border bg-white/80 p-4">
                <div className="text-sm font-semibold text-slate-900">属性</div>
                <dl className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-2">
                  <div>
                    <dt className="font-medium text-slate-900">记忆 ID</dt>
                    <dd>{detail.id}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-900">类型</dt>
                    <dd>{detail.memoryTypeLabel}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-900">作用域</dt>
                    <dd>{detail.scopeLabel}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-900">来源工作区</dt>
                    <dd>{detail.originWorkspaceLabel}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-900">重要度</dt>
                    <dd>{detail.importance ?? "未记录"}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-900">置信度</dt>
                    <dd>{detail.confidence ?? "未记录"}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-900">最近确认时间</dt>
                    <dd>{formatTimestamp(detail.lastConfirmedAt)}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-900">创建时间</dt>
                    <dd>{formatTimestamp(detail.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-900">更新时间</dt>
                    <dd>{formatTimestamp(detail.updatedAt)}</dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-xl border bg-white/80 p-4">
                <div className="text-sm font-semibold text-slate-900">来源</div>
                <dl className="mt-4 space-y-3 text-sm text-slate-600">
                  <div>
                    <dt className="font-medium text-slate-900">来源摘要</dt>
                    <dd>{detail.sourceFormatted}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-900">来源类型</dt>
                    <dd>{detail.sourceType ?? "未知"}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-900">来源引用</dt>
                    <dd>{detail.sourceRef ?? "未知"}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-900">服务名</dt>
                    <dd>{detail.sourceServiceName ?? "未知"}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </section>

          <GovernancePanel detail={detail} />

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">结构化详情</p>
                <h2 className="font-[var(--font-serif)] text-2xl text-slate-900">详情 JSON</h2>
              </div>
            </div>
            <div className="panel-body">
              <pre className="overflow-x-auto rounded-xl border bg-slate-950 p-4 text-sm leading-6 text-slate-100">
                {detail.detailsFormatted}
              </pre>
            </div>
          </section>
        </>
      ) : (
        <EmptyState
          title="未找到这条记忆"
          description="请求的记录不在已发布的存储读模型里。"
        />
      )}
    </div>
  );
}
