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
      <div className="rounded-xl border border-dashed bg-white/70 px-4 py-6 text-sm text-slate-500">
        {t("sessionList.emptyTitle")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sessions.map((session) => {
        const isActive = session.id === activeSessionId;
        const isEditing = editingId === session.id;

        return (
          <div
            key={session.id}
            className={cn(
              "w-full rounded-2xl border bg-white/80 p-4 text-left transition hover:border-accent hover:shadow-soft",
              isActive && "border-accent ring-2 ring-accent/15"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                onClick={() => onSelect(session.id)}
                className="min-w-0 flex-1 text-left"
              >
                {isEditing ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const nextTitle = draftTitle.trim();
                      if (!nextTitle) {
                        return;
                      }
                      onRename(session, nextTitle);
                      setEditingId(null);
                    }}
                  >
                    <input
                      autoFocus
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setEditingId(null);
                        }
                      }}
                      className="w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0"
                    />
                  </form>
                ) : (
                  <div className="truncate text-sm font-semibold text-slate-900">
                    {session.title ?? formatSessionTitle(session.id.slice(0, 8))}
                  </div>
                )}
                <div className="mt-2 text-xs text-slate-500">{t("sessionList.workspace", { id: session.workspace_id })}</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  <StatusBadge tone={session.closed_at ? "warning" : "success"}>
                    {session.closed_at ? t("sessionList.closed") : t("sessionList.active")}
                  </StatusBadge>
                  <StatusBadge tone="neutral">{formatMemoryModeLabel(session.memory_mode)}</StatusBadge>
                </div>
              </button>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setEditingId(session.id);
                    setDraftTitle(session.title ?? "");
                  }}
                  className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                  aria-label={t("sessionList.renameAria")}
                >
                  <PencilLine className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(session);
                  }}
                  className="rounded-full p-2 text-slate-500 transition hover:bg-rose-50 hover:text-rose-700"
                  aria-label={t("sessionList.deleteAria")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
