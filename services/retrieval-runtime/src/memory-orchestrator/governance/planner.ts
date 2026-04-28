import type { AppConfig } from "../../config.js";
import { callMemoryLlm, parseMemoryLlmJsonPayload, type MemoryLlmConfig } from "../llm-client.js";
import { MEMORY_GOVERNANCE_PLAN_SYSTEM_PROMPT } from "../prompts.js";
import { memoryGovernancePlanSchema } from "../schemas.js";
import type {
  GovernanceAction,
  GovernancePlan,
  GovernancePlanInput,
  GovernancePlanner,
} from "../types.js";

type GovernancePlannerConfig = MemoryLlmConfig &
  Pick<AppConfig, "WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS" | "WRITEBACK_MAINTENANCE_MAX_ACTIONS">;

export class HttpMemoryGovernancePlanner implements GovernancePlanner {
  constructor(private readonly config: GovernancePlannerConfig) {}

  async healthCheck(): Promise<void> {
    await callMemoryLlm(
      this.config,
      MEMORY_GOVERNANCE_PLAN_SYSTEM_PROMPT,
      {
        seed_records: [],
        related_records: [],
        open_conflicts: [],
      },
      64,
    );
  }

  async plan(input: GovernancePlanInput): Promise<GovernancePlan> {
    const text = await callMemoryLlm(
      this.config,
      MEMORY_GOVERNANCE_PLAN_SYSTEM_PROMPT,
      {
        seed_records: input.seed_records.map(toCompactRecord),
        related_records: input.related_records.map(toCompactRecord),
        open_conflicts: input.open_conflicts.map(toCompactConflict),
        recently_rejected: input.recently_rejected ?? [],
      },
      this.config.WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS,
    );
    const parsed = memoryGovernancePlanSchema.safeParse(parseMemoryLlmJsonPayload(text));
    if (!parsed.success) {
      throw new Error("writeback maintenance response did not match schema");
    }

    const allowedRecordIds = new Set<string>([
      ...input.seed_records.map((record) => record.id),
      ...input.related_records.map((record) => record.id),
    ]);
    const allowedConflictIds = new Set<string>(input.open_conflicts.map((conflict) => conflict.id));
    const actions = parsed.data.actions
      .filter((action) => isActionReferencingKnownIds(action, allowedRecordIds, allowedConflictIds))
      .slice(0, this.config.WRITEBACK_MAINTENANCE_MAX_ACTIONS);

    return {
      actions,
      notes: parsed.data.notes,
    };
  }
}

function toCompactRecord(record: GovernancePlanInput["seed_records"][number]) {
  return {
    id: record.id,
    memory_type: record.memory_type,
    scope: record.scope,
    status: record.status,
    summary: record.summary,
    importance: record.importance,
    confidence: record.confidence,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

function toCompactConflict(conflict: GovernancePlanInput["open_conflicts"][number]) {
  return {
    id: conflict.id,
    record_id: conflict.record_id,
    conflict_with_record_id: conflict.conflict_with_record_id,
    conflict_type: conflict.conflict_type,
    conflict_summary: conflict.conflict_summary,
    created_at: conflict.created_at,
  };
}

function isActionReferencingKnownIds(
  action: GovernanceAction,
  recordIds: Set<string>,
  conflictIds: Set<string>,
): boolean {
  switch (action.type) {
    case "merge":
      return action.target_record_ids.every((id) => recordIds.has(id));
    case "archive":
    case "downgrade":
    case "delete":
      return recordIds.has(action.record_id);
    case "summarize":
      return action.source_record_ids.every((id) => recordIds.has(id));
    case "resolve_conflict":
      if (!conflictIds.has(action.conflict_id)) {
        return false;
      }
      if (action.activate_record_id && !recordIds.has(action.activate_record_id)) {
        return false;
      }
      return true;
    default:
      return false;
  }
}
