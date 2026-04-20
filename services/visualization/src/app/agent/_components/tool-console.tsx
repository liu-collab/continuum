"use client";

import React from "react";

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
    <div data-testid="tool-console" className="rounded-lg border bg-surface">
      <div className="border-b px-4 py-3">
        <div className="text-sm font-medium text-foreground">{t("toolConsole.title")}</div>
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
                className="rounded-md border bg-surface-muted/40 px-3 py-2 text-sm text-foreground"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{call.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {t("toolConsole.turnLabel", { id: call.turnId.slice(0, 8) })}
                  </span>
                  <UntrustedBadge trustLevel={call.trustLevel} />
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{call.argsPreview}</div>
                <div className="mt-1 rounded-md border bg-surface px-3 py-1.5 text-xs leading-5 text-foreground">
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
