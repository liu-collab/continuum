import type { AppConfig } from "../../config.js";
import { callMemoryLlm, parseMemoryLlmJsonPayload, type MemoryLlmConfig } from "../llm-client.js";
import { MEMORY_RECALL_SEARCH_SYSTEM_PROMPT } from "../prompts.js";
import { normalizeRecallSearchResponse } from "../response-normalizers.js";
import { memoryRecallSearchSchema } from "../schemas.js";
import type { RecallSearchInput, RecallSearchPlan, RecallSearchPlanner } from "../types.js";

type RecallSearchPlannerConfig = MemoryLlmConfig &
  Pick<AppConfig, "RECALL_LLM_JUDGE_MAX_TOKENS" | "RECALL_LLM_CANDIDATE_LIMIT">;

export class HttpMemoryRecallSearchPlanner implements RecallSearchPlanner {
  constructor(private readonly config: RecallSearchPlannerConfig) {}

  async healthCheck(): Promise<void> {
    await callMemoryLlm(
      this.config,
      MEMORY_RECALL_SEARCH_SYSTEM_PROMPT,
      {
        current_input: "按之前那个方案继续",
        recent_context_summary: "",
        phase: "before_response",
        memory_mode: "workspace_plus_global",
        requested_scopes: ["workspace", "session", "user"],
        requested_memory_types: ["fact", "preference", "task_state", "episodic"],
        semantic_score: 0.4,
        semantic_threshold: 0.72,
      },
      64,
    );
  }

  async plan(input: RecallSearchInput): Promise<RecallSearchPlan> {
    const text = await callMemoryLlm(
      this.config,
      MEMORY_RECALL_SEARCH_SYSTEM_PROMPT,
      {
        current_input: input.context.current_input,
        recent_context_summary: input.context.recent_context_summary ?? "",
        phase: input.context.phase,
        memory_mode: input.memory_mode,
        requested_scopes: input.requested_scopes,
        requested_memory_types: input.requested_memory_types,
        semantic_score: input.semantic_score ?? null,
        semantic_threshold: input.semantic_threshold ?? null,
        task_id_present: Boolean(input.context.task_id),
      },
      this.config.RECALL_LLM_JUDGE_MAX_TOKENS,
    );

    const parsed = memoryRecallSearchSchema.safeParse(normalizeRecallSearchResponse(parseMemoryLlmJsonPayload(text)));
    if (!parsed.success) {
      throw new Error("recall llm search response did not match schema");
    }

    return {
      needs_memory: parsed.data.needs_memory,
      intent_confidence: parsed.data.intent_confidence,
      intent_reason: parsed.data.intent_reason,
      should_search: parsed.data.should_search,
      reason: parsed.data.reason,
      requested_scopes: parsed.data.requested_scopes,
      requested_memory_types: parsed.data.requested_memory_types,
      importance_threshold: parsed.data.importance_threshold,
      query_hint: parsed.data.query_hint,
      candidate_limit:
        parsed.data.candidate_limit === undefined
          ? undefined
          : Math.min(parsed.data.candidate_limit, this.config.RECALL_LLM_CANDIDATE_LIMIT),
    };
  }
}
