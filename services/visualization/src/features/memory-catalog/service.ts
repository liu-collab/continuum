import "server-only";

import { MemoryCatalogDetail, MemoryCatalogFilters, MemoryCatalogItem, MemoryCatalogResponse } from "@/lib/contracts";
import {
  memoryStatusExplanation,
  memoryStatusLabel,
  memoryTypeLabel,
  memoryViewModeExplanation,
  scopeExplanation,
  scopeLabel,
  visibilitySummary
} from "@/lib/format";
import {
  fetchMemoryById,
  mapSource,
  queryCatalogView
} from "@/lib/server/storage-read-model-client";

function toCatalogItem(
  row: Awaited<ReturnType<typeof queryCatalogView>>["rows"][number],
  filters: MemoryCatalogFilters
): MemoryCatalogItem {
  const source = mapSource(row.source);
  const originWorkspaceId = source.originWorkspaceId ?? row.workspace_id;
  const scope = row.scope as MemoryCatalogResponse["items"][number]["scope"];
  const status = row.status as MemoryCatalogResponse["items"][number]["status"];
  const memoryType = row.memory_type as MemoryCatalogResponse["items"][number]["memoryType"];

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    taskId: row.task_id,
    sessionId: row.session_id,
    memoryType,
    memoryTypeLabel: memoryTypeLabel(memoryType),
    scope,
    scopeLabel: scopeLabel(scope),
    scopeExplanation: scopeExplanation(scope, originWorkspaceId),
    status,
    statusLabel: memoryStatusLabel(status),
    statusExplanation: memoryStatusExplanation(status),
    summary: row.summary,
    importance: row.importance,
    confidence: row.confidence,
    originWorkspaceId,
    originWorkspaceLabel: originWorkspaceId ? `Origin workspace ${originWorkspaceId}` : "No origin workspace recorded",
    visibilitySummary: visibilitySummary(scope, filters.memoryViewMode, originWorkspaceId),
    sourceType: source.sourceType,
    sourceRef: source.sourceRef,
    sourceServiceName: source.sourceServiceName,
    sourceSummary: [source.sourceType ?? "unknown source", source.sourceRef ?? "no source ref"].join(
      " · "
    ),
    lastConfirmedAt: row.last_confirmed_at,
    updatedAt: row.updated_at
  };
}

function buildViewSummary(filters: MemoryCatalogFilters) {
  const base = memoryViewModeExplanation(filters.memoryViewMode);

  if (filters.memoryViewMode === "workspace_only") {
    return filters.workspaceId
      ? `${base} Current workspace: ${filters.workspaceId}.`
      : `${base} Workspace id is missing, so only explicit filters can narrow the result.`;
  }

  return filters.workspaceId && filters.userId
    ? `${base} Current workspace: ${filters.workspaceId}. Global memory owner: ${filters.userId}.`
    : `${base} One or more identity fields are missing, so the view may be partial.`;
}

export async function getMemoryCatalog(filters: MemoryCatalogFilters): Promise<MemoryCatalogResponse> {
  const result = await queryCatalogView(filters);

  return {
    items: result.rows.map((row) => toCatalogItem(row, filters)),
    total: result.total,
    page: filters.page,
    pageSize: filters.pageSize,
    appliedFilters: filters,
    viewSummary: buildViewSummary(filters),
    viewWarnings: result.warnings,
    sourceStatus: result.status
  };
}

export function describeCatalogEmptyState(response: MemoryCatalogResponse) {
  if (response.sourceStatus.status === "unavailable" || response.sourceStatus.status === "timeout") {
    return {
      title: "Memory source unavailable",
      description:
        response.sourceStatus.detail ??
        "The shared read model could not be queried, so the memory catalog is temporarily degraded."
    };
  }

  if (response.sourceStatus.status === "misconfigured") {
    return {
      title: "Memory source misconfigured",
      description:
        response.sourceStatus.detail ??
        "The shared read model connection is not configured, so the catalog cannot load yet."
    };
  }

  return {
    title: "No memories matched this view",
    description:
      response.appliedFilters.memoryViewMode === "workspace_only"
        ? "The workspace-only view is active. No workspace, task, or session memories matched the current workspace and filters."
        : "The workspace + global view is active. No current workspace or global memories matched the selected filters."
  };
}

export async function getMemoryDetail(id: string): Promise<MemoryCatalogDetail | null> {
  const record = await fetchMemoryById(id);

  if (!record) {
    return null;
  }

  const filters = {
    workspaceId: record.workspace_id ?? undefined,
    userId: record.user_id ?? undefined,
    taskId: record.task_id ?? undefined,
    memoryViewMode: "workspace_plus_global" as const,
    memoryType: undefined,
    scope: undefined,
    status: undefined,
    updatedFrom: undefined,
    updatedTo: undefined,
    page: 1,
    pageSize: 1
  };
  const base = toCatalogItem(record, filters);
  const sourceParts = [base.sourceType, base.sourceRef, base.sourceServiceName].filter(Boolean);

  return {
    ...base,
    details: record.details,
    detailsFormatted: JSON.stringify(record.details ?? {}, null, 2),
    sourceFormatted: sourceParts.length > 0 ? sourceParts.join(" / ") : "Unknown",
    createdAt: record.created_at
  };
}
