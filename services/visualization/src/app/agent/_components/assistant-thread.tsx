"use client";

import React, { useMemo } from "react";
import {
  AssistantRuntimeProvider,
  MessagePartPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useMessagePartText,
  useExternalStoreRuntime,
  type MessageState,
  type ToolCallMessagePartProps
} from "@assistant-ui/react";
import {
  CheckCircle2,
  ChevronUp,
  LoaderCircle,
  TerminalSquare,
  WandSparkles,
  XCircle
} from "lucide-react";
import { marked } from "marked";

import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";

import { useAgentI18n } from "../_i18n/provider";
import {
  createContinuumThreadStore,
  readContinuumMeta,
  type ContinuumToolCallArtifact
} from "../_lib/assistant-ui-adapter";
import type { AgentTurnState } from "../_lib/event-reducer";

type AssistantThreadProps = {
  turns: AgentTurnState[];
  hiddenTurnCount: number;
  onLoadEarlier(): void;
  onSend(text: string): void;
  onAbort(): void;
  onOpenPrompt(turnId: string): void;
};

export function AssistantThread({
  turns,
  hiddenTurnCount,
  onLoadEarlier,
  onSend,
  onAbort,
  onOpenPrompt
}: AssistantThreadProps) {
  const isRunning = turns.some((turn) => turn.status === "streaming");
  const store = useMemo(
    () =>
      createContinuumThreadStore({
        turns,
        isRunning,
        onSend,
        onAbort
      }),
    [isRunning, onAbort, onSend, turns]
  );
  const runtime = useExternalStoreRuntime(store);
  const { t } = useAgentI18n();
  const turnLabels = useMemo(
    () =>
      new Map(
        turns.map((turn, index) => [
          turn.turnId,
          t("chatPanel.turnLabel", { index: hiddenTurnCount + index + 1 })
        ])
      ),
    [hiddenTurnCount, t, turns]
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="flex h-full min-h-0 flex-1 flex-col">
        {turns.length === 0 ? (
          <div className="min-h-0 flex-1 overflow-auto bg-[var(--canvas)] px-4 py-6">
            <EmptyState
              title={t("chatPanel.emptyTitle")}
            />
          </div>
        ) : (
          <ThreadPrimitive.Viewport
            data-testid="assistant-thread-viewport"
            className="min-h-0 flex-1 overflow-auto bg-[var(--canvas)] px-4 py-6"
            autoScroll
          >
            <div className="flex w-full flex-col gap-6">
              {hiddenTurnCount > 0 ? (
                <div className="flex justify-center">
                  <button
                    type="button"
                    data-testid="load-earlier-turns"
                    onClick={onLoadEarlier}
                    className="inline-flex items-center gap-2 rounded-full border bg-surface px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground"
                  >
                    <ChevronUp className="h-4 w-4" />
                    {t("chatPanel.loadEarlier", { count: hiddenTurnCount })}
                  </button>
                </div>
              ) : null}

              <ThreadPrimitive.Messages>
                {({ message }) =>
                  message.role === "user" ? (
                    <UserMessageBubble message={message} />
                  ) : (
                    <AssistantMessageBubble message={message} turnLabels={turnLabels} onOpenPrompt={onOpenPrompt} />
                  )
                }
              </ThreadPrimitive.Messages>
            </div>
          </ThreadPrimitive.Viewport>
        )}
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

function UserMessageBubble({ message }: { message: MessageState }) {
  const { t } = useAgentI18n();
  const meta = readContinuumMeta(message);
  const turnId = meta?.turnId ?? message.id;
  const content = getMessageText(message);

  return (
    <div className="flex justify-end">
      <MessagePrimitive.Root className="max-w-[80%] bg-primary px-4 py-3 text-white" style={{ borderRadius: "var(--radius-lg)" }}>
        <div className="text-[12px] font-medium uppercase text-white/70">
          {t("chatPanel.you")}
        </div>
        <div
          data-testid={`user-message-${turnId}`}
          className="mt-1 whitespace-pre-wrap text-sm leading-6 text-white"
        >
          {content ? (
            <MessagePrimitive.Parts
              components={{
                Text: UserTextPart
              }}
            />
          ) : (
            t("chatPanel.waitingForInput")
          )}
        </div>
      </MessagePrimitive.Root>
    </div>
  );
}

function AssistantMessageBubble({
  message,
  turnLabels,
  onOpenPrompt
}: {
  message: MessageState;
  turnLabels: Map<string, string>;
  onOpenPrompt(turnId: string): void;
}) {
  const { formatAgentError, formatFinishReasonLabel, formatPhaseLabel, t } = useAgentI18n();
  const meta = readContinuumMeta(message);
  const turnId = meta?.turnId ?? message.id;
  const hasRenderableParts = message.content.length > 0;
  const errorContents = meta?.errors.map((item) => formatAgentError(item.code, null, item.reason)) ?? [];

  return (
    <div className="flex justify-start">
      <MessagePrimitive.Root className="w-full max-w-[92%] border bg-surface px-4 py-4" style={{ borderRadius: "var(--radius-lg)" }}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[12px] font-medium uppercase text-muted-foreground">
            {t("chatPanel.assistant")}
          </div>
          <StatusBadge tone="neutral">
            <span title={turnId}>{turnLabels.get(turnId) ?? t("chatPanel.turnLabel", { index: 1 })}</span>
          </StatusBadge>
          {meta?.injection ? <StatusBadge tone="success">{t("chatPanel.injectionReady")}</StatusBadge> : null}
          {meta?.finishReason ? (
            <StatusBadge tone="neutral">{formatFinishReasonLabel(meta.finishReason)}</StatusBadge>
          ) : null}
          {meta?.promptAvailable ? (
            <button
              type="button"
              onClick={() => onOpenPrompt(turnId)}
              className="button-pearl-capsule !min-h-8 !px-3 !py-1"
            >
              <WandSparkles className="h-3 w-3" />
              {t("chatPanel.viewPrompt")}
            </button>
          ) : null}
        </div>

        <div
          data-testid={`assistant-message-${turnId}`}
          className="mt-3 text-sm leading-6 text-foreground"
        >
          {hasRenderableParts ? (
            <MessagePrimitive.Parts
              components={{
                Text: AssistantTextPart,
                tools: {
                  Fallback: ToolCallCard
                },
                ToolGroup: ToolCallGroup
              }}
            />
          ) : (
            <span>{message.status?.type === "running" ? t("chatPanel.streaming") : t("chatPanel.noOutput")}</span>
          )}
        </div>

        {meta?.phases.length ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {meta.phases.map((phase) => (
              <StatusBadge
                key={`${turnId}:${phase.phase}:${phase.traceId ?? ""}`}
                tone={phase.degradedSkipReason ? "warning" : "neutral"}
              >
                {phase.degradedSkipReason
                  ? t("chatPanel.phaseDegradedSkip", { phase: formatPhaseLabel(phase.phase) })
                  : formatPhaseLabel(phase.phase)}
              </StatusBadge>
            ))}
          </div>
        ) : null}

        {meta?.plan ? (
          <div className="mt-4 border bg-[var(--surface-pearl)] px-3 py-3" style={{ borderRadius: "var(--radius-lg)" }}>
            <div className="text-xs font-medium text-foreground">
              plan · {meta.plan.status}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{meta.plan.goal}</div>
            <div className="mt-2 space-y-1">
              {meta.plan.steps.map((step) => (
                <div key={step.id} className="text-xs text-foreground">
                  {step.status} · {step.title}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {meta?.evaluations.length ? (
          <div className="mt-4 border bg-[var(--surface-pearl)] px-3 py-3" style={{ borderRadius: "var(--radius-lg)" }}>
            <div className="text-xs font-medium text-foreground">evaluation</div>
            <div className="mt-2 space-y-1">
              {meta.evaluations.slice(-4).map((item, index) => (
                <div key={`${item.scope}-${index}`} className="text-xs text-muted-foreground">
                  {item.scope} · {item.decision.status} · {item.decision.reason}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {errorContents.length ? (
          <TurnInlineErrorNotice
            title={errorContents.length === 1 ? errorContents[0]!.title : t("chatPanel.turnErrorTitle")}
            description={errorContents.map((item) => item.description).join("；")}
          />
        ) : null}
      </MessagePrimitive.Root>
    </div>
  );
}

function TurnInlineErrorNotice({ title, description }: { title: string; description: string }) {
  return (
    <div
      data-testid="turn-inline-error"
      className="mt-3 max-w-full rounded-[var(--radius-md)] border border-[var(--hairline)] bg-[var(--surface-pearl)] px-3 py-2 text-[12px] leading-[1.4] text-muted-foreground"
    >
      <div className="font-semibold text-[var(--ink-muted-80)]">{title}</div>
      <div className="mt-0.5">{description}</div>
    </div>
  );
}

function UserTextPart() {
  return <MessagePartPrimitive.Text className="whitespace-pre-wrap text-sm leading-6 text-white" />;
}

function AssistantTextPart() {
  const { text } = useMessagePartText();

  return (
    <div
      className="agent-markdown text-sm leading-6 text-foreground"
      dangerouslySetInnerHTML={{
        __html: renderAssistantMarkdown(text)
      }}
    />
  );
}

function ToolCallGroup({ children }: React.PropsWithChildren) {
  return <div className="mt-4 space-y-2">{children}</div>;
}

function ToolCallCard(props: ToolCallMessagePartProps<Record<string, unknown>, unknown>) {
  const { t } = useAgentI18n();
  const artifact = readToolArtifact(props.artifact);
  const errorOutput = artifact?.status === "error" ? artifact.outputPreview.trim() : "";

  return (
    <div
      data-testid={`tool-call-${props.toolCallId}`}
      className="border bg-[var(--surface-pearl)] px-3 py-3"
      style={{ borderRadius: "var(--radius-lg)" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-foreground">
          <TerminalSquare className="h-3.5 w-3.5" />
          {props.toolName}
        </span>
        {artifact?.status === "ok" ? (
          <StatusBadge tone="success">
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              {t("chatPanel.toolStatus.ok")}
            </span>
          </StatusBadge>
        ) : null}
        {artifact?.status === "error" ? (
          <StatusBadge tone="danger">
            <span className="inline-flex items-center gap-1">
              <XCircle className="h-3 w-3" />
              {t("chatPanel.toolStatus.error")}
            </span>
          </StatusBadge>
        ) : null}
        {artifact?.status === "pending" ? (
          <StatusBadge tone="warning">
            <span className="inline-flex items-center gap-1">
              <LoaderCircle className="h-3 w-3 animate-spin" />
              {t("chatPanel.toolStatus.pending")}
            </span>
          </StatusBadge>
        ) : null}
      </div>
      <div className="mt-2 text-xs leading-5 text-muted-foreground">{artifact?.argsPreview ?? props.argsText}</div>
      {errorOutput ? (
        <div
          data-testid={`tool-call-output-${props.toolCallId}`}
          className="mt-2 whitespace-pre-wrap break-words rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs leading-5 text-rose-800"
        >
          {errorOutput}
        </div>
      ) : null}
    </div>
  );
}

function readToolArtifact(value: unknown): ContinuumToolCallArtifact | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const artifact = value as Partial<ContinuumToolCallArtifact>;
  if (!artifact.status || !artifact.argsPreview) {
    return null;
  }

  return artifact as ContinuumToolCallArtifact;
}

function getMessageText(message: MessageState) {
  return message.content
    .filter((part): part is Extract<MessageState["content"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
}

function renderAssistantMarkdown(source: string) {
  return marked.parse(escapeInlineHtml(source), {
    async: false,
    breaks: true,
    gfm: true,
  }) as string;
}

function escapeInlineHtml(source: string) {
  return source
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
