"use client";

import React from "react";

import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";

import { useAgentI18n } from "../_i18n/provider";
import type { AgentTurnState } from "../_lib/event-reducer";

type MemoryPanelProps = {
  activeTurn: AgentTurnState | null;
};

export function MemoryPanel({
  activeTurn
}: MemoryPanelProps) {
  const injection = activeTurn?.injection ?? null;
  const { formatPhaseLabel, t } = useAgentI18n();
  const phaseLabel = injection ? formatPhaseLabel(injection.phase) : null;
  const scopeCounts = countRecordScopes(injection?.memory_records ?? []);

  return (
    <section data-testid="memory-panel" className="panel flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{t("memoryPanel.title")}</div>
        </div>
        {phaseLabel ? (
          <StatusBadge tone="neutral">
            <span data-testid="memory-panel-phase">{phaseLabel}</span>
          </StatusBadge>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-3">
        {!injection ? (
          <EmptyState
            testId="memory-panel-empty-state"
            title={t("memoryPanel.emptyTitle")}
            description={t("memoryPanel.emptyDescription")}
            className="px-4 py-8"
          />
        ) : (
          <>
            <div className="break-words border bg-[var(--surface-pearl)] p-3" style={{ borderRadius: "var(--radius-lg)" }} data-testid="memory-panel-summary">
              {scopeCounts.length > 0 ? (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {scopeCounts.map((item) => (
                    <StatusBadge key={item.scope} tone={scopeTone(item.scope)}>
                      {formatScopeLabel(t, item.scope)} {item.count}
                    </StatusBadge>
                  ))}
                </div>
              ) : null}
              <div className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{injection.memory_summary}</div>
              <div className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
                {injection.injection_reason}
              </div>
            </div>
            {injection.memory_records.length > 0 ? (
              <div className="space-y-2" data-testid="memory-panel-records">
                {injection.memory_records.map((record) => (
                  <div key={record.id} className="record-card">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="min-w-0 whitespace-pre-wrap break-words text-sm font-medium text-foreground">{record.summary}</span>
                      <StatusBadge tone="neutral">{formatMemoryTypeLabel(t, record.memory_type)}</StatusBadge>
                      <StatusBadge tone={scopeTone(record.scope)}>{formatScopeLabel(t, record.scope)}</StatusBadge>
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
            ) : (
              <div
                data-testid="memory-panel-records-empty"
                className="border border-dashed bg-[var(--surface-pearl)] px-3 py-4 text-center text-xs text-muted-foreground"
                style={{ borderRadius: "var(--radius-lg)" }}
              >
                {t("memoryPanel.recordsEmpty")}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function countRecordScopes(records: Array<{ scope: string }>) {
  const counts = new Map<string, number>();

  for (const record of records) {
    counts.set(record.scope, (counts.get(record.scope) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort(([left], [right]) => compareScopeOrder(left, right))
    .map(([scope, count]) => ({
      scope,
      count
    }));
}

function compareScopeOrder(left: string, right: string) {
  return scopeOrder(left) - scopeOrder(right) || left.localeCompare(right);
}

function scopeOrder(scope: string) {
  switch (scope) {
    case "workspace":
      return 0;
    case "task":
      return 1;
    case "session":
      return 2;
    case "user":
      return 3;
    default:
      return 4;
  }
}

function scopeTone(scope: string): "neutral" | "success" | "warning" | "danger" {
  if (scope === "workspace") {
    return "success";
  }

  if (scope === "user") {
    return "warning";
  }

  return "neutral";
}

function formatScopeLabel(t: (key: string) => string, scope: string) {
  return translateWithFallback(t, `memoryPanel.scopes.${scope}`, scope);
}

function formatMemoryTypeLabel(t: (key: string) => string, memoryType: string) {
  return translateWithFallback(t, `memoryPanel.types.${memoryType}`, memoryType);
}

function translateWithFallback(t: (key: string) => string, key: string, fallback: string) {
  const value = t(key);
  return value === key ? fallback : value;
}
