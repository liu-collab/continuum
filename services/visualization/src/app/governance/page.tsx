import React from "react";

import { FilterModalButton } from "@/components/filter-modal";
import { FormField } from "@/components/form-field";
import { HealthModalButton } from "@/components/health-modal";
import { SearchForm } from "@/components/search-form";
import { GovernanceConfigEditor } from "@/app/governance/_components/governance-config-button";
import { getGovernanceExecutionDetail, getGovernanceHistory } from "@/features/memory-catalog/service";
import { getServerTranslator } from "@/lib/i18n/server";
import { fetchRuntimeGovernanceConfig } from "@/lib/server/runtime-observe-client";

import { GovernanceWorkspace } from "./governance-workspace";

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

export default async function GovernancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, t } = await getServerTranslator();
  const params = parseSearchParams(await searchParams);
  const filters = {
    workspaceId: params.workspaceId,
    proposalType: params.proposalType,
    executionStatus: params.executionStatus,
    limit: params.limit
  };
  const response = await getGovernanceHistory(filters);
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
            <GovernanceConfigEditor config={governanceConfig} label={t("governance.autoConfig.configure")} />
          </div>
        </div>
      </section>

      <section className="tile tile-parchment">
        <div className="tile-inner">
          <GovernanceWorkspace
            response={response}
            initialDetailResponse={detailResponse}
            filters={filters}
            initialSelectedId={selectedId}
            locale={locale}
          />
        </div>
      </section>
    </div>
  );
}
