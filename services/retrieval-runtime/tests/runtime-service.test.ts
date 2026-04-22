import pino from "pino";
import { describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config.js";
import { createApp } from "../src/app.js";
import { DependencyGuard } from "../src/dependency/dependency-guard.js";
import { InjectionEngine } from "../src/injection/injection-engine.js";
import { createMemoryOrchestrator } from "../src/memory-orchestrator/index.js";
import { InMemoryRuntimeRepository } from "../src/observability/in-memory-runtime-repository.js";
import type { EmbeddingsClient } from "../src/query/embeddings-client.js";
import { InMemoryReadModelRepository } from "../src/query/in-memory-read-model-repository.js";
import { QueryEngine } from "../src/query/query-engine.js";
import { RetrievalRuntimeService } from "../src/runtime-service.js";
import type {
  CandidateMemory,
  GovernanceExecutionResponseItem,
  MemoryConflictSnapshot,
  MemoryRecordSnapshot,
  SubmittedWriteBackJob,
  WriteBackCandidate,
} from "../src/shared/types.js";
import type {
  LlmRecallPlan,
  LlmRecallPlanner,
  LlmRecallSearchPlan,
} from "../src/trigger/llm-recall-judge.js";
import { TriggerEngine } from "../src/trigger/trigger-engine.js";
import type {
  LlmExtractionResult,
  LlmExtractor,
  LlmRefineResult,
} from "../src/writeback/llm-extractor.js";
import { FinalizeIdempotencyCache } from "../src/writeback/finalize-idempotency-cache.js";
import type {
  RecordListPage,
  RecordPatchPayload,
  ResolveConflictPayload,
  StorageMutationPayload,
  StorageWritebackClient,
} from "../src/writeback/storage-client.js";
import { WritebackEngine } from "../src/writeback/writeback-engine.js";

const baseConfig: AppConfig = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 3002,
  LOG_LEVEL: "info",
  DATABASE_URL: "postgres://postgres:postgres@localhost:5432/agent_memory",
  READ_MODEL_SCHEMA: "storage_shared_v1",
  READ_MODEL_TABLE: "memory_read_model_v1",
  RUNTIME_SCHEMA: "runtime_private",
  STORAGE_WRITEBACK_URL: "http://localhost:3001",
  EMBEDDING_BASE_URL: "http://localhost:8090/v1",
  EMBEDDING_MODEL: "text-embedding-3-small",
  EMBEDDING_API_KEY: "test-key",
  WRITEBACK_LLM_MODEL: "claude-haiku-4-5-20251001",
  WRITEBACK_LLM_PROTOCOL: "openai-compatible",
  WRITEBACK_LLM_TIMEOUT_MS: 5000,
  RECALL_LLM_JUDGE_ENABLED: true,
  RECALL_LLM_JUDGE_MAX_TOKENS: 400,
  RECALL_LLM_CANDIDATE_LIMIT: 12,
  WRITEBACK_LLM_REFINE_MAX_TOKENS: 800,
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
  WRITEBACK_GOVERNANCE_VERIFY_ENABLED: true,
  WRITEBACK_GOVERNANCE_VERIFY_MAX_TOKENS: 1000,
  WRITEBACK_GOVERNANCE_ARCHIVE_MIN_CONFIDENCE: 0.85,
  WRITEBACK_GOVERNANCE_DELETE_MIN_CONFIDENCE: 0.92,
  WRITEBACK_GOVERNANCE_SHADOW_MODE: false,
  FINALIZE_IDEMPOTENCY_TTL_MS: 5 * 60 * 1000,
  FINALIZE_IDEMPOTENCY_MAX_ENTRIES: 500,
  WRITEBACK_INPUT_OVERLAP_THRESHOLD: 0.2,
  QUERY_TIMEOUT_MS: 50,
  STORAGE_TIMEOUT_MS: 50,
  EMBEDDING_TIMEOUT_MS: 50,
  QUERY_CANDIDATE_LIMIT: 30,
  PACKET_RECORD_LIMIT: 10,
  INJECTION_RECORD_LIMIT: 2,
  INJECTION_TOKEN_BUDGET: 256,
  SEMANTIC_TRIGGER_THRESHOLD: 0.72,
  IMPORTANCE_THRESHOLD_SESSION_START: 4,
  IMPORTANCE_THRESHOLD_DEFAULT: 3,
  IMPORTANCE_THRESHOLD_SEMANTIC: 4,
};

const ids = {
  workspace: "550e8400-e29b-41d4-a716-446655440000",
  user: "550e8400-e29b-41d4-a716-446655440001",
  session: "550e8400-e29b-41d4-a716-446655440002",
  task: "550e8400-e29b-41d4-a716-446655440003",
};

