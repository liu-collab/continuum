import pino from "pino";
import { describe, expect, it } from "vitest";

import { loadConfig, type AppConfig } from "../src/config.js";
import { DependencyGuard } from "../src/dependency/dependency-guard.js";
import { InMemoryRuntimeRepository } from "../src/observability/in-memory-runtime-repository.js";
import type { EmbeddingsClient } from "../src/query/embeddings-client.js";
import type { ReadModelRepository } from "../src/query/read-model-repository.js";
import type { RecallSearchInput, RecallSearchPlan, RecallSearchPlanner } from "../src/memory-orchestrator/types.js";
import type {
  CandidateMemory,
  ReadModelAvailabilityQuery,
  RetrievalQuery,
} from "../src/shared/types.js";
import {
  evaluateSemanticTriggerStats,
  TriggerEngine,
} from "../src/trigger/trigger-engine.js";

const config: AppConfig = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 3002,
  LOG_LEVEL: "info",
  LOG_SAMPLE_RATE: 1,
  DATABASE_URL: "postgres://postgres:postgres@localhost:5432/agent_memory",
  READ_MODEL_SCHEMA: "storage_shared_v1",
  READ_MODEL_TABLE: "memory_read_model_v1",
  RUNTIME_SCHEMA: "runtime_private",
  STORAGE_WRITEBACK_URL: "http://localhost:3001",
  EMBEDDING_BASE_URL: "http://localhost:8090/v1",
  EMBEDDING_MODEL: "text-embedding-3-small",
  EMBEDDING_API_KEY: "test-key",
  EMBEDDING_CACHE_TTL_MS: 5 * 60 * 1000,
  EMBEDDING_CACHE_MAX_ENTRIES: 1000,
  MEMORY_LLM_MODEL: "claude-haiku-4-5-20251001",
  MEMORY_LLM_PROTOCOL: "openai-compatible",
  MEMORY_LLM_TIMEOUT_MS: 15000,
  MEMORY_LLM_FALLBACK_ENABLED: true,
  MEMORY_LLM_DEGRADED_THRESHOLD: 0.5,
  MEMORY_LLM_RECOVERY_INTERVAL_MS: 5 * 60 * 1000,
  RECALL_LLM_JUDGE_ENABLED: false,
  RECALL_LLM_JUDGE_WAIT_MS: 5_000,
  RECALL_SEMANTIC_PREFETCH_ENABLED: true,
  RECALL_LLM_JUDGE_MAX_TOKENS: 400,
  RECALL_LLM_CANDIDATE_LIMIT: 12,
  MEMORY_LLM_REFINE_MAX_TOKENS: 800,
  WRITEBACK_REFINE_ENABLED: true,
  WRITEBACK_MAX_CANDIDATES: 3,
  WRITEBACK_OUTBOX_FLUSH_INTERVAL_MS: 5_000,
  WRITEBACK_OUTBOX_BATCH_SIZE: 50,
  WRITEBACK_OUTBOX_MAX_RETRIES: 5,
  WRITEBACK_MAINTENANCE_ENABLED: false,
  WRITEBACK_MAINTENANCE_INTERVAL_MS: 15 * 60 * 1000,
  WRITEBACK_MAINTENANCE_WORKSPACE_INTERVAL_MS: 60 * 60 * 1000,
  WRITEBACK_MAINTENANCE_WORKSPACE_BATCH: 3,
  WRITEBACK_MAINTENANCE_SEED_LIMIT: 20,
  WRITEBACK_MAINTENANCE_RELATED_LIMIT: 40,
  WRITEBACK_MAINTENANCE_SIMILARITY_THRESHOLD: 0.35,
  WRITEBACK_MAINTENANCE_SEED_LOOKBACK_MS: 24 * 60 * 60 * 1000,
  WRITEBACK_MAINTENANCE_TIMEOUT_MS: 5_000,
  WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS: 1500,
  WRITEBACK_MAINTENANCE_MAX_ACTIONS: 10,
  WRITEBACK_MAINTENANCE_MIN_IMPORTANCE: 2,
  WRITEBACK_MAINTENANCE_ACTOR_ID: "retrieval-runtime-maintenance",
  WRITEBACK_SESSION_EPISODIC_TTL_MS: 7 * 24 * 60 * 60 * 1000,
  WRITEBACK_GOVERNANCE_VERIFY_ENABLED: true,
  WRITEBACK_GOVERNANCE_VERIFY_MAX_TOKENS: 1000,
  WRITEBACK_GOVERNANCE_ARCHIVE_MIN_CONFIDENCE: 0.85,
  WRITEBACK_GOVERNANCE_DELETE_MIN_CONFIDENCE: 0.92,
  WRITEBACK_GOVERNANCE_SHADOW_MODE: false,
  FINALIZE_IDEMPOTENCY_TTL_MS: 5 * 60 * 1000,
  FINALIZE_IDEMPOTENCY_MAX_ENTRIES: 500,
  WRITEBACK_INPUT_OVERLAP_THRESHOLD: 0.2,
  WRITEBACK_CROSS_REFERENCE_CONFIRMATION_THRESHOLD: 0.85,
  WRITEBACK_CROSS_REFERENCE_PARTIAL_MATCH_THRESHOLD: 0.7,
  QUERY_TIMEOUT_MS: 50,
  STORAGE_TIMEOUT_MS: 50,
  EMBEDDING_TIMEOUT_MS: 50,
  QUERY_CANDIDATE_LIMIT: 30,
  PACKET_RECORD_LIMIT: 10,
  INJECTION_RECORD_LIMIT: 2,
  INJECTION_TOKEN_BUDGET: 256,
  INJECTION_DEDUP_ENABLED: true,
  INJECTION_HARD_WINDOW_TURNS_FACT: 5,
  INJECTION_HARD_WINDOW_TURNS_PREFERENCE: 5,
  INJECTION_HARD_WINDOW_TURNS_TASK_STATE: 3,
  INJECTION_HARD_WINDOW_TURNS_EPISODIC: 2,
  INJECTION_HARD_WINDOW_MS_FACT: 30 * 60 * 1000,
  INJECTION_HARD_WINDOW_MS_PREFERENCE: 30 * 60 * 1000,
  INJECTION_HARD_WINDOW_MS_TASK_STATE: 10 * 60 * 1000,
  INJECTION_HARD_WINDOW_MS_EPISODIC: 5 * 60 * 1000,
  INJECTION_SOFT_WINDOW_MS_TASK_STATE: 30 * 60 * 1000,
  INJECTION_SOFT_WINDOW_MS_EPISODIC: 15 * 60 * 1000,
  INJECTION_RECENT_STATE_TTL_MS: 60 * 60 * 1000,
  INJECTION_RECENT_STATE_MAX_SESSIONS: 500,
  SEMANTIC_TRIGGER_THRESHOLD: 0.72,
  SEMANTIC_TRIGGER_CANDIDATE_LIMIT: 30,
  SEMANTIC_TRIGGER_BEST_SCORE_THRESHOLD: 0.85,
  SEMANTIC_TRIGGER_TOP3_AVG_THRESHOLD: 0.75,
  SEMANTIC_TRIGGER_ABOVE_COUNT_THRESHOLD: 5,
  IMPORTANCE_THRESHOLD_SESSION_START: 4,
  IMPORTANCE_THRESHOLD_DEFAULT: 3,
  IMPORTANCE_THRESHOLD_SEMANTIC: 4,
};

