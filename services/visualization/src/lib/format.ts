import { format, formatDistanceToNow } from "date-fns";

import {
  DashboardMetric,
  GovernanceExecutionDetail,
  MemoryStatus,
  MemoryType,
  MemoryViewMode,
  Scope,
  SourceHealthStatus
} from "@/lib/contracts";

export function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return "未记录";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${format(date, "yyyy-MM-dd HH:mm:ss")} (${formatDistanceToNow(date, { addSuffix: true })})`;
}

export function formatLastSuccess(value: string | null | undefined) {
  if (!value) {
    return "从未成功连接";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return formatDistanceToNow(date, { addSuffix: true });
}

export function formatMetricValue(value: number | null, unit: DashboardMetric["unit"]) {
  if (value === null || Number.isNaN(value)) {
    return "不可用";
  }

  if (unit === "percent") {
    return `${(value * 100).toFixed(1)}%`;
  }

  if (unit === "ms") {
    return `${Math.round(value)} ms`;
  }

  return new Intl.NumberFormat("zh-CN").format(value);
}

export function dashboardSeverityLabel(value: string) {
  switch (value) {
    case "danger":
      return "异常";
    case "warning":
      return "关注";
    case "info":
      return "提示";
    case "normal":
      return "正常";
    case "healthy":
      return "健康";
    case "unknown":
      return "未知";
    default:
      return value;
  }
}

export function dashboardSeverityTone(value: string) {
  if (value === "danger") return "danger";
  if (value === "warning") return "warning";
  if (value === "normal" || value === "healthy") return "success";
  return "neutral";
}

export function memoryTypeLabel(value: MemoryType) {
  switch (value) {
    case "fact_preference":
      return "事实与偏好";
    case "task_state":
      return "任务状态";
    case "episodic":
      return "情景记忆";
  }
}

export function scopeLabel(value: Scope) {
  switch (value) {
    case "session":
      return "会话";
    case "task":
      return "任务";
    case "user":
      return "平台";
    case "workspace":
      return "工作区";
  }
}

export function scopeExplanation(value: Scope, originWorkspaceId?: string | null) {
  if (value === "user") {
    return originWorkspaceId
      ? `这是平台级记忆。它会在不同工作区之间共享显示。来源工作区：${originWorkspaceId}。`
      : "这是平台级记忆。它会在不同工作区之间共享显示。";
  }

  if (value === "workspace") {
    return "这是工作区记忆，只会在当前工作区范围内复用。";
  }

  if (value === "task") {
    return "这是任务记忆，会绑定在当前任务链路上。";
  }

  return "这是会话记忆，只属于当前会话上下文。";
}

export function memoryViewModeLabel(value: MemoryViewMode) {
  return value === "workspace_only" ? "仅工作区" : "工作区 + 平台";
}

export function memoryViewModeExplanation(value: MemoryViewMode) {
  return value === "workspace_only"
    ? "只显示当前工作区内的工作区、任务和会话记忆。"
    : "显示当前工作区内的工作区、任务和会话记忆，同时包含平台级记忆。";
}

export function visibilitySummary(
  scope: Scope,
  memoryViewMode: MemoryViewMode,
  originWorkspaceId?: string | null
) {
  if (scope === "user") {
    return memoryViewMode === "workspace_only"
      ? "当前是仅工作区模式，所以这条平台级记忆会被隐藏。"
      : originWorkspaceId
        ? `当前视图包含平台级记忆，所以它会显示。来源工作区：${originWorkspaceId}。`
        : "当前视图包含平台级记忆，所以它会显示。";
  }

  if (scope === "workspace") {
    return "它属于当前工作区，所以会显示。";
  }

  if (scope === "task") {
    return "它作为当前工作区上下文中的任务记忆被保留，所以会显示。";
  }

  return "它作为当前工作区上下文中的会话记忆被保留，所以会显示。";
}

export function memoryStatusLabel(value: MemoryStatus) {
  switch (value) {
    case "active":
      return "生效中";
    case "superseded":
      return "已被替代";
    case "archived":
      return "已归档";
    case "pending_confirmation":
      return "待确认";
    case "deleted":
      return "已删除";
  }
}

export function memoryStatusExplanation(value: MemoryStatus) {
  switch (value) {
    case "active":
      return "当前可参与自动召回。";
    case "pending_confirmation":
      return "在冲突或确认问题解决前，默认不会参与召回。";
    case "superseded":
      return "已被更新版本替代，但仍保留用于追踪。";
    case "archived":
      return "作为历史记录保留用于查看，不再参与默认召回。";
    case "deleted":
      return "已从常规视图和召回中移除。";
  }
}

export function memoryModeSummary(value: MemoryViewMode | null | undefined) {
  if (value === "workspace_only") {
    return "当前模式是仅工作区。";
  }

  if (value === "workspace_plus_global") {
    return "当前模式包含工作区和平台级记忆。";
  }

  return "未记录记忆模式。";
}

export function sourceStatusTone(status: SourceHealthStatus) {
  switch (status) {
    case "healthy":
      return "success";
    case "partial":
      return "warning";
    case "misconfigured":
    case "timeout":
    case "unavailable":
      return "danger";
  }
}

export function sourceStatusLabel(status: SourceHealthStatus) {
  switch (status) {
    case "healthy":
      return "健康";
    case "partial":
      return "部分可用";
    case "misconfigured":
      return "配置异常";
    case "timeout":
      return "超时";
    case "unavailable":
      return "不可用";
  }
}

export function governanceProposalTypeLabel(value: string) {
  switch (value) {
    case "archive":
      return "归档";
    case "confirm":
      return "确认";
    case "delete":
      return "软删除";
    case "downgrade":
      return "降级";
    case "merge":
      return "合并";
    case "resolve_conflict":
      return "解决冲突";
    case "summarize":
      return "摘要收敛";
    default:
      return value;
  }
}

export function governanceExecutionStatusLabel(value: string) {
  switch (value) {
    case "executed":
      return "执行成功";
    case "failed":
      return "执行失败";
    case "executing":
      return "执行中";
    case "verified":
      return "已复核";
    case "proposed":
      return "已提案";
    case "rejected_by_guard":
      return "已拦截";
    case "cancelled":
      return "已取消";
    case "superseded":
      return "已覆盖";
    default:
      return value;
  }
}

export function governanceStatusTone(value: string) {
  if (value === "executed" || value === "verified") {
    return "success";
  }

  if (value === "failed" || value === "rejected_by_guard") {
    return "danger";
  }

  if (value === "executing" || value === "proposed" || value === "cancelled" || value === "superseded") {
    return "warning";
  }

  return "neutral";
}

export function summarizeGovernanceTarget(
  targets: GovernanceExecutionDetail["targets"] | Array<{ recordId: string | null; conflictId: string | null; role: string }>,
) {
  const parts = targets.map((target) => {
    if (target.recordId) {
      return `${target.role}:${target.recordId}`;
    }
    if (target.conflictId) {
      return `${target.role}:${target.conflictId}`;
    }
    return target.role;
  });

  return parts.length > 0 ? parts.join(" · ") : "未记录目标";
}
