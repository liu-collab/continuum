import { format, formatDistanceToNow } from "date-fns";

import {
  DashboardMetric,
  MemoryStatus,
  MemoryType,
  MemoryViewMode,
  Scope,
  SourceHealthStatus
} from "@/lib/contracts";

export function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return "Not available";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${format(date, "yyyy-MM-dd HH:mm:ss")} (${formatDistanceToNow(date, { addSuffix: true })})`;
}

export function formatLastSuccess(value: string | null | undefined) {
  if (!value) {
    return "Never connected";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return formatDistanceToNow(date, { addSuffix: true });
}

export function formatMetricValue(value: number | null, unit: DashboardMetric["unit"]) {
  if (value === null || Number.isNaN(value)) {
    return "Unavailable";
  }

  if (unit === "percent") {
    return `${(value * 100).toFixed(1)}%`;
  }

  if (unit === "ms") {
    return `${Math.round(value)} ms`;
  }

  return new Intl.NumberFormat("en-US").format(value);
}

export function memoryTypeLabel(value: MemoryType) {
  switch (value) {
    case "fact_preference":
      return "Facts & preferences";
    case "task_state":
      return "Task state";
    case "episodic":
      return "Episodic";
  }
}

export function scopeLabel(value: Scope) {
  switch (value) {
    case "session":
      return "Session";
    case "task":
      return "Task";
    case "user":
      return "Global";
    case "workspace":
      return "Workspace";
  }
}

export function scopeExplanation(value: Scope, originWorkspaceId?: string | null) {
  if (value === "user") {
    return originWorkspaceId
      ? `Global memory. It can appear in the current workspace because global memory is shared across workspaces. Origin workspace: ${originWorkspaceId}.`
      : "Global memory. It can appear in the current workspace because global memory is shared across workspaces.";
  }

  if (value === "workspace") {
    return "Workspace memory. It is only meant to be reused inside the current workspace boundary.";
  }

  if (value === "task") {
    return "Task memory. It stays tied to the current task chain.";
  }

  return "Session memory. It belongs to the current session context only.";
}

export function memoryViewModeLabel(value: MemoryViewMode) {
  return value === "workspace_only" ? "Workspace only" : "Workspace + global";
}

export function memoryViewModeExplanation(value: MemoryViewMode) {
  return value === "workspace_only"
    ? "Only workspace, task, and session memories from the current workspace are shown."
    : "Workspace, task, and session memories from the current workspace are shown together with global memories.";
}

export function visibilitySummary(
  scope: Scope,
  memoryViewMode: MemoryViewMode,
  originWorkspaceId?: string | null
) {
  if (scope === "user") {
    return memoryViewMode === "workspace_only"
      ? "This global memory is hidden in workspace-only mode."
      : originWorkspaceId
        ? `Visible because the current view includes global memory. Origin workspace: ${originWorkspaceId}.`
        : "Visible because the current view includes global memory.";
  }

  if (scope === "workspace") {
    return "Visible because it belongs to the current workspace.";
  }

  if (scope === "task") {
    return "Visible because task memory is retained for the current workspace context.";
  }

  return "Visible because session memory is retained for the current workspace context.";
}

export function memoryStatusLabel(value: MemoryStatus) {
  switch (value) {
    case "active":
      return "Active";
    case "superseded":
      return "Superseded";
    case "archived":
      return "Archived";
    case "pending_confirmation":
      return "Pending confirmation";
    case "deleted":
      return "Deleted";
  }
}

export function memoryStatusExplanation(value: MemoryStatus) {
  switch (value) {
    case "active":
      return "Currently eligible for automatic recall.";
    case "pending_confirmation":
      return "Held back from default recall until the conflict or confirmation issue is resolved.";
    case "superseded":
      return "Replaced by a newer version and kept for traceability.";
    case "archived":
      return "Historical record kept for review, not part of default recall.";
    case "deleted":
      return "Removed from normal views and recall.";
  }
}

export function memoryModeSummary(value: MemoryViewMode | null | undefined) {
  if (value === "workspace_only") {
    return "Current mode is workspace only.";
  }

  if (value === "workspace_plus_global") {
    return "Current mode includes workspace and global memory.";
  }

  return "Memory mode was not recorded.";
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