const decisionConfig = {
  semanticThreshold: 0.72,
  bestScoreThreshold: 0.85,
  top3AvgThreshold: 0.75,
  aboveCountThreshold: 5,
};

const ids = {
  workspace: "550e8400-e29b-41d4-a716-446655440000",
  user: "550e8400-e29b-41d4-a716-446655440001",
  session: "550e8400-e29b-41d4-a716-446655440002",
};

class StubEmbeddingsClient implements EmbeddingsClient {
  async embedText(): Promise<number[]> {
    return [1, 0];
  }
}

class CapturingReadModelRepository implements ReadModelRepository {
  public query?: RetrievalQuery;
  public searchCallCount = 0;

  async estimateAvailability(_query: ReadModelAvailabilityQuery) {
    return {
      total_count: 6,
      type_distribution: { preference: 6 },
    };
  }

  async searchCandidates(query: RetrievalQuery): Promise<CandidateMemory[]> {
    this.searchCallCount += 1;
    this.query = query;
    return [
      this.memory("mem-1", [0.76, Math.sqrt(1 - 0.76 ** 2)]),
      this.memory("mem-2", [0.76, Math.sqrt(1 - 0.76 ** 2)]),
      this.memory("mem-3", [0.76, Math.sqrt(1 - 0.76 ** 2)]),
      this.memory("mem-4", [0.72, Math.sqrt(1 - 0.72 ** 2)]),
      this.memory("mem-5", [0.72, Math.sqrt(1 - 0.72 ** 2)]),
      this.memory("mem-6", [0.2, Math.sqrt(1 - 0.2 ** 2)]),
    ];
  }

