import type { Route } from "next";
import Link from "next/link";
import React from "react";
import { ArrowLeft } from "lucide-react";

import { DetailRow } from "@/components/detail-row";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { GovernancePanel } from "@/features/memory-catalog/governance-panel";
import { getMemoryDetail } from "@/features/memory-catalog/service";
import {
  formatDebugReference,
  formatTimestamp,
  governanceStatusTone,
} from "@/lib/format";
import type { AppLocale } from "@/lib/i18n/messages";
import { getServerTranslator } from "@/lib/i18n/server";

function statusTone(status: string) {
  if (status === "active") return "success";
  if (status === "pending_confirmation") return "warning";
  if (status === "deleted") return "danger";
  return "neutral";
}

function linkedDebugReference(value: string | null | undefined, href: Route | null, locale: AppLocale) {
  const label = formatDebugReference(value, locale);

  if (!value || !href) {
    return label;
  }

  return (
    <Link href={href} className="text-[var(--primary)] underline underline-offset-2" title={value}>
      {label}
    </Link>
  );
}

export default async function MemoryDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { locale, t } = await getServerTranslator();
  const { id } = await params;
  const detail = await getMemoryDetail(id);

  if (!detail) {
    return (
      <div className="app-page">
        <section className="tile tile-light">
          <div className="tile-inner-narrow">
            <Link href={"/memories" as Route} className="button-secondary-pill mb-6">
              <ArrowLeft className="h-4 w-4" />
              {t("memories.detail.back")}
            </Link>
            <EmptyState title={t("memories.detail.notFoundTitle")} description={t("memories.detail.notFoundDescription")} />
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
            {t("memories.detail.back")}
          </Link>
          <div className="tile-head tile-head-row">
            <div>
              <div className="section-kicker">{t("memories.detail.kicker")}</div>
              <h1 className="tile-title">{detail.summary}</h1>
              <p className="tile-subtitle">{detail.visibilitySummary}</p>
            </div>
            <StatusBadge tone={statusTone(detail.status)}>{detail.statusLabel}</StatusBadge>
          </div>

          <div className="detail-grid">
            <section className="panel p-6">
              <div className="section-kicker">{t("memories.detail.status")}</div>
              <p className="mt-4 text-[21px] font-semibold leading-[1.19] text-text">
                {detail.statusExplanation}
              </p>
              <p className="mt-3 text-[17px] leading-[1.47] text-muted">
                {detail.scopeExplanation}
              </p>
            </section>

            <section className="panel p-6">
              <div className="section-kicker">{t("memories.detail.attributes")}</div>
              <dl className="kv-grid mt-4">
                <DetailRow label={t("memories.fields.type")} value={detail.memoryTypeLabel} />
                <DetailRow label={t("memories.fields.scope")} value={detail.scopeLabel} />
                <DetailRow label={t("memories.detail.originWorkspace")} value={detail.originWorkspaceLabel} />
                <DetailRow label={t("memories.detail.importance")} value={detail.importance != null ? String(detail.importance) : t("common.notRecorded")} />
                <DetailRow label={t("memories.detail.confidence")} value={detail.confidence != null ? String(detail.confidence) : t("common.notRecorded")} />
                <DetailRow label={t("memories.detail.lastConfirmed")} value={formatTimestamp(detail.lastConfirmedAt, locale)} />
                <DetailRow label={t("memories.detail.created")} value={formatTimestamp(detail.createdAt, locale)} />
                <DetailRow label={t("memories.detail.updated")} value={formatTimestamp(detail.updatedAt, locale)} />
              </dl>
            </section>
          </div>
        </div>
      </section>

      <section className="tile tile-parchment">
        <div className="tile-inner">
          <div className="tile-head">
            <div className="section-kicker">{t("memories.detail.sourceKicker")}</div>
            <h2 className="tile-title">{t("memories.detail.sourceTitle")}</h2>
          </div>
          <div className="detail-grid">
            <section className="panel p-6">
              <dl className="kv-grid">
                <DetailRow label={t("memories.detail.summary")} value={detail.sourceFormatted} />
                <DetailRow label={t("memories.fields.type")} value={detail.sourceType ?? t("common.notRecorded")} />
                <DetailRow
                  label={t("memories.fields.source")}
                  value={linkedDebugReference(
                    detail.sourceRef,
                    detail.sourceRef ? (`/runs?turn_id=${encodeURIComponent(detail.sourceRef)}` as Route) : null,
                    locale
                  )}
                />
                <DetailRow label={t("memories.detail.service")} value={detail.sourceServiceName ?? t("common.notRecorded")} />
                <DetailRow
                  label={t("memories.detail.sourceTurn")}
                  value={linkedDebugReference(
                    detail.sourceTurnId,
                    detail.sourceTurnId ? (`/runs?turn_id=${encodeURIComponent(detail.sourceTurnId)}` as Route) : null,
                    locale
                  )}
                />
                <DetailRow label={t("memories.detail.extractionBasis")} value={detail.extractionBasis ?? t("common.notRecorded")} />
              </dl>
            </section>
            {detail.sourceExcerpt ? (
              <section className="panel p-6">
                <div className="section-kicker">{t("memories.detail.excerpt")}</div>
                <p className="mt-4 text-[17px] leading-[1.47] text-muted">{detail.sourceExcerpt}</p>
              </section>
            ) : null}
          </div>
        </div>
      </section>

      <section className="tile tile-light">
        <div className="tile-inner">
          <div className="tile-head">
            <div className="section-kicker">{t("memories.detail.manualGovernanceKicker")}</div>
            <h2 className="tile-title">{t("memories.detail.manualGovernanceTitle")}</h2>
          </div>
          <GovernancePanel detail={detail} />
        </div>
      </section>

      <section className="tile tile-parchment">
        <div className="tile-inner">
          <div className="tile-head tile-head-row">
            <div>
              <div className="section-kicker">{t("memories.detail.autoGovernanceKicker")}</div>
              <h2 className="tile-title">{t("memories.detail.autoGovernanceTitle")}</h2>
              <p className="tile-subtitle">{detail.governanceSummary}</p>
            </div>
            <Link
              href={`/governance?workspace_id=${encodeURIComponent(detail.workspaceId ?? "")}` as Route}
              className="button-secondary-pill"
            >
              {t("memories.detail.viewAll")}
            </Link>
          </div>

          {detail.governanceHistory.length > 0 ? (
            <div className="record-list">
              {detail.governanceHistory.map((item) => (
                <Link
                  key={item.executionId}
                  href={`/governance?workspace_id=${encodeURIComponent(detail.workspaceId ?? "")}&execution_id=${encodeURIComponent(item.executionId)}` as Route}
                  className="record-card"
                >
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
                    <DetailRow label={t("memories.detail.target")} value={item.targetSummary} />
                    <DetailRow label={t("memories.detail.planner")} value={`${item.plannerModel} / ${item.plannerConfidence ?? t("common.notRecorded")}`} />
                    <DetailRow label={t("memories.detail.verifier")} value={item.verifierRequired ? item.verifierDecision ?? t("common.pendingReview") : t("common.notNeeded")} />
                    <DetailRow label={t("memories.detail.executionTime")} value={formatTimestamp(item.startedAt, locale)} />
                    {item.errorMessage ? <DetailRow label={t("memories.detail.failureReason")} value={item.errorMessage} /> : null}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState title={t("memories.detail.emptyGovernanceTitle")} description={t("memories.detail.emptyGovernanceDescription")} />
          )}
        </div>
      </section>
    </div>
  );
}
