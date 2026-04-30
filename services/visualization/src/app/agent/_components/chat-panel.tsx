"use client";

import React from "react";
import {
  Activity,
  LoaderCircle,
  SendHorizontal,
  Settings2,
  Square
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ErrorState } from "@/components/error-state";
import { StatusBadge } from "@/components/status-badge";

import { useAgentI18n } from "@/lib/i18n/agent/provider";
import type {
  AgentConnectionState,
  MnaDependencyStatusResponse,
  MnaSkillSummary
} from "../_lib/openapi-types";
import type { AgentTurnState } from "../_lib/event-reducer";
import { AssistantThread } from "./assistant-thread";

type ChatPanelProps = {
  turns: AgentTurnState[];
  connection: AgentConnectionState;
  degraded: boolean;
  activeTaskLabel: string | null;
  providerLabel?: string | null;
  dependencyStatus?: MnaDependencyStatusResponse | null;
  skills: MnaSkillSummary[];
  onSend(text: string): void;
  onAbort(): void;
  onOpenPrompt(turnId: string): void;
  onCheckModels?(): Promise<void>;
  onOpenSettings?(): void;
};

const INITIAL_VISIBLE_TURNS = 12;
const LOAD_MORE_TURNS_STEP = 12;
const PANEL_HEIGHT_CLASS = "h-full min-h-0";

