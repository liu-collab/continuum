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
  visibilitySummary
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

export type MemoryCatalogQuickView = {
  key: string;
  label: string;
  description: string;
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
      ? `${base} 当前工作区：${filters.workspaceId}${filters.sessionId ? `，会话：${filters.sessionId}` : ""}${filters.sourceRef ? `，来源引用：${filters.sourceRef}` : ""}。`
      : `${base} 当前缺少 workspace_id，所以只能依赖显式筛选条件进一步收窄结果。`;
  }

  if (filters.scope === "user" || isImplicitGlobalView(filters)) {
    return `${base} 当前正在查看平台级记忆，不需要 workspace_id。`;
  }

  return filters.workspaceId
    ? `${base} 当前工作区：${filters.workspaceId}。${filters.sessionId ? `当前会话：${filters.sessionId}。` : ""}${filters.sourceRef ? `当前来源引用：${filters.sourceRef}。` : ""}`
    : `${base} 当前缺少 workspace_id，所以页面结果可能不完整。`;
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

export function buildMemoryCatalogQuickViews(filters: MemoryCatalogFilters): MemoryCatalogQuickView[] {
  const views: MemoryCatalogQuickView[] = [
    createQuickView(
      filters,
      "global-user",
      "全局记忆",
      "直接查看平台级偏好和长期事实，不受 session_id 限制。",
      {
        memoryViewMode: "workspace_plus_global",
        scope: "user"
      }
    )
  ];

  if (filters.workspaceId) {
    views.push(
      createQuickView(
        filters,
        "workspace-plus-global",
        "当前工作区 + 全局",
        "查看当前工作区的工作区、任务、会话记忆，同时包含全局记忆。",
        {
          workspaceId: filters.workspaceId,
          memoryViewMode: "workspace_plus_global"
        }
      ),
      createQuickView(
        filters,
        "workspace-only",
        "仅当前工作区",
        "只看当前工作区下的工作区、任务、会话记忆，不包含全局记忆。",
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
        "本轮相关",
        "按来源引用查看这一轮写出来的相关记忆。",
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
        "去掉会话限制",
        "保留当前工作区，但不再用 session_id 限制结果，避免把全局记忆筛掉。",
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

export function describeCatalogFilterHints(filters: MemoryCatalogFilters) {
  const hints: string[] = [];

  if (filters.sessionId) {
    hints.push("当前带了 session_id，只会稳定命中会话级记录。平台级记忆通常没有 session_id，所以想看全局偏好时请直接点“全局记忆”。");
  }

  if (!filters.workspaceId) {
    if (filters.scope === "user" || isImplicitGlobalView(filters)) {
      hints.push("当前正在查看平台级记忆，不需要 workspace_id。");
    } else {
      hints.push("当前没有 workspace_id，页面只能稳定展示平台级记忆。要看工作区、任务或会话记忆，请补充 workspace_id。");
    }
  }

  return hints;
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
  const base = toCatalogItem(record, filters);
  const sourceParts = [base.sourceType, base.sourceRef, base.sourceServiceName].filter(Boolean);
  const governanceResult = await fetchGovernanceExecutions({
    workspaceId: record.workspace_id ?? undefined,
    proposalType: undefined,
    executionStatus: undefined,
    limit: 50,
  });
  const governanceHistory = governanceResult.items.filter((item: (typeof governanceResult.items)[number]) =>
    item.targetSummary.includes(id),
  );

  return {
    ...base,
    details: record.details,
    detailsFormatted: JSON.stringify(record.details ?? {}, null, 2),
    sourceFormatted: sourceParts.length > 0 ? sourceParts.join(" / ") : "未知",
    createdAt: record.created_at,
    governanceHistory,
    governanceSummary:
      governanceHistory.length > 0
        ? `最近 ${governanceHistory.length} 次自动治理命中过这条记忆。`
        : "当前还没有自动治理命中这条记忆。",
  };
}

export async function getGovernanceHistory(
  filters: GovernanceExecutionFilters,
): Promise<GovernanceExecutionResponse> {
  const result = await fetchGovernanceExecutions(filters);

  return {
    items: result.items,
    appliedFilters: filters,
    sourceStatus: result.status,
  };
}

export async function getGovernanceExecutionDetail(executionId: string) {
  return fetchGovernanceExecutionDetail(executionId);
}