  protected memory(id: string, summaryEmbedding: number[]): CandidateMemory {
    return {
      id,
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: null,
      task_id: null,
      memory_type: "preference",
      scope: "user",
      summary: "用户的长期偏好和任务约定",
      details: null,
      source: null,
      importance: 4,
      confidence: 0.9,
      status: "active",
      updated_at: "2026-04-20T10:00:00.000Z",
      last_confirmed_at: null,
      summary_embedding: summaryEmbedding,
      embedding_status: "ok",
    };
  }
}

class LowScoreReadModelRepository extends CapturingReadModelRepository {
  override async searchCandidates(query: RetrievalQuery): Promise<CandidateMemory[]> {
    this.searchCallCount += 1;
    this.query = query;
    return [
      this.memory("mem-low-1", [0.2, Math.sqrt(1 - 0.2 ** 2)]),
      this.memory("mem-low-2", [0.1, Math.sqrt(1 - 0.1 ** 2)]),
    ];
  }
}

class SlowRecallSearchPlanner implements RecallSearchPlanner {
  public callCount = 0;

  constructor(
    private readonly delayMs: number,
    private readonly planResult: RecallSearchPlan = {
      should_search: false,
      reason: "slow planner says no",
    },
  ) {}

  async plan(_input: RecallSearchInput): Promise<RecallSearchPlan> {
    this.callCount += 1;
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return this.planResult;
  }
}

