import { z } from "zod";

import type { AppConfig } from "../config.js";
import type {
  MemoryConflictSnapshot,
  MemoryRecordSnapshot,
  MemoryType,
  ScopeType,
} from "../shared/types.js";
import {
  callWritebackLlm,
  parseJsonPayload,
  type WritebackLlmConfig,
} from "./llm-extractor.js";
import { WRITEBACK_MAINTENANCE_SYSTEM_PROMPT } from "./llm-refiner-prompt.js";

const scopeSchema = z.enum(["workspace", "user", "task", "session"]);
const memoryTypeSchema = z.enum(["fact_preference", "task_state", "episodic"]);
const importanceSchema = z.number().int().min(1).max(5);

const mergeActionSchema = z.object({
  type: z.literal("merge"),
  target_record_ids: z.array(z.string().min(1)).min(2),
  merged_summary: z.string().min(1),
  merged_importance: importanceSchema.optional(),
  reason: z.string().min(1),
});

const archiveActionSchema = z.object({
  type: z.literal("archive"),
  record_id: z.string().min(1),
  reason: z.string().min(1),
});

const downgradeActionSchema = z.object({
  type: z.literal("downgrade"),
  record_id: z.string().min(1),
  new_importance: importanceSchema,
  reason: z.string().min(1),
});

const summarizeActionSchema = z.object({
  type: z.literal("summarize"),
  source_record_ids: z.array(z.string().min(1)).min(1),
  new_summary: z.string().min(1),
  new_importance: importanceSchema,
  scope: scopeSchema,
  candidate_type: memoryTypeSchema,
  reason: z.string().min(1),
});

const resolveConflictActionSchema = z.object({
  type: z.literal("resolve_conflict"),
  conflict_id: z.string().min(1),
  resolution_type: z.enum(["auto_merge", "manual_fix", "dismissed"]),
  activate_record_id: z.string().min(1).optional(),
  resolution_note: z.string().min(1),
});

const maintenanceActionSchema = z.discriminatedUnion("type", [
  mergeActionSchema,
  archiveActionSchema,
  downgradeActionSchema,
  summarizeActionSchema,
  resolveConflictActionSchema,
]);

const maintenancePlanSchema = z.object({
  actions: z.array(maintenanceActionSchema),
  notes: z.string().optional(),
});

export type MaintenanceAction = z.infer<typeof maintenanceActionSchema>;
export type MaintenancePlan = z.infer<typeof maintenancePlanSchema>;

export interface MaintenancePlanInput {
  seed_records: MemoryRecordSnapshot[];
  related_records: MemoryRecordSnapshot[];
  open_conflicts: MemoryConflictSnapshot[];
}

export interface LlmMaintenancePlanner {
  plan(input: MaintenancePlanInput): Promise<MaintenancePlan>;
  healthCheck?(): Promise<void>;
}

type MaintenancePlannerConfig = WritebackLlmConfig &
  Pick<AppConfig, "WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS" | "WRITEBACK_MAINTENANCE_MAX_ACTIONS">;

export class HttpLlmMaintenancePlanner implements LlmMaintenancePlanner {
  constructor(private readonly config: MaintenancePlannerConfig) {}

  async healthCheck(): Promise<void> {
    await callWritebackLlm(
      this.config,
      WRITEBACK_MAINTENANCE_SYSTEM_PROMPT,
      {
        seed_records: [],
        related_records: [],
        open_conflicts: [],
      },
      64,
    );
  }

  async plan(input: MaintenancePlanInput): Promise<MaintenancePlan> {
    const text = await callWritebackLlm(
      this.config,
      WRITEBACK_MAINTENANCE_SYSTEM_PROMPT,
      {
        seed_records: input.seed_records.map(toCompactRecord),
        related_records: input.related_records.map(toCompactRecord),
        open_conflicts: input.open_conflicts.map(toCompactConflict),
      },
      this.config.WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS,
    );
    const parsed = maintenancePlanSchema.safeParse(parseJsonPayload(text));
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

function toCompactRecord(record: MemoryRecordSnapshot) {
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

function toCompactConflict(conflict: MemoryConflictSnapshot) {
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
  action: MaintenanceAction,
  recordIds: Set<string>,
  conflictIds: Set<string>,
): boolean {
  switch (action.type) {
    case "merge":
      return action.target_record_ids.every((id) => recordIds.has(id));
    case "archive":
    case "downgrade":
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

export function inferScope(record: MemoryRecordSnapshot): ScopeType {
  return record.scope;
}

export function inferMemoryType(record: MemoryRecordSnapshot): MemoryType {
  return record.memory_type;
}
