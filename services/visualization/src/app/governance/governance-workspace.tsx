"use client";

import type { Route } from "next";
import Link from "next/link";
import React, { useCallback, useEffect, useState } from "react";

import { DetailRow } from "@/components/detail-row";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import type {
  GovernanceExecutionDetail,
  GovernanceExecutionFilters,
  GovernanceExecutionResponse,
  SourceStatus
} from "@/lib/contracts";
import {
  formatDebugReference,
  formatTimestamp,
  formatWorkspaceReference,
  governanceStatusTone,
  summarizeGovernanceTarget
} from "@/lib/format";
import { createTranslator, type AppLocale } from "@/lib/i18n/messages";

type GovernanceDetailResponse = {
  detail: GovernanceExecutionDetail | null;
  status: SourceStatus;
};

type GovernanceWorkspaceProps = {
  response: GovernanceExecutionResponse;
  initialDetailResponse: GovernanceDetailResponse;
  filters: GovernanceExecutionFilters;
  initialSelectedId: string | null;
  locale: AppLocale;
};

type TFunction = (key: string, variables?: Record<string, string | number>) => string;

function governanceExecutionPath(filters: GovernanceExecutionFilters, executionId: string) {
  const query = new URLSearchParams({
    ...(filters.workspaceId ? { workspace_id: filters.workspaceId } : {}),
    ...(filters.proposalType ? { proposal_type: filters.proposalType } : {}),
    ...(filters.executionStatus ? { execution_status: filters.executionStatus } : {}),
    limit: String(filters.limit),
    execution_id: executionId,
  });

  return `/governance?${query.toString()}` as Route;
}

function readExecutionIdFromLocation() {
  return new URLSearchParams(window.location.search).get("execution_id")?.trim() || null;
}

export function GovernanceWorkspace({
  response,
  initialDetailResponse,
  filters,
  initialSelectedId,
  locale
}: GovernanceWorkspaceProps) {
  const t = createTranslator(locale);
  const [detailResponse, setDetailResponse] = useState(initialDetailResponse);
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadExecution = useCallback(async (executionId: string, historyMode: "push" | "replace" | "none") => {
    setLoadingId(executionId);
    setErrorMessage(null);
    try {
      const nextDetailResponse = await fetchGovernanceExecution(executionId);
      setDetailResponse(nextDetailResponse);
      setSelectedId(executionId);
      if (historyMode === "push") {
        window.history.pushState(null, "", governanceExecutionPath(filters, executionId));
      } else if (historyMode === "replace") {
        window.history.replaceState(null, "", governanceExecutionPath(filters, executionId));
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingId(null);
    }
  }, [filters]);

  useEffect(() => {
    setDetailResponse(initialDetailResponse);
    setSelectedId(initialSelectedId);
    setLoadingId(null);
    setErrorMessage(null);
  }, [initialDetailResponse, initialSelectedId]);

  useEffect(() => {
    function handlePopState() {
      const nextExecutionId = readExecutionIdFromLocation();
      if (!nextExecutionId) {
        setDetailResponse(initialDetailResponse);
        setSelectedId(initialSelectedId);
        setLoadingId(null);
        setErrorMessage(null);
        return;
      }

      void loadExecution(nextExecutionId, "none");
    }

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [initialDetailResponse, initialSelectedId, loadExecution]);

  async function selectExecution(executionId: string) {
    if (executionId === selectedId) {
      window.history.replaceState(null, "", governanceExecutionPath(filters, executionId));
      return;
    }

    await loadExecution(executionId, "push");
  }

  return (
    <div className="master-detail-grid">
      <aside className="panel p-5">
        <div className="section-kicker">{t("governance.recentKicker")}</div>
        {response.items.length > 0 ? (
          <div className="record-list mt-4">
            {response.items.map((item) => {
              const href = governanceExecutionPath(filters, item.executionId);
              const isActive = item.executionId === selectedId;
              const isLoading = loadingId === item.executionId;

              return (
                <a
                  key={item.executionId}
                  href={href}
                  aria-busy={isLoading}
                  data-testid={`governance-execution-link-${item.executionId}`}
                  onClick={(event) => {
                    event.preventDefault();
                    void selectExecution(item.executionId);
                  }}
                  className={`record-link ${isActive ? "record-link-active" : ""}`}
                >
                  {isLoading ? (
                    <span className="mb-3 flex items-center gap-2 text-[14px] leading-[1.43] text-[var(--primary)]" role="status">
                      {t("governance.loadingDetail")}
                    </span>
                  ) : null}
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
                </a>
              );
            })}
          </div>
        ) : (
          <EmptyState title={t("governance.emptyTitle")} description={response.sourceStatus.detail ?? t("governance.emptyDescription")} />
        )}
      </aside>

      <section className="grid gap-6" data-testid="governance-detail-boundary" aria-busy={Boolean(loadingId)}>
        {loadingId ? (
          <div className="notice notice-info" role="status" data-testid="governance-detail-pending">
            {t("governance.loadingDetail")}
          </div>
        ) : null}
        {!loadingId && errorMessage ? (
          <div className="notice notice-danger" role="alert" data-testid="governance-detail-error">
            {errorMessage}
          </div>
        ) : null}
        {!loadingId ? (
          detailResponse.detail ? (
            <GovernanceDetail detail={detailResponse.detail} locale={locale} t={t} />
          ) : (
            <EmptyState title={t("governance.notSelectedTitle")} description={detailResponse.status.detail ?? t("governance.notSelectedDescription")} />
          )
        ) : null}
      </section>
    </div>
  );
}

async function fetchGovernanceExecution(executionId: string) {
  const response = await fetch(`/api/governance/executions/${encodeURIComponent(executionId)}`, {
    headers: {
      accept: "application/json",
    },
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(readErrorMessage(payload, `Request failed with status ${response.status}`));
  }

  return payload as GovernanceDetailResponse;
}

function readErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: { message?: unknown } }).error;
    if (error && typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
  }

  return fallback;
}

