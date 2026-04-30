import "server-only";

import {
  GovernanceExecutionFilters,
  GovernanceExecutionResponse,
  MemoryCatalogDetail,
  MemoryCatalogFilters,
  MemoryCatalogItem,
  MemoryCatalogResponse,
} from "@/lib/contracts";
import {
  memoryStatusExplanation,
  memoryStatusLabel,
  memoryTypeLabel,
  scopeExplanation,
  scopeLabel,
  visibilitySummary,
  formatSourceReference,
  formatWorkspaceReference
} from "@/lib/format";
import {
  fetchMemoryById,
  mapSource,
  queryCatalogView
} from "@/lib/server/storage-read-model-client";
import {
  fetchGovernanceExecutionDetail,
  fetchGovernanceExecutions,
} from "@/lib/server/storage-governance-executions-client";
import { getRequestLocale } from "@/lib/i18n/server";
import { createTranslator, type AppLocale } from "@/lib/i18n/messages";
import { buildViewSummary } from "@/features/memory-catalog/view-model";

export {
  buildMemoryCatalogFilterChips,
  buildMemoryCatalogQuickViews,
  describeCatalogEmptyState,
  describeCatalogFilterHints,
  type MemoryCatalogFilterChip,
  type MemoryCatalogQuickView
} from "@/features/memory-catalog/view-model";

function toCatalogItem(
  row: Awaited<ReturnType<typeof queryCatalogView>>["rows"][number],
  filters: MemoryCatalogFilters,
  locale: AppLocale
): MemoryCatalogItem {
  const t = createTranslator(locale);
  const source = mapSource(row.source);
  const originWorkspaceId = source.originWorkspaceId ?? row.workspace_id;
  const scope = row.scope as MemoryCatalogResponse["items"][number]["scope"];
  const status = row.status as MemoryCatalogResponse["items"][number]["status"];
  const memoryType = row.memory_type as MemoryCatalogResponse["items"][number]["memoryType"];

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    taskId: row.task_id,
    sessionId: row.session_id,
    memoryType,
    memoryTypeLabel: memoryTypeLabel(memoryType, locale),
    scope,
    scopeLabel: scopeLabel(scope, locale),
    scopeExplanation: scopeExplanation(scope, originWorkspaceId, locale),
    status,
    statusLabel: memoryStatusLabel(status, locale),
    statusExplanation: memoryStatusExplanation(status, locale),
    summary: row.summary,
    importance: row.importance,
    confidence: row.confidence,
    originWorkspaceId,
    originWorkspaceLabel: originWorkspaceId
      ? t("service.memory.sourceWorkspace", { workspace: formatWorkspaceReference(originWorkspaceId, locale) })
      : t("service.memory.sourceWorkspaceMissing"),
    visibilitySummary: visibilitySummary(scope, filters.memoryViewMode, originWorkspaceId, locale),
    sourceType: source.sourceType,
    sourceRef: source.sourceRef,
    sourceServiceName: source.sourceServiceName,
    sourceSummary: [source.sourceType ?? t("service.memory.unknownSource"), formatSourceReference(source.sourceRef, locale)].join(
      " · "
    ),
    lastConfirmedAt: row.last_confirmed_at,
    updatedAt: row.updated_at
  };
}

export async function getMemoryCatalog(filters: MemoryCatalogFilters): Promise<MemoryCatalogResponse> {
  const locale = await getRequestLocale();
  const t = createTranslator(locale);
  const [result, pendingResult] = await Promise.all([
    queryCatalogView(filters, { locale }),
    queryCatalogView({
      ...filters,
      status: "pending_confirmation",
      page: 1,
      pageSize: 1
    }, { locale })
  ]);

  return {
    items: result.rows.map((row) => toCatalogItem(row, filters, locale)),
    total: result.total,
    page: filters.page,
    pageSize: filters.pageSize,
    appliedFilters: filters,
    viewSummary:
      pendingResult.total > 0
        ? t("service.memory.pendingSummary", {
            summary: buildViewSummary(filters, locale),
            count: pendingResult.total
          })
        : buildViewSummary(filters, locale),
    viewWarnings: result.warnings,
    pendingConfirmationCount: pendingResult.total,
    sourceStatus: result.status
  };
}

export async function getMemoryDetail(id: string): Promise<MemoryCatalogDetail | null> {
  const locale = await getRequestLocale();
  const t = createTranslator(locale);
  const record = await fetchMemoryById(id);

  if (!record) {
    return null;
  }

  const filters = {
    workspaceId: record.workspace_id ?? undefined,
    taskId: record.task_id ?? undefined,
    sessionId: record.session_id ?? undefined,
    sourceRef: undefined,
    memoryViewMode: "workspace_plus_global" as const,
    memoryType: undefined,
    scope: undefined,
    status: undefined,
    updatedFrom: undefined,
    updatedTo: undefined,
    page: 1,
    pageSize: 1
  };
  const base = toCatalogItem(record, filters, locale);
  const sourceParts = [
    base.sourceType,
    base.sourceRef ? formatSourceReference(base.sourceRef, locale) : null,
    base.sourceServiceName
  ].filter(Boolean);
  const governanceResult = await fetchGovernanceExecutions({
    workspaceId: record.workspace_id ?? undefined,
    proposalType: undefined,
    executionStatus: undefined,
    limit: 50,
  }, { locale });
  const governanceHistory = governanceResult.items.filter((item: (typeof governanceResult.items)[number]) =>
    item.targetSummary.includes(id),
  );
  const originTrace =
    record.details && typeof record.details === "object" && record.details !== null && "origin_trace" in record.details
      ? (record.details.origin_trace as Record<string, unknown>)
      : null;

  return {
    ...base,
    details: record.details,
    detailsFormatted: JSON.stringify(record.details ?? {}, null, 2),
    sourceFormatted: sourceParts.length > 0 ? sourceParts.join(" / ") : t("service.memory.sourceFormattedMissing"),
    sourceExcerpt: typeof originTrace?.source_excerpt === "string" ? originTrace.source_excerpt : null,
    extractionBasis: typeof originTrace?.extraction_basis === "string" ? originTrace.extraction_basis : null,
    sourceTurnId: typeof originTrace?.source_turn_id === "string" ? originTrace.source_turn_id : null,
    createdAt: record.created_at,
    governanceHistory,
    governanceSummary:
      governanceHistory.length > 0
        ? t("service.memory.governanceHitSummary", { count: governanceHistory.length })
        : t("service.memory.governanceNoHitSummary"),
  };
}

export async function getGovernanceHistory(
  filters: GovernanceExecutionFilters,
): Promise<GovernanceExecutionResponse> {
  const locale = await getRequestLocale();
  const result = await fetchGovernanceExecutions(filters, { locale });

  return {
    items: result.items,
    appliedFilters: filters,
    sourceStatus: result.status,
  };
}

export async function getGovernanceExecutionDetail(executionId: string) {
  const locale = await getRequestLocale();
  return fetchGovernanceExecutionDetail(executionId, { locale });
}
