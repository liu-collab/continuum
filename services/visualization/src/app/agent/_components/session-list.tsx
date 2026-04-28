"use client";

import React from "react";
import { Brain, PencilLine, Trash2, Workflow } from "lucide-react";
import { useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";

import { useAgentI18n } from "../_i18n/provider";
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
  onRename(session: MnaSessionSummary, title: string): void;
  onDelete(session: MnaSessionSummary): void;
};

export function SessionList({
  sessions,
  workspaces = [],
  activeSessionId,
  activeSessionMemoriesHref,
  activeSessionRunsHref,
  onSelect,
  onRename,
  onDelete
}: SessionListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
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
        const isEditing = editingId === session.id;
        const workspace = workspaces.find((item) => item.workspace_id === session.workspace_id) ?? null;
        const workspaceLabel = getSessionWorkspaceLabel(locale, session, workspace);
        const workspaceTitle = workspace
          ? `${getWorkspacePathLabel(workspace)} · ${t("fileTree.workspaceDebugIdLabel")}: ${getWorkspaceDebugId(workspace)}`
          : session.workspace_id;

        return (
          <div
            key={session.id}
            data-testid={`session-card-${session.id}`}
            className={cn(
              "w-full rounded-[var(--radius-lg)] border border-[var(--hairline)] bg-[var(--canvas)] p-4 text-left transition hover:border-[var(--primary)]",
              isActive && "border-[var(--primary-focus)] bg-[var(--cyan-bg)]"
            )}
          >
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3">
              <div className="min-w-0">
                {isEditing ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const nextTitle = draftTitle.trim();
                      if (!nextTitle) return;
                      onRename(session, nextTitle);
                      setEditingId(null);
                    }}
                  >
                    <input
                      autoFocus
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setEditingId(null);
                      }}
                      className="field"
                    />
                  </form>
                ) : (
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
                )}
              </div>
              <div
                data-testid={`session-card-action-rail-${session.id}`}
                className="flex shrink-0 items-start gap-0.5 self-start"
              >
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setEditingId(session.id);
                    setDraftTitle(session.title ?? "");
                  }}
                  className="icon-button !h-8 !w-8 !bg-transparent text-muted-foreground hover:!bg-[var(--surface-pearl)] hover:text-foreground"
                  aria-label={t("sessionList.renameAria")}
                >
                  <PencilLine className="h-3.5 w-3.5" />
                </button>
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
              {isEditing ? (
                <>
                  <div />
                  <div />
                </>
              ) : (
                <>
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
                  <div className="flex shrink-0 items-center justify-end">
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
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function getSessionWorkspaceLabel(locale: AgentLocale, session: MnaSessionSummary, workspace: MnaWorkspaceSummary | null) {
  const folderLabel = getWorkspaceFolderLabel(workspace);
  if (folderLabel) {
    return folderLabel;
  }

  return locale === "en-US"
    ? `Unknown workspace ${getShortIdentifier(session.workspace_id)}`
    : `未知工作区 ${getShortIdentifier(session.workspace_id)}`;
}

function formatFallbackSessionTitle(locale: AgentLocale, session: MnaSessionSummary) {
  const formattedTime = formatSessionTimeTitle(locale, session.created_at);
  if (formattedTime) {
    return locale === "en-US" ? `Session · ${formattedTime}` : `会话 · ${formattedTime}`;
  }

  return locale === "en-US" ? "Untitled session" : "未命名会话";
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
