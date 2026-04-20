"use client";

import React from "react";
import { CheckCircle2, ChevronUp, LoaderCircle, SendHorizontal, Square, TerminalSquare, WandSparkles, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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

const INITIAL_VISIBLE_TURNS = 12;
const LOAD_MORE_TURNS_STEP = 12;

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
  const [visibleTurnCount, setVisibleTurnCount] = useState(INITIAL_VISIBLE_TURNS);
  const { formatConnection, formatFinishReasonLabel, formatPhaseLabel, t } = useAgentI18n();
  const isBusy = turns.some((turn) => turn.status === "streaming");
  const latestTurn = turns.at(-1) ?? null;
  const hiddenTurnCount = Math.max(turns.length - visibleTurnCount, 0);
  const visibleTurns = useMemo(
    () => turns.slice(Math.max(turns.length - visibleTurnCount, 0)),
    [turns, visibleTurnCount],
  );

  useEffect(() => {
    if (turns.length <= visibleTurnCount) {
      return;
    }

    if (isBusy) {
      setVisibleTurnCount(turns.length);
      return;
    }

    if (turns.length - visibleTurnCount > LOAD_MORE_TURNS_STEP) {
      setVisibleTurnCount(INITIAL_VISIBLE_TURNS);
    }
  }, [isBusy, turns.length, visibleTurnCount]);

  function submitDraft() {
    const nextText = draft.trim();
    if (!nextText || connection !== "open") {
      return;
    }

    onSend(nextText);
    setDraft("");
  }

  return (
    <div className="flex h-[calc(100vh-12rem)] min-h-[38rem] max-h-[calc(100vh-12rem)] flex-col overflow-hidden rounded-[1.75rem] border bg-surface shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-surface-muted/30 px-5 py-4">
        <div className="min-w-0">
          <div className="text-base font-semibold text-foreground">Continuum Agent</div>
          <div className="mt-1 text-xs text-muted-foreground">{t("chatPanel.description")}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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

      <div className="min-h-0 flex-1 overflow-auto bg-[radial-gradient(circle_at_top,rgba(148,163,184,0.08),transparent_38%)] px-4 py-6">
        {turns.length === 0 ? (
          <EmptyState
            title={t("chatPanel.emptyTitle")}
            description={t("chatPanel.emptyDescription")}
          />
        ) : (
          <div className="flex w-full flex-col gap-6">
            {hiddenTurnCount > 0 ? (
              <div className="flex justify-center">
                <button
                  type="button"
                  data-testid="load-earlier-turns"
                  onClick={() => {
                    setVisibleTurnCount((current) => Math.min(current + LOAD_MORE_TURNS_STEP, turns.length));
                  }}
                  className="inline-flex items-center gap-2 rounded-full border bg-surface px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground"
                >
                  <ChevronUp className="h-4 w-4" />
                  {t("chatPanel.loadEarlier", { count: hiddenTurnCount })}
                </button>
              </div>
            ) : null}
            {visibleTurns.map((turn) => (
              <div key={turn.turnId} className="space-y-4">
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-[1.5rem] bg-accent px-4 py-3 text-white shadow-sm">
                    <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/70">
                      {t("chatPanel.you")}
                    </div>
                    <div
                      data-testid={`user-message-${turn.turnId}`}
                      className="mt-1 whitespace-pre-wrap text-sm leading-6 text-white"
                    >
                      {turn.userInput || t("chatPanel.waitingForInput")}
                    </div>
                  </div>
                </div>

                <div className="flex justify-start">
                  <div className="w-full max-w-[92%] rounded-[1.5rem] border bg-surface px-4 py-4 shadow-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        {t("chatPanel.assistant")}
                      </div>
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

                    <div
                      data-testid={`assistant-message-${turn.turnId}`}
                      className="mt-3 whitespace-pre-wrap text-sm leading-7 text-foreground"
                    >
                      {turn.assistantOutput ||
                        (turn.status === "streaming" ? t("chatPanel.streaming") : t("chatPanel.noOutput"))}
                    </div>

                    {turn.toolCalls.length > 0 ? (
                      <div className="mt-4 space-y-2">
                        {turn.toolCalls.map((call) => (
                          <div
                            key={call.callId}
                            data-testid={`tool-call-${call.callId}`}
                            className="rounded-2xl border bg-surface-muted/40 px-3 py-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-foreground">
                                <TerminalSquare className="h-3.5 w-3.5" />
                                {call.name}
                              </span>
                              {call.status === "ok" ? (
                                <StatusBadge tone="success">
                                  <span className="inline-flex items-center gap-1">
                                    <CheckCircle2 className="h-3 w-3" />
                                    {t("chatPanel.toolStatus.ok")}
                                  </span>
                                </StatusBadge>
                              ) : null}
                              {call.status === "error" ? (
                                <StatusBadge tone="danger">
                                  <span className="inline-flex items-center gap-1">
                                    <XCircle className="h-3 w-3" />
                                    {t("chatPanel.toolStatus.error")}
                                  </span>
                                </StatusBadge>
                              ) : null}
                              {call.status === "pending" ? (
                                <StatusBadge tone="warning">
                                  <span className="inline-flex items-center gap-1">
                                    <LoaderCircle className="h-3 w-3 animate-spin" />
                                    {t("chatPanel.toolStatus.pending")}
                                  </span>
                                </StatusBadge>
                              ) : null}
                            </div>
                            <div className="mt-2 text-xs leading-5 text-muted-foreground">{call.argsPreview}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {turn.injection ? (
                      <div className="mt-4 rounded-2xl border bg-surface-muted/30 px-3 py-3">
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
                      <div className="mt-4 flex flex-wrap gap-1.5">
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

                    {turn.errors.length > 0 ? (
                      <div className="mt-4">
                        <ErrorState
                          title={t("chatPanel.turnErrorTitle")}
                          description={turn.errors.map((item) => `${item.code}: ${item.message}`).join("；")}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t bg-surface px-4 pb-6 pt-3">
        {connection === "closed" ? (
          <ErrorState
            title={t("chatPanel.connectionClosedTitle")}
            description={t("chatPanel.connectionClosedDescription")}
          />
        ) : null}
        <form
          className="mt-2 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            submitDraft();
          }}
        >
          <div className="rounded-[1.5rem] border bg-surface-muted/30 p-3 shadow-sm">
            <textarea
              data-testid="agent-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t("chatPanel.placeholder")}
              rows={3}
              disabled={connection !== "open"}
              className="min-h-20 w-full resize-none border-0 bg-transparent px-1 py-1 text-sm leading-6 text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-60"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submitDraft();
                }

                if (event.key === "Escape" && isBusy && latestTurn) {
                  event.preventDefault();
                  onAbort();
                }
              }}
            />
            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <div className="text-xs text-muted-foreground">{t("chatPanel.placeholder")}</div>
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
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
