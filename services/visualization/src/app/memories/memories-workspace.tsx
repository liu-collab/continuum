"use client";

import type { Route } from "next";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { FilterModalButton } from "@/components/filter-modal";
import { FormField } from "@/components/form-field";
import { HealthModalButton } from "@/components/health-modal";
import { SearchForm } from "@/components/search-form";
import { StatusBadge } from "@/components/status-badge";
import { MemoryTable } from "@/features/memory-catalog/memory-table";
import {
  buildMemoryCatalogFilterChips,
  buildMemoryCatalogQuickViews,
  describeCatalogEmptyState,
  describeCatalogFilterHints
} from "@/features/memory-catalog/view-model";
import type { MemoryCatalogFilters, MemoryCatalogResponse } from "@/lib/contracts";
import { createTranslator, type AppLocale } from "@/lib/i18n/messages";
import { parseMemoryCatalogFilters, toMemoryCatalogQuery } from "@/lib/query-params";

type MemoriesWorkspaceProps = {
  initialResponse: MemoryCatalogResponse;
  initialFilters: MemoryCatalogFilters;
  locale: AppLocale;
};

function memoryCatalogPath(filters: MemoryCatalogFilters) {
  const query = toMemoryCatalogQuery(filters);
  return (query ? `/memories?${query}` : "/memories") as Route;
}

function readFiltersFromLocation() {
  return parseMemoryCatalogFilters(new URLSearchParams(window.location.search));
}