const sampleRecords: CandidateMemory[] = [
  {
    id: "mem-workspace",
    workspace_id: ids.workspace,
    user_id: ids.user,
    session_id: null,
    task_id: null,
    memory_type: "fact_preference",
    scope: "workspace",
    summary: "工作区约束：这个仓库默认保持中文注释和简洁输出。",
    details: null,
    source: { turn_id: "t-0" },
    importance: 5,
    confidence: 0.96,
    status: "active",
    updated_at: "2026-04-15T09:00:00.000Z",
    last_confirmed_at: "2026-04-15T09:00:00.000Z",
    summary_embedding: [1, 0, 0],
  },
  {
    id: "mem-preference",
    workspace_id: ids.workspace,
    user_id: ids.user,
    session_id: ids.session,
    task_id: null,
    memory_type: "fact_preference",
    scope: "user",
    summary: "用户偏好：默认用中文，回答尽量简短直接。",
    details: null,
    source: { turn_id: "t-1" },
    importance: 5,
    confidence: 0.95,
    status: "active",
    updated_at: "2026-04-15T10:00:00.000Z",
    last_confirmed_at: "2026-04-15T10:00:00.000Z",
    summary_embedding: [1, 0, 0],
  },
  {
    id: "mem-task",
    workspace_id: ids.workspace,
    user_id: ids.user,
    session_id: ids.session,
    task_id: ids.task,
    memory_type: "task_state",
    scope: "task",
    summary: "当前任务状态：需要先补 `retrieval-runtime`（运行时检索服务）的接口和测试。",
    details: null,
    source: { turn_id: "t-2" },
    importance: 5,
    confidence: 0.9,
    status: "active",
    updated_at: "2026-04-15T11:00:00.000Z",
    last_confirmed_at: "2026-04-15T11:00:00.000Z",
    summary_embedding: [0.9, 0.1, 0],
  },
  {
    id: "mem-episodic",
    workspace_id: ids.workspace,
    user_id: ids.user,
    session_id: ids.session,
    task_id: ids.task,
    memory_type: "episodic",
    scope: "task",
    summary: "历史事件：上一轮已经确定先做 `Fastify`（Web 框架）接口，再补写回。",
    details: null,
    source: { turn_id: "t-3" },
    importance: 4,
    confidence: 0.8,
    status: "active",
    updated_at: "2026-04-15T12:00:00.000Z",
    last_confirmed_at: "2026-04-15T12:00:00.000Z",
    summary_embedding: [0.8, 0.2, 0],
  },
];

class StubEmbeddingsClient implements EmbeddingsClient {
  constructor(private readonly vector: number[] = [1, 0, 0], private readonly shouldFail = false) {}

  async embedText(): Promise<number[]> {
    if (this.shouldFail) {
      throw new Error("embeddings unavailable");
    }
    return this.vector;
  }
}

class StubStorageClient implements StorageWritebackClient {
  public callCount = 0;

  constructor(private readonly jobs: SubmittedWriteBackJob[] = [], private readonly shouldFail = false) {}

  async submitCandidates(candidates: WriteBackCandidate[]): Promise<SubmittedWriteBackJob[]> {
    this.callCount += 1;
    if (this.shouldFail) {
      throw new Error("storage unavailable");
    }

    return (
      this.jobs.length > 0
        ? this.jobs
        : candidates.map((candidate) => ({
            candidate_summary: candidate.summary,
            status: "accepted_async",
          }))
    ) as SubmittedWriteBackJob[];
  }

  async listRecords(): Promise<RecordListPage> {
    return { items: [], total: 0, page: 1, page_size: 20 };
  }

  async patchRecord(_recordId: string, _payload: RecordPatchPayload): Promise<MemoryRecordSnapshot> {
    throw new Error("stub storage client does not implement patchRecord");
  }

  async archiveRecord(_recordId: string, _payload: StorageMutationPayload): Promise<MemoryRecordSnapshot> {
    throw new Error("stub storage client does not implement archiveRecord");
  }

  async listConflicts(): Promise<MemoryConflictSnapshot[]> {
    return [];
  }

  async resolveConflict(_conflictId: string, _payload: ResolveConflictPayload): Promise<MemoryConflictSnapshot> {
    throw new Error("stub storage client does not implement resolveConflict");
  }

  async submitGovernanceExecutions(): Promise<GovernanceExecutionResponseItem[]> {
    return [];
  }
}

class StubLlmExtractor implements LlmExtractor {
  constructor(private readonly result: LlmExtractionResult, private readonly shouldFail = false) {}

  async extract(): Promise<LlmExtractionResult> {
    if (this.shouldFail) {
      throw new Error("writeback llm timeout");
    }
    return this.result;
  }

  async refine(): Promise<LlmRefineResult> {
    if (this.shouldFail) {
      throw new Error("writeback llm refine timeout");
    }
    return {
      refined_candidates: this.result.candidates.map((candidate) => ({
        source: "llm_new" as const,
        action: "new" as const,
        summary: candidate.summary,
        importance: candidate.importance,
        confidence: candidate.confidence,
        scope: candidate.scope,
        candidate_type: candidate.candidate_type,
        reason: candidate.write_reason,
      })),
    };
  }
}

class SpyLlmExtractor implements LlmExtractor {
  public callCount = 0;
  public refineCallCount = 0;

  constructor(private readonly result: LlmExtractionResult) {}

  async extract(): Promise<LlmExtractionResult> {
    this.callCount += 1;
    return this.result;
  }

  async refine(): Promise<LlmRefineResult> {
    this.refineCallCount += 1;
    return {
      refined_candidates: this.result.candidates.map((candidate) => ({
        source: "llm_new" as const,
        action: "new" as const,
        summary: candidate.summary,
        importance: candidate.importance,
        confidence: candidate.confidence,
        scope: candidate.scope,
        candidate_type: candidate.candidate_type,
        reason: candidate.write_reason,
      })),
    };
  }
}

class StubLlmRecallPlanner implements LlmRecallPlanner {
  constructor(
    private readonly searchPlan: LlmRecallSearchPlan,
    private readonly injectionPlan: LlmRecallPlan,
    private readonly shouldFail = false,
  ) {}

  async planSearch(): Promise<LlmRecallSearchPlan> {
    if (this.shouldFail) {
      throw new Error("recall llm timeout");
    }
    return this.searchPlan;
  }

  async planInjection(): Promise<LlmRecallPlan> {
    if (this.shouldFail) {
      throw new Error("recall llm timeout");
    }
    return this.injectionPlan;
  }

  async healthCheck(): Promise<void> {
    if (this.shouldFail) {
      throw new Error("recall llm timeout");
    }
  }
}

