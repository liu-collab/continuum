"use client";

import React from "react";
import { PencilLine, Trash2 } from "lucide-react";
import { useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";

import { useAgentI18n } from "../_i18n/provider";
import type { MnaSessionSummary } from "../_lib/openapi-types";

type SessionListProps = {
  sessions: MnaSessionSummary[];
  activeSessionId: string | null;
  onSelect(sessionId: string): void;
  onRename(session: MnaSessionSummary, title: string): void;
  onDelete(session: MnaSessionSummary): void;
};

export function SessionList({
  sessions,
  activeSessionId,
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
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
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
                      {t("sessionList.workspace", { id: session.workspace_id })}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <StatusBadge tone={session.closed_at ? "warning" : "success"}>
                        {session.closed_at ? t("sessionList.closed") : t("sessionList.active")}
                      </StatusBadge>
                      <StatusBadge tone="neutral">{formatMemoryModeLabel(session.memory_mode)}</StatusBadge>
                    </div>
                  </button>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
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
            </div>
          </div>
        );
      })}
    </div>
  );
}
