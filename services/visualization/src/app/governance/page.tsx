import Link from "next/link";
import type { Route } from "next";
import React from "react";

import { DetailRow } from "@/components/detail-row";
import { EmptyState } from "@/components/empty-state";
import { FilterModalButton } from "@/components/filter-modal";
import { FormField } from "@/components/form-field";
import { HealthModalButton } from "@/components/health-modal";
import { SearchForm } from "@/components/search-form";
import { StatusBadge } from "@/components/status-badge";
import { getGovernanceExecutionDetail, getGovernanceHistory } from "@/features/memory-catalog/service";
import type { GovernanceExecutionDetail } from "@/lib/contracts";
import { formatDebugReference, formatTimestamp, formatWorkspaceReference, governanceStatusTone, summarizeGovernanceTarget } from "@/lib/format";
import { getServerTranslator } from "@/lib/i18n/server";
import { fetchRuntimeGovernanceConfig } from "@/lib/server/runtime-observe-client";

type TFunction = (key: string, variables?: Record<string, string | number>) => string;

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

function targetReferenceLink(
  target: { recordId: string | null; conflictId: string | null },
  locale: "zh-CN" | "en-US"
) {
  const value = target.recordId ?? target.conflictId;
  const label = formatDebugReference(value, locale);

  if (!target.recordId) {
    return label;
  }

  return (
    <Link
      href={`/memories/${encodeURIComponent(target.recordId)}` as Route}
      className="text-[var(--primary)] underline underline-offset-2"
      title={target.recordId}
    >
      {label}
    </Link>
  );
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readEvidenceReason(evidence: GovernanceExecutionDetail["evidence"], ...keys: string[]) {
  for (const key of keys) {
    const value = evidence[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

function hasEvidence(evidence: GovernanceExecutionDetail["evidence"]) {
  return Object.keys(evidence).length > 0;
}

function GovernanceEvidence({
  proposalType,
  evidence,
  t
}: {
  proposalType: string;
  evidence: GovernanceExecutionDetail["evidence"];
  t: TFunction;
}) {
  if (!hasEvidence(evidence)) {
    return (
      <p className="text-[14px] leading-[1.43] text-muted" data-testid="governance-evidence-empty">
        {t("governance.evidenceFormatted.empty")}
      </p>
    );
  }

  if (proposalType === "merge") {
    const mergedFrom = readStringList(evidence["merged_from"] ?? evidence["mergedFrom"]);
    return (
      <p className="text-[14px] leading-[1.43] text-muted" data-testid="governance-evidence-formatted">
        {t("governance.evidenceFormatted.merge", { count: mergedFrom.length })}
      </p>
    );
  }

  if (proposalType === "archive") {
    const reason = readEvidenceReason(evidence, "archive_reason", "archiveReason", "reason");
    return (
      <p className="text-[14px] leading-[1.43] text-muted" data-testid="governance-evidence-formatted">
        {t("governance.evidenceFormatted.archive", { reason: reason ?? t("governance.evidenceFormatted.missingReason") })}
      </p>
    );
  }

  if (proposalType === "delete") {
    const reason = readEvidenceReason(evidence, "delete_reason", "deleteReason", "reason");
    return (
      <div className="notice notice-warning" data-testid="governance-evidence-formatted">
        {t("governance.evidenceFormatted.delete", { reason: reason ?? t("governance.evidenceFormatted.missingReason") })}
      </div>
    );
  }

  if (proposalType === "summarize") {
    const sourceRecordIds = readStringList(evidence["source_record_ids"] ?? evidence["sourceRecordIds"]);
    return (
      <p className="text-[14px] leading-[1.43] text-muted" data-testid="governance-evidence-formatted">
        {t("governance.evidenceFormatted.summarize", { count: sourceRecordIds.length })}
      </p>
    );
  }

  return (
    <details className="record-card" data-testid="governance-evidence-raw">
      <summary className="cursor-pointer text-[17px] font-semibold leading-[1.24] text-text">
        {t("governance.evidenceFormatted.rawSummary")}
      </summary>
      <p className="mt-3 text-[14px] leading-[1.43] text-muted">
        {t("governance.evidenceFormatted.unknown")}
      </p>
      <pre className="quiet-code mt-4">{JSON.stringify(evidence, null, 2)}</pre>
    </details>
  );
}

export default async function GovernancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, t } = await getServerTranslator();
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
  const runtimeConfigResponse = await fetchRuntimeGovernanceConfig({ locale });
  const activeCount = [params.workspaceId, params.proposalType, params.executionStatus, params.executionId].filter(Boolean).length;
  const governanceConfig = runtimeConfigResponse.governance;
  const governanceSummary = governanceConfig
    ? [
        `${t("governance.autoConfig.status")}: ${governanceConfig.WRITEBACK_MAINTENANCE_ENABLED ? t("common.yes") : t("common.noValue")}`,
        `${t("governance.autoConfig.interval")}: ${Math.max(1, Math.round(governanceConfig.WRITEBACK_MAINTENANCE_INTERVAL_MS / 60000))} ${t("governance.autoConfig.minutes")}`,
        `${t("governance.autoConfig.verifier")}: ${governanceConfig.WRITEBACK_GOVERNANCE_VERIFY_ENABLED ? t("common.yes") : t("common.noValue")}`,
        `${t("governance.autoConfig.shadow")}: ${governanceConfig.WRITEBACK_GOVERNANCE_SHADOW_MODE ? t("common.yes") : t("common.noValue")}`,
        `${t("governance.autoConfig.maxActions")}: ${governanceConfig.WRITEBACK_MAINTENANCE_MAX_ACTIONS}`
      ]
    : [runtimeConfigResponse.status.detail ?? t("common.unavailable")];

  return (
    <div className="app-page">
      <section className="tile tile-light">
        <div className="tile-inner">
          <div className="tile-head tile-head-row">
            <div>
              <div className="section-kicker">{t("governance.kicker")}</div>
              <h1 className="tile-title">{t("governance.title")}</h1>
              <p className="tile-subtitle">{t("governance.subtitle")}</p>
            </div>
            <div className="tile-actions">
              <FilterModalButton activeCount={activeCount} title={t("governance.filterTitle")} description={t("governance.filterDescription")}>
                <SearchForm action="/governance" initialValues={{
                  workspace_id: params.workspaceId,
                  proposal_type: params.proposalType,
                  execution_status: params.executionStatus,
                  limit: String(params.limit)
                }}>
                  <FormField label={t("governance.fields.workspace")} name="workspace_id" placeholder={t("memories.placeholders.workspace")} defaultValue={params.workspaceId} />
                  <FormField label={t("governance.fields.action")} name="proposal_type" defaultValue={params.proposalType} options={[
                    { label: t("governance.actions.archive"), value: "archive" },
                    { label: t("governance.actions.confirm"), value: "confirm" },
                    { label: t("governance.actions.delete"), value: "delete" },
                    { label: t("governance.actions.downgrade"), value: "downgrade" },
                    { label: t("governance.actions.merge"), value: "merge" },
                    { label: t("governance.actions.resolve_conflict"), value: "resolve_conflict" },
                    { label: t("governance.actions.summarize"), value: "summarize" }
                  ]} />
                  <FormField label={t("governance.fields.status")} name="execution_status" defaultValue={params.executionStatus} options={[
                    { label: t("enums.governanceStatus.executed"), value: "executed" },
                    { label: t("enums.governanceStatus.failed"), value: "failed" },
                    { label: t("enums.governanceStatus.executing"), value: "executing" },
                    { label: t("enums.governanceStatus.proposed"), value: "proposed" },
                    { label: t("enums.governanceStatus.verified"), value: "verified" },
                    { label: t("enums.governanceStatus.rejected_by_guard"), value: "rejected_by_guard" }
                  ]} />
                  <FormField label={t("governance.fields.limit")} name="limit" type="number" placeholder="50" defaultValue={String(params.limit)} />
                </SearchForm>
              </FilterModalButton>
              <HealthModalButton sources={[response.sourceStatus, detailResponse.status]} label={t("common.dataSource")} />
            </div>
          </div>
          <div className="notice notice-info mt-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-text">{t("governance.autoConfig.title")}</div>
              <p className="mt-1 text-sm text-muted">{governanceSummary.join(" | ")}</p>
            </div>
            <Link href="/agent?settings=governance" className="btn-outline">
              {t("governance.autoConfig.configure")}
            </Link>
          </div>
        </div>
      </section>

      <section className="tile tile-parchment">
        <div className="tile-inner">
          <div className="master-detail-grid">
            <aside className="panel p-5">
              <div className="section-kicker">{t("governance.recentKicker")}</div>
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
                      <Link
                        key={item.executionId}
                        href={href}
                        scroll={false}
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
                            {t("common.blocked", { reason: item.verificationBlockedReason ?? t("common.pendingReview") })}
                          </div>
                        ) : null}
                        <div className="mt-3 text-[14px] leading-[1.43] text-muted-foreground">
                          {formatTimestamp(item.startedAt, locale)}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <EmptyState title={t("governance.emptyTitle")} description={response.sourceStatus.detail ?? t("governance.emptyDescription")} />
              )}
            </aside>

            <section className="grid gap-6">
              {detailResponse.detail ? (
                <>
                  <div className="panel p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="section-kicker">{t("governance.detailKicker")}</div>
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
                      <div className="section-kicker">{t("governance.planningKicker")}</div>
                      <dl className="kv-grid mt-4">
                        <DetailRow label={t("governance.fields.plannerModel")} value={detailResponse.detail.plannerModel} />
                        <DetailRow label={t("governance.fields.plannerConfidence")} value={String(detailResponse.detail.plannerConfidence ?? t("common.notRecorded"))} />
                        <DetailRow label={t("governance.fields.verifierRequired")} value={detailResponse.detail.verifierRequired ? t("common.needed") : t("common.notNeeded")} />
                        <DetailRow label={t("governance.fields.verifierDecision")} value={detailResponse.detail.verifierDecision ?? t("common.notRecorded")} />
                        <DetailRow label={t("governance.fields.verificationBlocked")} value={detailResponse.detail.verificationBlocked ? t("common.yes") : t("common.noValue")} />
                        <DetailRow label={t("governance.fields.verifierModel")} value={detailResponse.detail.verifierModel ?? t("common.notRecorded")} />
                        <DetailRow label={t("governance.fields.policyVersion")} value={detailResponse.detail.policyVersion} />
                      </dl>
                    </section>

                    <section className="panel p-6">
                      <div className="section-kicker">{t("governance.executionKicker")}</div>
                      {detailResponse.detail.verificationBlocked ? (
                        <div className="notice notice-warning mt-4">
                          {t("common.blocked", { reason: detailResponse.detail.verificationBlockedReason ?? t("common.pendingReview") })}
                        </div>
                      ) : null}
                      <dl className="kv-grid mt-4">
                        <DetailRow label={t("governance.fields.executionRecord")} value={formatDebugReference(detailResponse.detail.executionId, locale)} />
                        <DetailRow label={t("governance.fields.proposalRecord")} value={formatDebugReference(detailResponse.detail.proposalId, locale)} />
                        <DetailRow label={t("governance.fields.workspace")} value={formatWorkspaceReference(detailResponse.detail.workspaceId, locale)} />
                        <DetailRow label={t("governance.fields.startedAt")} value={formatTimestamp(detailResponse.detail.startedAt, locale)} />
                        <DetailRow label={t("governance.fields.finishedAt")} value={formatTimestamp(detailResponse.detail.finishedAt, locale)} />
                        <DetailRow label={t("governance.fields.result")} value={detailResponse.detail.resultSummary ?? t("common.notRecorded")} />
                        <DetailRow label={t("governance.fields.error")} value={detailResponse.detail.errorMessage ?? t("common.no")} />
                      </dl>
                    </section>
                  </div>

                  <section className="panel p-6">
                    <div className="section-kicker">{t("governance.targetKicker")}</div>
                    <p className="mt-4 text-[17px] leading-[1.47] text-muted">
                      {summarizeGovernanceTarget(detailResponse.detail.targets, locale)}
                    </p>
                    <div className="record-list mt-5">
                      {detailResponse.detail.targets.map((target, index) => (
                        <div key={`${target.role}-${index}`} className="record-card">
                          <DetailRow label={target.role} value={targetReferenceLink(target, locale)} />
                        </div>
                      ))}
                    </div>
                  </section>

                  <details className="panel p-6">
                    <summary className="cursor-pointer text-[21px] font-semibold leading-[1.19] text-text">
                      {t("governance.evidenceSummary")}
                    </summary>
                    <div className="detail-grid mt-5">
                      <div>
                        <div className="section-kicker mb-3">{t("governance.suggestedChanges")}</div>
                        <pre className="quiet-code">{JSON.stringify(detailResponse.detail.suggestedChanges, null, 2)}</pre>
                      </div>
                      <div>
                        <div className="section-kicker mb-3">{t("governance.evidence")}</div>
                        <GovernanceEvidence
                          proposalType={detailResponse.detail.proposalType}
                          evidence={detailResponse.detail.evidence}
                          t={t}
                        />
                      </div>
                    </div>
                  </details>
                </>
              ) : (
                <EmptyState title={t("governance.notSelectedTitle")} description={detailResponse.status.detail ?? t("governance.notSelectedDescription")} />
              )}
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}
