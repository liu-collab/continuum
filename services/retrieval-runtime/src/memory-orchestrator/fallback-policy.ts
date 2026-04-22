export type MemoryOrchestratorStage =
  | "recall_search"
  | "recall_injection"
  | "writeback_plan"
  | "governance_plan"
  | "governance_verify";

const fallbackCodes: Record<MemoryOrchestratorStage, string> = {
  recall_search: "memory_orchestrator_recall_search_unavailable",
  recall_injection: "memory_orchestrator_recall_injection_unavailable",
  writeback_plan: "memory_orchestrator_writeback_plan_unavailable",
  governance_plan: "memory_orchestrator_governance_plan_unavailable",
  governance_verify: "memory_orchestrator_governance_verify_unavailable",
};

export function getMemoryOrchestratorFallbackCode(stage: MemoryOrchestratorStage, error?: Error) {
  const message = error?.message?.toLowerCase() ?? "";
  if (message.includes("timeout")) {
    return "dependency_timeout";
  }
  return fallbackCodes[stage];
}
