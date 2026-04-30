import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import { loadConfig, type AppConfig } from "../src/config.js";
import { DependencyGuard } from "../src/dependency/dependency-guard.js";
import { InjectionEngine } from "../src/injection/injection-engine.js";
import {
  DEFAULT_RECENT_INJECTION_CONFIG,
  RecentInjectionPolicy,
} from "../src/injection/recent-injection-policy.js";
import type { RecallEffectivenessEvaluator } from "../src/memory-orchestrator/index.js";
import { InMemoryRuntimeRepository } from "../src/observability/in-memory-runtime-repository.js";
import type { QueryResult } from "../src/query/query-engine.js";
import { PrepareContextFinalizer } from "../src/query/prepare-context-finalizer.js";
import { PrepareContextService } from "../src/query/prepare-context-service.js";
import { RecallEffectivenessService } from "../src/query/recall-effectiveness-service.js";
import type {
  CandidateMemory,
  DependencyStatus,
  DependencyStatusSnapshot,
  FinalizeTurnInput,
  MemoryPacket,
  RetrievalQuery,
  TriggerContext,
  TriggerDecision,
  WriteBackCandidate,
} from "../src/shared/types.js";
import { FinalizeTurnService } from "../src/writeback/finalize-turn-service.js";
import { FinalizeIdempotencyCache } from "../src/writeback/finalize-idempotency-cache.js";
import type { WritebackEngineResult } from "../src/writeback/writeback-engine.js";

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const base = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/agent_memory",
    STORAGE_WRITEBACK_URL: "http://localhost:3001",
  } as unknown as NodeJS.ProcessEnv);
  return {
    ...base,
    EMBEDDING_TIMEOUT_MS: 50,
    MEMORY_LLM_TIMEOUT_MS: 50,
    INJECTION_RECORD_LIMIT: 3,
    INJECTION_TOKEN_BUDGET: 256,
    ...overrides,
  };
}

function createDependencyStatus(name: DependencyStatus["name"]): DependencyStatus {
  return {
    name,
    status: "healthy",
    detail: "ok",
    last_checked_at: "2026-04-30T00:00:00.000Z",
  };
}

function createDependencySnapshot(): DependencyStatusSnapshot {
  return {
    read_model: createDependencyStatus("read_model"),
    embeddings: createDependencyStatus("embeddings"),
    storage_writeback: createDependencyStatus("storage_writeback"),
    memory_llm: createDependencyStatus("memory_llm"),
  };
}

function createContext(overrides: Partial<TriggerContext> = {}): TriggerContext {
  return {
    host: "custom_agent",
    workspace_id: "workspace-1",
    user_id: "user-1",
    session_id: "session-1",
    phase: "before_response",
    current_input: "继续按中文偏好处理",
    turn_id: "turn-1",
    ...overrides,
  };
}

function createDecision(overrides: Partial<TriggerDecision> = {}): TriggerDecision {
  return {
    hit: true,
    trigger_type: "phase",
    trigger_reason: "before response recall",
    requested_memory_types: ["preference"],
    memory_mode: "workspace_plus_global",
    requested_scopes: ["user"],
    scope_reason: "user preference requested",
    importance_threshold: 3,
    cooldown_applied: false,
    ...overrides,
  };
}

function createCandidate(overrides: Partial<CandidateMemory> = {}): CandidateMemory {
  return {
    id: "memory-1",
    workspace_id: "workspace-1",
    user_id: "user-1",
    session_id: null,
    task_id: null,
    memory_type: "preference",
    scope: "user",
    summary: "用户偏好：默认使用中文回答。",
    importance: 4,
    confidence: 0.9,
    status: "active",
    updated_at: "2026-04-30T00:00:00.000Z",
    rerank_score: 0.9,
    ...overrides,
  };
}

