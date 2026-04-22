import type { AppConfig } from "../../config.js";
import { callMemoryLlm, parseMemoryLlmJsonPayload, type MemoryLlmConfig } from "../llm-client.js";
import { MEMORY_RECALL_INJECTION_SYSTEM_PROMPT } from "../prompts.js";
import { normalizeRecallInjectionResponse } from "../response-normalizers.js";
import { memoryRecallInjectionSchema } from "../schemas.js";
import type { RecallInjectionInput, RecallInjectionPlan, RecallInjectionPlanner } from "../types.js";

type RecallInjectionPlannerConfig = MemoryLlmConfig &
  Pick<AppConfig, "RECALL_LLM_JUDGE_MAX_TOKENS" | "RECALL_LLM_CANDIDATE_LIMIT">;

export class HttpMemoryRecallInjectionPlanner implements RecallInjectionPlanner {
  constructor(private readonly config: RecallInjectionPlannerConfig) {}

  async healthCheck(): Promise<void> {
    await callMemoryLlm(
      this.config,
      MEMORY_RECALL_INJECTION_SYSTEM_PROMPT,
      {
        current_input: "按之前那个方案继续",
        recent_context_summary: "",
        phase: "before_response",
        memory_mode: "workspace_plus_global",
        requested_scopes: ["workspace", "session", "user"],
        requested_memory_types: ["fact_preference", "task_state", "episodic"],
        candidates: [
          {
            id: "mem-1",
            scope: "user",
            memory_type: "fact_preference",
            summary: "用户偏好：默认用中文回答。",
            importance: 5,
            confidence: 0.95,
            rerank_score: 0.81,
            semantic_score: 0.8,
            updated_at: "2026-01-01T00:00:00.000Z",
          },
        ],
        semantic_score: 0.4,
        semantic_threshold: 0.72,
      },
      64,
    );
  }

  async plan(input: RecallInjectionInput): Promise<RecallInjectionPlan> {
    const text = await callMemoryLlm(
      this.config,
      MEMORY_RECALL_INJECTION_SYSTEM_PROMPT,
      {
        current_input: input.context.current_input,
        recent_context_summary: input.context.recent_context_summary ?? "",
        phase: input.context.phase,
        memory_mode: input.memory_mode,
        requested_scopes: input.requested_scopes,
        requested_memory_types: input.requested_memory_types,
        search_reason: input.search_reason ?? null,
        candidates: input.candidates
          .slice(0, this.config.RECALL_LLM_CANDIDATE_LIMIT)
          .map((candidate) => ({
            id: candidate.id,
            scope: candidate.scope,
            memory_type: candidate.memory_type,
            summary: candidate.summary,
            importance: candidate.importance,
            confidence: candidate.confidence,
            rerank_score: candidate.rerank_score ?? null,
            semantic_score: candidate.semantic_score ?? null,
            updated_at: candidate.updated_at,
          })),
        semantic_score: input.semantic_score ?? null,
        semantic_threshold: input.semantic_threshold ?? null,
        task_id_present: Boolean(input.context.task_id),
      },
      this.config.RECALL_LLM_JUDGE_MAX_TOKENS,
    );

    const parsed = memoryRecallInjectionSchema.safeParse(
      normalizeRecallInjectionResponse(parseMemoryLlmJsonPayload(text)),
    );
    if (!parsed.success) {
      throw new Error("recall llm injection response did not match schema");
    }

    const allowedIds = new Set(input.candidates.map((candidate) => candidate.id));
    const selectedRecordIds = Array.from(
      new Set((parsed.data.selected_record_ids ?? []).filter((id) => allowedIds.has(id))),
    );

    if (!parsed.data.should_inject) {
      return {
        should_inject: false,
        reason: parsed.data.reason,
        selected_record_ids: [],
        requested_scopes: parsed.data.requested_scopes,
        requested_memory_types: parsed.data.requested_memory_types,
        importance_threshold: parsed.data.importance_threshold,
        ...(parsed.data.memory_summary ? { memory_summary: parsed.data.memory_summary } : {}),
      };
    }

    const fallbackSelectedIds =
      selectedRecordIds.length > 0
        ? selectedRecordIds
        : input.candidates.slice(0, Math.min(3, input.candidates.length)).map((candidate) => candidate.id);

    return {
      should_inject: true,
      reason: parsed.data.reason,
      selected_record_ids: fallbackSelectedIds,
      memory_summary: parsed.data.memory_summary,
      requested_scopes: parsed.data.requested_scopes,
      requested_memory_types: parsed.data.requested_memory_types,
      importance_threshold: parsed.data.importance_threshold,
    };
  }
}
