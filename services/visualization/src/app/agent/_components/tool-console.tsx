"use client";

import React from "react";
import { TerminalSquare } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

import { useAgentI18n } from "../_i18n/provider";
import type { AgentTurnState } from "../_lib/event-reducer";
import { UntrustedBadge } from "./untrusted-badge";

type ToolConsoleProps = {
  turns: AgentTurnState[];
};

export function ToolConsole({ turns }: ToolConsoleProps) {
  const { t } = useAgentI18n();
  const calls = turns.flatMap((turn) =>
    turn.toolCalls.map((call) => ({
      ...call,
      turnId: turn.turnId
    }))
  );

  return (
    <div data-testid="tool-console" className="rounded-3xl border bg-white/85 shadow-soft">
      <div className="flex items-center gap-2 border-b px-5 py-4">
        <TerminalSquare className="h-4 w-4 text-accent" />
        <div>
          <div className="text-sm font-semibold text-slate-900">{t("toolConsole.title")}</div>
          <div className="text-xs text-slate-500">{t("toolConsole.description")}</div>
        </div>
      </div>
      <div className="max-h-72 overflow-auto px-4 py-3">
        {calls.length === 0 ? (
          <EmptyState title={t("toolConsole.emptyTitle")} description={t("toolConsole.emptyDescription")} />
        ) : (
          <div className="space-y-3">
            {calls.map((call) => (
              <div
                key={call.callId}
                data-testid={`tool-call-${call.callId}`}
                className="rounded-2xl border bg-slate-50/80 px-4 py-3 text-sm text-slate-700"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900">{call.name}</span>
                  <span className="text-xs text-slate-500">{t("toolConsole.turnLabel", { id: call.turnId.slice(0, 8) })}</span>
                  <UntrustedBadge trustLevel={call.trustLevel} />
                </div>
                <div className="mt-2 text-xs text-slate-500">{call.argsPreview}</div>
                <div className="mt-2 rounded-xl bg-white px-3 py-2 text-xs leading-6 text-slate-700">
                  {call.outputPreview || t("toolConsole.waiting")}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
