import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { createMemoryOrchestrator } from "../src/memory-orchestrator/index.js";
import { memoryGovernancePlanSchema, memoryRecallSearchSchema, memoryWritebackExtractionSchema } from "../src/memory-orchestrator/schemas.js";
import type {
  GovernancePlanner,
  GovernanceVerifier,
  RecallInjectionPlanner,
  RecallSearchPlanner,
  WritebackPlanner,
} from "../src/memory-orchestrator/types.js";

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgres://postgres:postgres@localhost:5432/agent_memory",
  STORAGE_WRITEBACK_URL: "http://localhost:3001",
} as unknown as NodeJS.ProcessEnv);

describe("memory orchestrator factory", () => {
  it("returns undefined when no planner is configured", () => {
    expect(createMemoryOrchestrator({ config })).toBeUndefined();
  });

  it("adapts recall, writeback, and governance capabilities behind one entry", async () => {
    const recallSearchPlanner: RecallSearchPlanner = {
      async plan() {
        return { should_search: true, reason: "search" };
      },
    };
    const recallInjectionPlanner: RecallInjectionPlanner = {
      async plan() {
        return {
          should_inject: true,
          reason: "inject",
          selected_record_ids: ["mem-1"],
          memory_summary: "summary",
        };
      },
    };
    const writebackPlanner: WritebackPlanner = {
      async extract() {
        return {
          candidates: [
            {
              candidate_type: "preference",
              scope: "user",
              summary: "默认中文",
              importance: 5,
              confidence: 0.9,
              write_reason: "stable preference",
            },
          ],
        };
      },
      async refine() {
        return {
          refined_candidates: [
            {
              source: "llm_new",
              action: "new",
              summary: "默认中文",
              importance: 5,
              confidence: 0.9,
              scope: "user",
              candidate_type: "preference",
              reason: "stable preference",
            },
          ],
        };
      },
    };
    const governancePlanner: GovernancePlanner = {
      async plan() {
        return {
          actions: [
            {
              type: "archive",
              record_id: "rec-1",
              reason: "superseded",
            },
          ],
        };
      },
    };
    const governanceVerifier: GovernanceVerifier = {
      async verify() {
        return {
          decision: "approve",
          confidence: 0.92,
          notes: "verified",
        };
      },
    };

    const orchestrator = createMemoryOrchestrator({
      config,
      recallPlanner: {
        search: recallSearchPlanner,
        injection: recallInjectionPlanner,
      },
      writebackPlanner,
      governancePlanner,
      governanceVerifier,
    });

    expect(orchestrator?.recall?.search).toBeDefined();
    expect(orchestrator?.recall?.injection).toBeDefined();
    expect(orchestrator?.writeback).toBeDefined();
    expect(orchestrator?.governance?.planner).toBeDefined();
    expect(orchestrator?.governance?.verifier).toBeDefined();

    await expect(
      orchestrator?.recall?.search?.plan({
        context: {
          host: "codex_app_server",
          workspace_id: "ws",
          user_id: "user",
          session_id: "session",
          phase: "before_response",
          current_input: "继续之前那个方案",
        },
        memory_mode: "workspace_plus_global",
        requested_scopes: ["workspace"],
        requested_memory_types: ["preference"],
      }) ?? Promise.reject(new Error("missing search planner")),
    ).resolves.toEqual({ should_search: true, reason: "search" });

    await expect(
      orchestrator?.recall?.injection?.plan({
        context: {
          host: "codex_app_server",
          workspace_id: "ws",
          user_id: "user",
          session_id: "session",
          phase: "before_response",
          current_input: "继续之前那个方案",
        },
        memory_mode: "workspace_plus_global",
        requested_scopes: ["workspace"],
        requested_memory_types: ["preference"],
        candidates: [],
      }) ?? Promise.reject(new Error("missing injection planner")),
    ).resolves.toMatchObject({ should_inject: true, reason: "inject" });
  });

  it("validates shared recall, writeback, and governance schemas", () => {
    expect(
      memoryRecallSearchSchema.parse({
        should_search: true,
        reason: "需要继续之前的任务状态",
        requested_scopes: ["workspace", "task"],
        requested_memory_types: ["task_state"],
        importance_threshold: 4,
        query_hint: "继续之前的任务状态",
        candidate_limit: 8,
      }),
    ).toMatchObject({
      should_search: true,
      candidate_limit: 8,
    });

    expect(
      memoryWritebackExtractionSchema.parse({
        candidates: [
          {
            candidate_type: "preference",
            scope: "user",
            summary: "默认中文",
            importance: 5,
            confidence: 0.9,
            write_reason: "stable preference",
          },
        ],
      }),
    ).toMatchObject({
      candidates: [
        {
          summary: "默认中文",
        },
      ],
    });

    expect(
      memoryGovernancePlanSchema.parse({
        actions: [
          {
            type: "archive",
            record_id: "rec-1",
            reason: "superseded",
          },
        ],
      }),
    ).toMatchObject({
      actions: [
        {
          type: "archive",
        },
      ],
    });
  });
});
