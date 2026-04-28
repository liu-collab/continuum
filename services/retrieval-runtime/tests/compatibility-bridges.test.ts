import { afterEach, describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config.js";
import { HttpMemoryGovernancePlanner } from "../src/memory-orchestrator/governance/planner.js";
import { HttpMemoryGovernanceVerifier } from "../src/memory-orchestrator/governance/verifier.js";
import { HttpMemoryRecallInjectionPlanner } from "../src/memory-orchestrator/recall/injection-planner.js";
import { HttpMemoryRecallSearchPlanner } from "../src/memory-orchestrator/recall/search-planner.js";
import { HttpMemoryWritebackPlanner } from "../src/memory-orchestrator/writeback/planner.js";
import type { RecallInjectionInput, RecallSearchInput } from "../src/memory-orchestrator/types.js";
import { HttpLlmRecallPlanner } from "../src/trigger/llm-recall-judge.js";
import { HttpLlmExtractor } from "../src/writeback/llm-extractor.js";
import { HttpGovernanceVerifier } from "../src/writeback/llm-governance-verifier.js";
import { HttpLlmMaintenancePlanner } from "../src/writeback/llm-maintenance-planner.js";

const compatConfig: Pick<
  AppConfig,
  | "MEMORY_LLM_BASE_URL"
  | "MEMORY_LLM_MODEL"
  | "MEMORY_LLM_API_KEY"
  | "MEMORY_LLM_PROTOCOL"
  | "MEMORY_LLM_TIMEOUT_MS"
  | "MEMORY_LLM_EFFORT"
  | "RECALL_LLM_JUDGE_MAX_TOKENS"
  | "RECALL_LLM_CANDIDATE_LIMIT"
  | "MEMORY_LLM_REFINE_MAX_TOKENS"
  | "WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS"
  | "WRITEBACK_MAINTENANCE_MAX_ACTIONS"
  | "WRITEBACK_GOVERNANCE_VERIFY_MAX_TOKENS"
  | "WRITEBACK_MAX_CANDIDATES"
> = {
  MEMORY_LLM_BASE_URL: "https://api.example.com/v1",
  MEMORY_LLM_MODEL: "gpt-5-mini",
  MEMORY_LLM_API_KEY: "test-key",
  MEMORY_LLM_PROTOCOL: "openai-compatible",
  MEMORY_LLM_TIMEOUT_MS: 500,
  MEMORY_LLM_EFFORT: "medium",
  RECALL_LLM_JUDGE_MAX_TOKENS: 400,
  RECALL_LLM_CANDIDATE_LIMIT: 12,
  MEMORY_LLM_REFINE_MAX_TOKENS: 800,
  WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS: 1500,
  WRITEBACK_MAINTENANCE_MAX_ACTIONS: 10,
  WRITEBACK_GOVERNANCE_VERIFY_MAX_TOKENS: 1000,
  WRITEBACK_MAX_CANDIDATES: 3,
};

describe("compatibility bridges", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("keeps recall compatibility wrapper aligned with orchestrator planners", async () => {
    let callCount = 0;
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => {
          callCount += 1;
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify(
                    callCount === 1
                      ? {
                          should_search: true,
                          reason: "需要继续之前的任务",
                          requested_scopes: ["workspace", "task"],
                          requested_memory_types: ["task_state"],
                          query_hint: "继续之前的任务状态",
                          candidate_limit: 6,
                        }
                      : {
                          should_inject: true,
                          reason: "需要注入任务状态",
                          selected_record_ids: ["rec-1"],
                          memory_summary: "继续之前的任务状态。",
                        },
                  ),
                },
              },
            ],
          };
        },
      }) as Response) as typeof fetch;

    const compatPlanner = new HttpLlmRecallPlanner(compatConfig);
    const searchPlanner = new HttpMemoryRecallSearchPlanner(compatConfig);
    const injectionPlanner = new HttpMemoryRecallInjectionPlanner(compatConfig);

    const searchInput: RecallSearchInput = {
      context: {
        host: "codex_app_server" as const,
        workspace_id: "ws-1",
        user_id: "user-1",
        session_id: "session-1",
        phase: "before_response" as const,
        current_input: "继续之前那个任务",
      },
      memory_mode: "workspace_plus_global" as const,
      requested_scopes: ["workspace", "task"],
      requested_memory_types: ["task_state"],
    };

    const compatSearch = await compatPlanner.planSearch(searchInput);
    callCount = 0;
    const directSearch = await searchPlanner.plan(searchInput);
    expect(compatSearch).toEqual(directSearch);

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
                }),
              },
            },
          ],
        }),
      }) as Response) as typeof fetch;

    const injectionInput: RecallInjectionInput = {
      ...searchInput,
      candidates: [
        {
          id: "rec-1",
          workspace_id: "ws-1",
          user_id: "user-1",
          session_id: "session-1",
          task_id: "task-1",
          memory_type: "task_state" as const,
          scope: "task" as const,
          summary: "继续之前的任务状态",
          details: null,
          importance: 5,
          confidence: 0.9,
          status: "active" as const,
          updated_at: "2026-04-22T00:00:00.000Z",
        },
      ],
    };
    const compatInjection = await compatPlanner.planInjection(injectionInput);
    const directInjection = await injectionPlanner.plan(injectionInput);
    expect(compatInjection).toEqual(directInjection);
  });

  it("keeps writeback and governance wrappers as thin subclasses over orchestrator modules", () => {
    expect(new HttpLlmExtractor(compatConfig as AppConfig)).toBeInstanceOf(HttpMemoryWritebackPlanner);
    expect(new HttpLlmMaintenancePlanner(compatConfig)).toBeInstanceOf(HttpMemoryGovernancePlanner);
    expect(new HttpGovernanceVerifier(compatConfig)).toBeInstanceOf(HttpMemoryGovernanceVerifier);
  });
});
