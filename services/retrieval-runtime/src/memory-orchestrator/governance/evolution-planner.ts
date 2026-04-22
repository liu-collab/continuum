import type { AppConfig } from "../../config.js";
import { callMemoryLlm, parseMemoryLlmJsonPayload, type MemoryLlmConfig } from "../llm-client.js";
import { MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT } from "../prompts.js";
import { memoryEvolutionPlanSchema } from "../schemas.js";
import type {
  EvolutionPlan,
  EvolutionPlanner,
  EvolutionPlannerInput,
} from "../types.js";

type EvolutionPlannerConfig = MemoryLlmConfig &
  Pick<AppConfig, "WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS">;

export class HttpMemoryEvolutionPlanner implements EvolutionPlanner {
  constructor(private readonly config: EvolutionPlannerConfig) {}

  async healthCheck(): Promise<void> {
    await callMemoryLlm(
      this.config,
      MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT,
      {
        source_records: [],
        time_window: {
          start: "2026-01-01T00:00:00.000Z",
          end: "2026-01-02T00:00:00.000Z",
        },
        evolution_type: "knowledge_extraction",
      },
      64,
    );
  }

  async plan(input: EvolutionPlannerInput): Promise<EvolutionPlan> {
    const text = await callMemoryLlm(
      this.config,
      MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT,
      {
        source_records: input.source_records.map(toCompactRecord),
        time_window: input.time_window,
        evolution_type: input.evolution_type,
      },
      this.config.WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS,
    );

    const parsed = memoryEvolutionPlanSchema.safeParse(parseMemoryLlmJsonPayload(text));
    if (!parsed.success) {
      throw new Error("memory evolution planner response did not match schema");
    }

    const allowedIds = new Set(input.source_records.map((record) => record.id));
    const sourceRecords = parsed.data.source_records.filter((recordId) => allowedIds.has(recordId));

    return {
      evolution_type: parsed.data.evolution_type,
      source_records: sourceRecords.length > 0 ? sourceRecords : input.source_records.map((record) => record.id),
      extracted_knowledge: parsed.data.extracted_knowledge,
      consolidation_plan: parsed.data.consolidation_plan
        ? {
            ...parsed.data.consolidation_plan,
            records_to_archive: parsed.data.consolidation_plan.records_to_archive.filter((recordId) => allowedIds.has(recordId)),
          }
        : undefined,
    };
  }
}

function toCompactRecord(record: EvolutionPlannerInput["source_records"][number]) {
  return {
    id: record.id,
    memory_type: record.memory_type,
    scope: record.scope,
    summary: record.summary,
    importance: record.importance,
    confidence: record.confidence,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}