function createRetrievalQuery(): RetrievalQuery {
  return {
    workspace_id: "workspace-1",
    user_id: "user-1",
    session_id: "session-1",
    phase: "before_response",
    memory_mode: "workspace_plus_global",
    scope_filter: ["user"],
    memory_type_filter: ["preference"],
    status_filter: ["active"],
    importance_threshold: 3,
    semantic_query_text: "中文偏好",
    candidate_limit: 10,
  };
}

function createMemoryPacket(overrides: Partial<MemoryPacket> = {}): MemoryPacket {
  return {
    packet_id: "packet-1",
    trigger: "before response recall",
    memory_mode: "workspace_plus_global",
    requested_scopes: ["user"],
    selected_scopes: ["user"],
    scope_reason: "user preference requested",
    query_scope: "mode=workspace_plus_global",
    records: [createCandidate()],
    packet_summary: "偏好：默认使用中文回答。",
    injection_hint: "使用相关记忆补充回答。",
    ttl_ms: 300_000,
    priority_breakdown: {
      fact: 0,
      preference: 1,
      task_state: 0,
      episodic: 0,
    },
    ...overrides,
  };
}

function createWriteBackCandidate(overrides: Partial<WriteBackCandidate> = {}): WriteBackCandidate {
  return {
    workspace_id: "workspace-1",
    user_id: "user-1",
    task_id: null,
    session_id: null,
    candidate_type: "preference",
    scope: "user",
    summary: "用户偏好：默认使用中文回答。",
    details: {},
    importance: 4,
    confidence: 0.9,
    write_reason: "user stated a stable preference",
    source: {
      source_type: "host_user_input",
      source_ref: "turn-1",
      service_name: "retrieval-runtime",
      extraction_method: "rules",
    },
    idempotency_key: "candidate-1",
    ...overrides,
  };
}

function createFinalizeInput(overrides: Partial<FinalizeTurnInput> = {}): FinalizeTurnInput {
  return {
    host: "custom_agent",
    workspace_id: "workspace-1",
    user_id: "user-1",
    session_id: "session-1",
    turn_id: "turn-1",
    current_input: "请记住默认用中文回答。",
    assistant_output: "已记住。",
    ...overrides,
  };
}

describe("PrepareContextService", () => {
  it("deduplicates concurrent prepare requests for the same turn", async () => {
    const repository = new InMemoryRuntimeRepository();
    const logger = pino({ enabled: false });
    const dependencyGuard = new DependencyGuard(repository, logger);
    const candidate = createCandidate();
    const queryResult: QueryResult = {
      query: createRetrievalQuery(),
      candidates: [candidate],
      degraded: false,
    };
    let queryCalls = 0;
    let releaseQuery!: () => void;
    const queryWait = new Promise<void>((resolve) => {
      releaseQuery = resolve;
    });
    const service = new PrepareContextService({
      dependencyGuard,
      memoryLlmTimeoutMs: 50,
      prepareContextFinalizer: new PrepareContextFinalizer({
        repository,
        injectionEngine: new InjectionEngine(makeConfig()),
        recentInjectionPolicy: new RecentInjectionPolicy({
          config: DEFAULT_RECENT_INJECTION_CONFIG,
          repository,
          logger,
        }),
        recallEffectivenessService: {
          storeInjectionContext: vi.fn(),
        } as unknown as RecallEffectivenessService,
      }),
      queryEngine: {
        query: vi.fn(async () => {
          queryCalls += 1;
          await queryWait;
          return queryResult;
        }),
      } as never,
      recentInjectionPolicy: new RecentInjectionPolicy({
        config: DEFAULT_RECENT_INJECTION_CONFIG,
        repository,
        logger,
      }),
      recallAugmentationService: {
        annotateOpenConflicts: vi.fn(async (_context, candidates: CandidateMemory[]) => candidates),
        collectProactiveRecommendations: vi.fn(async () => []),
        expandCandidatesWithRelations: vi.fn(async () => []),
      } as never,
      repository,
      triggerEngine: {
        decide: vi.fn(async () => createDecision()),
      } as never,
    });

    const first = service.prepareContext(createContext());
    const second = service.prepareContext(createContext());
    releaseQuery();
    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(firstResponse.trace_id).toBe(secondResponse.trace_id);
    expect(queryCalls).toBe(1);
    expect(firstResponse.injection_block?.memory_records.map((record) => record.id)).toEqual(["memory-1"]);
  });
});

