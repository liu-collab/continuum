"use client";

import React from "react";
import { Brain, PencilLine, Trash2, Workflow } from "lucide-react";
import { useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";

import { useAgentI18n } from "../_i18n/provider";
import type { MnaSessionSummary } from "../_lib/openapi-types";

function toShortWorkspaceId(workspaceId: string) {
  const normalized = workspaceId.replace(/[^a-zA-Z0-9]/g, "");
  if (normalized.length >= 8) {
    return normalized.slice(0, 8).toLowerCase();
  }

  return workspaceId.slice(0, 8).toLowerCase();
}

type SessionListProps = {
  sessions: MnaSessionSummary[];
  activeSessionId: string | null;
  activeSessionMemoriesHref?: string | null;
  activeSessionRunsHref?: string | null;
  onSelect(sessionId: string): void;
  onRename(session: MnaSessionSummary, title: string): void;
  onDelete(session: MnaSessionSummary): void;
};

export function SessionList({
  sessions,
  activeSessionId,
  activeSessionMemoriesHref,
  activeSessionRunsHref,
  onSelect,
  onRename,
  onDelete
}: SessionListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const { formatMemoryModeLabel, formatSessionTitle, t } = useAgentI18n();

  if (sessions.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-surface-muted/40 px-3 py-5 text-center text-xs text-muted-foreground">
        {t("sessionList.emptyTitle")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sessions.map((session) => {
        const isActive = session.id === activeSessionId;
        const isEditing = editingId === session.id;

        return (
          <div
            key={session.id}
            data-testid={`session-card-${session.id}`}
            className={cn(
              "w-full rounded-md border bg-surface p-3 text-left transition hover:border-border-strong",
              isActive && "border-accent bg-accent-soft"
            )}
          >
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2">
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
                    <div className="truncate text-sm font-medium text-foreground">
                      {session.title ?? formatSessionTitle(session.id.slice(0, 8))}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {t("sessionList.workspace", { id: toShortWorkspaceId(session.workspace_id) })}
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
                  className="rounded-md p-1.5 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
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
                  className="rounded-md p-1.5 text-muted-foreground transition hover:bg-rose-50 hover:text-rose-700"
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
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border bg-surface-muted/40 text-muted-foreground opacity-50"
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
      className="inline-flex h-7 w-7 items-center justify-center rounded-full border bg-surface text-muted-foreground transition hover:text-foreground"
    >
      {icon}
    </a>
  );
}
