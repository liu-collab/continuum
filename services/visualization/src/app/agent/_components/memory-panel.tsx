"use client";

import React from "react";
import { BrainCircuit } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";

import { useAgentI18n } from "../_i18n/provider";
import type { AgentTurnState } from "../_lib/event-reducer";

type MemoryPanelProps = {
  activeTurn: AgentTurnState | null;
  degraded: boolean;
};

export function MemoryPanel({ activeTurn, degraded }: MemoryPanelProps) {
  const injection = activeTurn?.injection ?? null;
  const { formatPhaseLabel, t } = useAgentI18n();

  return (
    <div className="rounded-3xl border bg-white/85 shadow-soft">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
        <div className="flex items-center gap-2">
          <BrainCircuit className="h-4 w-4 text-accent" />
          <div>
            <div className="text-sm font-semibold text-slate-900">{t("memoryPanel.title")}</div>
            <div className="text-xs text-slate-500">{t("memoryPanel.description")}</div>
          </div>
        </div>
        {degraded ? <StatusBadge tone="warning">{t("memoryPanel.degraded")}</StatusBadge> : null}
      </div>
      <div className="space-y-4 px-5 py-4">
        {!injection ? (
          <EmptyState
            title={t("memoryPanel.emptyTitle")}
            description={t("memoryPanel.emptyDescription")}
          />
        ) : (
          <>
            <div className="rounded-2xl border bg-slate-50/80 px-4 py-3">
              <div className="text-sm font-semibold text-slate-900">{formatPhaseLabel(injection.phase)}</div>
              <div className="mt-2 text-sm leading-6 text-slate-700">{injection.memory_summary}</div>
              <div className="mt-2 text-xs leading-6 text-slate-500">{injection.injection_reason}</div>
            </div>
            <div className="space-y-3">
              {injection.memory_records.map((record) => (
                <div key={record.id} className="rounded-2xl border bg-white px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{record.summary}</span>
                    <StatusBadge tone="neutral">{record.memory_type}</StatusBadge>
                    <StatusBadge tone="neutral">{record.scope}</StatusBadge>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
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
    </div>
  );
}