export function MemoriesWorkspace({
  initialResponse,
  initialFilters,
  locale
}: MemoriesWorkspaceProps) {
  const t = createTranslator(locale);
  const [response, setResponse] = useState(initialResponse);
  const [filters, setFilters] = useState(initialFilters);
  const [loadingHref, setLoadingHref] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const emptyState = useMemo(() => describeCatalogEmptyState(response, locale), [locale, response]);
  const views = useMemo(() => buildMemoryCatalogQuickViews(filters, locale), [filters, locale]);
  const filterChips = useMemo(
    () => buildMemoryCatalogFilterChips(filters, response.pendingConfirmationCount, locale),
    [filters, locale, response.pendingConfirmationCount]
  );
  const hints = useMemo(() => describeCatalogFilterHints(filters, locale), [filters, locale]);
  const activeCount = Object.values(filters).filter(Boolean).length;

  const loadFilters = useCallback(async (nextFilters: MemoryCatalogFilters, historyMode: "push" | "replace" | "none") => {
    const href = memoryCatalogPath(nextFilters);
    setLoadingHref(href);
    setErrorMessage(null);
    try {
      const nextResponse = await fetchMemoryCatalog(nextFilters);
      setResponse(nextResponse);
      setFilters(nextResponse.appliedFilters);
      const nextHref = memoryCatalogPath(nextResponse.appliedFilters);
      if (historyMode === "push") {
        window.history.pushState(null, "", nextHref);
      } else if (historyMode === "replace") {
        window.history.replaceState(null, "", nextHref);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingHref(null);
    }
  }, []);

  const loadHref = useCallback(async (href: string, historyMode: "push" | "replace" | "none") => {
    const nextUrl = new URL(href, window.location.origin);
    await loadFilters(parseMemoryCatalogFilters(nextUrl.searchParams), historyMode);
  }, [loadFilters]);

  useEffect(() => {
    setResponse(initialResponse);
    setFilters(initialFilters);
    setLoadingHref(null);
    setErrorMessage(null);
  }, [initialFilters, initialResponse]);

  useEffect(() => {
    function handlePopState() {
      void loadFilters(readFiltersFromLocation(), "none");
    }

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [loadFilters]);

  return (
    <div className="app-page">
      <section className="tile tile-light">
        <div className="tile-inner">
          <div className="tile-head tile-head-row">
            <div>
              <div className="section-kicker">{t("memories.kicker")}</div>
              <h1 className="tile-title">{t("memories.title")}</h1>
              <p className="tile-subtitle">{t("memories.subtitle")}</p>
            </div>
            <div className="tile-actions">
              <FilterModalButton activeCount={activeCount} title={t("memories.filterTitle")} description={t("memories.filterDescription")}>
                {(close) => (
                  <SearchForm
                    action="/memories"
                    initialValues={{
                      workspace_id: filters.workspaceId,
                      task_id: filters.taskId,
                      session_id: filters.sessionId,
                      source_ref: filters.sourceRef,
                      memory_view_mode: filters.memoryViewMode,
                      memory_type: filters.memoryType,
                      scope: filters.scope,
                      status: filters.status,
                      updated_from: filters.updatedFrom,
                      updated_to: filters.updatedTo
                    }}
                    onNavigate={async (href) => {
                      await loadHref(href, "push");
                    }}
                    onSubmitted={close}
                  >
                    <FormField label={t("memories.fields.workspace")} name="workspace_id" placeholder={t("memories.placeholders.workspace")} defaultValue={filters.workspaceId} />
                    <FormField label={t("memories.fields.task")} name="task_id" placeholder={t("memories.placeholders.task")} defaultValue={filters.taskId} />
                    <FormField label={t("memories.fields.session")} name="session_id" placeholder={t("memories.placeholders.session")} defaultValue={filters.sessionId} />
                    <FormField label={t("memories.fields.source")} name="source_ref" placeholder={t("memories.placeholders.source")} defaultValue={filters.sourceRef} />
                    <FormField label={t("memories.fields.view")} name="memory_view_mode" defaultValue={filters.memoryViewMode} options={[
                      { label: t("enums.memoryViewMode.workspace_plus_global"), value: "workspace_plus_global" },
                      { label: t("enums.memoryViewMode.workspace_only"), value: "workspace_only" }
                    ]} />
                    <FormField label={t("memories.fields.type")} name="memory_type" defaultValue={filters.memoryType} options={[
                      { label: t("enums.memoryType.fact"), value: "fact" },
                      { label: t("enums.memoryType.preference"), value: "preference" },
                      { label: t("enums.memoryType.task_state"), value: "task_state" },
                      { label: t("enums.memoryType.episodic"), value: "episodic" }
                    ]} />
                    <FormField label={t("memories.fields.scope")} name="scope" defaultValue={filters.scope} options={[
                      { label: t("enums.scope.session"), value: "session" },
                      { label: t("enums.scope.task"), value: "task" },
                      { label: t("enums.scope.user"), value: "user" },
                      { label: t("enums.scope.workspace"), value: "workspace" }
                    ]} />
                    <FormField label={t("memories.fields.status")} name="status" defaultValue={filters.status} options={[
                      { label: t("enums.memoryStatus.active"), value: "active" },
                      { label: t("enums.memoryStatus.pending_confirmation"), value: "pending_confirmation" },
                      { label: t("enums.memoryStatus.superseded"), value: "superseded" },
                      { label: t("enums.memoryStatus.archived"), value: "archived" },
                      { label: t("enums.memoryStatus.deleted"), value: "deleted" }
                    ]} />
                    <FormField label={t("memories.fields.updatedFrom")} name="updated_from" type="date" defaultValue={filters.updatedFrom} />
                    <FormField label={t("memories.fields.updatedTo")} name="updated_to" type="date" defaultValue={filters.updatedTo} />
                  </SearchForm>
                )}
              </FilterModalButton>
              <HealthModalButton sources={[response.sourceStatus]} label={t("common.dataSource")} />
            </div>
          </div>

          {errorMessage ? (
            <div className="notice notice-danger mt-5" role="alert" data-testid="memories-filter-error">
              {errorMessage}
            </div>
          ) : null}

          <div className="stat-grid">
            <SummaryCard label={t("memories.total")} value={response.total.toLocaleString()} />
            <SummaryCard label={t("memories.view")} value={t(`enums.memoryViewMode.${filters.memoryViewMode}`)} />
            <SummaryCard
              label={t("memories.pendingConfirmation")}
              value={response.pendingConfirmationCount.toLocaleString()}
              tone={response.pendingConfirmationCount > 0 ? "warning" : "neutral"}
              reviewLabel={t("memories.reviewNeeded")}
            />
          </div>

          <nav className="quick-filter-bar mt-6" aria-label={t("memories.quickFilters.label")}>
            {filterChips.map((chip) => (
              <a
                key={chip.key}
                href={chip.href}
                aria-busy={loadingHref === chip.href}
                data-testid={`memory-filter-chip-${chip.key}`}
                onClick={(event) => {
                  event.preventDefault();
                  void loadHref(chip.href, "push");
                }}
                className={`quick-filter-chip ${chip.active ? "quick-filter-chip-active" : ""}`}
              >
                {chip.label}
              </a>
            ))}
          </nav>

          {loadingHref ? (
            <div className="notice notice-info mt-4" role="status" data-testid="memories-filter-pending">
              {t("common.loadingResults")}
            </div>
          ) : null}
          {hints.length > 0 ? (
            <div className="notice notice-warning mt-6">{hints.join(" ")}</div>
          ) : null}
          {response.viewWarnings.length > 0 ? (
            <div className="notice notice-warning mt-3">{response.viewWarnings.join(" ")}</div>
          ) : null}
          {response.pendingConfirmationCount > 0 && filters.status !== "pending_confirmation" ? (
            <div className="notice notice-warning mt-3">
              {t("memories.pendingNotice", { count: response.pendingConfirmationCount })}
            </div>
          ) : null}
        </div>
      </section>

      <section className="tile tile-dark">
        <div className="tile-inner">
          <div className="tile-head">
            <div className="section-kicker">{t("memories.viewsKicker")}</div>
            <h2 className="tile-title">{t("memories.viewsTitle")}</h2>
            <p className="tile-subtitle">{t("memories.viewsDescription")}</p>
          </div>
          <div className="utility-grid">
            {views.map((view) => (
              <a
                key={view.key}
                href={view.href}
                aria-busy={loadingHref === view.href}
                data-testid={`memory-quick-view-${view.key}`}
                onClick={(event) => {
                  event.preventDefault();
                  void loadHref(view.href, "push");
                }}
                className={`record-link ${view.active ? "record-link-active" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="headline-display text-[21px] font-semibold leading-[1.19] text-text">{view.label}</h3>
                  {view.active ? <StatusBadge tone="success">{t("memories.active")}</StatusBadge> : null}
                </div>
                <p className="mt-3 text-[17px] leading-[1.47] text-muted">{view.description}</p>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="tile tile-parchment">
        <div className="tile-inner">
          <div className="tile-head tile-head-row">
            <div>
              <div className="section-kicker">{t("memories.recordsKicker")}</div>
              <h2 className="tile-title">{t("memories.recordsTitle")}</h2>
              <p className="tile-subtitle">{response.viewSummary}</p>
            </div>
            <StatusBadge tone={response.sourceStatus.status === "healthy" ? "success" : response.sourceStatus.status === "partial" ? "warning" : "danger"}>
              {response.sourceStatus.label}: {t(`enums.sourceStatus.${response.sourceStatus.status}`)}
            </StatusBadge>
          </div>
          {response.items.length > 0 ? (
            <MemoryTable items={response.items} locale={locale} />
          ) : (
            <EmptyState title={emptyState.title} description={emptyState.description} />
          )}
        </div>
      </section>
    </div>
  );
}

async function fetchMemoryCatalog(filters: MemoryCatalogFilters) {
  const query = toMemoryCatalogQuery(filters);
  const response = await fetch(query ? `/api/memories?${query}` : "/api/memories", {
    headers: {
      accept: "application/json",
    },
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(readErrorMessage(payload, `Request failed with status ${response.status}`));
  }

  return payload as MemoryCatalogResponse;
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

function SummaryCard({
  label,
  value,
  tone = "neutral",
  reviewLabel
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warning";
  reviewLabel?: string;
}) {
  return (
    <div className="panel p-6">
      <div className="text-[14px] font-semibold leading-[1.29] text-muted-foreground">{label}</div>
      <div className="headline-display mt-4 text-[40px] font-semibold leading-[1.1] text-text">{value}</div>
      {tone === "warning" ? <div className="notice notice-warning mt-4">{reviewLabel}</div> : null}
    </div>
  );
}
