import { z } from "zod";

import type { AppConfig } from "../config.js";
import type { CandidateMemory, MemoryMode, MemoryType, ScopeType, TriggerContext } from "../shared/types.js";
import { callWritebackLlm, parseJsonPayload, type WritebackLlmConfig } from "../writeback/llm-extractor.js";

const scopeSchema = z.enum(["workspace", "user", "task", "session"]);
const memoryTypeSchema = z.enum(["fact_preference", "task_state", "episodic"]);

const llmRecallInjectSchema = z.object({
  should_inject: z.literal(true),
  reason: z.string().min(1),
  selected_record_ids: z.array(z.string().min(1)).min(1),
  memory_summary: z.string().min(1),
  requested_scopes: z.array(scopeSchema).optional(),
  requested_memory_types: z.array(memoryTypeSchema).optional(),
  importance_threshold: z.number().int().min(1).max(5).optional(),
});

const llmRecallSkipSchema = z.object({
  should_inject: z.literal(false),
  reason: z.string().min(1),
  selected_record_ids: z.array(z.string().min(1)).optional(),
  memory_summary: z.string().optional(),
  requested_scopes: z.array(scopeSchema).optional(),
  requested_memory_types: z.array(memoryTypeSchema).optional(),
  importance_threshold: z.number().int().min(1).max(5).optional(),
});

const llmRecallPlannerResultSchema = z.discriminatedUnion("should_inject", [
  llmRecallInjectSchema,
  llmRecallSkipSchema,
]);

export type LlmRecallPlan = z.infer<typeof llmRecallPlannerResultSchema>;

export interface LlmRecallPlannerInput {
  context: TriggerContext;
  memory_mode: MemoryMode;
  requested_scopes: ScopeType[];
  requested_memory_types: MemoryType[];
  candidates: CandidateMemory[];
  semantic_score?: number;
  semantic_threshold?: number;
}

export interface LlmRecallPlanner {
  plan(input: LlmRecallPlannerInput): Promise<LlmRecallPlan>;
  healthCheck?(): Promise<void>;
}

type RecallJudgeConfig = WritebackLlmConfig &
  Pick<AppConfig, "RECALL_LLM_JUDGE_MAX_TOKENS" | "RECALL_LLM_CANDIDATE_LIMIT">;

const RECALL_JUDGE_SYSTEM_PROMPT = `
You are the memory recall planner for a memory-native agent.
Return strict JSON only with shape:
{"should_inject":boolean,"reason":"...","selected_record_ids":[...],"memory_summary":"...","requested_scopes":[...],"requested_memory_types":[...],"importance_threshold":number}

Your task is to decide whether the current user input needs memory injection before the main model answers, using the provided candidate memories.

Injection SHOULD happen when:
- the user implicitly refers to prior preferences, prior decisions, prior task state, or prior conversation context
- the user says things like "照旧", "还是那个", "按之前的", "按我习惯", "继续刚才", "延续上次"
- the user is asking for continuity, personalization, or context carry-over

Injection should NOT happen when:
- the input is self-contained and does not depend on memory
- the user is asking a fresh question with enough local context
- memory would add little value

Rules:
- Base your decision on both the current input and the provided candidate memories.
- Only select record ids that exist in the candidate list.
- If should_inject is true, selected_record_ids must be non-empty and memory_summary must explain the injected memory in concise Chinese.
- If should_inject is false, selected_record_ids should be empty.
- Prefer the provided requested scopes and memory types unless there is a clear reason to narrow them.
- Never invent unsupported scope or type values.
- Keep reason short and concrete in Chinese.
`.trim();

export class HttpLlmRecallPlanner implements LlmRecallPlanner {
  constructor(private readonly config: RecallJudgeConfig) {}

  async healthCheck(): Promise<void> {
    await callWritebackLlm(
      this.config,
      RECALL_JUDGE_SYSTEM_PROMPT,
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
          },
        ],
        semantic_score: 0.4,
        semantic_threshold: 0.72,
      },
      64,
    );
  }

  async plan(input: LlmRecallPlannerInput): Promise<LlmRecallPlan> {
    const text = await callWritebackLlm(
      this.config,
      RECALL_JUDGE_SYSTEM_PROMPT,
      {
        current_input: input.context.current_input,
        recent_context_summary: input.context.recent_context_summary ?? "",
        phase: input.context.phase,
        memory_mode: input.memory_mode,
        requested_scopes: input.requested_scopes,
        requested_memory_types: input.requested_memory_types,
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

    const parsed = llmRecallPlannerResultSchema.safeParse(parseJsonPayload(text));
    if (!parsed.success) {
      throw new Error("recall llm judge response did not match schema");
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