function createRuntime(overrides?: {
  records?: CandidateMemory[];
  embeddingsClient?: EmbeddingsClient;
  storageClient?: StorageWritebackClient;
  llmExtractor?: LlmExtractor;
  llmRecallPlanner?: LlmRecallPlanner;
  config?: Partial<AppConfig>;
}) {
  const repository = new InMemoryRuntimeRepository();
  const logger = pino({ enabled: false });
  const dependencyGuard = new DependencyGuard(repository, logger);
  const readModelRepository = new InMemoryReadModelRepository(overrides?.records ?? sampleRecords);
  const embeddingsClient = overrides?.embeddingsClient ?? new StubEmbeddingsClient();
  const storageClient = overrides?.storageClient ?? new StubStorageClient();
  const config = { ...baseConfig, ...overrides?.config };
  const finalizeIdempotencyCache = new FinalizeIdempotencyCache(config);
  const memoryOrchestrator = createMemoryOrchestrator({
    config,
    recallPlanner: overrides?.llmRecallPlanner as never,
    writebackPlanner: overrides?.llmExtractor as never,
  });

  const service = new RetrievalRuntimeService(
    new TriggerEngine(
      config,
      embeddingsClient,
      readModelRepository,
      dependencyGuard,
      logger,
      memoryOrchestrator?.recall?.search,
    ),
    new QueryEngine(config, readModelRepository, embeddingsClient, dependencyGuard, logger),
    embeddingsClient,
    new InjectionEngine(config),
    new WritebackEngine(config, storageClient, dependencyGuard, memoryOrchestrator?.writeback),
    repository,
    dependencyGuard,
    logger,
    finalizeIdempotencyCache,
    config.EMBEDDING_TIMEOUT_MS,
    memoryOrchestrator,
  );

  return { service, repository, storageClient };
}

