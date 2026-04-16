import { format, formatDistanceToNow } from "date-fns";

import { DashboardMetric, MemoryStatus, MemoryType, Scope, SourceHealthStatus } from "@/lib/contracts";

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
      return "User";
    case "workspace":
      return "Workspace";
  }
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
