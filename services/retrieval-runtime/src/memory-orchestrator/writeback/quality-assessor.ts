import type { AppConfig } from "../../config.js";
import { callMemoryLlm, parseMemoryLlmJsonPayload, type MemoryLlmConfig } from "../llm-client.js";
import { MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT } from "../prompts.js";
import { memoryQualityAssessmentResultSchema } from "../schemas.js";
import type {
  QualityAssessor,
  QualityAssessorInput,
  QualityAssessorResult,
} from "../types.js";

type QualityAssessorConfig = MemoryLlmConfig &
  Pick<AppConfig, "WRITEBACK_LLM_REFINE_MAX_TOKENS">;

export class HttpMemoryQualityAssessor implements QualityAssessor {
  constructor(private readonly config: QualityAssessorConfig) {}

  async healthCheck(): Promise<void> {
    await callMemoryLlm(
      this.config,
      MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT,
      {
        writeback_candidates: [],
        existing_similar_records: [],
        turn_context: {
          user_input: "health check",
          assistant_output: "health check",
        },
      },
      64,
    );
  }

  async assess(input: QualityAssessorInput): Promise<QualityAssessorResult> {
    const text = await callMemoryLlm(
      this.config,
      MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT,
      {
        writeback_candidates: input.writeback_candidates.map((candidate) => ({
          id: candidate.idempotency_key,
          candidate_type: candidate.candidate_type,
          scope: candidate.scope,
          summary: candidate.summary,
          importance: candidate.importance,
          confidence: candidate.confidence,
          write_reason: candidate.write_reason,
          cross_reference: typeof candidate.details.cross_reference === "string" ? candidate.details.cross_reference : undefined,
          cross_reference_similarity:
            typeof candidate.details.cross_reference_similarity === "number"
              ? candidate.details.cross_reference_similarity
              : undefined,
        })),
        existing_similar_records: input.existing_similar_records.map((record) => ({
          id: record.id,
          scope: record.scope,
          memory_type: record.memory_type,
          status: record.status,
          summary: record.summary,
          importance: record.importance,
          confidence: record.confidence,
        })),
        turn_context: input.turn_context,
      },
      this.config.WRITEBACK_LLM_REFINE_MAX_TOKENS,
    );

    const parsed = memoryQualityAssessmentResultSchema.safeParse(parseMemoryLlmJsonPayload(text));
    if (!parsed.success) {
      throw new Error("memory quality assessor response did not match schema");
    }

    const allowedCandidateIds = new Set(input.writeback_candidates.map((candidate) => candidate.idempotency_key));
    const allowedConflictIds = new Set(input.existing_similar_records.map((record) => record.id));

    return {
      assessments: parsed.data.assessments
        .filter((assessment) => allowedCandidateIds.has(assessment.candidate_id))
        .map((assessment) => ({
          ...assessment,
          potential_conflicts: assessment.potential_conflicts.filter((recordId) => allowedConflictIds.has(recordId)),
        })),
    };
  }
}
