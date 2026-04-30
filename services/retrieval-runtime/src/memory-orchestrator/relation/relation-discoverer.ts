import type { AppConfig } from "../../config.js";
import { callMemoryLlm, parseMemoryLlmJsonPayload, type MemoryLlmConfig } from "../llm-client.js";
import { MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT } from "../prompts.js";
import { memoryRelationDiscoverySchema } from "../schemas.js";
import type {
  RelationDiscoverer,
  RelationDiscovererInput,
  RelationDiscoveryResult,
} from "../types.js";

type RelationDiscovererConfig = MemoryLlmConfig &
  Pick<AppConfig, "WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS">;

export class HttpMemoryRelationDiscoverer implements RelationDiscoverer {
  constructor(private readonly config: RelationDiscovererConfig) {}

  async healthCheck(): Promise<void> {
    await callMemoryLlm(
      this.config,
      MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT,
      {
        source_record: {
          id: "source",
          memory_type: "preference",
          scope: "user",
          summary: "默认中文输出",
          importance: 5,
          confidence: 0.9,
        },
        candidate_records: [],
        context: null,
      },
      64,
    );
  }

  async discover(input: RelationDiscovererInput): Promise<RelationDiscoveryResult> {
    const text = await callMemoryLlm(
      this.config,
      MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT,
      {
        source_record: toCompactRecord(input.source_record),
        candidate_records: input.candidate_records.map(toCompactRecord),
        context: input.context ?? null,
      },
      this.config.WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS,
    );

    const parsed = memoryRelationDiscoverySchema.safeParse(parseMemoryLlmJsonPayload(text));
    if (!parsed.success) {
      throw new Error("memory relation discoverer response did not match schema");
    }

    const allowedIds = new Set(input.candidate_records.map((record) => record.id));
    return {
      source_record_id: input.source_record.id,
      relations: parsed.data.relations.filter((relation) => allowedIds.has(relation.target_record_id)),
    };
  }
}

function toCompactRecord(record: RelationDiscovererInput["source_record"]) {
  return {
    id: record.id,
    memory_type: record.memory_type,
    scope: record.scope,
    summary: record.summary,
    importance: record.importance,
    confidence: record.confidence,
  };
}
