"use client";

import React from "react";

import { EmptyState } from "@/components/empty-state";

import { useAgentI18n } from "@/lib/i18n/agent/provider";
import type { AgentTurnState } from "../_lib/event-reducer";
import { UntrustedBadge } from "./untrusted-badge";

type ToolConsoleProps = {
  turns: AgentTurnState[];
};

export function ToolConsole({ turns }: ToolConsoleProps) {
  const { t } = useAgentI18n();
  const calls = turns.flatMap((turn, turnIndex) =>
    turn.toolCalls.map((call) => ({
      ...call,
      turnId: turn.turnId,
      turnIndex
    }))
  );

  return (
    <div data-testid="tool-console" className="panel">
      <div className="border-b px-4 py-3">
        <div className="text-sm font-semibold text-foreground">{t("toolConsole.title")}</div>
      </div>
      <div className="max-h-64 overflow-auto px-4 py-3">
        {calls.length === 0 ? (
          <EmptyState title={t("toolConsole.emptyTitle")} description={t("toolConsole.emptyDescription")} />
        ) : (
          <div className="space-y-2">
            {calls.map((call) => (
              <div
                key={call.callId}
                data-testid={`tool-call-${call.callId}`}
                className="record-card px-3 py-2 text-sm text-foreground"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{call.name}</span>
                  <span className="text-xs text-muted-foreground" title={call.turnId}>
                    {t("toolConsole.turnLabel", { index: call.turnIndex + 1 })}
                  </span>
                  <UntrustedBadge trustLevel={call.trustLevel} />
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{call.argsPreview}</div>
                <div className="mt-1 border bg-surface px-3 py-1.5 text-xs leading-5 text-foreground" style={{ borderRadius: "var(--radius-sm)" }}>
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
