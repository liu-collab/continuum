import type { AppConfig } from "../config.js";
import { scopePlanReason } from "../shared/messages.js";
import type { MemoryMode, MemoryType, ScopeType, TriggerContext } from "../shared/types.js";

export interface PhaseScopePlan {
  scopes: ScopeType[];
  reason: string;
}

export interface PhaseMemoryPlan {
  requested_scopes: ScopeType[];
  requested_memory_types: MemoryType[];
  scope_reason: string;
  importance_threshold: number;
}

export function requestedTypesByPhase(phase: TriggerContext["phase"]): MemoryType[] {
  switch (phase) {
    case "session_start":
      return ["fact_preference", "task_state"];
    case "task_start":
    case "task_switch":
      return ["task_state", "episodic", "fact_preference"];
    case "before_plan":
      return ["fact_preference", "task_state"];
    case "before_response":
      return ["fact_preference", "task_state", "episodic"];
    case "after_response":
      return [];
  }
}

export function dedupeScopes(scopes: ScopeType[]): ScopeType[] {
  return [...new Set(scopes)];
}

export function scopePlanByPhase(
  phase: TriggerContext["phase"],
  hasTask: boolean,
  memoryMode: MemoryMode,
): PhaseScopePlan {
  switch (phase) {
    case "session_start":
      return {
        scopes:
          memoryMode === "workspace_plus_global"
            ? ["workspace", "user"]
            : ["workspace"],
        reason: scopePlanReason(phase, memoryMode, hasTask),
      };
    case "task_start":
    case "task_switch":
    case "before_plan":
      return {
        scopes: dedupeScopes([
          "workspace",
          ...(hasTask ? ["task" as const] : []),
          ...(memoryMode === "workspace_plus_global" ? ["user" as const] : []),
        ]),
        reason: scopePlanReason(phase, memoryMode, hasTask),
      };
    case "before_response":
      return {
        scopes: dedupeScopes([
          "workspace",
          ...(hasTask ? ["task" as const] : []),
          "session",
          ...(memoryMode === "workspace_plus_global" ? ["user" as const] : []),
        ]),
        reason: scopePlanReason(phase, memoryMode, hasTask),
      };
    case "after_response":
      return {
        scopes: [],
        reason: scopePlanReason(phase, memoryMode, hasTask),
      };
  }
}

export function importanceThresholdByPhase(
  phase: TriggerContext["phase"],
  config: Pick<AppConfig, "IMPORTANCE_THRESHOLD_SESSION_START" | "IMPORTANCE_THRESHOLD_DEFAULT">,
) {
  return phase === "session_start"
    ? config.IMPORTANCE_THRESHOLD_SESSION_START
    : config.IMPORTANCE_THRESHOLD_DEFAULT;
}

export function buildPhaseMemoryPlan(
  context: Pick<TriggerContext, "phase" | "task_id">,
  memoryMode: MemoryMode,
  config: Pick<AppConfig, "IMPORTANCE_THRESHOLD_SESSION_START" | "IMPORTANCE_THRESHOLD_DEFAULT">,
): PhaseMemoryPlan {
  const scopePlan = scopePlanByPhase(context.phase, Boolean(context.task_id), memoryMode);
  return {
    requested_scopes: scopePlan.scopes,
    requested_memory_types: requestedTypesByPhase(context.phase),
    scope_reason: scopePlan.reason,
    importance_threshold: importanceThresholdByPhase(context.phase, config),
  };
}
