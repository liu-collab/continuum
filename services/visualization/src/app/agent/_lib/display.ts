import type { AgentLocale, MnaWorkspaceSummary } from "./openapi-types";

type WorkspaceDisplaySource = Pick<MnaWorkspaceSummary, "workspace_id" | "short_id" | "cwd" | "label">;

export function getShortIdentifier(value: string | null | undefined, length = 8) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.length <= 24) {
    return trimmed;
  }

  return trimmed.slice(0, length).toLowerCase();
}

export function getWorkspaceDebugId(workspace: Pick<WorkspaceDisplaySource, "workspace_id" | "short_id">) {
  return workspace.short_id?.trim() || getShortIdentifier(workspace.workspace_id);
}

export function getFolderNameFromPath(cwd: string | null | undefined) {
  const trimmed = cwd?.trim();
  if (!trimmed) {
    return "";
  }

  const normalized = trimmed.replace(/[\\/]+$/, "");
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? normalized;
}

export function getWorkspaceFolderLabel(workspace: Pick<WorkspaceDisplaySource, "cwd" | "label"> | null | undefined) {
  return workspace?.label?.trim() || getFolderNameFromPath(workspace?.cwd) || "";
}

export function getWorkspacePathLabel(workspace: Pick<WorkspaceDisplaySource, "cwd" | "label"> | null | undefined) {
  return workspace?.cwd?.trim() || getWorkspaceFolderLabel(workspace);
}

export function formatSessionTimeTitle(locale: AgentLocale, createdAt: string | null | undefined) {
  if (!createdAt) {
    return null;
  }

  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const formatted = new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);

  return formatted;
}
