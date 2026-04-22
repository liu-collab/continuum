import type { AppConfig } from "../../config.js";
import { callMemoryLlm, parseMemoryLlmJsonPayload, type MemoryLlmConfig } from "../llm-client.js";
import { MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT } from "../prompts.js";
import { memoryEffectivenessEvaluationResultSchema } from "../schemas.js";
import type {
  RecallEffectivenessEvaluator,
  RecallEffectivenessEvaluatorInput,
  RecallEffectivenessEvaluatorResult,
} from "../types.js";

type RecallEffectivenessEvaluatorConfig = MemoryLlmConfig &
  Pick<AppConfig, "WRITEBACK_LLM_REFINE_MAX_TOKENS">;

export class HttpMemoryRecallEffectivenessEvaluator implements RecallEffectivenessEvaluator {
  constructor(private readonly config: RecallEffectivenessEvaluatorConfig) {}

  async healthCheck(): Promise<void> {
    await callMemoryLlm(
      this.config,
      MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT,
      {
        injected_memories: [],
        assistant_output: "health check",
        user_feedback: null,
      },
      64,
    );
  }

  async evaluate(
    input: RecallEffectivenessEvaluatorInput,
  ): Promise<RecallEffectivenessEvaluatorResult> {
    const text = await callMemoryLlm(
      this.config,
      MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT,
      {
        injected_memories: input.injected_memories,
        assistant_output: input.assistant_output,
        user_feedback: input.user_feedback ?? null,
      },
      this.config.WRITEBACK_LLM_REFINE_MAX_TOKENS,
    );

    const parsed = memoryEffectivenessEvaluationResultSchema.safeParse(parseMemoryLlmJsonPayload(text));
    if (!parsed.success) {
      throw new Error("memory recall effectiveness response did not match schema");
    }

    const allowedIds = new Set(input.injected_memories.map((memory) => memory.record_id));
    return {
      evaluations: parsed.data.evaluations.filter((evaluation) => allowedIds.has(evaluation.record_id)),
    };
  }
}
