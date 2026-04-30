import React from "react";

import { FilterModalButton } from "@/components/filter-modal";
import { FormField } from "@/components/form-field";
import { HealthModalButton } from "@/components/health-modal";
import { SearchForm } from "@/components/search-form";
import { describeRunTraceEmptyState, getRunTrace } from "@/features/run-trace/service";
import { getSourceHealth } from "@/features/source-health/service";
import { getServerTranslator } from "@/lib/i18n/server";
import { parseRunTraceFilters } from "@/lib/query-params";

import { RunsWorkspace } from "./runs-workspace";

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
          <RunsWorkspace
            initialResponse={response}
            initialEmptyState={emptyState}
            locale={locale}
            labels={{
              recentKicker: t("runs.recentKicker"),
              selectedKicker: t("runs.selectedKicker"),
              loadingDetail: t("runs.loadingDetail"),
              notSelectedTitle: t("runs.notSelectedTitle"),
              memoryModeNotRecorded: t("runs.memoryModeNotRecorded"),
              degraded: t("runs.degraded"),
              normal: t("runs.normal"),
              injectedCount: t("runs.injectedCount", { count: "{count}" }),
              dependencies: t("runs.dependencies"),
              fields: {
                trace: t("runs.fields.trace"),
                turn: t("runs.fields.turn"),
                phase: t("runs.fields.phase"),
                host: t("runs.fields.host"),
                created: t("runs.fields.created"),
                input: t("runs.fields.input"),
                output: t("runs.fields.output")
              },
              common: {
                notRecorded: t("common.notRecorded")
              },
              service: {
                keptRecords: t("service.runs.keptRecords", { records: "" }),
                trimmedRecords: t("service.runs.trimmedRecords", { records: "" })
              }
            }}
            memoryModeLabels={{
              workspace_plus_global: t("enums.memoryViewMode.workspace_plus_global"),
              workspace_only: t("enums.memoryViewMode.workspace_only")
            }}
          />
        </div>
      </section>
    </div>
  );
}