describe("PrepareContextFinalizer", () => {
  it("records recall and injection runs and stores injected memory context", async () => {
    const repository = new InMemoryRuntimeRepository();
    await repository.recordTurn({
      trace_id: "trace-1",
      host: "custom_agent",
      workspace_id: "workspace-1",
      user_id: "user-1",
      session_id: "session-1",
      phase: "before_response",
      turn_id: "turn-1",
      current_input: "继续按中文偏好处理",
      created_at: "2026-04-30T00:00:00.000Z",
    });
    const recallEffectivenessService = {
      storeInjectionContext: vi.fn(),
    };
    const recentInjectionPolicy = {
      remember: vi.fn(),
    };
    const finalizer = new PrepareContextFinalizer({
      repository,
      injectionEngine: new InjectionEngine(makeConfig()),
      recentInjectionPolicy: recentInjectionPolicy as never,
      recallEffectivenessService: recallEffectivenessService as unknown as RecallEffectivenessService,
    });

    const response = await finalizer.finalize({
      traceId: "trace-1",
      sessionId: "session-1",
      turnId: "turn-1",
      turnIndex: 2,
      phase: "before_response",
      decision: createDecision(),
      triggerReason: "before response recall",
      queryResult: {
        candidates: [createCandidate()],
        degraded: false,
      },
      packet: createMemoryPacket(),
      recallStartedAt: Date.now(),
      injectionStartedAt: Date.now(),
      dependencyStatus: createDependencySnapshot(),
      proactiveRecommendations: [],
    });
    const runs = await repository.getRuns({ trace_id: "trace-1" });

    expect(response.injection_block?.memory_records.map((record) => record.id)).toEqual(["memory-1"]);
    expect(runs.recall_runs[0]).toMatchObject({
      trace_id: "trace-1",
      selected_count: 1,
      result_state: "matched",
    });
    expect(runs.injection_runs[0]).toMatchObject({
      trace_id: "trace-1",
      injected: true,
      injected_count: 1,
      result_state: "injected",
    });
    expect(recallEffectivenessService.storeInjectionContext).toHaveBeenCalledWith(
      { session_id: "session-1", turn_id: "turn-1" },
      expect.arrayContaining([expect.objectContaining({ id: "memory-1" })]),
      "trace-1",
    );
    expect(recentInjectionPolicy.remember).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-1",
      turnIndex: 2,
    }));
  });
});

