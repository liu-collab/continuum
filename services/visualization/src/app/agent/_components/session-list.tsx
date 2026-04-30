"use client";

import React from "react";
import { Brain, Trash2, Workflow } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { createTranslator } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

import { useAgentI18n } from "@/lib/i18n/agent/provider";
import {
  formatSessionTimeTitle,
  getShortIdentifier,
  getWorkspaceDebugId,
  getWorkspaceFolderLabel,
  getWorkspacePathLabel
} from "../_lib/display";
import type { AgentLocale, MnaSessionSummary, MnaWorkspaceSummary } from "../_lib/openapi-types";

type SessionListProps = {
  sessions: MnaSessionSummary[];
  workspaces?: MnaWorkspaceSummary[];
  activeSessionId: string | null;
  activeSessionMemoriesHref?: string | null;
  activeSessionRunsHref?: string | null;
  onSelect(sessionId: string): void;
  onDelete(session: MnaSessionSummary): void;
};

export function SessionList({
  sessions,
  workspaces = [],
  activeSessionId,
  activeSessionMemoriesHref,
  activeSessionRunsHref,
  onSelect,
  onDelete
}: SessionListProps) {
  const { formatMemoryModeLabel, locale, t } = useAgentI18n();

  if (sessions.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed bg-[var(--surface-pearl)] px-4 py-8 text-center text-[14px] leading-[1.43] text-muted-foreground">
        {t("sessionList.emptyTitle")}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {sessions.map((session) => {
        const isActive = session.id === activeSessionId;
        const workspace = workspaces.find((item) => item.workspace_id === session.workspace_id) ?? null;
        const workspaceLabel = getSessionWorkspaceLabel(locale, session, workspace);
        const workspaceTitle = workspace
          ? `${getWorkspacePathLabel(workspace)} · ${t("fileTree.workspaceDebugIdLabel")}: ${getWorkspaceDebugId(workspace)}`
          : session.workspace_id;

        return (
          <div
            key={session.id}
            data-testid={`session-card-${session.id}`}
            data-active={isActive ? "true" : "false"}
            className={cn(
              "w-full rounded-[var(--radius-lg)] border border-[var(--hairline)] bg-[var(--canvas)] p-4 text-left transition hover:border-[var(--primary)]",
              isActive && "border-[var(--primary-focus)] bg-[var(--cyan-bg)]"
            )}
          >
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3">
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => onSelect(session.id)}
                  className="w-full text-left"
                >
                  <div className="truncate text-[17px] font-semibold leading-[1.24] text-foreground">
                    {session.title ?? formatFallbackSessionTitle(locale, session)}
                  </div>
                  <div className="mt-2 truncate text-[14px] leading-[1.43] text-muted-foreground" title={workspaceTitle}>
                    {t("sessionList.workspace", { label: workspaceLabel })}
                  </div>
                </button>
              </div>
              <div
                data-testid={`session-card-action-rail-${session.id}`}
                className="flex shrink-0 items-start gap-0.5 self-start"
              >
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(session);
                  }}
                  className="icon-button !h-8 !w-8 !bg-transparent text-muted-foreground hover:!bg-[var(--surface-pearl)] hover:text-foreground"
                  aria-label={t("sessionList.deleteAria")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => onSelect(session.id)}
                className="flex min-w-0 items-center gap-3 text-left"
              >
                <div
                  data-testid={`session-card-status-row-${session.id}`}
                  className="flex min-w-0 flex-wrap items-center gap-1.5"
                >
                  <StatusBadge tone={session.closed_at ? "warning" : "success"}>
                    {session.closed_at ? t("sessionList.closed") : t("sessionList.active")}
                  </StatusBadge>
                  <StatusBadge tone="neutral">{formatMemoryModeLabel(session.memory_mode)}</StatusBadge>
                </div>
              </button>
              <div className="flex min-h-8 shrink-0 items-center justify-end">
                {isActive ? (
                  <div
                    data-testid={`session-card-quick-actions-${session.id}`}
                    className="flex items-center gap-2"
                  >
                    <QuickActionLink
                      href={activeSessionMemoriesHref ?? null}
                      title={t("workspace.currentTurnMemories")}
                      icon={<Brain className="h-3.5 w-3.5" />}
                    />
                    <QuickActionLink
                      href={activeSessionRunsHref ?? null}
                      title={t("workspace.currentTurnRuns")}
                      icon={<Workflow className="h-3.5 w-3.5" />}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function getSessionWorkspaceLabel(locale: AgentLocale, session: MnaSessionSummary, workspace: MnaWorkspaceSummary | null) {
  const t = createTranslator(locale);
  const folderLabel = getWorkspaceFolderLabel(workspace);
  if (folderLabel) {
    return folderLabel;
  }

  return t("service.memory.unknownWorkspace", {
    id: getShortIdentifier(session.workspace_id)
  });
}

function formatFallbackSessionTitle(locale: AgentLocale, session: MnaSessionSummary) {
  const t = createTranslator(locale);
  const formattedTime = formatSessionTimeTitle(locale, session.created_at);
  if (formattedTime) {
    return t("service.memory.sessionTimeTitle", { time: formattedTime });
  }

  return t("service.memory.untitledSession");
}

function QuickActionLink({
  href,
  title,
  icon
}: {
  href: string | null;
  title: string;
  icon: React.ReactNode;
}) {
  if (!href) {
    return (
      <span
        title={title}
        aria-label={title}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--hairline)] bg-[var(--surface-pearl)] text-muted-foreground opacity-50"
      >
        {icon}
      </span>
    );
  }

  return (
    <a
      href={href}
      title={title}
      aria-label={title}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--hairline)] bg-[var(--canvas)] text-muted-foreground transition hover:border-[var(--primary)] hover:text-foreground"
    >
      {icon}
    </a>
  );
}
