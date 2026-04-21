"use client";

import React from "react";

import { StatusBadge } from "@/components/status-badge";

import { useAgentI18n } from "../_i18n/provider";
import type { AgentTurnState } from "../_lib/event-reducer";

type MemoryPanelProps = {
  activeTurn: AgentTurnState | null;
  degraded: boolean;
};

export function MemoryPanel({
  activeTurn,
  degraded
}: MemoryPanelProps) {
  const injection = activeTurn?.injection ?? null;
  const { formatPhaseLabel, t } = useAgentI18n();

  return (
    <section className="rounded-[1.75rem] border bg-surface">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="text-sm font-medium text-foreground">{t("memoryPanel.title")}</div>
        {degraded ? <StatusBadge tone="warning">{t("memoryPanel.degraded")}</StatusBadge> : null}
      </div>
      <div className="space-y-3 px-4 py-3">
        {!injection ? (
          <div className="rounded-lg border border-dashed bg-surface-muted/40 px-6 py-10 text-center">
            <h3 className="text-base font-semibold text-foreground">{t("memoryPanel.emptyTitle")}</h3>
          </div>
        ) : (
          <>
            <div className="rounded-md border bg-surface-muted/40 p-3">
              <div className="text-xs font-medium text-foreground">
                {formatPhaseLabel(injection.phase)}
              </div>
              <div className="mt-1 text-sm leading-6 text-foreground">{injection.memory_summary}</div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                {injection.injection_reason}
              </div>
            </div>
            <div className="space-y-2">
              {injection.memory_records.map((record) => (
                <div key={record.id} className="rounded-md border bg-surface p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium text-foreground">{record.summary}</span>
                    <StatusBadge tone="neutral">{record.memory_type}</StatusBadge>
                    <StatusBadge tone="neutral">{record.scope}</StatusBadge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t("memoryPanel.importanceConfidence", {
                      importance: record.importance,
                      confidence: record.confidence
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
