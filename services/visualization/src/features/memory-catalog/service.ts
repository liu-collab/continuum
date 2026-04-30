import "server-only";

import type { Route } from "next";

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
  memoryViewModeExplanation,
  scopeExplanation,
  scopeLabel,
  visibilitySummary,
  formatSessionReference,
  formatSourceReference,
  formatWorkspaceReference
} from "@/lib/format";
import { toMemoryCatalogQuery } from "@/lib/query-params";
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

export type MemoryCatalogQuickView = {
  key: string;
  label: string;
  description: string;
  href: Route;
  active: boolean;
};

export type MemoryCatalogFilterChip = {
  key: string;
  label: string;
  href: Route;
  active: boolean;
};

function isImplicitGlobalView(filters: MemoryCatalogFilters) {
  return (
    !filters.workspaceId
    && !filters.taskId
    && !filters.sessionId
    && !filters.sourceRef
    && !filters.scope
    && filters.memoryViewMode === "workspace_plus_global"
  );
}

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

function buildViewSummary(filters: MemoryCatalogFilters, locale: AppLocale) {
  const t = createTranslator(locale);
  const base = memoryViewModeExplanation(filters.memoryViewMode, locale);

  if (filters.memoryViewMode === "workspace_only") {
    return filters.workspaceId
      ? t("service.memory.workspaceOnlySummaryWithWorkspace", {
          base,
          workspace: formatWorkspaceReference(filters.workspaceId, locale),
          session: filters.sessionId
            ? t("service.memory.sessionSuffix", { session: formatSessionReference(filters.sessionId, locale) })
            : "",
          source: filters.sourceRef
            ? t("service.memory.sourceSuffix", { source: formatSourceReference(filters.sourceRef, locale) })
            : ""
        })
      : t("service.memory.workspaceOnlySummaryMissingWorkspace", { base });
  }

  if (filters.scope === "user" || isImplicitGlobalView(filters)) {
    return t("service.memory.globalViewSummary", { base });
  }

  return filters.workspaceId
    ? t("service.memory.workspacePlusSummaryWithWorkspace", {
        base,
        workspace: formatWorkspaceReference(filters.workspaceId, locale),
        session: filters.sessionId
          ? t("service.memory.sessionSentence", { session: formatSessionReference(filters.sessionId, locale) })
          : "",
        source: filters.sourceRef
          ? t("service.memory.sourceSentence", { source: formatSourceReference(filters.sourceRef, locale) })
          : ""
      })
    : t("service.memory.workspacePlusSummaryMissingWorkspace", { base });
}

function buildQuickViewHref(filters: MemoryCatalogFilters) {
  const query = toMemoryCatalogQuery(filters);
  return (query ? `/memories?${query}` : "/memories") as Route;
}

function isQuickViewActive(current: MemoryCatalogFilters, target: MemoryCatalogFilters) {
  const normalizedCurrent = isImplicitGlobalView(current)
    ? { ...current, scope: "user" as const }
    : current;
  const normalizedTarget = isImplicitGlobalView(target)
    ? { ...target, scope: "user" as const }
    : target;

  return (
    normalizedCurrent.workspaceId === normalizedTarget.workspaceId
    && normalizedCurrent.taskId === normalizedTarget.taskId
    && normalizedCurrent.sessionId === normalizedTarget.sessionId
    && normalizedCurrent.sourceRef === normalizedTarget.sourceRef
    && normalizedCurrent.memoryViewMode === normalizedTarget.memoryViewMode
    && normalizedCurrent.memoryType === normalizedTarget.memoryType
    && normalizedCurrent.scope === normalizedTarget.scope
    && normalizedCurrent.status === normalizedTarget.status
    && normalizedCurrent.updatedFrom === normalizedTarget.updatedFrom
    && normalizedCurrent.updatedTo === normalizedTarget.updatedTo
  );
}

function createQuickView(
  current: MemoryCatalogFilters,
  key: string,
  label: string,
  description: string,
  target: Partial<MemoryCatalogFilters>
): MemoryCatalogQuickView {
  const normalizedTarget: MemoryCatalogFilters = {
    workspaceId: target.workspaceId,
    taskId: target.taskId,
    sessionId: target.sessionId,
    sourceRef: target.sourceRef,
    memoryViewMode: target.memoryViewMode ?? "workspace_plus_global",
    memoryType: target.memoryType,
    scope: target.scope,
    status: target.status,
    updatedFrom: target.updatedFrom,
    updatedTo: target.updatedTo,
    page: 1,
    pageSize: current.pageSize
  };

  return {
    key,
    label,
    description,
    href: buildQuickViewHref(normalizedTarget),
    active: isQuickViewActive(current, normalizedTarget)
  };
}

function createFilterChip(
  current: MemoryCatalogFilters,
  key: string,
  label: string,
  target: Partial<MemoryCatalogFilters>
): MemoryCatalogFilterChip {
  const normalizedTarget: MemoryCatalogFilters = {
    workspaceId: current.workspaceId,
    taskId: current.taskId,
    sessionId: current.sessionId,
    sourceRef: current.sourceRef,
    memoryViewMode: current.memoryViewMode,
    memoryType: undefined,
    scope: undefined,
    status: undefined,
    updatedFrom: current.updatedFrom,
    updatedTo: current.updatedTo,
    page: 1,
    pageSize: current.pageSize,
    ...target
  };

  return {
    key,
    label,
    href: buildQuickViewHref(normalizedTarget),
    active: isQuickViewActive(current, normalizedTarget)
  };
}

