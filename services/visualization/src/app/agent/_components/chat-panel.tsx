"use client";

import { LoaderCircle, SendHorizontal, Square, WandSparkles } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { StatusBadge } from "@/components/status-badge";

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
  const isBusy = turns.some((turn) => turn.status === "streaming");
  const latestTurn = turns.at(-1) ?? null;

  return (
    <div className="flex min-h-[40rem] flex-col rounded-3xl border bg-white/88 shadow-soft">
      <div className="border-b px-6 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <p className="eyebrow">Agent</p>
          <StatusBadge
            tone={
              connection === "open"
                ? "success"
                : connection === "reconnecting" || connection === "connecting"
                  ? "warning"
                  : "danger"
            }
          >
            {connection}
          </StatusBadge>
          {degraded ? <StatusBadge tone="warning">memory degraded</StatusBadge> : null}
          {activeTaskLabel ? <StatusBadge tone="neutral">{activeTaskLabel}</StatusBadge> : null}
        </div>
        <h2 className="mt-3 font-[var(--font-serif)] text-3xl text-slate-900">
          直接在页面里和 `memory-native-agent` 对话。
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          这里直接消费 mna 的 HTTP 和 WebSocket 接口。visualization 只负责渲染，不承接 agent 业务逻辑。
        </p>
      </div>

      <div className="flex-1 space-y-5 overflow-auto px-6 py-5">
        {turns.length === 0 ? (
          <EmptyState
            title="还没有对话"
            description="输入第一条消息后，这里会展示注入横幅、phase 轨迹、assistant 流式输出和工具调用日志。"
          />
        ) : (
          turns.map((turn) => (
            <div key={turn.turnId} className="space-y-4 rounded-3xl border bg-slate-50/70 px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="neutral">turn {turn.turnId.slice(0, 8)}</StatusBadge>
                {turn.injection ? <StatusBadge tone="success">injection ready</StatusBadge> : null}
                {turn.finishReason ? <StatusBadge tone="neutral">{turn.finishReason}</StatusBadge> : null}
                {turn.promptAvailable ? (
                  <button
                    type="button"
                    onClick={() => onOpenPrompt(turn.turnId)}
                    className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-white"
                  >
                    <WandSparkles className="h-3.5 w-3.5" />
                    查看 prompt
                  </button>
                ) : null}
              </div>

              {turn.injection ? (
                <div className="rounded-2xl border bg-white px-4 py-3">
                  <div className="text-sm font-semibold text-slate-900">Injection Banner</div>
                  <div className="mt-2 text-sm leading-6 text-slate-700">{turn.injection.memory_summary}</div>
                </div>
              ) : null}

              {turn.phases.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {turn.phases.map((phase) => (
                    <StatusBadge key={`${turn.turnId}:${phase.phase}:${phase.traceId ?? ""}`} tone="neutral">
                      {phase.phase}
                    </StatusBadge>
                  ))}
                </div>
              ) : null}

              <MessageBubble title="You" content={turn.userInput || "等待用户输入..."} tone="user" />
              <MessageBubble
                title="Assistant"
                content={turn.assistantOutput || (turn.status === "streaming" ? "正在生成..." : "还没有输出。")}
                tone="assistant"
              />

              {turn.errors.length > 0 ? (
                <ErrorState
                  title="本轮出现错误"
                  description={turn.errors.map((item) => `${item.code}: ${item.message}`).join("；")}
                />
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="border-t px-6 py-5">
        {connection === "closed" ? (
          <ErrorState title="连接已关闭" description="请先恢复 `memory-native-agent`，然后再继续发送消息。" />
        ) : null}
        <form
          className="mt-3 flex flex-col gap-3"
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
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            rows={4}
            disabled={connection !== "open"}
            className="min-h-28 rounded-3xl border bg-slate-50/70 px-4 py-4 text-sm leading-6 text-slate-900 outline-none ring-0 disabled:cursor-not-allowed disabled:opacity-60"
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
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onAbort}
              disabled={!isBusy}
              className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Square className="h-4 w-4" />
              中止
            </button>
            <button
              type="submit"
              disabled={connection !== "open" || !draft.trim()}
              className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
              发送
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
  tone
}: {
  title: string;
  content: string;
  tone: "user" | "assistant";
}) {
  return (
    <div className={`rounded-3xl px-5 py-4 ${tone === "user" ? "bg-white" : "bg-white/70"}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{title}</div>
      <div className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-800">{content}</div>
    </div>
  );
}
