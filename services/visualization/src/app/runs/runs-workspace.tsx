"use client";

import type { Route } from "next";
import Link from "next/link";
import React, { useCallback, useEffect, useState } from "react";

import { DetailRow } from "@/components/detail-row";
import { EmptyState } from "@/components/empty-state";
import { SkeletonBlock } from "@/components/page-skeleton";
import { StatusBadge } from "@/components/status-badge";
import type { RunTraceDetail, RunTraceResponse } from "@/lib/contracts";
import { formatDebugReference, formatRunTraceTitle, formatTimestamp } from "@/lib/format";
import type { AppLocale } from "@/lib/i18n/messages";

type RunsWorkspaceProps = {
  initialResponse: RunTraceResponse;
  initialEmptyState: {
    title: string;
    description: string;
  };
  locale: AppLocale;
  labels: {
    recentKicker: string;
    selectedKicker: string;
    loadingDetail: string;
    notSelectedTitle: string;
    memoryModeNotRecorded: string;
    degraded: string;
    normal: string;
    injectedCount: string;
    dependencies: string;
    fields: {
      trace: string;
      turn: string;
      phase: string;
      host: string;
      created: string;
      input: string;
      output: string;
    };
    common: {
      notRecorded: string;
    };
    service: {
      keptRecords: string;
      trimmedRecords: string;
    };
  };
  memoryModeLabels: Record<string, string>;
};

function sectionStatusTone(value: string) {
  if (["completed", "submitted", "injected", "healthy", "ready"].includes(value)) return "success";
  if (["rejected", "degraded", "empty", "no_candidates", "trimmed_to_zero", "partial"].includes(value)) return "warning";
  if (["failed", "unavailable", "timeout"].includes(value)) return "danger";
  return "neutral";
}

function runsTracePath(traceId: string) {
  return `/runs?trace_id=${encodeURIComponent(traceId)}`;
}

function readTraceIdFromLocation() {
  return new URLSearchParams(window.location.search).get("trace_id")?.trim() || null;
}

