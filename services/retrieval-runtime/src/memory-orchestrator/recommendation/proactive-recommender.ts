import type { AppConfig } from "../../config.js";
import { callMemoryLlm, parseMemoryLlmJsonPayload, type MemoryLlmConfig } from "../llm-client.js";
import { MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT } from "../prompts.js";
import { memoryProactiveRecommendationSchema } from "../schemas.js";
import type {
  ProactiveRecommendationResult,
  ProactiveRecommender,
  ProactiveRecommenderInput,
} from "../types.js";

type ProactiveRecommenderConfig = MemoryLlmConfig &
  Pick<AppConfig, "RECALL_LLM_JUDGE_MAX_TOKENS" | "RECALL_LLM_CANDIDATE_LIMIT">;

export class HttpMemoryProactiveRecommender implements ProactiveRecommender {
  constructor(private readonly config: ProactiveRecommenderConfig) {}

  async healthCheck(): Promise<void> {
    await callMemoryLlm(
      this.config,
      MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT,
      {
        current_context: {
          user_input: "health check",
          session_context: {
            session_id: "health-check-session",
            workspace_id: "health-check-workspace",
          },
          detected_task_type: "health_check",
        },
        available_memories: [],
      },
      64,
    );
  }

  async recommend(input: ProactiveRecommenderInput): Promise<ProactiveRecommendationResult> {
    const text = await callMemoryLlm(
      this.config,
      MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT,
      {
        current_context: input.current_context,
        available_memories: input.available_memories
          .slice(0, this.config.RECALL_LLM_CANDIDATE_LIMIT)
          .map((record) => ({
            id: record.id,
            memory_type: record.memory_type,
            scope: record.scope,
            status: record.status,
            summary: record.summary,
            importance: record.importance,
            confidence: record.confidence,
          })),
      },
      this.config.RECALL_LLM_JUDGE_MAX_TOKENS,
    );

    const parsed = memoryProactiveRecommendationSchema.safeParse(parseMemoryLlmJsonPayload(text));
    if (!parsed.success) {
      throw new Error("memory proactive recommender response did not match schema");
    }

    const allowedIds = new Set(input.available_memories.map((record) => record.id));
    return {
      recommendations: parsed.data.recommendations
        .filter((recommendation) => allowedIds.has(recommendation.record_id))
        .slice(0, this.config.RECALL_LLM_CANDIDATE_LIMIT),
    };
  }
}
