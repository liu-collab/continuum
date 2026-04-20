"use client";

import React from "react";
import { LoaderCircle, SendHorizontal, Square, WandSparkles } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { StatusBadge } from "@/components/status-badge";

import { useAgentI18n } from "../_i18n/provider";
import type { AgentConnectionState } from "../_lib/openapi-types";
import type { AgentTurnState } from "../_lib/event-reducer";

type ChatPanelProps = {
  turns: AgentTurnState[];
  connection: AgentConnectionState;
  degraded: boolean;
  activeTaskLabel: string | null;
  onSend(text: string): void;
  onAbort(): void;
  onOpenPrompt(turnId: string): void;
};

export function ChatPanel({
  turns,
  connection,
  degraded,
  activeTaskLabel,
  onSend,
  onAbort,
  onOpenPrompt
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const { formatConnection, formatFinishReasonLabel, formatPhaseLabel, t } = useAgentI18n();
  const isBusy = turns.some((turn) => turn.status === "streaming");
  const latestTurn = turns.at(-1) ?? null;

  return (
    <div className="flex min-h-[38rem] flex-col rounded-lg border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">{t("chatPanel.title")}</span>
          <StatusBadge
            tone={
              connection === "open"
                ? "success"
                : connection === "reconnecting" || connection === "connecting"
                  ? "warning"
                  : "danger"
            }
          >
            <span data-testid="agent-connection-state">{formatConnection(connection)}</span>
          </StatusBadge>
          {degraded ? (
            <StatusBadge tone="warning">
              <span data-testid="agent-degraded-banner">{t("chatPanel.memoryDegraded")}</span>
            </StatusBadge>
          ) : null}
          {activeTaskLabel ? <StatusBadge tone="neutral">{activeTaskLabel}</StatusBadge> : null}
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-auto px-4 py-4">
        {turns.length === 0 ? (
          <EmptyState
            title={t("chatPanel.emptyTitle")}
            description={t("chatPanel.emptyDescription")}
          />
        ) : (
          turns.map((turn) => (
            <div key={turn.turnId} className="space-y-3 rounded-md border bg-surface-muted/30 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="neutral">
                  {t("chatPanel.turnLabel", { id: turn.turnId.slice(0, 8) })}
                </StatusBadge>
                {turn.injection ? (
                  <StatusBadge tone="success">{t("chatPanel.injectionReady")}</StatusBadge>
                ) : null}
                {turn.finishReason ? (
                  <StatusBadge tone="neutral">{formatFinishReasonLabel(turn.finishReason)}</StatusBadge>
                ) : null}
                {turn.promptAvailable ? (
                  <button
                    type="button"
                    onClick={() => onOpenPrompt(turn.turnId)}
                    className="inline-flex items-center gap-1 rounded-md border bg-surface px-2 py-0.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                  >
                    <WandSparkles className="h-3 w-3" />
                    {t("chatPanel.viewPrompt")}
                  </button>
                ) : null}
              </div>

              {turn.injection ? (
                <div className="rounded-md border bg-surface px-3 py-2">
                  <div className="text-xs font-medium text-muted-foreground">
                    {t("chatPanel.injectionTitle")}
                  </div>
                  <div
                    className="mt-1 text-sm leading-6 text-foreground"
                    data-testid={`injection-summary-${turn.turnId}`}
                  >
                    {turn.injection.memory_summary}
                  </div>
                </div>
              ) : null}

              {turn.phases.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {turn.phases.map((phase) => (
                    <StatusBadge
                      key={`${turn.turnId}:${phase.phase}:${phase.traceId ?? ""}`}
                      tone="neutral"
                    >
                      {formatPhaseLabel(phase.phase)}
                    </StatusBadge>
                  ))}
                </div>
              ) : null}

              <MessageBubble
                title={t("chatPanel.you")}
                content={turn.userInput || t("chatPanel.waitingForInput")}
                tone="user"
                testId={`user-message-${turn.turnId}`}
              />
              <MessageBubble
                title={t("chatPanel.assistant")}
                content={
                  turn.assistantOutput ||
                  (turn.status === "streaming" ? t("chatPanel.streaming") : t("chatPanel.noOutput"))
                }
                tone="assistant"
                testId={`assistant-message-${turn.turnId}`}
              />

              {turn.errors.length > 0 ? (
                <ErrorState
                  title={t("chatPanel.turnErrorTitle")}
                  description={turn.errors.map((item) => `${item.code}: ${item.message}`).join("；")}
                />
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="border-t px-4 py-3">
        {connection === "closed" ? (
          <ErrorState
            title={t("chatPanel.connectionClosedTitle")}
            description={t("chatPanel.connectionClosedDescription")}
          />
        ) : null}
        <form
          className="mt-2 flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const nextText = draft.trim();
            if (!nextText) {
              return;
            }
            onSend(nextText);
            setDraft("");
          }}
        >
          <textarea
            data-testid="agent-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t("chatPanel.placeholder")}
            rows={3}
            disabled={connection !== "open"}
            className="field min-h-20 resize-none disabled:cursor-not-allowed disabled:opacity-60"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                const nextText = draft.trim();
                if (!nextText) {
                  return;
                }
                onSend(nextText);
                setDraft("");
              }

              if (event.key === "Escape" && isBusy && latestTurn) {
                event.preventDefault();
                onAbort();
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onAbort}
              disabled={!isBusy}
              data-testid="abort-turn"
              className="btn-outline"
            >
              <Square className="h-3.5 w-3.5" />
              {t("chatPanel.abort")}
            </button>
            <button
              type="submit"
              disabled={connection !== "open" || !draft.trim()}
              data-testid="send-message"
              className="btn-primary"
            >
              {isBusy ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <SendHorizontal className="h-3.5 w-3.5" />
              )}
              {t("chatPanel.send")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MessageBubble({
  title,
  content,
  tone,
  testId
}: {
  title: string;
  content: string;
  tone: "user" | "assistant";
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={`rounded-md px-4 py-3 ${tone === "user" ? "bg-surface" : "border bg-surface"}`}
    >
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </div>
      <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground">{content}</div>
    </div>
  );
}
