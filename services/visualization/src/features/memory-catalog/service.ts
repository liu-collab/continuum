import "server-only";

import { MemoryCatalogDetail, MemoryCatalogFilters, MemoryCatalogItem, MemoryCatalogResponse } from "@/lib/contracts";
import {
  memoryStatusExplanation,
  memoryStatusLabel,
  memoryTypeLabel,
  scopeLabel
} from "@/lib/format";
import {
  fetchMemoryById,
  mapSource,
  queryMemoryReadModel
} from "@/lib/server/storage-read-model-client";

function toCatalogItem(
  row: Awaited<ReturnType<typeof queryMemoryReadModel>>["rows"][number]
): MemoryCatalogItem {
  const source = mapSource(row.source);

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    taskId: row.task_id,
    sessionId: row.session_id,
    memoryType: row.memory_type as MemoryCatalogResponse["items"][number]["memoryType"],
    memoryTypeLabel: memoryTypeLabel(
      row.memory_type as MemoryCatalogResponse["items"][number]["memoryType"]
    ),
    scope: row.scope as MemoryCatalogResponse["items"][number]["scope"],
    scopeLabel: scopeLabel(row.scope as MemoryCatalogResponse["items"][number]["scope"]),
    status: row.status as MemoryCatalogResponse["items"][number]["status"],
    statusLabel: memoryStatusLabel(
      row.status as MemoryCatalogResponse["items"][number]["status"]
    ),
    statusExplanation: memoryStatusExplanation(
      row.status as MemoryCatalogResponse["items"][number]["status"]
    ),
    summary: row.summary,
    importance: row.importance,
    confidence: row.confidence,
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

export async function getMemoryCatalog(filters: MemoryCatalogFilters): Promise<MemoryCatalogResponse> {
  const result = await queryMemoryReadModel(filters);

  return {
    items: result.rows.map(toCatalogItem),
    total: result.total,
    page: filters.page,
    pageSize: filters.pageSize,
    appliedFilters: filters,
    sourceStatus: result.status
  };
}

export function describeCatalogEmptyState(response: MemoryCatalogResponse) {
  if (response.sourceStatus.status !== "healthy") {
    return {
      title: "Memory source unavailable",
      description:
        response.sourceStatus.detail ??
        "The shared read model could not be queried, so the memory catalog is temporarily degraded."
    };
  }

  return {
    title: "No memories matched these filters",
    description:
      "The shared read model is reachable, but no structured records matched the selected workspace, task, type, or status filters."
  };
}

export async function getMemoryDetail(id: string): Promise<MemoryCatalogDetail | null> {
  const record = await fetchMemoryById(id);

  if (!record) {
    return null;
  }

  const base = toCatalogItem(record);
  const sourceParts = [base.sourceType, base.sourceRef, base.sourceServiceName].filter(Boolean);

  return {
    ...base,
    details: record.details,
    detailsFormatted: JSON.stringify(record.details ?? {}, null, 2),
    sourceFormatted: sourceParts.length > 0 ? sourceParts.join(" / ") : "Unknown",
    createdAt: record.created_at
  };
}