export function buildMemoryCatalogFilterChips(
  filters: MemoryCatalogFilters,
  pendingConfirmationCount: number,
  locale: AppLocale = "zh-CN"
): MemoryCatalogFilterChip[] {
  const t = createTranslator(locale);

  return [
    createFilterChip(filters, "active", t("memories.quickFilters.active"), {
      status: "active"
    }),
    createFilterChip(filters, "pending", t("memories.quickFilters.pending", {
      count: pendingConfirmationCount
    }), {
      status: "pending_confirmation"
    }),
    createFilterChip(filters, "fact", t("memories.quickFilters.fact"), {
      status: "active",
      memoryType: "fact"
    }),
    createFilterChip(filters, "preference", t("memories.quickFilters.preference"), {
      status: "active",
      memoryType: "preference"
    }),
    createFilterChip(filters, "task-state", t("memories.quickFilters.taskState"), {
      status: "active",
      memoryType: "task_state"
    }),
    createFilterChip(filters, "episodic", t("memories.quickFilters.episodic"), {
      status: "active",
      memoryType: "episodic"
    })
  ];
}

export function buildMemoryCatalogQuickViews(
  filters: MemoryCatalogFilters,
  locale: AppLocale = "zh-CN"
): MemoryCatalogQuickView[] {
  const t = createTranslator(locale);
  const views: MemoryCatalogQuickView[] = [
    createQuickView(
      filters,
      "global-user",
      t("service.memory.quickGlobalTitle"),
      t("service.memory.quickGlobalDescription"),
      {
        workspaceId: filters.workspaceId,
        memoryViewMode: "workspace_plus_global",
        scope: "user"
      }
    )
  ];

  views.push(
    createQuickView(
      filters,
      "pending-confirmation",
      t("service.memory.quickPendingTitle"),
      t("service.memory.quickPendingDescription"),
      {
        workspaceId: filters.workspaceId,
        memoryViewMode: "workspace_plus_global",
        status: "pending_confirmation"
      }
    )
  );

  if (filters.workspaceId) {
    views.push(
      createQuickView(
        filters,
        "workspace-plus-global",
        t("service.memory.quickWorkspaceGlobalTitle"),
        t("service.memory.quickWorkspaceGlobalDescription"),
        {
          workspaceId: filters.workspaceId,
          memoryViewMode: "workspace_plus_global"
        }
      ),
      createQuickView(
        filters,
        "workspace-only",
        t("service.memory.quickWorkspaceOnlyTitle"),
        t("service.memory.quickWorkspaceOnlyDescription"),
        {
          workspaceId: filters.workspaceId,
          memoryViewMode: "workspace_only"
        }
      )
    );
  }

  if (filters.sourceRef) {
    views.push(
      createQuickView(
        filters,
        "turn-related",
        t("service.memory.quickTurnRelatedTitle"),
        t("service.memory.quickTurnRelatedDescription"),
        {
          workspaceId: filters.workspaceId,
          sourceRef: filters.sourceRef,
          memoryViewMode: "workspace_plus_global"
        }
      )
    );
  }

  if (filters.sessionId) {
    views.push(
      createQuickView(
        filters,
        "clear-session",
        t("service.memory.quickClearSessionTitle"),
        t("service.memory.quickClearSessionDescription"),
        {
          workspaceId: filters.workspaceId,
          memoryViewMode: filters.workspaceId ? "workspace_plus_global" : "workspace_plus_global",
          sourceRef: filters.sourceRef
        }
      )
    );
  }

  return views;
}

export function describeCatalogFilterHints(filters: MemoryCatalogFilters, locale: AppLocale = "zh-CN") {
  const t = createTranslator(locale);
  const hints: string[] = [];

  if (filters.sessionId) {
    hints.push(t("service.memory.sessionFilterHint"));
  }

  if (!filters.workspaceId) {
    if (filters.scope === "user" || isImplicitGlobalView(filters)) {
      hints.push(t("service.memory.platformNoWorkspaceHint"));
    } else {
      hints.push(t("service.memory.missingWorkspaceHint"));
    }
  }

  return hints;
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

export function describeCatalogEmptyState(response: MemoryCatalogResponse, locale: AppLocale = "zh-CN") {
  const t = createTranslator(locale);

  if (response.sourceStatus.status === "unavailable" || response.sourceStatus.status === "timeout") {
    return {
      title: t("service.memory.sourceUnavailableTitle"),
      description:
        response.sourceStatus.detail ??
        t("service.memory.sourceUnavailableDescription")
    };
  }

  if (response.sourceStatus.status === "misconfigured") {
    return {
      title: t("service.memory.sourceMisconfiguredTitle"),
      description:
        response.sourceStatus.detail ??
        t("service.memory.sourceMisconfiguredDescription")
    };
  }

  return {
    title: t("service.memory.emptyTitle"),
    description:
      response.appliedFilters.memoryViewMode === "workspace_only"
        ? t("service.memory.emptyWorkspaceOnly")
        : t("service.memory.emptyWorkspaceGlobal")
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