describe("FinalizeTurnService", () => {
  it("submits extracted candidates once and reuses the idempotent response", async () => {
    const config = makeConfig();
    const repository = new InMemoryRuntimeRepository();
    const logger = pino({ enabled: false });
    const dependencyGuard = new DependencyGuard(repository, logger);
    await repository.recordTurn({
      trace_id: "trace-1",
      host: "custom_agent",
      workspace_id: "workspace-1",
      user_id: "user-1",
      session_id: "session-1",
      phase: "before_response",
      turn_id: "turn-1",
      current_input: "请记住默认用中文回答。",
      created_at: "2026-04-30T00:00:00.000Z",
    });
    const candidate = createWriteBackCandidate();
    const extraction: WritebackEngineResult = {
      candidates: [candidate],
      filtered_count: 0,
      filtered_reasons: [],
      scope_reasons: ["weighted signals"],
      plan_observation: {
        input_summary: "input",
        output_summary: "candidate=1",
        prompt_version: "memory-writeback-extract-v1",
        schema_version: "memory-writeback-schema-v1",
        degraded: false,
        result_state: "planned",
        duration_ms: 1,
      },
    };
    const writebackEngine = {
      submit: vi.fn(async () => extraction),
      submitCandidates: vi.fn(async () => ({
        ok: true,
        submitted_jobs: [{
          candidate_summary: candidate.summary,
          status: "accepted",
        }],
      })),
    };
    const recallEffectivenessService = {
      evaluateIfNeeded: vi.fn(async () => undefined),
    };
    const service = new FinalizeTurnService({
      dependencyGuard,
      finalizeIdempotencyCache: new FinalizeIdempotencyCache(config),
      recallEffectivenessService: recallEffectivenessService as unknown as RecallEffectivenessService,
      repository,
      writebackEngine,
    });
    const input = createFinalizeInput();

    const first = await service.finalize(input);
    const second = await service.finalize(input);
    const runs = await repository.getRuns({ trace_id: "trace-1" });

    expect(first).toEqual(second);
    expect(first.writeback_submitted).toBe(true);
    expect(writebackEngine.submit).toHaveBeenCalledTimes(1);
    expect(writebackEngine.submitCandidates).toHaveBeenCalledTimes(1);
    expect(recallEffectivenessService.evaluateIfNeeded).toHaveBeenCalledTimes(1);
    expect(runs.writeback_submissions[0]).toMatchObject({
      candidate_count: 1,
      submitted_count: 1,
      result_state: "submitted",
    });
  });
});

describe("RecallEffectivenessService", () => {
  it("evaluates injected memories and patches importance changes", async () => {
    const repository = new InMemoryRuntimeRepository();
    await repository.recordTurn({
      trace_id: "trace-1",
      host: "custom_agent",
      workspace_id: "workspace-1",
      user_id: "user-1",
      session_id: "session-1",
      phase: "after_response",
      turn_id: "turn-1",
      current_input: "继续按中文偏好处理",
      assistant_output: "我会使用中文回答。",
      created_at: "2026-04-30T00:00:00.000Z",
    });
    const logger = pino({ enabled: false });
    const dependencyGuard = new DependencyGuard(repository, logger);
    const evaluator: RecallEffectivenessEvaluator = {
      evaluate: vi.fn(async () => ({
        evaluations: [{
          record_id: "memory-1",
          was_used: true,
          usage_confidence: 0.9,
          effectiveness_score: 0.8,
          suggested_importance_adjustment: 1,
          reason: "assistant used the memory",
        }],
      })),
    };
    const writebackEngine = {
      patchRecord: vi.fn(async () => undefined),
    };
    const service = new RecallEffectivenessService({
      dependencyGuard,
      repository,
      writebackEngine,
      embeddingTimeoutMs: 50,
      memoryLlmTimeoutMs: 50,
      evaluator,
    });

    service.storeInjectionContext(
      { session_id: "session-1", turn_id: "turn-1" },
      [{ id: "memory-1", summary: "用户偏好：默认使用中文回答。", importance: 4 }],
      "trace-1",
    );
    await service.evaluateIfNeeded({
      session_id: "session-1",
      turn_id: "turn-1",
      assistant_output: "我会使用中文回答。",
      tool_results_summary: "language: zh",
    }, "trace-1");
    const runs = await repository.getRuns({ trace_id: "trace-1" });

    expect(evaluator.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      injected_memories: [expect.objectContaining({ record_id: "memory-1" })],
      tool_behavior_summary: expect.stringContaining("language: zh"),
    }));
    expect(writebackEngine.patchRecord).toHaveBeenCalledWith(
      "memory-1",
      expect.objectContaining({
        importance: 5,
        reason: "assistant used the memory",
      }),
    );
    expect(runs.memory_plan_runs[0]).toMatchObject({
      plan_kind: "memory_effectiveness_plan",
      result_state: "planned",
    });
  });
});
