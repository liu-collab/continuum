import type { Route } from "next";
import Link from "next/link";
import React from "react";
import { DetailRow } from "@/components/detail-row";
import { EmptyState } from "@/components/empty-state";
import { FilterModalButton } from "@/components/filter-modal";
import { FormField } from "@/components/form-field";
import { HealthModalButton } from "@/components/health-modal";
import { NavigationPendingProvider, PendingContentBoundary, PendingLink } from "@/components/pending-link";
import { SkeletonBlock } from "@/components/page-skeleton";
import { SearchForm } from "@/components/search-form";
import { StatusBadge } from "@/components/status-badge";
import { describeRunTraceEmptyState, getRunTrace } from "@/features/run-trace/service";
import { getSourceHealth } from "@/features/source-health/service";
import { formatDebugReference, formatRunTraceTitle, formatTimestamp } from "@/lib/format";
import type { AppLocale } from "@/lib/i18n/messages";
import { getServerTranslator } from "@/lib/i18n/server";
import { parseRunTraceFilters } from "@/lib/query-params";

function sectionStatusTone(value: string) {
  if (["completed", "submitted", "injected", "healthy", "ready"].includes(value)) return "success";
  if (["rejected", "degraded", "empty", "no_candidates", "trimmed_to_zero", "partial"].includes(value)) return "warning";
  if (["failed", "unavailable", "timeout"].includes(value)) return "danger";
  return "neutral";
}

export default async function RunsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { locale, t } = await getServerTranslator();
  const filters = parseRunTraceFilters(params);
  const [response, health] = await Promise.all([getRunTrace(filters), getSourceHealth()]);
  const emptyState = describeRunTraceEmptyState(response, locale);
  const activeCount = Object.values(filters).filter(Boolean).length;
  const selectedTurn = response.selectedTurn;

  return (
    <div className="app-page">
      <section className="tile tile-light">
        <div className="tile-inner">
          <div className="tile-head tile-head-row">
            <div>
              <div className="section-kicker">{t("runs.kicker")}</div>
              <h1 className="tile-title">{t("runs.title")}</h1>
              <p className="tile-subtitle">{t("runs.subtitle")}</p>
            </div>
            <div className="tile-actions">
              <FilterModalButton activeCount={activeCount} title={t("runs.filterTitle")} description={t("runs.filterDescription")}>
                <SearchForm action="/runs" initialValues={{ turn_id: filters.turnId, session_id: filters.sessionId, trace_id: filters.traceId }}>
                  <FormField label={t("runs.fields.turn")} name="turn_id" placeholder={t("runs.placeholders.turn")} defaultValue={filters.turnId} />
                  <FormField label={t("runs.fields.session")} name="session_id" placeholder={t("runs.placeholders.session")} defaultValue={filters.sessionId} />
                  <FormField label={t("runs.fields.trace")} name="trace_id" placeholder={t("runs.placeholders.trace")} defaultValue={filters.traceId} />
                </SearchForm>
              </FilterModalButton>
              <HealthModalButton health={health} />
            </div>
          </div>
        </div>
      </section>

      <section className="tile tile-parchment">
        <div className="tile-inner">
          <NavigationPendingProvider>
          <div className="master-detail-grid">
            <aside className="panel p-5">
              <div className="section-kicker">{t("runs.recentKicker")}</div>
              {response.items.length > 0 ? (
                <div className="record-list mt-4">
                  {response.items.map((item) => (
                    <PendingLink
                      key={item.traceId}
                      href={`/runs?trace_id=${encodeURIComponent(item.traceId)}` as Route}
                      scroll={false}
                      pendingKey="runs-detail"
                      pendingLabel={t("runs.loadingDetail")}
                      testId={`run-trace-link-${item.traceId}`}
                      className={`record-link ${selectedTurn?.turn.traceId === item.traceId ? "record-link-active" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-[17px] font-semibold leading-[1.24] text-text" title={item.turnId}>
                            {formatRunTraceTitle(item.createdAt, locale)}
                          </div>
                          <div className="mt-1 text-[14px] leading-[1.43] text-muted">
                            {item.memoryMode ? t(`enums.memoryViewMode.${item.memoryMode}`) : t("runs.memoryModeNotRecorded")}
                          </div>
                        </div>
                        <StatusBadge tone={item.degraded ? "warning" : "success"}>
                          {item.degraded ? t("runs.degraded") : t("runs.normal")}
                        </StatusBadge>
                      </div>
                      <p className="mt-3 line-clamp-2 text-[14px] leading-[1.43] text-muted">{item.summary}</p>
                      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[14px] leading-[1.43] text-muted-foreground">
                        <span>{item.triggerLabel}</span>
                        <span>{t("runs.injectedCount", { count: item.injectedCount })}</span>
                        <span>{formatTimestamp(item.createdAt, locale)}</span>
                      </div>
                    </PendingLink>
                  ))}
                </div>
              ) : (
                <EmptyState title={emptyState.title} description={emptyState.description} />
              )}
            </aside>

            <PendingContentBoundary
              pendingKey="runs-detail"
              className="grid gap-6"
              testId="run-detail-boundary"
              fallback={<RunDetailSkeleton label={t("runs.loadingDetail")} />}
            >
              {selectedTurn ? (
                <>
                  <div className="panel p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="section-kicker">{t("runs.selectedKicker")}</div>
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
                      <DetailRow label={t("runs.fields.trace")} value={formatDebugReference(selectedTurn.turn.traceId, locale)} />
                      <DetailRow label={t("runs.fields.turn")} value={formatDebugReference(selectedTurn.turn.turnId, locale)} />
                      <DetailRow label={t("runs.fields.phase")} value={selectedTurn.turn.phase ?? t("common.notRecorded")} />
                      <DetailRow label={t("runs.fields.host")} value={selectedTurn.turn.host ?? t("common.notRecorded")} />
                      <DetailRow label={t("runs.fields.created")} value={formatTimestamp(selectedTurn.turn.createdAt, locale)} />
                    </dl>
                    <div className="detail-grid mt-6">
                      <TextBlock label={t("runs.fields.input")} value={selectedTurn.turn.inputSummary ?? t("common.notRecorded")} />
                      <TextBlock label={t("runs.fields.output")} value={selectedTurn.turn.assistantOutputSummary ?? t("common.notRecorded")} />
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
                            keptLabel={t("service.runs.keptRecords", { records: "" })}
                            droppedLabel={t("service.runs.trimmedRecords", { records: "" })}
                          />
                        ) : null}
                      </div>
                    ))}
                  </div>

                  <div className="panel p-6">
                    <div className="section-kicker">{t("runs.dependencies")}</div>
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
              ) : (
                <EmptyState title={t("runs.notSelectedTitle")} description={emptyState.description} />
              )}
            </PendingContentBoundary>
          </div>
          </NavigationPendingProvider>
        </div>
      </section>
    </div>
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

  return (
    <div>
      <div className="section-kicker mb-2">{label}</div>
      <div className="flex flex-wrap gap-2">
        {recordIds.map((recordId) => (
          <Link
            key={recordId}
            href={`/memories/${encodeURIComponent(recordId)}` as Route}
            className="status-badge hover:border-[rgba(0,102,204,0.28)] hover:text-[var(--primary)]"
            title={recordId}
          >
            {formatDebugReference(recordId, locale)}
          </Link>
        ))}
      </div>
    </div>
  );
}