function targetReferenceLink(
  target: { recordId: string | null; conflictId: string | null },
  locale: AppLocale
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

function GovernanceDetail({ detail, locale, t }: { detail: GovernanceExecutionDetail; locale: AppLocale; t: TFunction }) {
  return (
    <>
      <div className="panel p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="section-kicker">{t("governance.detailKicker")}</div>
            <h2 className="headline-display mt-3 text-[34px] font-semibold leading-[1.12] text-text">
              {detail.proposalTypeLabel}
            </h2>
            <p className="mt-4 text-[17px] leading-[1.47] text-muted">
              {detail.reasonText}
            </p>
          </div>
          <StatusBadge tone={governanceStatusTone(detail.executionStatus)}>
            {detail.executionStatusLabel}
          </StatusBadge>
        </div>
      </div>

      <div className="detail-grid">
        <section className="panel p-6">
          <div className="section-kicker">{t("governance.planningKicker")}</div>
          <dl className="kv-grid mt-4">
            <DetailRow label={t("governance.fields.plannerModel")} value={detail.plannerModel} />
            <DetailRow label={t("governance.fields.plannerConfidence")} value={String(detail.plannerConfidence ?? t("common.notRecorded"))} />
            <DetailRow label={t("governance.fields.verifierRequired")} value={detail.verifierRequired ? t("common.needed") : t("common.notNeeded")} />
            <DetailRow label={t("governance.fields.verifierDecision")} value={detail.verifierDecision ?? t("common.notRecorded")} />
            <DetailRow label={t("governance.fields.verificationBlocked")} value={detail.verificationBlocked ? t("common.yes") : t("common.noValue")} />
            <DetailRow label={t("governance.fields.verifierModel")} value={detail.verifierModel ?? t("common.notRecorded")} />
            <DetailRow label={t("governance.fields.policyVersion")} value={detail.policyVersion} />
          </dl>
        </section>

        <section className="panel p-6">
          <div className="section-kicker">{t("governance.executionKicker")}</div>
          {detail.verificationBlocked ? (
            <div className="notice notice-warning mt-4">
              {t("common.blocked", { reason: detail.verificationBlockedReason ?? t("common.pendingReview") })}
            </div>
          ) : null}
          <dl className="kv-grid mt-4">
            <DetailRow label={t("governance.fields.executionRecord")} value={formatDebugReference(detail.executionId, locale)} />
            <DetailRow label={t("governance.fields.proposalRecord")} value={formatDebugReference(detail.proposalId, locale)} />
            <DetailRow label={t("governance.fields.workspace")} value={formatWorkspaceReference(detail.workspaceId, locale)} />
            <DetailRow label={t("governance.fields.startedAt")} value={formatTimestamp(detail.startedAt, locale)} />
            <DetailRow label={t("governance.fields.finishedAt")} value={formatTimestamp(detail.finishedAt, locale)} />
            <DetailRow label={t("governance.fields.result")} value={detail.resultSummary ?? t("common.notRecorded")} />
            <DetailRow label={t("governance.fields.error")} value={detail.errorMessage ?? t("common.no")} />
          </dl>
        </section>
      </div>

      <section className="panel p-6">
        <div className="section-kicker">{t("governance.targetKicker")}</div>
        <p className="mt-4 text-[17px] leading-[1.47] text-muted">
          {summarizeGovernanceTarget(detail.targets, locale)}
        </p>
        <div className="record-list mt-5">
          {detail.targets.map((target, index) => (
            <div key={`${target.role}-${index}`} className="record-card">
              <DetailRow label={target.role} value={targetReferenceLink(target, locale)} />
            </div>
          ))}
        </div>
      </section>

      <details className="panel p-6">
        <summary className="headline-display cursor-pointer text-[21px] font-semibold leading-[1.19] text-text">
          {t("governance.evidenceSummary")}
        </summary>
        <div className="detail-grid mt-5">
          <div>
            <div className="section-kicker mb-3">{t("governance.suggestedChanges")}</div>
            <pre className="quiet-code">{JSON.stringify(detail.suggestedChanges, null, 2)}</pre>
          </div>
          <div>
            <div className="section-kicker mb-3">{t("governance.evidence")}</div>
            <GovernanceEvidence
              proposalType={detail.proposalType}
              evidence={detail.evidence}
              t={t}
            />
          </div>
        </div>
      </details>
    </>
  );
}
