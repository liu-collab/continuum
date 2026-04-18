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
    originWorkspaceLabel: originWorkspaceId ? `来源工作区 ${originWorkspaceId}` : "未记录来源工作区",
    visibilitySummary: visibilitySummary(scope, filters.memoryViewMode, originWorkspaceId),
    sourceType: source.sourceType,
    sourceRef: source.sourceRef,
    sourceServiceName: source.sourceServiceName,
    sourceSummary: [source.sourceType ?? "未知来源", source.sourceRef ?? "未记录来源引用"].join(
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
      ? `${base} 当前工作区：${filters.workspaceId}。`
      : `${base} 当前缺少 workspace_id，所以只能依赖显式筛选条件进一步收窄结果。`;
  }

  return filters.workspaceId && filters.userId
    ? `${base} 当前工作区：${filters.workspaceId}。全局记忆归属用户：${filters.userId}。`
    : `${base} 当前缺少部分身份字段，所以页面结果可能不完整。`;
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
      title: "记忆数据源暂不可用",
      description:
        response.sourceStatus.detail ??
        "共享读模型当前不可查询，所以记忆目录暂时处于降级状态。"
    };
  }

  if (response.sourceStatus.status === "misconfigured") {
    return {
      title: "记忆数据源配置不完整",
      description:
        response.sourceStatus.detail ??
        "共享读模型连接尚未配置完成，所以目录暂时无法加载。"
    };
  }

  return {
    title: "当前视图下没有匹配的记忆",
    description:
      response.appliedFilters.memoryViewMode === "workspace_only"
        ? "当前是仅工作区视图，没有任何工作区、任务或会话记忆命中当前工作区和筛选条件。"
        : "当前是工作区加全局视图，没有任何当前工作区或全局记忆命中所选筛选条件。"
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
    sourceFormatted: sourceParts.length > 0 ? sourceParts.join(" / ") : "未知",
    createdAt: record.created_at
  };
}