describe("retrieval-runtime service", () => {
  it("returns an injection block when history reference trigger hits", async () => {
    const { service } = createRuntime();

    const response = await service.prepareContext({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      thread_id: "thread-1",
      turn_id: "turn-1",
      phase: "before_response",
      current_input: "上次定过的接口结构这轮继续沿用。",
    });

    expect(response.trigger).toBe(true);
    expect(response.injection_block).not.toBeNull();
    expect(response.injection_block?.memory_records.length).toBeGreaterThan(0);
    expect(response.memory_packet?.records.length).toBeGreaterThan(0);
    expect(response.injection_block?.memory_mode).toBe("workspace_plus_global");
    expect(response.injection_block?.requested_scopes).toContain("workspace");
    expect(response.injection_block?.memory_summary).toContain("偏好与约束");
    expect(response.memory_packet?.injection_hint).toContain("优先");
  });

  it("returns no injection when trigger is not hit", async () => {
    const { service } = createRuntime({
      embeddingsClient: new StubEmbeddingsClient([0, 0, 1]),
    });

    const response = await service.prepareContext({
      host: "codex_app_server",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      phase: "before_response",
      current_input: "嗯",
    });

    expect(response.trigger).toBe(false);
    expect(response.injection_block).toBeNull();
    expect(response.memory_packet).toBeNull();
  });

  it("uses llm recall planner to select injected memory", async () => {
    const { service } = createRuntime({
      llmRecallPlanner: new StubLlmRecallPlanner({
        should_search: true,
        reason: "用户在隐式引用之前确认过的做法，需要先查记忆。",
        requested_scopes: ["workspace", "task", "session", "user"],
        requested_memory_types: ["fact_preference", "task_state", "episodic"],
        importance_threshold: 3,
        query_hint: "继续沿用用户已经确认过的输出偏好和当前任务状态",
        candidate_limit: 6,
      }, {
        should_inject: true,
        reason: "用户在隐式引用之前确认过的做法，需要恢复记忆。",
        selected_record_ids: ["mem-preference", "mem-task"],
        memory_summary: "偏好与任务状态：默认中文回答，并继续当前 retrieval-runtime 接口测试任务。",
        requested_scopes: ["workspace", "task", "session", "user"],
        requested_memory_types: ["fact_preference", "task_state", "episodic"],
        importance_threshold: 3,
      }),
    });

    const response = await service.prepareContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      phase: "before_response",
      current_input: "照旧，按我定的那套继续就行。",
    });

    expect(response.trigger).toBe(true);
    expect(response.trigger_reason).toContain("隐式引用");
    expect(response.injection_block).not.toBeNull();
    expect(response.memory_packet?.records.map((record) => record.id)).toEqual(["mem-preference", "mem-task"]);
    expect(response.injection_block?.memory_summary).toContain("偏好与任务状态");
  });

  it("respects llm recall planner refusal and skips injection", async () => {
    const { service } = createRuntime({
      llmRecallPlanner: new StubLlmRecallPlanner({
        should_search: false,
        reason: "当前问题是独立问题，不依赖历史记忆。",
      }, {
        should_inject: false,
        reason: "当前问题是独立问题，不依赖历史记忆。",
      }),
    });

    const response = await service.prepareContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      phase: "before_response",
      current_input: "帮我解释一下这个接口的作用。",
    });

    expect(response.trigger).toBe(false);
    expect(response.trigger_reason).toContain("独立问题");
    expect(response.injection_block).toBeNull();
    expect(response.memory_packet).toBeNull();
  });

  it("falls back to default injection when llm recall planner is unavailable", async () => {
    const { service } = createRuntime({
      llmRecallPlanner: new StubLlmRecallPlanner(
        {
          should_search: true,
          reason: "需要查记忆",
        },
        {
          should_inject: false,
          reason: "unused",
        },
        true,
      ),
    });

    const response = await service.prepareContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      phase: "before_response",
      current_input: "把之前确定的偏好和任务状态都恢复出来。",
    });

    expect(response.trigger).toBe(true);
    expect(response.injection_block).not.toBeNull();
    expect(response.memory_packet?.records.length).toBeGreaterThan(0);
  });

  it("degrades query when embeddings dependency fails", async () => {
    const { service } = createRuntime({
      embeddingsClient: new StubEmbeddingsClient([1, 0, 0], true),
    });

    const response = await service.prepareContext({
      host: "custom_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      phase: "task_start",
      current_input: "开始这个任务",
    });

    expect(response.trigger).toBe(true);
    expect(response.degraded).toBe(true);
    expect(response.dependency_status.embeddings.status).not.toBe("healthy");
  });

  it("actively checks embeddings health and records a healthy status", async () => {
    const { service } = createRuntime();

    const response = await service.checkEmbeddings();
    const dependencies = await service.getDependencies();

    expect(response).toMatchObject({
      name: "embeddings",
      status: "healthy",
      detail: "embedding request completed",
    });
    expect(dependencies.embeddings.status).toBe("healthy");
  });

  it("returns the concrete embedding failure reason during active health check", async () => {
    const { service } = createRuntime({
      embeddingsClient: new StubEmbeddingsClient([1, 0, 0], true),
    });

    const response = await service.checkEmbeddings();

    expect(response).toMatchObject({
      name: "embeddings",
      status: "unavailable",
      detail: "embeddings unavailable",
    });
  });

  it("actively checks writeback llm health and records a healthy status", async () => {
    const { service } = createRuntime({
      llmExtractor: {
        extract: async () => ({ candidates: [] }),
        refine: async () => ({ refined_candidates: [] }),
        healthCheck: async () => undefined,
      },
    });

    const response = await service.checkWritebackLlm();
    const dependencies = await service.getDependencies();

    expect(response).toMatchObject({
      name: "writeback_llm",
      status: "healthy",
      detail: "writeback llm request completed",
    });
    expect(dependencies.writeback_llm.status).toBe("healthy");
  });

  it("returns not configured style status when writeback llm is missing", async () => {
    const { service } = createRuntime();

    const response = await service.checkWritebackLlm();

    expect(response).toMatchObject({
      name: "writeback_llm",
      status: "unavailable",
      detail: "writeback llm is not configured",
    });
  });

  it("returns the concrete writeback llm failure reason during active health check", async () => {
    const { service } = createRuntime({
      llmExtractor: {
        extract: async () => ({ candidates: [] }),
        refine: async () => ({ refined_candidates: [] }),
        healthCheck: async () => {
          throw new Error("writeback llm request failed with 401");
        },
      },
    });

    const response = await service.checkWritebackLlm();

    expect(response).toMatchObject({
      name: "writeback_llm",
      status: "unavailable",
      detail: "writeback llm request failed with 401",
    });
  });

  it("trims injection records when budget is exceeded", async () => {
    const { service } = createRuntime({
      config: {
        INJECTION_TOKEN_BUDGET: 220,
        INJECTION_RECORD_LIMIT: 2,
      },
    });

    const response = await service.prepareContext({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      phase: "task_start",
      current_input: "任务继续",
    });

    expect(response.injection_block).not.toBeNull();
    expect(response.injection_block?.trimmed_record_ids.length).toBeGreaterThan(0);
    expect(response.injection_block?.memory_records.length).toBeLessThanOrEqual(baseConfig.INJECTION_RECORD_LIMIT);
    expect(response.injection_block?.selected_scopes.length).toBeGreaterThan(0);
  });

  it("filters low-value writeback content and submits structured candidates", async () => {
    const { service } = createRuntime();

    const response = await service.finalizeTurn({
      host: "codex_app_server",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-2",
      current_input: "我偏好: 默认中文输出",
      assistant_output: "已确认: 后续都用中文。下一步: 完成接口测试。我会在每次发布前补齐写回链路并验证结果。",
      tool_results_summary: "tool summary: storage connection failed once and then recovered",
    });

    expect(response.candidate_count).toBeGreaterThan(0);
    expect(response.writeback_submitted).toBe(true);
    expect(response.submitted_jobs.every((job) => job.status === "accepted_async")).toBe(true);
    expect(
      response.write_back_candidates.every((candidate) =>
        ["fact_preference", "task_state", "episodic"].includes(candidate.candidate_type),
      ),
    ).toBe(true);
    expect(response.write_back_candidates.every((candidate) => candidate.source.service_name === "retrieval-runtime")).toBe(true);
    expect(
      response.write_back_candidates.filter((candidate) => candidate.candidate_type === "fact_preference").map((candidate) => candidate.scope),
    ).toEqual(["user"]);
    expect(response.memory_mode).toBe("workspace_plus_global");
  });

  it("extracts long-term preference memory from remember-style user input", async () => {
    const { service } = createRuntime();

    const response = await service.finalizeTurn({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      turn_id: "turn-remember-pref",
      current_input: "请记住：以后默认用中文回答，除非我明确要求英文。这是长期偏好。",
      assistant_output: "已记住：以后默认使用中文回答，除非你明确要求英文。这会作为你的长期偏好来遵循。",
    });

    expect(response.candidate_count).toBeGreaterThan(0);
    expect(
      response.write_back_candidates.some(
        (candidate) =>
          candidate.candidate_type === "fact_preference"
          && candidate.scope === "user"
          && candidate.summary.includes("以后默认用中文回答"),
      ),
    ).toBe(true);
    expect(response.filtered_reasons).not.toContain("no_stable_preference_detected");
  });

  it("extracts long-term preference memory from default-preference phrasing without remember keywords", async () => {
    const { service } = createRuntime();

    const response = await service.finalizeTurn({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      turn_id: "turn-default-pref",
      current_input: "以后默认用中文回答，除非我明确要求英文。这是长期偏好。",
      assistant_output: "好的，已记住：以后默认使用中文回答，除非你明确要求英文。",
    });

    expect(response.candidate_count).toBeGreaterThan(0);
    expect(
      response.write_back_candidates.some(
        (candidate) =>
          candidate.candidate_type === "fact_preference"
          && candidate.scope === "user"
          && candidate.summary.includes("默认用中文回答"),
      ),
    ).toBe(true);
    expect(response.filtered_reasons).not.toContain("no_stable_preference_detected");
  });

  it("uses configured llm extraction before falling back to rules", async () => {
    const { service } = createRuntime({
      llmExtractor: new StubLlmExtractor({
        candidates: [
          {
            candidate_type: "fact_preference",
            scope: "user",
            summary: "默认用中文输出",
            importance: 5,
            confidence: 0.92,
            write_reason: "user preference confirmed in this turn",
          },
        ],
      }),
    });

    const response = await service.finalizeTurn({
      host: "codex_app_server",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      current_input: "后续都用中文输出",
      assistant_output: "收到，我会统一改成中文输出。",
    });

    expect(response.write_back_candidates).toHaveLength(1);
    expect(response.write_back_candidates[0]?.source.source_type).toBe("writeback_llm");
    expect(response.write_back_candidates[0]?.summary).toBe("默认用中文输出");
    expect(response.write_back_candidates[0]?.scope).toBe("user");
  });

  it("falls back to rules when llm extraction fails", async () => {
    const { service } = createRuntime({
      llmExtractor: new StubLlmExtractor({ candidates: [] }, true),
    });

    const response = await service.finalizeTurn({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      current_input: "我偏好: 默认中文输出",
      assistant_output: "已确认: 后续都用中文。下一步: 继续补测试。",
    });

    expect(response.write_back_candidates.length).toBeGreaterThan(0);
    expect(response.write_back_candidates.some((candidate) => candidate.source.source_type !== "writeback_llm")).toBe(true);
  });

  it("deduplicates assistant confirmation when the same preference was already extracted from user input", async () => {
    const { service } = createRuntime();

    const response = await service.finalizeTurn({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      current_input: "我偏好: 默认中文输出",
      assistant_output: "已确认: 后续都用中文。",
    });

    const factPreferences = response.write_back_candidates.filter((candidate) => candidate.candidate_type === "fact_preference");
    expect(factPreferences).toHaveLength(1);
    expect(factPreferences[0]?.scope).toBe("user");
  });

  it("applies writeback max candidates to llm extraction output", async () => {
    const { service } = createRuntime({
      config: { WRITEBACK_MAX_CANDIDATES: 2 },
      llmExtractor: new StubLlmExtractor({
        candidates: [
          {
            candidate_type: "fact_preference",
            scope: "user",
            summary: "默认使用中文输出",
            importance: 5,
            confidence: 0.95,
            write_reason: "reason one",
          },
          {
            candidate_type: "task_state",
            scope: "task",
            summary: "继续补齐运行时分页接口",
            importance: 4,
            confidence: 0.86,
            write_reason: "reason two",
          },
          {
            candidate_type: "episodic",
            scope: "session",
            summary: "上一轮已经确认桥接脚本可用",
            importance: 4,
            confidence: 0.81,
            write_reason: "reason three",
          },
        ],
      }),
    });

    const response = await service.finalizeTurn({
      host: "codex_app_server",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      current_input: "默认使用中文输出。继续补齐运行时分页接口。上一轮已经确认桥接脚本可用。",
      assistant_output: "收到，继续补齐运行时分页接口，默认使用中文输出，上一轮已经确认桥接脚本可用。",
    });

    expect(response.write_back_candidates).toHaveLength(2);
    expect(response.filtered_reasons).toContain("candidate_limit_exceeded");
  });

  it("returns degraded writeback result when storage dependency is unavailable", async () => {
    const { service, repository } = createRuntime({
      storageClient: new StubStorageClient([], true),
    });

    const response = await service.finalizeTurn({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      current_input: "我偏好: 默认中文输出",
      assistant_output: "已确认: 后续都用中文。",
    });

    expect(response.degraded).toBe(true);
    expect(response.submitted_jobs[0]?.status).toBe("dependency_unavailable");
    expect((await repository.getMetrics()).outbox_pending_count).toBeGreaterThan(0);
  });

  it("does not read global user memory in workspace_only mode", async () => {
    const { service } = createRuntime();

    const response = await service.prepareContext({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      phase: "before_response",
      current_input: "上次那个仓库约束继续沿用。",
      memory_mode: "workspace_only",
    });

    expect(response.injection_block).not.toBeNull();
    expect(response.memory_packet?.requested_scopes).not.toContain("user");
    expect(response.injection_block?.requested_scopes).not.toContain("user");
    expect(response.injection_block?.memory_records.some((record) => record.scope === "user")).toBe(false);
    expect(response.injection_block?.memory_records.some((record) => record.scope === "workspace")).toBe(true);
  });

  it("reads workspace and global user memory in workspace_plus_global mode", async () => {
    const { service } = createRuntime();

    const response = await service.prepareContext({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      phase: "before_response",
      current_input: "上次那个约定继续。",
      memory_mode: "workspace_plus_global",
    });

    expect(response.memory_packet?.requested_scopes).toContain("workspace");
    expect(response.memory_packet?.requested_scopes).toContain("user");
    expect(response.memory_packet?.selected_scopes).toContain("workspace");
    expect(response.memory_packet?.selected_scopes).toContain("user");
  });

  it("keeps injection payload within current token and record budgets", async () => {
    const { service } = createRuntime({
      config: {
        INJECTION_RECORD_LIMIT: 7,
        INJECTION_TOKEN_BUDGET: 512,
      },
    });

    const response = await service.prepareContext({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      phase: "before_response",
      current_input: "把之前确定的偏好和任务状态都恢复出来。",
      memory_mode: "workspace_plus_global",
    });

    expect(response.injection_block?.token_estimate ?? 0).toBeLessThanOrEqual(512);
    expect(response.injection_block?.memory_records.length ?? 0).toBeLessThanOrEqual(7);
  });

  it("keeps user scope visible across workspaces while isolating workspace scope", async () => {
    const anotherWorkspace = "550e8400-e29b-41d4-a716-446655440099";
    const { service } = createRuntime({
      records: [
        ...sampleRecords,
        {
          id: "mem-other-workspace",
          workspace_id: anotherWorkspace,
          user_id: ids.user,
          session_id: null,
          task_id: null,
          memory_type: "fact_preference",
          scope: "workspace",
          summary: "另一个工作区约束：不要带进当前仓库。",
          details: null,
          source: null,
          importance: 5,
          confidence: 0.9,
          status: "active",
          updated_at: "2026-04-15T08:00:00.000Z",
          last_confirmed_at: null,
          summary_embedding: [1, 0, 0],
        },
        {
          id: "mem-global-origin-other-workspace",
          workspace_id: anotherWorkspace,
          user_id: ids.user,
          session_id: null,
          task_id: null,
          memory_type: "fact_preference",
          scope: "user",
          summary: "全局偏好：始终用中文回答。",
          details: null,
          source: null,
          importance: 5,
          confidence: 0.95,
          status: "active",
          updated_at: "2026-04-15T07:00:00.000Z",
          last_confirmed_at: null,
          summary_embedding: [1, 0, 0],
        },
      ],
    });

    const response = await service.prepareContext({
      host: "codex_app_server",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      phase: "session_start",
      current_input: "恢复上下文",
      memory_mode: "workspace_plus_global",
    });

    expect(response.memory_packet?.records.some((record) => record.id === "mem-other-workspace")).toBe(false);
    expect(response.memory_packet?.records.some((record) => record.id === "mem-global-origin-other-workspace")).toBe(true);
  });

  it("records mode and scope explanations in runtime observability", async () => {
    const { service, repository } = createRuntime();

    const prepared = await service.prepareContext({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      phase: "before_response",
      current_input: "上次那个仓库约束继续沿用。",
      memory_mode: "workspace_only",
    });

    const runs = await repository.getRuns({ trace_id: prepared.trace_id });
    expect(runs.trigger_runs[0]?.memory_mode).toBe("workspace_only");
    expect(runs.trigger_runs[0]?.requested_scopes).toContain("workspace");
    expect(runs.recall_runs[0]?.matched_scopes).toContain("workspace");
    expect(runs.injection_runs[0]?.selected_scopes).toContain("workspace");
  });

  it("uses only formal scope enum values in requested and selected scopes", async () => {
    const allowedScopes = new Set(["session", "task", "workspace", "user"]);
    const { service } = createRuntime();

    const workspaceOnly = await service.prepareContext({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      phase: "before_response",
      current_input: "恢复当前仓库约束。",
      memory_mode: "workspace_only",
    });

    const workspacePlusGlobal = await service.prepareContext({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      phase: "before_response",
      current_input: "恢复当前仓库约束和全局偏好。",
      memory_mode: "workspace_plus_global",
    });

    for (const scope of workspaceOnly.injection_block?.requested_scopes ?? []) {
      expect(allowedScopes.has(scope)).toBe(true);
    }
    for (const scope of workspaceOnly.injection_block?.selected_scopes ?? []) {
      expect(allowedScopes.has(scope)).toBe(true);
    }
    for (const scope of workspacePlusGlobal.injection_block?.requested_scopes ?? []) {
      expect(allowedScopes.has(scope)).toBe(true);
    }
    for (const scope of workspacePlusGlobal.injection_block?.selected_scopes ?? []) {
      expect(allowedScopes.has(scope)).toBe(true);
    }
  });

  it("emits writeback candidates with only formal scope enum values", async () => {
    const allowedScopes = new Set(["session", "task", "workspace", "user"]);
    const { service } = createRuntime();

    const response = await service.finalizeTurn({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      current_input: "我偏好: 默认中文输出",
      assistant_output: "已确认: 后续都用中文。下一步: 继续补测试。",
      memory_mode: "workspace_plus_global",
    });

    expect(response.write_back_candidates.length).toBeGreaterThan(0);
    for (const candidate of response.write_back_candidates) {
      expect(allowedScopes.has(candidate.scope)).toBe(true);
    }
  });

  it("reuses the same trace for prepare and finalize phases and keeps phase records split", async () => {
    const { service, repository } = createRuntime();

    const preparedTaskStart = await service.prepareContext({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-shared-trace",
      phase: "task_start",
      current_input: "开始当前任务。",
      memory_mode: "workspace_plus_global",
    });

    const prepared = await service.prepareContext({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-shared-trace",
      phase: "before_response",
      current_input: "上次那个仓库约束继续沿用。",
      memory_mode: "workspace_plus_global",
    });

    expect(preparedTaskStart.trace_id).toBe(prepared.trace_id);

    const finalized = await service.finalizeTurn({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-shared-trace",
      current_input: "我偏好: 默认中文输出",
      assistant_output: "已确认: 后续都用中文。下一步: 继续补测试。",
      memory_mode: "workspace_plus_global",
    });

    expect(finalized.trace_id).toBe(prepared.trace_id);

    const runs = await repository.getRuns({ trace_id: prepared.trace_id });
    expect(runs.turns).toHaveLength(3);
    expect(runs.turns.map((run) => run.phase)).toEqual(["after_response", "before_response", "task_start"]);
    expect(runs.trigger_runs).toHaveLength(2);
    expect(runs.recall_runs).toHaveLength(2);
    expect(runs.injection_runs).toHaveLength(2);
    expect(runs.writeback_submissions).toHaveLength(1);
    expect(runs.writeback_submissions[0]?.phase).toBe("after_response");
  });

  it("does not mark writeback as submitted when storage dependency is unavailable", async () => {
    const { service, repository } = createRuntime({
      storageClient: new StubStorageClient([], true),
    });

    const response = await service.finalizeTurn({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      current_input: "我偏好: 默认中文输出",
      assistant_output: "已确认: 后续都用中文。",
    });

    expect(response.degraded).toBe(true);
    expect(response.writeback_submitted).toBe(false);
    expect((await repository.getMetrics()).outbox_pending_count).toBeGreaterThan(0);
  });

  it("marks outbox entries as submitted after fast-path writeback succeeds", async () => {
    const { service, repository } = createRuntime();

    const response = await service.finalizeTurn({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      current_input: "我偏好: 默认中文输出",
      assistant_output: "已确认: 后续都用中文。",
    });

    expect(response.writeback_submitted).toBe(true);
    const metrics = await repository.getMetrics();
    expect(metrics.outbox_pending_count).toBe(0);
    expect(metrics.outbox_submit_latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("reuses finalize response from short-lived idempotency cache", async () => {
    const storageClient = new StubStorageClient();
    const { service } = createRuntime({
      storageClient,
    });

    const request = {
      host: "claude_code_plugin" as const,
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      turn_id: "turn-idempotent",
      current_input: "我偏好: 默认中文输出",
      assistant_output: "已确认: 后续都用中文。",
    };

    const first = await service.finalizeTurn(request);
    const second = await service.finalizeTurn(request);

    expect(first).toEqual(second);
    expect(storageClient.callCount).toBe(1);
  });

  it("reuses persisted finalize response across service instances before calling llm extraction again", async () => {
    const llmExtractor = new SpyLlmExtractor({
      candidates: [
        {
          candidate_type: "fact_preference",
          scope: "user",
          summary: "默认用中文输出",
          importance: 5,
          confidence: 0.94,
          write_reason: "stable preference confirmed",
        },
      ],
    });
    const repository = new InMemoryRuntimeRepository();
    const logger = pino({ enabled: false });
    const dependencyGuard = new DependencyGuard(repository, logger);
    const readModelRepository = new InMemoryReadModelRepository(sampleRecords);
    const storageClient = new StubStorageClient();
    const config = { ...baseConfig };
    const embeddingsClient = new StubEmbeddingsClient();
    const memoryOrchestrator = createMemoryOrchestrator({
      config,
      writebackPlanner: llmExtractor,
    });

    const firstService = new RetrievalRuntimeService(
      new TriggerEngine(
        config,
        embeddingsClient,
        readModelRepository,
        dependencyGuard,
        logger,
        memoryOrchestrator?.recall?.search,
      ),
      new QueryEngine(config, readModelRepository, embeddingsClient, dependencyGuard, logger),
      embeddingsClient,
      new InjectionEngine(config),
      new WritebackEngine(config, storageClient, dependencyGuard, memoryOrchestrator?.writeback),
      repository,
      dependencyGuard,
      logger,
      new FinalizeIdempotencyCache(config),
      config.EMBEDDING_TIMEOUT_MS,
      memoryOrchestrator,
    );

    const request = {
      host: "codex_app_server" as const,
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      turn_id: "turn-persisted-idempotent",
      current_input: "后续默认中文输出",
      assistant_output: "收到，我会统一改成中文输出。",
    };

    const first = await firstService.finalizeTurn(request);
    expect(llmExtractor.refineCallCount).toBe(1);

    const secondService = new RetrievalRuntimeService(
      new TriggerEngine(
        config,
        embeddingsClient,
        readModelRepository,
        dependencyGuard,
        logger,
        memoryOrchestrator?.recall?.search,
      ),
      new QueryEngine(config, readModelRepository, embeddingsClient, dependencyGuard, logger),
      embeddingsClient,
      new InjectionEngine(config),
      new WritebackEngine(config, storageClient, dependencyGuard, memoryOrchestrator?.writeback),
      repository,
      dependencyGuard,
      logger,
      new FinalizeIdempotencyCache(config),
      config.EMBEDDING_TIMEOUT_MS,
      memoryOrchestrator,
    );

    const second = await secondService.finalizeTurn(request);

    expect(second).toEqual(first);
    expect(llmExtractor.refineCallCount).toBe(1);
  });

  it("keeps upstream scope suggestions for llm candidates and leaves final arbitration to storage", async () => {
    const { service } = createRuntime({
      llmExtractor: new StubLlmExtractor({
        candidates: [
          {
            candidate_type: "fact_preference",
            scope: "workspace",
            summary: "默认使用中文输出",
            importance: 5,
            confidence: 0.95,
            write_reason: "stable user preference",
          },
          {
            candidate_type: "fact_preference",
            scope: "workspace",
            summary: "仓库规则：提交前必须跑接口测试",
            importance: 5,
            confidence: 0.92,
            write_reason: "repository constraint",
          },
        ],
      }),
    });

    const response = await service.finalizeTurn({
      host: "custom_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      current_input: "默认使用中文输出，仓库规则是提交前必须跑接口测试",
      assistant_output: "好的，我会按这个约定继续处理。",
    });

    const llmCandidates = response.write_back_candidates.filter(
      (candidate) => candidate.source.extraction_method === "llm",
    );
    expect(llmCandidates.map((candidate) => candidate.scope)).toEqual(["workspace", "workspace"]);
  });

  it("serves public HTTP endpoints with stable response shapes", async () => {
    const { service } = createRuntime();
    const app = createApp(service);

    const prepareResponse = await app.inject({
      method: "POST",
      url: "/v1/runtime/prepare-context",
      payload: {
        host: "claude_code_plugin",
        workspace_id: ids.workspace,
        user_id: ids.user,
        session_id: ids.session,
        task_id: ids.task,
        turn_id: "http-turn-1",
        phase: "before_response",
        current_input: "上次定过的接口结构这轮继续沿用。",
      },
    });

    const finalizeResponse = await app.inject({
      method: "POST",
      url: "/v1/runtime/finalize-turn",
      payload: {
        host: "codex_app_server",
        workspace_id: ids.workspace,
        user_id: ids.user,
        session_id: ids.session,
        turn_id: "http-turn-2",
        current_input: "我偏好: 默认中文输出",
        assistant_output: "已确认: 后续都用中文。",
      },
    });

    const livenessResponse = await app.inject({
      method: "GET",
      url: "/v1/runtime/health/liveness",
    });
    const readinessResponse = await app.inject({
      method: "GET",
      url: "/v1/runtime/health/readiness",
    });
    const dependenciesResponse = await app.inject({
      method: "GET",
      url: "/v1/runtime/health/dependencies",
    });
    const embeddingCheckResponse = await app.inject({
      method: "POST",
      url: "/v1/runtime/dependency-status/embeddings/check",
    });
    const writebackLlmCheckResponse = await app.inject({
      method: "POST",
      url: "/v1/runtime/dependency-status/writeback-llm/check",
    });

    expect(prepareResponse.statusCode).toBe(200);
    expect(finalizeResponse.statusCode).toBe(200);
    expect(embeddingCheckResponse.statusCode).toBe(200);
    expect(writebackLlmCheckResponse.statusCode).toBe(200);
    expect(livenessResponse.json()).toEqual({ status: "alive" });
    expect(readinessResponse.json()).toEqual({ status: "ready" });
    expect(dependenciesResponse.json()).toHaveProperty("read_model");
    expect(embeddingCheckResponse.json()).toMatchObject({
      name: "embeddings",
      status: "healthy",
    });
    expect(writebackLlmCheckResponse.json()).toMatchObject({
      name: "writeback_llm",
      status: "unavailable",
    });
    expect(prepareResponse.json().injection_block.memory_summary).toBeTruthy();
    expect(finalizeResponse.json().write_back_candidates.length).toBeGreaterThan(0);
  });

  it("returns structured injection data from session start context", async () => {
    const { service } = createRuntime();

    const response = await service.sessionStartContext({
      host: "codex_app_server",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      phase: "session_start",
      current_input: "恢复当前会话",
      turn_id: "session-start-turn",
      memory_mode: "workspace_plus_global",
    });

    expect(response.injection_block).not.toBeNull();
    expect(response.additional_context).toContain("恢复");
    expect(response.injection_block?.memory_summary).toContain("偏好与约束");
  });

  it("reuses the latest session trace for session_start when the session already has runtime history", async () => {
    const { service } = createRuntime();

    const prepared = await service.prepareContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      turn_id: "turn-session-trace",
      phase: "before_response",
      current_input: "继续沿用之前的约束。",
    });

    const restarted = await service.sessionStartContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      phase: "session_start",
      current_input: "恢复当前会话",
    });

    expect(restarted.trace_id).toBe(prepared.trace_id);
  });

  it("returns validation errors for missing host identity boundaries instead of accepting fake namespaces", async () => {
    const { service } = createRuntime();
    const app = createApp(service);

    const response = await app.inject({
      method: "POST",
      url: "/v1/runtime/prepare-context",
      payload: {
        host: "claude_code_plugin",
        session_id: ids.session,
        phase: "before_response",
        current_input: "上次那个约定继续沿用。",
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("accepts memory_native_agent across prepare and finalize runtime endpoints", async () => {
    const { service } = createRuntime();
    const app = createApp(service);

    const prepareResponse = await app.inject({
      method: "POST",
      url: "/v1/runtime/prepare-context",
      payload: {
        host: "memory_native_agent",
        workspace_id: ids.workspace,
        user_id: ids.user,
        session_id: ids.session,
        task_id: ids.task,
        turn_id: "mna-turn-1",
        phase: "before_response",
        current_input: "延续上次已经确认的约束。",
      },
    });

    const finalizeResponse = await app.inject({
      method: "POST",
      url: "/v1/runtime/finalize-turn",
      payload: {
        host: "memory_native_agent",
        workspace_id: ids.workspace,
        user_id: ids.user,
        session_id: ids.session,
        task_id: ids.task,
        turn_id: "mna-turn-1",
        current_input: "我偏好默认中文输出",
        assistant_output: "收到，后续都会保持中文输出。",
      },
    });

    const sessionStartResponse = await app.inject({
      method: "POST",
      url: "/v1/runtime/session-start-context",
      payload: {
        host: "memory_native_agent",
        workspace_id: ids.workspace,
        user_id: ids.user,
        session_id: ids.session,
        recent_context_summary: "恢复当前工作区的上下文。",
      },
    });

    expect(prepareResponse.statusCode).toBe(200);
    expect(prepareResponse.json().trigger).toBe(true);
    expect(finalizeResponse.statusCode).toBe(200);
    expect(finalizeResponse.json().candidate_count).toBeGreaterThanOrEqual(0);
    expect(sessionStartResponse.statusCode).toBe(200);
    expect(sessionStartResponse.json().memory_mode).toBe("workspace_plus_global");

    const healthResponse = await app.inject({
      method: "GET",
      url: "/healthz",
    });
    expect(healthResponse.statusCode).toBe(200);
    expect(healthResponse.json()).toMatchObject({
      version: "0.1.0",
      api_version: "v1",
      liveness: "alive",
      readiness: "ready",
    });
  });
});
