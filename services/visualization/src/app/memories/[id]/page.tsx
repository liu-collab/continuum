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
            <p className="eyebrow">Memory detail</p>
            <h2 className="font-[var(--font-serif)] text-2xl text-slate-900">
              {detail?.summary ?? "Memory not found"}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Inspect the published memory record, understand whether it is global or workspace memory, and run the minimum governance actions from this page.
            </p>
          </div>
          <Link
            href={"/memories" as Route}
            className="rounded-full border bg-white px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Back to catalog
          </Link>
        </div>
      </section>

      {detail ? (
        <>
          <section className="panel">
            <div className="panel-body grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-xl border bg-white/80 p-4">
                <div className="text-sm font-semibold text-slate-900">Summary</div>
                <p className="mt-3 text-sm leading-7 text-slate-700">{detail.summary}</p>
                <div className="mt-4 rounded-xl bg-slate-50/80 p-3 text-sm leading-6 text-slate-600">
                  {detail.visibilitySummary}
                </div>
              </div>
              <div className="rounded-xl border bg-white/80 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Status</div>
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
                <div className="text-sm font-semibold text-slate-900">Attributes</div>
                <dl className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-2">
                  <div>
                    <dt className="font-medium text-slate-900">Memory id</dt>
                    <dd>{detail.id}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-900">Type</dt>
                    <dd>{detail.memoryTypeLabel}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-900">Scope</dt>
                    <dd>{detail.scopeLabel}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-900">Origin workspace</dt>
                    <dd>{detail.originWorkspaceLabel}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-900">Importance</dt>
                    <dd>{detail.importance ?? "Not available"}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-900">Confidence</dt>
                    <dd>{detail.confidence ?? "Not available"}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-900">Last confirmed</dt>
                    <dd>{formatTimestamp(detail.lastConfirmedAt)}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-900">Created</dt>
                    <dd>{formatTimestamp(detail.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-900">Updated</dt>
                    <dd>{formatTimestamp(detail.updatedAt)}</dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-xl border bg-white/80 p-4">
                <div className="text-sm font-semibold text-slate-900">Source</div>
                <dl className="mt-4 space-y-3 text-sm text-slate-600">
                  <div>
                    <dt className="font-medium text-slate-900">Source summary</dt>
                    <dd>{detail.sourceFormatted}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-900">Source type</dt>
                    <dd>{detail.sourceType ?? "Unknown"}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-900">Source ref</dt>
                    <dd>{detail.sourceRef ?? "Unknown"}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-900">Service name</dt>
                    <dd>{detail.sourceServiceName ?? "Unknown"}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </section>

          <GovernancePanel detail={detail} />

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Structured details</p>
                <h2 className="font-[var(--font-serif)] text-2xl text-slate-900">Details JSON</h2>
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
          title="Memory not found"
          description="The requested record is not present in the published storage read model."
        />
      )}
    </div>
  );
}
