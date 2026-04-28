import { afterEach, describe, expect, it } from "vitest";

import {
  HttpMemoryEvolutionPlanner,
} from "../src/memory-orchestrator/governance/evolution-planner.js";
import { HttpMemoryIntentAnalyzer } from "../src/memory-orchestrator/intent/intent-analyzer.js";
import { HttpMemoryRecallEffectivenessEvaluator } from "../src/memory-orchestrator/recall/effectiveness-evaluator.js";
import { HttpMemoryProactiveRecommender } from "../src/memory-orchestrator/recommendation/proactive-recommender.js";
import { HttpMemoryRelationDiscoverer } from "../src/memory-orchestrator/relation/relation-discoverer.js";
import { HttpMemoryQualityAssessor } from "../src/memory-orchestrator/writeback/quality-assessor.js";
import type { MemoryRecordSnapshot, WriteBackCandidate } from "../src/shared/types.js";

const baseConfig = {
  MEMORY_LLM_BASE_URL: "https://api.example.com/v1",
  MEMORY_LLM_MODEL: "gpt-5-mini",
  MEMORY_LLM_API_KEY: "test-key",
  MEMORY_LLM_PROTOCOL: "openai-compatible" as const,
  MEMORY_LLM_TIMEOUT_MS: 500,
  MEMORY_LLM_EFFORT: "medium" as const,
  RECALL_LLM_JUDGE_MAX_TOKENS: 400,
  RECALL_LLM_CANDIDATE_LIMIT: 12,
  MEMORY_LLM_REFINE_MAX_TOKENS: 800,
  WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS: 1500,
};

const sampleRecord: MemoryRecordSnapshot = {
  id: "rec-1",
  workspace_id: "ws-1",
  user_id: "user-1",
  task_id: "task-1",
  session_id: "session-1",
  memory_type: "fact_preference",
  scope: "user",
  status: "active",
  summary: "默认用中文回答",
  details: null,
  importance: 5,
  confidence: 0.9,
  created_at: "2026-04-22T00:00:00.000Z",
  updated_at: "2026-04-22T00:00:00.000Z",
  last_used_at: null,
};

const sampleCandidate: WriteBackCandidate = {
  workspace_id: "ws-1",
  user_id: "user-1",
  task_id: null,
  session_id: null,
  candidate_type: "fact_preference",
  scope: "user",
  summary: "默认用中文回答",
  details: {},
  importance: 5,
  confidence: 0.9,
  write_reason: "stable preference",
  source: {
    source_type: "assistant_final",
    source_ref: "turn-1",
    service_name: "retrieval-runtime",
  },
  idempotency_key: "cand-1",
};

