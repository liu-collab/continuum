import type { Route } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { GovernancePanel } from "@/features/memory-catalog/governance-panel";
import { getMemoryDetail } from "@/features/memory-catalog/service";
import { formatTimestamp } from "@/lib/format";

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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={"/memories" as Route}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回记忆
          </Link>
          <h1 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
            {detail?.summary ?? "未找到这条记忆"}
          </h1>
        </div>
        {detail ? (
          <StatusBadge tone={statusTone(detail.status)}>{detail.statusLabel}</StatusBadge>
        ) : null}
      </div>

      {detail ? (
        <>
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <div className="rounded-lg border bg-surface p-4">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                摘要
              </div>
              <p className="mt-2 text-sm leading-6 text-foreground">{detail.summary}</p>
              <div className="mt-3 rounded-md border bg-surface-muted/40 p-3 text-xs leading-5 text-muted-foreground">
                {detail.visibilitySummary}
              </div>
            </div>
            <div className="rounded-lg border bg-surface p-4">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                状态
              </div>
              <p className="mt-2 text-sm leading-6 text-foreground">{detail.statusExplanation}</p>
              <div className="mt-3 rounded-md border bg-surface-muted/40 p-3 text-xs leading-5 text-muted-foreground">
                {detail.scopeExplanation}
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border bg-surface p-4">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                属性
              </div>
              <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm md:grid-cols-2">
                <Row label="ID" value={detail.id} />
                <Row label="类型" value={detail.memoryTypeLabel} />
                <Row label="作用域" value={detail.scopeLabel} />
                <Row label="来源工作区" value={detail.originWorkspaceLabel} />
                <Row label="重要度" value={detail.importance != null ? String(detail.importance) : "—"} />
                <Row label="置信度" value={detail.confidence != null ? String(detail.confidence) : "—"} />
                <Row label="最近确认" value={formatTimestamp(detail.lastConfirmedAt)} />
                <Row label="创建" value={formatTimestamp(detail.createdAt)} />
                <Row label="更新" value={formatTimestamp(detail.updatedAt)} />
              </dl>
            </div>
            <div className="rounded-lg border bg-surface p-4">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                来源
              </div>
              <dl className="mt-3 space-y-1 text-sm">
                <Row label="摘要" value={detail.sourceFormatted} />
                <Row label="类型" value={detail.sourceType ?? "—"} />
                <Row label="引用" value={detail.sourceRef ?? "—"} />
                <Row label="服务" value={detail.sourceServiceName ?? "—"} />
              </dl>
            </div>
          </div>

          <GovernancePanel detail={detail} />

          <div className="rounded-lg border bg-surface p-4">
            <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              结构化详情
            </div>
            <pre className="mt-3 overflow-x-auto rounded-md border bg-foreground p-3 text-xs leading-5 text-background">
              {detail.detailsFormatted}
            </pre>
          </div>
        </>
      ) : (
        <EmptyState title="未找到这条记忆" description="请求的记录不在已发布的存储读模型里。" />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-dashed py-1 last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-right text-sm text-foreground">{String(value)}</dd>
    </div>
  );
}