export function ChatPanel({
  turns,
  connection,
  degraded,
  activeTaskLabel,
  providerLabel,
  dependencyStatus,
  skills,
  onSend,
  onAbort,
  onOpenPrompt,
  onCheckModels,
  onOpenSettings
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [visibleTurnCount, setVisibleTurnCount] = useState(INITIAL_VISIBLE_TURNS);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [checkingModels, setCheckingModels] = useState(false);
  const { t } = useAgentI18n();
  const isBusy = turns.some((turn) => turn.status === "streaming");
  const latestTurn = turns.at(-1) ?? null;
  const providerNotConfigured = dependencyStatus?.provider.id === "not-configured";
  const canSend = connection === "open" && !isBusy && !providerNotConfigured;
  const embeddingStatus = String(dependencyStatus?.runtime.embeddings?.status ?? "unknown");
  const embeddingNotConfigured = embeddingStatus === "unavailable" || embeddingStatus === "not_configured";
  const memoryLlmStatus = String(dependencyStatus?.runtime.memory_llm?.status ?? "unknown");
  const hiddenTurnCount = Math.max(turns.length - visibleTurnCount, 0);
  const visibleTurns = useMemo(
    () => turns.slice(Math.max(turns.length - visibleTurnCount, 0)),
    [turns, visibleTurnCount],
  );
  const slashCommands = useMemo(() => {
    const baseCommands = [
      {
        key: "builtin-skill",
        command: "/skill",
        label: "/skill",
        description: t("chatPanel.slash.skill")
      }
    ];
    const skillCommands = skills
      .filter((skill) => skill.user_invocable && skill.slash_name)
      .map((skill) => ({
        key: skill.id,
        command: `/${skill.slash_name}`,
        label: `/${skill.slash_name}`,
        description: skill.description?.trim() || skill.name
      }));

    return [...baseCommands, ...skillCommands];
  }, [skills, t]);
  const slashInput = draft.startsWith("/") ? draft.slice(1) : "";
  const slashToken = slashInput.split(/\s+/, 1)[0] ?? "";
  const hasSlashArguments = /\s/.test(slashInput);
  const slashQuery = slashToken.trim().toLowerCase();
  const filteredSlashCommands = useMemo(() => {
    if (!draft.startsWith("/") || hasSlashArguments) {
      return [];
    }

    if (!slashQuery) {
      return slashCommands;
    }

    return slashCommands.filter((command) => {
      const normalizedCommand = command.command.slice(1).toLowerCase();
      const normalizedLabel = command.label.slice(1).toLowerCase();
      const normalizedDescription = command.description.toLowerCase();
      return (
        normalizedCommand.includes(slashQuery) ||
        normalizedLabel.includes(slashQuery) ||
        normalizedDescription.includes(slashQuery)
      );
    });
  }, [draft, hasSlashArguments, slashCommands, slashQuery]);
  const showSlashMenu = filteredSlashCommands.length > 0;

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

  useEffect(() => {
    setSelectedCommandIndex(0);
  }, [draft]);

  useEffect(() => {
    if (selectedCommandIndex < filteredSlashCommands.length) {
      return;
    }
    setSelectedCommandIndex(0);
  }, [filteredSlashCommands.length, selectedCommandIndex]);

  function submitDraft() {
    const nextText = draft.trim();
    if (!nextText || !canSend) {
      return;
    }

    onSend(nextText);
    setDraft("");
  }

  function applySlashCommand(command: string) {
    setDraft(`${command} `);
    setSelectedCommandIndex(0);
  }

  async function checkModels() {
    if (!onCheckModels || checkingModels) {
      return;
    }

    setCheckingModels(true);
    try {
      await onCheckModels();
    } finally {
      setCheckingModels(false);
    }
  }

  return (
    <div className={`panel flex flex-1 ${PANEL_HEIGHT_CLASS} flex-col overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate text-base font-semibold text-foreground">Axis Agent</div>
            {providerLabel ? (
              <div
                data-testid="chat-provider-model"
                className="truncate text-sm text-muted-foreground"
              >
                {providerLabel}
              </div>
            ) : null}
          </div>
          <div data-testid="chat-status-bar" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <StatusDot
              tone={resolveStatusTone(embeddingStatus)}
              label={t("workspace.embeddingLabel")}
              stateValue={embeddingStatus}
              titleValue={embeddingStatus}
              testId="agent-embedding-badge"
            />
            <StatusDot
              tone={resolveStatusTone(memoryLlmStatus)}
              label={t("workspace.memoryLlmLabel")}
              stateValue={memoryLlmStatus}
              titleValue={memoryLlmStatus}
              testId="axis-memory-llm-badge"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {degraded ? (
            <StatusBadge tone="warning">
              <span data-testid="agent-degraded-banner">{t("chatPanel.memoryDegraded")}</span>
            </StatusBadge>
          ) : null}
          {activeTaskLabel ? <StatusBadge tone="neutral">{activeTaskLabel}</StatusBadge> : null}
          {onCheckModels ? (
            <button
              type="button"
              onClick={() => {
                void checkModels();
              }}
              disabled={checkingModels}
              className="icon-button !h-11 !w-11 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label={t("runtimeConfig.checkModelStatus")}
              title={t("runtimeConfig.checkModelStatus")}
              data-testid="check-model-status"
            >
              {checkingModels ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onOpenSettings?.()}
            className="icon-button !h-11 !w-11"
            aria-label={t("runtimeConfig.title")}
            title={t("runtimeConfig.title")}
          >
            <Settings2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <AssistantThread
          turns={visibleTurns}
          hiddenTurnCount={hiddenTurnCount}
          onLoadEarlier={() => {
            setVisibleTurnCount((current) => Math.min(current + LOAD_MORE_TURNS_STEP, turns.length));
          }}
          onSend={onSend}
          onAbort={onAbort}
          onOpenPrompt={onOpenPrompt}
        />
      </div>

      <div className="shrink-0 border-t bg-surface px-4 pb-6 pt-3">
        {providerNotConfigured ? (
          <div className="mb-3 rounded-md border bg-surface-muted/30 px-3 py-3">
            <div className="text-sm font-semibold text-foreground">{t("chatPanel.providerNotConfiguredTitle")}</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("chatPanel.providerNotConfiguredDescription")}
            </div>
            <button type="button" onClick={() => onOpenSettings?.()} className="btn-primary mt-3">
              {t("chatPanel.configureProvider")}
            </button>
          </div>
        ) : null}
        {!providerNotConfigured && embeddingNotConfigured ? (
          <div className="mb-3 rounded-md border bg-surface-muted/30 px-3 py-3">
            <div className="text-sm font-semibold text-foreground">{t("chatPanel.embeddingNotConfiguredTitle")}</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("chatPanel.embeddingNotConfiguredDescription")}
            </div>
            <button type="button" onClick={() => onOpenSettings?.()} className="btn-outline mt-3">
              {t("chatPanel.configureEmbedding")}
            </button>
          </div>
        ) : null}
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
          <div className="border bg-[var(--surface-pearl)] p-3" style={{ borderRadius: "var(--radius-lg)" }}>
            <div className="relative">
              <textarea
                data-testid="agent-input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={t("chatPanel.placeholder")}
                rows={3}
                disabled={connection !== "open"}
                  className="min-h-20 w-full resize-none border-0 bg-transparent px-1 py-1 text-[17px] leading-[1.47] text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-60"
                onKeyDown={(event) => {
                  if (showSlashMenu && event.key === "ArrowDown") {
                    event.preventDefault();
                    setSelectedCommandIndex((current) =>
                      filteredSlashCommands.length === 0
                        ? 0
                        : (current + 1) % filteredSlashCommands.length
                    );
                    return;
                  }

                  if (showSlashMenu && event.key === "ArrowUp") {
                    event.preventDefault();
                    setSelectedCommandIndex((current) =>
                      filteredSlashCommands.length === 0
                        ? 0
                        : (current - 1 + filteredSlashCommands.length) % filteredSlashCommands.length
                    );
                    return;
                  }

                  if (showSlashMenu && event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    applySlashCommand(filteredSlashCommands[selectedCommandIndex]?.command ?? "/skill");
                    return;
                  }

                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submitDraft();
                    return;
                  }

                  if (event.key === "Escape") {
                    if (showSlashMenu) {
                      event.preventDefault();
                      setDraft((current) => current.replace(/^\/[^\s]*\s*/, ""));
                      return;
                    }

                    if (isBusy && latestTurn) {
                      event.preventDefault();
                      onAbort();
                    }
                  }
                }}
              />
              {showSlashMenu ? (
                <div
                  data-testid="slash-command-menu"
                  className="absolute inset-x-0 bottom-full mb-3 overflow-hidden border bg-surface"
                  style={{ borderRadius: "var(--radius-lg)" }}
                >
                  <div className="border-b bg-[var(--surface-pearl)] px-3 py-2 text-[12px] font-semibold uppercase text-muted-foreground">
                    {t("chatPanel.slash.title")}
                  </div>
                  <div className="max-h-64 overflow-auto p-2">
                    {filteredSlashCommands.map((command, index) => (
                      <button
                        key={command.key}
                        type="button"
                        data-testid={`slash-command-option-${command.command.slice(1)}`}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          applySlashCommand(command.command);
                        }}
                        className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-left transition ${
                          index === selectedCommandIndex
                            ? "bg-[var(--cyan-bg)] text-foreground"
                            : "text-muted-foreground hover:bg-surface-muted/50 hover:text-foreground"
                        }`}
                        style={{ borderRadius: "var(--radius-sm)" }}
                      >
                        <span className="text-sm font-semibold">{command.label}</span>
                        <span className="line-clamp-2 text-xs">{command.description}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-muted-foreground">{t("chatPanel.inputHint")}</div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onAbort}
                  disabled={!isBusy}
                  data-testid="abort-turn"
                  className="icon-button !h-11 !w-11 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={t("chatPanel.abort")}
                  title={t("chatPanel.abort")}
                >
                  <Square className="h-3.5 w-3.5" />
                </button>
                <button
                  type="submit"
                  disabled={!canSend || !draft.trim()}
                  data-testid="send-message"
                  className="button-primary disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={t("chatPanel.send")}
                  title={t("chatPanel.send")}
                >
                  {isBusy ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <SendHorizontal className="h-3.5 w-3.5" />
                  )}
                  <span className="hidden sm:inline">{t("chatPanel.send")}</span>
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function resolveStatusTone(status?: string | null): "neutral" | "success" | "warning" | "danger" {
  if (!status) {
    return "neutral";
  }

  const normalized = status.toLowerCase();

  if (["healthy", "configured", "reachable", "ok", "online"].includes(normalized)) {
    return "success";
  }

  if (["degraded", "connecting", "reconnecting"].includes(normalized)) {
    return "warning";
  }

  if (["unavailable", "closed", "misconfigured", "not_configured", "error"].includes(normalized)) {
    return "danger";
  }

  return "neutral";
}

function StatusDot({
  label,
  stateValue,
  titleValue,
  tone,
  testId,
}: {
  label: string;
  stateValue: string;
  titleValue: string;
  tone: "neutral" | "success" | "warning" | "danger";
  testId: string;
}) {
  const dotColor =
    tone === "success" ? "var(--primary)" :
    tone === "warning" ? "#b7791f" :
    tone === "danger" ? "#d92d20" :
    "var(--ink-muted-48)";

  return (
    <span
      data-testid={testId}
      data-state={stateValue}
      title={`${label}: ${titleValue}`}
      aria-label={`${label}: ${titleValue}`}
      className="inline-flex items-center gap-1.5 whitespace-nowrap"
    >
      <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}