describe("semantic trigger fallback", () => {
  it("loads semantic trigger statistics controls from config", () => {
    const loaded = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://postgres:postgres@localhost:5432/agent_memory",
      STORAGE_WRITEBACK_URL: "http://localhost:3001",
      SEMANTIC_TRIGGER_CANDIDATE_LIMIT: "24",
      SEMANTIC_TRIGGER_BEST_SCORE_THRESHOLD: "0.9",
      SEMANTIC_TRIGGER_TOP3_AVG_THRESHOLD: "0.8",
      SEMANTIC_TRIGGER_ABOVE_COUNT_THRESHOLD: "4",
      RECALL_LLM_JUDGE_WAIT_MS: "7000",
      RECALL_SEMANTIC_PREFETCH_ENABLED: "true",
    } as unknown as NodeJS.ProcessEnv);

    expect(loaded.SEMANTIC_TRIGGER_CANDIDATE_LIMIT).toBe(24);
    expect(loaded.SEMANTIC_TRIGGER_BEST_SCORE_THRESHOLD).toBe(0.9);
    expect(loaded.SEMANTIC_TRIGGER_TOP3_AVG_THRESHOLD).toBe(0.8);
    expect(loaded.SEMANTIC_TRIGGER_ABOVE_COUNT_THRESHOLD).toBe(4);
    expect(loaded.RECALL_LLM_JUDGE_WAIT_MS).toBe(7000);
    expect(loaded.RECALL_SEMANTIC_PREFETCH_ENABLED).toBe(true);
  });

  it("hits on a strong best score", () => {
    const stats = evaluateSemanticTriggerStats([0.86, 0.3, 0.2], decisionConfig);

    expect(stats.hit).toBe(true);
    expect(stats.best_score).toBe(0.86);
    expect(stats.above_count).toBe(1);
  });

  it("hits on dense and broad medium-high scores", () => {
    const stats = evaluateSemanticTriggerStats([0.76, 0.75, 0.74, 0.72, 0.72], decisionConfig);

    expect(stats.hit).toBe(true);
    expect(stats.best_score).toBeLessThan(0.85);
    expect(stats.top3_avg).toBeGreaterThanOrEqual(0.75);
    expect(stats.above_count).toBe(5);
  });

  it("skips isolated noise that does not meet density", () => {
    const stats = evaluateSemanticTriggerStats([0.84, 0.2, 0.1, 0.05], decisionConfig);

    expect(stats.hit).toBe(false);
    expect(stats.best_score).toBe(0.84);
    expect(stats.above_count).toBe(1);
  });

  it("uses the configured candidate sample size for semantic fallback", async () => {
    const repository = new InMemoryRuntimeRepository();
    const readModelRepository = new CapturingReadModelRepository();
    const triggerEngine = new TriggerEngine(
      {
        ...config,
        SEMANTIC_TRIGGER_CANDIDATE_LIMIT: 24,
      },
      new StubEmbeddingsClient(),
      readModelRepository,
      new DependencyGuard(repository, pino({ enabled: false })),
      pino({ enabled: false }),
    );

    const decision = await triggerEngine.decide({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      phase: "before_response",
      current_input: "请分析这个模块的错误处理策略和边界情况",
      memory_mode: "workspace_plus_global",
    });

    expect(readModelRepository.query?.candidate_limit).toBe(24);
    expect(readModelRepository.query?.semantic_query_embedding).toEqual([1, 0]);
    expect(decision.hit).toBe(true);
    expect(decision.trigger_type).toBe("semantic_fallback");
  });

  it("uses semantic prefetch early only when the recall judge soft wait has a semantic hit", async () => {
    const repository = new InMemoryRuntimeRepository();
    const readModelRepository = new CapturingReadModelRepository();
    const planner = new SlowRecallSearchPlanner(80);
    const triggerEngine = new TriggerEngine(
      {
        ...config,
        RECALL_LLM_JUDGE_ENABLED: true,
        RECALL_LLM_JUDGE_WAIT_MS: 20,
        RECALL_SEMANTIC_PREFETCH_ENABLED: true,
      },
      new StubEmbeddingsClient(),
      readModelRepository,
      new DependencyGuard(repository, pino({ enabled: false })),
      pino({ enabled: false }),
      planner,
    );
    const startedAt = Date.now();

    const decision = await triggerEngine.decide({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      phase: "before_response",
      current_input: "请分析这个模块的错误处理策略和边界情况",
      memory_mode: "workspace_plus_global",
    });

    expect(Date.now() - startedAt).toBeLessThan(75);
    expect(planner.callCount).toBe(1);
    expect(readModelRepository.query?.candidate_limit).toBe(30);
    expect(decision.hit).toBe(true);
    expect(decision.trigger_type).toBe("semantic_fallback");
    expect(decision.search_plan_degraded).toBe(true);
    expect(decision.search_plan_degradation_reason).toBe("memory_llm_soft_wait_semantic_hit");
  });

  it("keeps waiting for the recall judge after soft wait when semantic prefetch misses", async () => {
    const repository = new InMemoryRuntimeRepository();
    const readModelRepository = new LowScoreReadModelRepository();
    const planner = new SlowRecallSearchPlanner(40, {
      should_search: true,
      reason: "planner eventually found memory need",
      requested_scopes: ["user"],
      requested_memory_types: ["preference"],
      candidate_limit: 6,
    });
    const triggerEngine = new TriggerEngine(
      {
        ...config,
        RECALL_LLM_JUDGE_ENABLED: true,
        RECALL_LLM_JUDGE_WAIT_MS: 10,
        RECALL_SEMANTIC_PREFETCH_ENABLED: true,
      },
      new StubEmbeddingsClient(),
      readModelRepository,
      new DependencyGuard(repository, pino({ enabled: false })),
      pino({ enabled: false }),
      planner,
    );
    const startedAt = Date.now();

    const decision = await triggerEngine.decide({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      phase: "before_response",
      current_input: "请分析这个模块的错误处理策略和边界情况",
      memory_mode: "workspace_plus_global",
    });

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(35);
    expect(planner.callCount).toBe(1);
    expect(readModelRepository.searchCallCount).toBe(1);
    expect(decision.hit).toBe(true);
    expect(decision.trigger_type).toBe("llm_recall_judge");
    expect(decision.search_plan_degraded).toBe(false);
  });
});