export function RunsWorkspace({
  initialResponse,
  initialEmptyState,
  locale,
  labels,
  memoryModeLabels
}: RunsWorkspaceProps) {
  const [response, setResponse] = useState(initialResponse);
  const [emptyState, setEmptyState] = useState(initialEmptyState);
  const [loadingTraceId, setLoadingTraceId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const selectedTraceId = response.selectedTurn?.turn.traceId ?? null;

  const loadTrace = useCallback(async (traceId: string, historyMode: "push" | "replace" | "none") => {
    setLoadingTraceId(traceId);
    setErrorMessage(null);
    try {
      const nextResponse = await fetchRunTrace(traceId);
      setResponse((current) => ({
        ...nextResponse,
        items: current.items.length > 0 ? current.items : nextResponse.items,
      }));
      setEmptyState(resolveEmptyState(nextResponse, labels));
      if (historyMode === "push") {
        window.history.pushState(null, "", runsTracePath(traceId));
      } else if (historyMode === "replace") {
        window.history.replaceState(null, "", runsTracePath(traceId));
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingTraceId(null);
    }
  }, [labels]);

  useEffect(() => {
    setResponse(initialResponse);
    setEmptyState(initialEmptyState);
    setLoadingTraceId(null);
    setErrorMessage(null);
  }, [initialEmptyState, initialResponse]);

  useEffect(() => {
    function handlePopState() {
      const traceId = readTraceIdFromLocation();
      if (!traceId) {
        setResponse(initialResponse);
        setEmptyState(initialEmptyState);
        setLoadingTraceId(null);
        setErrorMessage(null);
        return;
      }

      void loadTrace(traceId, "none");
    }

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [initialEmptyState, initialResponse, loadTrace]);

  async function selectTrace(traceId: string) {
    if (traceId === selectedTraceId) {
      window.history.replaceState(null, "", runsTracePath(traceId));
      return;
    }

    await loadTrace(traceId, "push");
  }

  return (
    <div className="master-detail-grid">
      <aside className="panel p-5">
        <div className="section-kicker">{labels.recentKicker}</div>
        {response.items.length > 0 ? (
          <div className="record-list mt-4">
            {response.items.map((item) => {
              const isActive = selectedTraceId === item.traceId;
              const isLoading = loadingTraceId === item.traceId;

              return (
                <a
                  key={item.traceId}
                  href={runsTracePath(item.traceId) as Route}
                  aria-busy={isLoading}
                  data-testid={`run-trace-link-${item.traceId}`}
                  onClick={(event) => {
                    event.preventDefault();
                    void selectTrace(item.traceId);
                  }}
                  className={`record-link w-full text-left ${isActive ? "record-link-active" : ""}`}
                >
                  {isLoading ? (
                    <span className="mb-3 flex items-center gap-2 text-[14px] leading-[1.43] text-[var(--primary)]" role="status">
                      {labels.loadingDetail}
                    </span>
                  ) : null}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[17px] font-semibold leading-[1.24] text-text" title={item.turnId}>
                        {formatRunTraceTitle(item.createdAt, locale)}
                      </div>
                      <div className="mt-1 text-[14px] leading-[1.43] text-muted">
                        {item.memoryMode ? memoryModeLabels[item.memoryMode] ?? item.memoryMode : labels.memoryModeNotRecorded}
                      </div>
                    </div>
                    <StatusBadge tone={item.degraded ? "warning" : "success"}>
                      {item.degraded ? labels.degraded : labels.normal}
                    </StatusBadge>
                  </div>
                  <p className="mt-3 line-clamp-2 text-[14px] leading-[1.43] text-muted">{item.summary}</p>
                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[14px] leading-[1.43] text-muted-foreground">
                    <span>{item.triggerLabel}</span>
                    <span>{labels.injectedCount.replace("{count}", String(item.injectedCount))}</span>
                    <span>{formatTimestamp(item.createdAt, locale)}</span>
                  </div>
                </a>
              );
            })}
          </div>
        ) : (
          <EmptyState title={emptyState.title} description={emptyState.description} />
        )}
      </aside>

      <div className="grid gap-6" data-testid="run-detail-boundary" aria-busy={Boolean(loadingTraceId)}>
        {loadingTraceId ? <RunDetailSkeleton label={labels.loadingDetail} /> : null}
        {!loadingTraceId && errorMessage ? (
          <div className="notice notice-danger" role="alert" data-testid="run-detail-error">
            {errorMessage}
          </div>
        ) : null}
        {!loadingTraceId ? (
          response.selectedTurn ? (
            <RunDetail
              selectedTurn={response.selectedTurn}
              locale={locale}
              labels={labels}
            />
          ) : (
            <EmptyState title={labels.notSelectedTitle} description={emptyState.description} />
          )
        ) : null}
      </div>
    </div>
  );
}

async function fetchRunTrace(traceId: string) {
  const response = await fetch(`/api/runs?trace_id=${encodeURIComponent(traceId)}`, {
    headers: {
      accept: "application/json",
    },
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(readErrorMessage(payload, `Request failed with status ${response.status}`));
  }

  return payload as RunTraceResponse;
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

function resolveEmptyState(response: RunTraceResponse, labels: RunsWorkspaceProps["labels"]) {
  if (response.sourceStatus.status !== "healthy") {
    return {
      title: labels.notSelectedTitle,
      description: response.sourceStatus.detail ?? labels.common.notRecorded,
    };
  }

  return {
    title: labels.notSelectedTitle,
    description: labels.common.notRecorded,
  };
}

function RunDetail({
  selectedTurn,
  locale,
  labels
}: {
  selectedTurn: RunTraceDetail;
  locale: AppLocale;
  labels: RunsWorkspaceProps["labels"];
}) {
  return (
    <>
      <div className="panel p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="section-kicker">{labels.selectedKicker}</div>
            <h2 className="headline-display mt-3 break-all text-[34px] font-semibold leading-[1.12] text-text">
              {formatRunTraceTitle(selectedTurn.turn.createdAt, locale)}
            </h2>
            <p className="mt-4 text-[17px] leading-[1.47] text-muted">
              {selectedTurn.narrative.explanation}
            </p>
          </div>
          <StatusBadge tone={selectedTurn.narrative.incomplete ? "warning" : "success"}>
            {selectedTurn.narrative.outcomeLabel}
          </StatusBadge>
        </div>
        <dl className="kv-grid mt-6">
          <DetailRow label={labels.fields.trace} value={formatDebugReference(selectedTurn.turn.traceId, locale)} />
          <DetailRow label={labels.fields.turn} value={formatDebugReference(selectedTurn.turn.turnId, locale)} />
          <DetailRow label={labels.fields.phase} value={selectedTurn.turn.phase ?? labels.common.notRecorded} />
          <DetailRow label={labels.fields.host} value={selectedTurn.turn.host ?? labels.common.notRecorded} />
          <DetailRow label={labels.fields.created} value={formatTimestamp(selectedTurn.turn.createdAt, locale)} />
        </dl>
        <div className="detail-grid mt-6">
          <TextBlock label={labels.fields.input} value={selectedTurn.turn.inputSummary ?? labels.common.notRecorded} />
          <TextBlock label={labels.fields.output} value={selectedTurn.turn.assistantOutputSummary ?? labels.common.notRecorded} />
        </div>
      </div>

      <div className="detail-grid">
        {selectedTurn.phaseNarratives.map((phase, index) => (
          <div key={`${phase.key}-${index}-${phase.title}`} className="panel p-6">
            <div className="flex items-start justify-between gap-4">
              <h3 className="headline-display text-[21px] font-semibold leading-[1.19] text-text">{phase.title}</h3>
              <StatusBadge tone="neutral">{phase.key}</StatusBadge>
            </div>
            <p className="mt-3 text-[17px] leading-[1.47] text-muted">{phase.summary}</p>
            {phase.details.length > 0 ? (
              <ul className="mt-4 grid gap-2 text-[14px] leading-[1.43] text-muted-foreground">
                {phase.details.slice(0, 3).map((detail, detailIndex) => (
                  <li key={detailIndex}>{detail}</li>
                ))}
              </ul>
            ) : null}
            {phase.key === "injection" ? (
              <RunInjectionRecordLinks
                keptRecordIds={selectedTurn.injectionRuns.flatMap((run) => run.keptRecordIds)}
                droppedRecordIds={selectedTurn.injectionRuns.flatMap((run) => run.droppedRecordIds)}
                locale={locale}
                keptLabel={labels.service.keptRecords}
                droppedLabel={labels.service.trimmedRecords}
              />
            ) : null}
          </div>
        ))}
      </div>

      <div className="panel p-6">
        <div className="section-kicker">{labels.dependencies}</div>
        <div className="utility-grid mt-4">
          {selectedTurn.dependencyStatus.map((dependency) => (
            <div key={dependency.name} className="record-card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[17px] font-semibold leading-[1.24] text-text">{dependency.label}</div>
                  <p className="mt-2 line-clamp-2 text-[14px] leading-[1.43] text-muted">{dependency.detail}</p>
                </div>
                <StatusBadge tone={sectionStatusTone(dependency.status)}>{dependency.status}</StatusBadge>
              </div>
              <div className="mt-3 text-[14px] leading-[1.43] text-muted-foreground">
                {formatTimestamp(dependency.checkedAt, locale)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function RunDetailSkeleton({ label }: { label: string }) {
  return (
    <>
      <div className="notice notice-info flex items-center gap-2" role="status" data-testid="run-detail-pending">
        {label}
      </div>
      <SkeletonBlock className="h-48" />
      <div className="detail-grid">
        <SkeletonBlock className="h-36" />
        <SkeletonBlock className="h-36" />
      </div>
    </>
  );
}

function TextBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="record-card">
      <div className="section-kicker">{label}</div>
      <p className="mt-3 text-[17px] leading-[1.47] text-muted">{value}</p>
    </div>
  );
}

function RunInjectionRecordLinks({
  keptRecordIds,
  droppedRecordIds,
  locale,
  keptLabel,
  droppedLabel
}: {
  keptRecordIds: string[];
  droppedRecordIds: string[];
  locale: AppLocale;
  keptLabel: string;
  droppedLabel: string;
}) {
  const uniqueKeptRecordIds = Array.from(new Set(keptRecordIds));
  const uniqueDroppedRecordIds = Array.from(new Set(droppedRecordIds));

  if (uniqueKeptRecordIds.length === 0 && uniqueDroppedRecordIds.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 grid gap-3">
      <RecordIdLinks label={keptLabel} recordIds={uniqueKeptRecordIds} locale={locale} />
      <RecordIdLinks label={droppedLabel} recordIds={uniqueDroppedRecordIds} locale={locale} />
    </div>
  );
}

function RecordIdLinks({ label, recordIds, locale }: { label: string; recordIds: string[]; locale: AppLocale }) {
  if (recordIds.length === 0) {
    return null;
  }

  const cleanLabel = label.replace(/[:：]\s*$/, "");

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--hairline)] bg-[var(--surface-pearl)] p-3 text-[14px] leading-[1.43] text-muted">
      <div className="font-semibold text-text">{cleanLabel}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {recordIds.map((recordId) => (
          <Link
            key={recordId}
            href={`/memories/${encodeURIComponent(recordId)}` as Route}
            title={recordId}
            className="inline-flex rounded-full border border-[var(--hairline)] bg-white px-2 py-1 text-[12px] leading-none text-[var(--primary)] hover:border-[var(--primary)]"
          >
            {formatDebugReference(recordId, locale)}
          </Link>
        ))}
      </div>
    </div>
  );
}
