import { afterEach, describe, expect, it } from "vitest";

import { HttpMemoryEvolutionPlanner } from "../src/memory-orchestrator/governance/evolution-planner.js";
import { HttpMemoryRecallInjectionPlanner } from "../src/memory-orchestrator/recall/injection-planner.js";
import { HttpMemoryRecallSearchPlanner } from "../src/memory-orchestrator/recall/search-planner.js";

const baseConfig = {
  MEMORY_LLM_BASE_URL: "https://api.example.com/v1",
  MEMORY_LLM_MODEL: "gpt-5-mini",
  MEMORY_LLM_API_KEY: "test-key",
  MEMORY_LLM_PROTOCOL: "openai-compatible" as const,
  MEMORY_LLM_TIMEOUT_MS: 500,
  MEMORY_LLM_EFFORT: "medium" as const,
  RECALL_LLM_JUDGE_MAX_TOKENS: 400,
  RECALL_LLM_CANDIDATE_LIMIT: 12,
  WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS: 1500,
};

describe("memory orchestrator response normalization", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("normalizes float importance_threshold for search planner", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  should_search: true,
                  reason: "需要延续上下文",
                  requested_scopes: ["workspace", "task"],
                  requested_memory_types: ["task_state"],
                  importance_threshold: 0.7,
                  query_hint: "延续上次任务",
                  candidate_limit: 7.8,
                }),
              },
            },
          ],
        }),
      }) as Response) as typeof fetch;

    const planner = new HttpMemoryRecallSearchPlanner(baseConfig);
    const result = await planner.plan({
      context: {
        host: "codex_app_server",
        workspace_id: "ws-1",
        user_id: "user-1",
        session_id: "session-1",
        phase: "before_response",
        current_input: "继续上次任务",
      },
      memory_mode: "workspace_plus_global",
      requested_scopes: ["workspace", "task"],
      requested_memory_types: ["task_state"],
    });

    expect(result.importance_threshold).toBe(1);
    expect(result.candidate_limit).toBe(8);
  });

  it("parses unified intent fields from search planner output", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  needs_memory: true,
                  intent_confidence: 0.92,
                  intent_reason: "用户在继续之前的任务",
                  should_search: true,
                  reason: "需要延续上下文",
                  requested_scopes: ["workspace", "task"],
                  requested_memory_types: ["task_state"],
                  importance_threshold: 3,
                }),
              },
            },
          ],
        }),
      }) as Response) as typeof fetch;

    const planner = new HttpMemoryRecallSearchPlanner(baseConfig);
    const result = await planner.plan({
      context: {
        host: "codex_app_server",
        workspace_id: "ws-1",
        user_id: "user-1",
        session_id: "session-1",
        phase: "before_response",
        current_input: "继续上次任务",
      },
      memory_mode: "workspace_plus_global",
      requested_scopes: ["workspace", "task"],
      requested_memory_types: ["task_state"],
    });

    expect(result.needs_memory).toBe(true);
    expect(result.intent_confidence).toBe(0.92);
    expect(result.intent_reason).toBe("用户在继续之前的任务");
  });

  it("normalizes float importance_threshold for injection planner", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  should_inject: true,
                  reason: "需要注入任务状态",
                  selected_record_ids: ["rec-1"],
                  memory_summary: "继续之前的任务状态。",
                  importance_threshold: 3.6,
                }),
              },
            },
          ],
        }),
      }) as Response) as typeof fetch;

    const planner = new HttpMemoryRecallInjectionPlanner(baseConfig);
    const result = await planner.plan({
      context: {
        host: "codex_app_server",
        workspace_id: "ws-1",
        user_id: "user-1",
        session_id: "session-1",
        phase: "before_response",
        current_input: "继续上次任务",
      },
      memory_mode: "workspace_plus_global",
      requested_scopes: ["workspace", "task"],
      requested_memory_types: ["task_state"],
      candidates: [
        {
          id: "rec-1",
          workspace_id: "ws-1",
          user_id: "user-1",
          session_id: "session-1",
          task_id: "task-1",
          memory_type: "task_state",
          scope: "task",
          summary: "继续之前的任务状态",
          details: null,
          importance: 5,
          confidence: 0.9,
          status: "active",
          updated_at: "2026-04-22T00:00:00.000Z",
        },
      ],
    });

    expect(result.importance_threshold).toBe(4);
  });

  it("drops empty consolidation plans for knowledge extraction", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  evolution_type: "knowledge_extraction",
                  source_records: ["rec-1"],
                  extracted_knowledge: {
                    pattern: "用户长期偏好中文短句输出。",
                    confidence: 0.88,
                    evidence_count: 2,
                    suggested_scope: "user",
                    suggested_importance: 4,
                  },
                  consolidation_plan: {
                    new_summary: "用户长期偏好中文短句输出。",
                    records_to_archive: [],
                  },
                }),
              },
            },
          ],
        }),
      }) as Response) as typeof fetch;

    const planner = new HttpMemoryEvolutionPlanner(baseConfig);
    const result = await planner.plan({
      source_records: [
        {
          id: "rec-1",
          workspace_id: "ws-1",
          user_id: "user-1",
          task_id: null,
          session_id: null,
          memory_type: "preference",
          scope: "user",
          status: "active",
          summary: "默认中文回答",
          details: null,
          importance: 5,
          confidence: 0.9,
          created_at: "2026-04-22T00:00:00.000Z",
          updated_at: "2026-04-22T00:00:00.000Z",
          last_used_at: null,
        },
      ],
      time_window: {
        start: "2026-04-01T00:00:00.000Z",
        end: "2026-04-30T00:00:00.000Z",
      },
      evolution_type: "knowledge_extraction",
    });

    expect(result.extracted_knowledge?.pattern).toContain("中文");
    expect(result.consolidation_plan).toBeUndefined();
  });
});