describe("memory orchestrator extra modules", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("parses intent analyzer output", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  needs_memory: true,
                  memory_types: ["fact_preference", "task_state"],
                  urgency: "immediate",
                  confidence: 0.91,
                  reason: "用户在继续之前的任务",
                  suggested_scopes: ["user", "task"],
                }),
              },
            },
          ],
        }),
      }) as Response) as typeof fetch;

    const analyzer = new HttpMemoryIntentAnalyzer(baseConfig);
    await expect(
      analyzer.analyze({
        current_input: "继续之前那个任务",
        session_context: {
          session_id: "session-1",
          workspace_id: "ws-1",
          recent_turns: [],
        },
      }),
    ).resolves.toMatchObject({
      needs_memory: true,
      urgency: "immediate",
      suggested_scopes: ["user", "task"],
    });
  });

  it("filters unknown ids from quality assessments", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  assessments: [
                    {
                      candidate_id: "cand-1",
                      quality_score: 0.82,
                      confidence: 0.88,
                      potential_conflicts: ["rec-1", "rec-x"],
                      suggested_importance: 4,
                      suggested_status: "pending_confirmation",
                      issues: [
                        {
                          type: "conflict",
                          severity: "medium",
                          description: "与历史偏好接近",
                        },
                      ],
                      reason: "需要人工确认",
                    },
                    {
                      candidate_id: "cand-x",
                      quality_score: 0.2,
                      confidence: 0.2,
                      potential_conflicts: [],
                      suggested_importance: 1,
                      suggested_status: "pending_confirmation",
                      issues: [],
                      reason: "无效",
                    },
                  ],
                }),
              },
            },
          ],
        }),
      }) as Response) as typeof fetch;

    const assessor = new HttpMemoryQualityAssessor(baseConfig);
    const result = await assessor.assess({
      writeback_candidates: [sampleCandidate],
      existing_similar_records: [sampleRecord],
      turn_context: {
        user_input: "以后默认用中文",
        assistant_output: "已确认默认中文",
      },
    });

    expect(result.assessments).toHaveLength(1);
    expect(result.assessments[0]?.potential_conflicts).toEqual(["rec-1"]);
  });

  it("filters unknown ids from effectiveness evaluations", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  evaluations: [
                    {
                      record_id: "rec-1",
                      was_used: true,
                      usage_confidence: 0.9,
                      effectiveness_score: 0.92,
                      suggested_importance_adjustment: 1,
                      usage_evidence: "已按中文输出",
                      reason: "偏好被明确使用",
                    },
                    {
                      record_id: "rec-x",
                      was_used: false,
                      usage_confidence: 0.1,
                      effectiveness_score: 0.1,
                      suggested_importance_adjustment: -1,
                      reason: "unknown",
                    },
                  ],
                }),
              },
            },
          ],
        }),
      }) as Response) as typeof fetch;

    const evaluator = new HttpMemoryRecallEffectivenessEvaluator(baseConfig);
    const result = await evaluator.evaluate({
      injected_memories: [
        {
          record_id: "rec-1",
          summary: "默认用中文回答",
          importance: 5,
        },
      ],
      assistant_output: "后续默认用中文回答，并继续当前任务。",
    });

    expect(result.evaluations).toHaveLength(1);
    expect(result.evaluations[0]?.record_id).toBe("rec-1");
  });

  it("keeps only valid relation targets", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  source_record_id: "rec-source",
                  relations: [
                    {
                      target_record_id: "rec-1",
                      relation_type: "related_to",
                      strength: 0.82,
                      bidirectional: true,
                      reason: "同一任务上下文",
                    },
                    {
                      target_record_id: "rec-x",
                      relation_type: "related_to",
                      strength: 0.5,
                      bidirectional: false,
                      reason: "unknown",
                    },
                  ],
                }),
              },
            },
          ],
        }),
      }) as Response) as typeof fetch;

    const discoverer = new HttpMemoryRelationDiscoverer(baseConfig);
    const result = await discoverer.discover({
      source_record: { ...sampleRecord, id: "rec-source" },
      candidate_records: [sampleRecord],
      context: {
        workspace_id: "ws-1",
        user_id: "user-1",
      },
    });

    expect(result.source_record_id).toBe("rec-source");
    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]?.target_record_id).toBe("rec-1");
  });

  it("caps proactive recommendations to known memories", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  recommendations: [
                    {
                      record_id: "rec-1",
                      relevance_score: 0.95,
                      trigger_reason: "task_similarity",
                      suggestion: "需要的话可以沿用之前的中文输出约定。",
                      auto_inject: true,
                    },
                    {
                      record_id: "rec-x",
                      relevance_score: 0.9,
                      trigger_reason: "related_decision",
                      suggestion: "unknown",
                      auto_inject: true,
                    },
                  ],
                }),
              },
            },
          ],
        }),
      }) as Response) as typeof fetch;

    const recommender = new HttpMemoryProactiveRecommender(baseConfig);
    const result = await recommender.recommend({
      current_context: {
        user_input: "继续做这个任务",
        session_context: {
          session_id: "session-1",
          workspace_id: "ws-1",
        },
        detected_task_type: "coding",
      },
      available_memories: [sampleRecord],
    });

    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]?.record_id).toBe("rec-1");
    expect(result.recommendations[0]?.auto_inject).toBe(true);
  });

  it("filters evolution plan record references to known source ids", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  evolution_type: "summarization",
                  source_records: ["rec-1", "rec-x"],
                  consolidation_plan: {
                    new_summary: "用户长期偏好：默认中文、回答简短。",
                    records_to_archive: ["rec-1", "rec-x"],
                  },
                }),
              },
            },
          ],
        }),
      }) as Response) as typeof fetch;

    const planner = new HttpMemoryEvolutionPlanner(baseConfig);
    const result = await planner.plan({
      source_records: [sampleRecord],
      time_window: {
        start: "2026-04-01T00:00:00.000Z",
        end: "2026-04-30T00:00:00.000Z",
      },
      evolution_type: "summarization",
    });

    expect(result.source_records).toEqual(["rec-1"]);
    expect(result.consolidation_plan?.records_to_archive).toEqual(["rec-1"]);
  });
});
