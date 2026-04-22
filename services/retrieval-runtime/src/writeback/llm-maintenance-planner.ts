import type { AppConfig } from "../config.js";
import { HttpMemoryGovernancePlanner } from "../memory-orchestrator/governance/planner.js";
import type { MemoryLlmConfig } from "../memory-orchestrator/llm-client.js";
import type {
  GovernanceAction,
  GovernancePlan,
  GovernancePlanInput,
  GovernancePlanner,
} from "../memory-orchestrator/types.js";
import type { MemoryRecordSnapshot, MemoryType, ScopeType } from "../shared/types.js";

export type MaintenanceAction = GovernanceAction;
export type MaintenancePlan = GovernancePlan;
export type MaintenancePlanInput = GovernancePlanInput;

export interface LlmMaintenancePlanner extends GovernancePlanner {}

type MaintenancePlannerConfig = MemoryLlmConfig &
  Pick<AppConfig, "WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS" | "WRITEBACK_MAINTENANCE_MAX_ACTIONS">;

export class HttpLlmMaintenancePlanner extends HttpMemoryGovernancePlanner {
  constructor(config: MaintenancePlannerConfig) {
    super(config);
  }
}

export function inferScope(record: MemoryRecordSnapshot): ScopeType {
  return record.scope;
}

export function inferMemoryType(record: MemoryRecordSnapshot): MemoryType {
  return record.memory_type;
}
