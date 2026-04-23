import pino from "pino";
import { describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config.js";
import { createApp } from "../src/app.js";
import { DependencyGuard } from "../src/dependency/dependency-guard.js";
import { ConflictAppError } from "../src/errors.js";
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
  MemoryRelationSnapshot,
  MemoryRecordSnapshot,
  SubmittedWriteBackJob,
  WriteProjectionStatusSnapshot,
  WriteBackCandidate,
} from "../src/shared/types.js";
import type {
  IntentAnalyzer,
  QualityAssessor,
  RecallEffectivenessEvaluator,
  RecallInjectionInput,
  RecallInjectionPlanner,
  RecallSearchInput,
  RecallSearchPlanner,
  WritebackPlanner,
} from "../src/memory-orchestrator/types.js";
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
import { WritebackMaintenanceWorker } from "../src/writeback/maintenance-worker.js";
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
  MEMORY_LLM_MODEL: "claude-haiku-4-5-20251001",
  MEMORY_LLM_PROTOCOL: "openai-compatible",
  MEMORY_LLM_TIMEOUT_MS: 15000,
  MEMORY_LLM_FALLBACK_ENABLED: true,
  MEMORY_LLM_DEGRADED_THRESHOLD: 0.5,
  MEMORY_LLM_RECOVERY_INTERVAL_MS: 5 * 60 * 1000,
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
  INJECTION_DEDUP_ENABLED: true,
  INJECTION_HARD_WINDOW_TURNS_FACT_PREFERENCE: 5,
  INJECTION_HARD_WINDOW_TURNS_TASK_STATE: 3,
  INJECTION_HARD_WINDOW_TURNS_EPISODIC: 2,
  INJECTION_HARD_WINDOW_MS_FACT_PREFERENCE: 30 * 60 * 1000,
  INJECTION_HARD_WINDOW_MS_TASK_STATE: 10 * 60 * 1000,
  INJECTION_HARD_WINDOW_MS_EPISODIC: 5 * 60 * 1000,
  INJECTION_SOFT_WINDOW_MS_TASK_STATE: 30 * 60 * 1000,
  INJECTION_SOFT_WINDOW_MS_EPISODIC: 15 * 60 * 1000,
  INJECTION_RECENT_STATE_TTL_MS: 60 * 60 * 1000,
  INJECTION_RECENT_STATE_MAX_SESSIONS: 500,
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

class BlockingReadModelRepository extends InMemoryReadModelRepository {
  public maxConcurrent = 0;
  public active = 0;
  public readonly starts: string[] = [];
  private readonly releaseQueue: Array<() => void> = [];

  constructor(records: CandidateMemory[]) {
    super(records);
  }

  override async searchCandidates(query: Parameters<InMemoryReadModelRepository["searchCandidates"]>[0], signal?: AbortSignal) {
    this.active += 1;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.active);
    this.starts.push(`${query.session_id}:${query.semantic_query_text}`);
    await new Promise<void>((resolve, reject) => {
      const release = () => resolve();
      this.releaseQueue.push(release);
      if (signal) {
        signal.addEventListener(
          "abort",
          () => reject(signal.reason instanceof Error ? signal.reason : new Error("aborted")),
          { once: true },
        );
      }
    });
    try {
      return await super.searchCandidates(query, signal);
    } finally {
      this.active -= 1;
    }
  }

  releaseNext() {
    const release = this.releaseQueue.shift();
    release?.();
  }
}

class MutableReadModelRepository extends InMemoryReadModelRepository {
  constructor(private items: CandidateMemory[]) {
    super(items);
  }

  setRecords(items: CandidateMemory[]) {
    this.items = items;
  }

  override async searchCandidates(query: Parameters<InMemoryReadModelRepository["searchCandidates"]>[0], signal?: AbortSignal) {
    return new InMemoryReadModelRepository(this.items).searchCandidates(query, signal);
  }
}

async function waitForCondition(check: () => boolean, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (!check()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

class StubStorageClient implements StorageWritebackClient {
  public callCount = 0;
  public projectionStatuses: WriteProjectionStatusSnapshot[] = [];

  constructor(
    private readonly jobs: SubmittedWriteBackJob[] = [],
    private readonly shouldFail = false,
    private readonly recordItems: MemoryRecordSnapshot[] = [],
    private readonly relationItems: MemoryRelationSnapshot[] = [],
  ) {}

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

  async getWriteProjectionStatuses(jobIds: string[]): Promise<WriteProjectionStatusSnapshot[]> {
    const idSet = new Set(jobIds);
    return this.projectionStatuses.filter((item) => idSet.has(item.job_id));
  }

  async listRecords(): Promise<RecordListPage> {
    return { items: this.recordItems, total: this.recordItems.length, page: 1, page_size: 20 };
  }

  async getRecordsByIds(recordIds: string[]): Promise<MemoryRecordSnapshot[]> {
    const idSet = new Set(recordIds);
    return this.recordItems.filter((item) => idSet.has(item.id));
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

  async upsertRelations(
    relations: Parameters<StorageWritebackClient["upsertRelations"]>[0],
  ): Promise<MemoryRelationSnapshot[]> {
    return relations.map((relation, index) => ({
      id: `rel-${index}`,
      ...relation,
      created_at: "2026-04-22T00:00:00.000Z",
      updated_at: "2026-04-22T00:00:00.000Z",
    }));
  }

  async listRelations(): Promise<MemoryRelationSnapshot[]> {
    return this.relationItems;
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

class StubQualityAssessor implements QualityAssessor {
  constructor(
    private readonly assessments: Array<{
      candidate_id?: string;
      quality_score: number;
      confidence: number;
      potential_conflicts: string[];
      suggested_importance: number;
      suggested_status: "active" | "pending_confirmation";
      issues: Array<{
        type: "duplicate" | "low_quality" | "conflict" | "vague";
        severity: "high" | "medium" | "low";
        description: string;
      }>;
      reason: string;
    }>,
    private readonly shouldFail = false,
  ) {}

  async assess(input: { writeback_candidates: Array<{ idempotency_key: string }> }) {
    if (this.shouldFail) {
      throw new Error("quality assessor unavailable");
    }
    return {
      assessments: this.assessments.map((assessment, index) => ({
        ...assessment,
        candidate_id: assessment.candidate_id ?? input.writeback_candidates[index]?.idempotency_key ?? `dynamic-${index}`,
      })),
    };
  }
}

class StubRecallEffectivenessEvaluator implements RecallEffectivenessEvaluator {
  public callCount = 0;

  constructor(
    private readonly suggestedAdjustment = 1,
  ) {}

  async evaluate(input: {
    injected_memories: Array<{ record_id: string }>;
  }) {
    this.callCount += 1;
    return {
      evaluations: input.injected_memories.map((memory) => ({
        record_id: memory.record_id,
        was_used: true,
        usage_confidence: 0.9,
        effectiveness_score: 0.92,
        suggested_importance_adjustment: this.suggestedAdjustment,
        usage_evidence: "已沿用之前的偏好",
        reason: "记忆被明确使用",
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

class StubRecallSearchPlanner implements RecallSearchPlanner {
  constructor(private readonly planner: LlmRecallPlanner) {}

  async plan(input: RecallSearchInput) {
    return this.planner.planSearch(input);
  }

  async healthCheck(): Promise<void> {
    await this.planner.healthCheck?.();
  }
}

class StubRecallInjectionPlanner implements RecallInjectionPlanner {
  constructor(private readonly planner: LlmRecallPlanner) {}

  async plan(input: RecallInjectionInput) {
    return this.planner.planInjection(input);
  }

  async healthCheck(): Promise<void> {
    await this.planner.healthCheck?.();
  }
}

class StubIntentAnalyzer implements IntentAnalyzer {
  constructor(
    private readonly output: {
      needs_memory: boolean;
      memory_types: Array<"fact_preference" | "task_state" | "episodic">;
      urgency: "immediate" | "deferred" | "optional";
      confidence: number;
      reason: string;
      suggested_scopes?: Array<"workspace" | "user" | "task" | "session">;
    },
  ) {}

  async analyze() {
    return this.output;
  }
}

function createRuntime(overrides?: {
  records?: CandidateMemory[];
  embeddingsClient?: EmbeddingsClient;
  storageClient?: StorageWritebackClient;
  llmExtractor?: LlmExtractor;
  qualityAssessor?: QualityAssessor;
  recallEffectivenessEvaluator?: RecallEffectivenessEvaluator;
  llmRecallPlanner?: LlmRecallPlanner;
  intentAnalyzer?: IntentAnalyzer;
  readModelRepository?: InMemoryReadModelRepository;
  config?: Partial<AppConfig>;
}) {
  const repository = new InMemoryRuntimeRepository();
  const logger = pino({ enabled: false });
  const dependencyGuard = new DependencyGuard(repository, logger);
  const readModelRepository =
    overrides?.readModelRepository ?? new InMemoryReadModelRepository(overrides?.records ?? sampleRecords);
  const embeddingsClient = overrides?.embeddingsClient ?? new StubEmbeddingsClient();
  const storageClient = overrides?.storageClient ?? new StubStorageClient();
  const config = { ...baseConfig, ...overrides?.config };
  const finalizeIdempotencyCache = new FinalizeIdempotencyCache(config);
  const recallPlanner =
    overrides?.llmRecallPlanner
      ? {
          search: new StubRecallSearchPlanner(overrides.llmRecallPlanner),
          injection: new StubRecallInjectionPlanner(overrides.llmRecallPlanner),
        }
      : undefined;
  const memoryOrchestrator = createMemoryOrchestrator({
    config,
    intentAnalyzer: overrides?.intentAnalyzer,
    recallPlanner,
    recallEffectivenessEvaluator: overrides?.recallEffectivenessEvaluator,
    writebackPlanner: overrides?.llmExtractor as WritebackPlanner | undefined,
    qualityAssessor: overrides?.qualityAssessor,
  });

  const service = new RetrievalRuntimeService(
    config,
    new TriggerEngine(
      config,
      embeddingsClient,
      readModelRepository,
      dependencyGuard,
      logger,
      memoryOrchestrator?.recall?.search,
      memoryOrchestrator?.intent,
    ),
    new QueryEngine(config, readModelRepository, embeddingsClient, dependencyGuard, logger),
    embeddingsClient,
    new InjectionEngine(config),
    new WritebackEngine(
      config,
      storageClient,
      dependencyGuard,
      memoryOrchestrator?.writeback,
      memoryOrchestrator?.quality,
    ),
    repository,
    dependencyGuard,
    logger,
    finalizeIdempotencyCache,
    config.EMBEDDING_TIMEOUT_MS,
    memoryOrchestrator,
    undefined,
    storageClient,
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

  it("keeps ranked candidates available when recall candidate limit is absent in ad-hoc config", async () => {
    const { service } = createRuntime({
      records: [
        {
          id: "mem-typescript-pref",
          workspace_id: ids.workspace,
          user_id: ids.user,
          session_id: null,
          task_id: null,
          memory_type: "fact_preference",
          scope: "user",
          summary: "用户偏好：使用 TypeScript。",
          details: null,
          source: { turn_id: "seed-typescript" },
          importance: 5,
          confidence: 0.95,
          status: "active",
          updated_at: "2026-04-20T10:00:00.000Z",
          last_confirmed_at: "2026-04-20T10:00:00.000Z",
          summary_embedding: [1, 0, 0],
        },
      ],
      config: {
        RECALL_LLM_CANDIDATE_LIMIT: undefined as unknown as number,
      },
    });

    const response = await service.sessionStartContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      phase: "session_start",
      current_input: "session start",
      memory_mode: "workspace_plus_global",
    });

    expect(response.injection_block?.memory_records.map((record) => record.id)).toContain("mem-typescript-pref");
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

  it("records memory intent plan when intent analyzer is configured", async () => {
    const { service, repository } = createRuntime({
      intentAnalyzer: new StubIntentAnalyzer({
        needs_memory: true,
        memory_types: ["fact_preference", "task_state"],
        urgency: "immediate",
        confidence: 0.92,
        reason: "用户在继续之前的任务，需要恢复偏好和任务状态。",
        suggested_scopes: ["user", "task"],
      }),
      llmRecallPlanner: new StubLlmRecallPlanner({
        should_search: true,
        reason: "继续任务前先恢复记忆。",
        requested_scopes: ["user", "task"],
        requested_memory_types: ["fact_preference", "task_state"],
        importance_threshold: 3,
        query_hint: "继续之前的任务与偏好",
        candidate_limit: 6,
      }, {
        should_inject: true,
        reason: "需要注入偏好与当前任务状态。",
        selected_record_ids: ["mem-preference", "mem-task"],
        memory_summary: "延续用户偏好，并恢复当前任务状态。",
      }),
    });

    await service.prepareContext({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-intent-plan",
      phase: "before_response",
      current_input: "继续上次那个任务，沿用之前的偏好。",
    });

    const runs = await repository.getRuns();
    const intentPlan = runs.memory_plan_runs.find((run) => run.plan_kind === "memory_intent_plan");
    expect(intentPlan).toBeTruthy();
    expect(intentPlan?.result_state).toBe("planned");
    expect(intentPlan?.output_summary).toContain("needs_memory=true");
  });

  it("returns proactive recommendations on session start", async () => {
    const storageClient = new StubStorageClient(
      [],
      false,
      [
        {
          id: "rec-recommend",
          workspace_id: ids.workspace,
          user_id: ids.user,
          task_id: ids.task,
          session_id: ids.session,
          memory_type: "fact_preference",
          scope: "user",
          status: "active",
          summary: "默认用中文输出",
          details: null,
          importance: 5,
          confidence: 0.95,
          created_at: "2026-04-22T00:00:00.000Z",
          updated_at: "2026-04-22T00:00:00.000Z",
          last_used_at: null,
        },
      ],
    );
    const recommender = {
      async recommend() {
        return {
          recommendations: [
            {
              record_id: "rec-recommend",
              relevance_score: 0.93,
              trigger_reason: "task_similarity" as const,
              suggestion: "这轮继续沿用中文输出约定。",
              auto_inject: true,
            },
          ],
        };
      },
    };
    const repository = new InMemoryRuntimeRepository();
    const logger = pino({ enabled: false });
    const dependencyGuard = new DependencyGuard(repository, logger);
    const readModelRepository = new InMemoryReadModelRepository(sampleRecords);
    const embeddingsClient = new StubEmbeddingsClient();
    const config = { ...baseConfig };
    const finalizeIdempotencyCache = new FinalizeIdempotencyCache(config);
    const memoryOrchestrator = createMemoryOrchestrator({
      config,
      proactiveRecommender: recommender,
    });

    const service = new RetrievalRuntimeService(
      config,
      new TriggerEngine(
        config,
        embeddingsClient,
        readModelRepository,
        dependencyGuard,
        logger,
        memoryOrchestrator?.recall?.search,
        memoryOrchestrator?.intent,
      ),
      new QueryEngine(config, readModelRepository, embeddingsClient, dependencyGuard, logger),
      embeddingsClient,
      new InjectionEngine(config),
      new WritebackEngine(
        config,
        storageClient,
        dependencyGuard,
        memoryOrchestrator?.writeback,
        memoryOrchestrator?.quality,
      ),
      repository,
      dependencyGuard,
      logger,
      finalizeIdempotencyCache,
      config.EMBEDDING_TIMEOUT_MS,
      memoryOrchestrator,
      undefined,
      storageClient,
    );

    const response = await service.sessionStartContext({
      host: "codex_app_server",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      phase: "session_start",
      current_input: "恢复当前会话",
    });

    expect(response.proactive_recommendations).toHaveLength(1);
    expect(response.proactive_recommendations[0]?.record_id).toBe("rec-recommend");
  });

  it("expands recall candidates with related memories from storage relations", async () => {
    const storageClient = new StubStorageClient(
      [],
      false,
      [
        {
          id: "related-memory",
          workspace_id: ids.workspace,
          user_id: ids.user,
          task_id: ids.task,
          session_id: ids.session,
          memory_type: "episodic",
          scope: "task",
          status: "active",
          summary: "相关历史：之前已经确认过 Fastify 接口结构。",
          details: null,
          importance: 4,
          confidence: 0.88,
          created_at: "2026-04-22T00:00:00.000Z",
          updated_at: "2026-04-22T00:00:00.000Z",
          last_used_at: null,
        },
      ],
      [
        {
          id: "rel-1",
          workspace_id: ids.workspace,
          source_record_id: "mem-task",
          target_record_id: "related-memory",
          relation_type: "related_to",
          strength: 0.86,
          bidirectional: true,
          reason: "同一任务上下文",
          created_by_service: "retrieval-runtime",
          created_at: "2026-04-22T00:00:00.000Z",
          updated_at: "2026-04-22T00:00:00.000Z",
        },
      ],
    );

    const { service } = createRuntime({
      storageClient,
      llmRecallPlanner: new StubLlmRecallPlanner({
        should_search: true,
        reason: "继续当前任务，需要先查相关记忆。",
        requested_scopes: ["task", "user", "workspace"],
        requested_memory_types: ["task_state", "fact_preference", "episodic"],
        importance_threshold: 3,
        query_hint: "继续当前任务",
        candidate_limit: 6,
      }, {
        should_inject: true,
        reason: "需要注入当前任务与相关历史。",
        selected_record_ids: ["mem-task", "related-memory"],
        memory_summary: "恢复当前任务状态，并补充相关历史决策。",
      }),
    });

    const response = await service.prepareContext({
      host: "claude_code_plugin",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-related-recall",
      phase: "before_response",
      current_input: "继续当前任务，把之前确认过的接口结构也带上。",
    });

    expect(response.injection_block?.memory_records.some((record) => record.id === "related-memory")).toBe(true);
    expect(response.trigger_reason).toContain("关联");
  });

  it("serializes concurrent prepare-context calls inside the same session", async () => {
    const readModelRepository = new BlockingReadModelRepository(sampleRecords);
    const { service } = createRuntime({
      readModelRepository,
      embeddingsClient: new StubEmbeddingsClient([0.95, 0.05, 0]),
      config: {
        RECALL_LLM_JUDGE_ENABLED: false,
      },
    });

    const first = service.prepareContext({
      host: "codex_app_server",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      phase: "before_response",
      current_input: "上次确定过的当前任务状态和偏好，这次继续沿用。",
      turn_id: "same-session-turn-1",
    });
    const second = service.prepareContext({
      host: "codex_app_server",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      phase: "before_response",
      current_input: "之前那套任务状态和偏好，这一轮也继续沿用。",
      turn_id: "same-session-turn-2",
    });

    await waitForCondition(() => readModelRepository.starts.length >= 1);
    expect(readModelRepository.maxConcurrent).toBe(1);
    expect(readModelRepository.starts).toHaveLength(1);

    readModelRepository.releaseNext();
    await waitForCondition(() => readModelRepository.starts.length >= 2);
    expect(readModelRepository.starts).toHaveLength(2);
    expect(readModelRepository.maxConcurrent).toBe(1);

    readModelRepository.releaseNext();
    await Promise.all([first, second]);
  });

  it("allows concurrent prepare-context calls across different sessions", async () => {
    const readModelRepository = new BlockingReadModelRepository(sampleRecords);
    const { service } = createRuntime({
      readModelRepository,
      embeddingsClient: new StubEmbeddingsClient([0.95, 0.05, 0]),
      config: {
        RECALL_LLM_JUDGE_ENABLED: false,
      },
    });

    const first = service.prepareContext({
      host: "codex_app_server",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      phase: "before_response",
      current_input: "上次确定过的当前任务状态和偏好，这次继续沿用。",
      turn_id: "cross-session-turn-1",
    });
    const second = service.prepareContext({
      host: "codex_app_server",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: "550e8400-e29b-41d4-a716-446655440099",
      task_id: ids.task,
      phase: "before_response",
      current_input: "之前那套任务状态和偏好，在另一个会话里也继续沿用。",
      turn_id: "cross-session-turn-2",
    });

    await waitForCondition(() => readModelRepository.starts.length >= 2);
    expect(readModelRepository.maxConcurrent).toBe(2);
    expect(readModelRepository.starts).toHaveLength(2);

    readModelRepository.releaseNext();
    readModelRepository.releaseNext();
    await Promise.all([first, second]);
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

  it("filters recently injected memories in later turns before injection planning", async () => {
    const planner = new StubLlmRecallPlanner({
      should_search: true,
      reason: "需要继续之前的任务",
      requested_scopes: ["workspace", "task", "session", "user"],
      requested_memory_types: ["fact_preference", "task_state", "episodic"],
      importance_threshold: 3,
      query_hint: "继续之前的任务状态",
      candidate_limit: 6,
    }, {
      should_inject: true,
      reason: "需要注入任务状态",
      selected_record_ids: ["mem-preference", "mem-task"],
      memory_summary: "继续之前的偏好和任务状态。",
    });
    const { service, repository } = createRuntime({
      llmRecallPlanner: planner,
      config: {
        INJECTION_HARD_WINDOW_TURNS_FACT_PREFERENCE: 5,
        INJECTION_HARD_WINDOW_TURNS_TASK_STATE: 3,
        INJECTION_HARD_WINDOW_MS_FACT_PREFERENCE: 60 * 60 * 1000,
        INJECTION_HARD_WINDOW_MS_TASK_STATE: 60 * 60 * 1000,
      },
    });

    const first = await service.prepareContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-dedup-1",
      phase: "before_response",
      current_input: "照旧，按之前定的方式继续。",
    });

    expect(first.injection_block?.memory_records.map((record) => record.id)).toEqual(["mem-preference", "mem-task"]);

    const second = await service.prepareContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-dedup-2",
      phase: "before_response",
      current_input: "继续上一轮的任务。",
    });

    expect(second.injection_block).not.toBeNull();
    expect(second.injection_block?.memory_records.some((record) => record.id === "mem-preference")).toBe(false);
    expect(second.injection_block?.memory_records.some((record) => record.id === "mem-task")).toBe(false);

    const runs = await repository.getRuns({ trace_id: second.trace_id });
    expect(runs.recall_runs[0]?.recently_filtered_record_ids).toEqual(expect.arrayContaining(["mem-preference", "mem-task"]));
    expect(runs.injection_runs[0]?.recently_filtered_record_ids).toEqual(expect.arrayContaining(["mem-preference", "mem-task"]));
  });

  it("uses different hard windows by memory type", async () => {
    const planner = new StubLlmRecallPlanner({
      should_search: true,
      reason: "需要继续之前的任务",
      requested_scopes: ["workspace", "task", "session", "user"],
      requested_memory_types: ["fact_preference", "task_state", "episodic"],
      importance_threshold: 3,
      query_hint: "继续之前的任务状态",
      candidate_limit: 6,
    }, {
      should_inject: true,
      reason: "需要注入任务状态",
      selected_record_ids: ["mem-preference", "mem-task"],
      memory_summary: "继续之前的偏好和任务状态。",
    });
    const { service } = createRuntime({
      llmRecallPlanner: planner,
      config: {
        INJECTION_HARD_WINDOW_TURNS_FACT_PREFERENCE: 5,
        INJECTION_HARD_WINDOW_TURNS_TASK_STATE: 1,
        INJECTION_HARD_WINDOW_MS_FACT_PREFERENCE: 60 * 60 * 1000,
        INJECTION_HARD_WINDOW_MS_TASK_STATE: 0,
      },
    });

    await service.prepareContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-window-1",
      phase: "before_response",
      current_input: "照旧，按之前定的方式继续。",
    });

    await service.prepareContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-window-2",
      phase: "before_response",
      current_input: "继续。",
    });

    const third = await service.prepareContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-window-3",
      phase: "before_response",
      current_input: "继续当前任务。",
    });

    expect(third.injection_block).not.toBeNull();
    expect(third.injection_block?.memory_records.some((record) => record.id === "mem-preference")).toBe(false);
    expect(third.injection_block?.memory_records.some((record) => record.id === "mem-task")).toBe(true);
  });

  it("marks soft-window candidates instead of filtering them", async () => {
    const planner = new StubLlmRecallPlanner({
      should_search: true,
      reason: "需要继续之前的任务",
      requested_scopes: ["workspace", "task", "session", "user"],
      requested_memory_types: ["fact_preference", "task_state", "episodic"],
      importance_threshold: 3,
      query_hint: "继续之前的任务状态",
      candidate_limit: 6,
    }, {
      should_inject: true,
      reason: "需要注入任务状态",
      selected_record_ids: ["mem-task"],
      memory_summary: "继续之前的任务状态。",
    });
    const { service, repository } = createRuntime({
      llmRecallPlanner: planner,
      config: {
        INJECTION_HARD_WINDOW_TURNS_TASK_STATE: 0,
        INJECTION_HARD_WINDOW_MS_TASK_STATE: 0,
        INJECTION_SOFT_WINDOW_MS_TASK_STATE: 60 * 60 * 1000,
      },
    });

    await service.prepareContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-soft-1",
      phase: "before_response",
      current_input: "照旧，按之前定的方式继续。",
    });

    const second = await service.prepareContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-soft-2",
      phase: "before_response",
      current_input: "继续当前任务。",
    });

    expect(second.injection_block).not.toBeNull();
    expect(second.memory_packet?.records.find((record) => record.id === "mem-task")?.recent_injection_hint?.recently_injected).toBe(true);
    const runs = await repository.getRuns({ trace_id: second.trace_id });
    expect(runs.recall_runs[0]?.recently_soft_marked_record_ids).toContain("mem-task");
  });

  it("allows history reference to break recent injection dedup", async () => {
    const planner = new StubLlmRecallPlanner({
      should_search: true,
      reason: "需要继续之前的任务",
      requested_scopes: ["workspace", "task", "session", "user"],
      requested_memory_types: ["fact_preference", "task_state", "episodic"],
      importance_threshold: 3,
      query_hint: "继续之前的任务状态",
      candidate_limit: 6,
    }, {
      should_inject: true,
      reason: "需要注入任务状态",
      selected_record_ids: ["mem-preference", "mem-task"],
      memory_summary: "继续之前的偏好和任务状态。",
    });
    const { service, repository } = createRuntime({
      llmRecallPlanner: planner,
      config: {
        INJECTION_HARD_WINDOW_TURNS_FACT_PREFERENCE: 99,
        INJECTION_HARD_WINDOW_TURNS_TASK_STATE: 99,
        INJECTION_HARD_WINDOW_MS_FACT_PREFERENCE: 60 * 60 * 1000,
        INJECTION_HARD_WINDOW_MS_TASK_STATE: 60 * 60 * 1000,
      },
    });

    await service.prepareContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-replay-1",
      phase: "before_response",
      current_input: "照旧，按之前定的方式继续。",
    });

    const second = await service.prepareContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-replay-2",
      phase: "before_response",
      current_input: "你还记得上次定过的偏好吗？",
    });

    expect(second.injection_block).not.toBeNull();
    const runs = await repository.getRuns({ trace_id: second.trace_id });
    expect(runs.recall_runs[0]?.replay_escape_reason).toBe("history_reference_escape");
  });

  it("supports broader history reference phrases for trigger and replay escape", async () => {
    const planner = new StubLlmRecallPlanner({
      should_search: true,
      reason: "需要恢复之前讨论过的上下文",
      requested_scopes: ["workspace", "task", "session", "user"],
      requested_memory_types: ["fact_preference", "task_state", "episodic"],
      importance_threshold: 3,
      query_hint: "restore earlier discussion",
      candidate_limit: 6,
    }, {
      should_inject: true,
      reason: "需要注入之前讨论过的任务上下文",
      selected_record_ids: ["mem-task"],
      memory_summary: "恢复之前讨论过的任务上下文。",
    });
    const { service, repository } = createRuntime({
      llmRecallPlanner: planner,
      config: {
        INJECTION_HARD_WINDOW_TURNS_TASK_STATE: 99,
        INJECTION_HARD_WINDOW_MS_TASK_STATE: 60 * 60 * 1000,
      },
    });

    await service.prepareContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-history-expanded-1",
      phase: "before_response",
      current_input: "继续当前任务。",
    });

    const second = await service.prepareContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-history-expanded-2",
      phase: "before_response",
      current_input: "Earlier 我们讨论过这个任务做到哪一步了？",
    });

    expect(second.trigger).toBe(true);
    expect(second.injection_block).not.toBeNull();
    const runs = await repository.getRuns({ trace_id: second.trace_id });
    expect(runs.trigger_runs[0]?.trigger_type).toBe("history_reference");
    expect(runs.recall_runs[0]?.replay_escape_reason).toBe("history_reference_escape");
  });

  it("allows task switch to break recent injection dedup on the following before_response", async () => {
    const planner = new StubLlmRecallPlanner({
      should_search: true,
      reason: "需要切换后恢复任务上下文",
      requested_scopes: ["workspace", "task", "session", "user"],
      requested_memory_types: ["fact_preference", "task_state", "episodic"],
      importance_threshold: 3,
      query_hint: "切换任务后恢复上下文",
      candidate_limit: 6,
    }, {
      should_inject: true,
      reason: "需要注入切换后的任务状态",
      selected_record_ids: ["mem-task"],
      memory_summary: "切换任务后恢复当前任务状态。",
    });
    const { service, repository } = createRuntime({
      llmRecallPlanner: planner,
      config: {
        INJECTION_HARD_WINDOW_TURNS_TASK_STATE: 99,
        INJECTION_HARD_WINDOW_MS_TASK_STATE: 60 * 60 * 1000,
      },
    });

    await service.prepareContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-task-switch-1",
      phase: "before_response",
      current_input: "继续当前任务。",
    });

    await service.prepareContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-task-switch-2",
      phase: "task_switch",
      current_input: "换个任务，改成另一个方向。",
    });

    const second = await service.prepareContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-task-switch-3",
      phase: "before_response",
      current_input: "现在继续新任务。",
    });

    expect(second.injection_block?.memory_records.some((record) => record.id === "mem-task")).toBe(true);
    const runs = await repository.getRuns({ trace_id: second.trace_id });
    expect(runs.recall_runs[0]?.replay_escape_reason).toBe("task_switch_escape");
  });

  it("restores recent injection dedup state after runtime restart", async () => {
    const planner = new StubLlmRecallPlanner({
      should_search: true,
      reason: "需要继续之前的任务",
      requested_scopes: ["workspace", "task", "session", "user"],
      requested_memory_types: ["fact_preference", "task_state", "episodic"],
      importance_threshold: 3,
      query_hint: "继续之前的任务状态",
      candidate_limit: 6,
    }, {
      should_inject: true,
      reason: "需要注入任务状态",
      selected_record_ids: ["mem-preference", "mem-task"],
      memory_summary: "继续之前的偏好和任务状态。",
    });
    const repository = new InMemoryRuntimeRepository();
    const readModelRepository = new InMemoryReadModelRepository(sampleRecords);
    const logger = pino({ enabled: false });
    const storageClient = new StubStorageClient();

    const createService = () => {
      const config = {
        ...baseConfig,
        INJECTION_HARD_WINDOW_TURNS_FACT_PREFERENCE: 5,
        INJECTION_HARD_WINDOW_TURNS_TASK_STATE: 3,
        INJECTION_HARD_WINDOW_MS_FACT_PREFERENCE: 60 * 60 * 1000,
        INJECTION_HARD_WINDOW_MS_TASK_STATE: 60 * 60 * 1000,
      };
      const dependencyGuard = new DependencyGuard(repository, logger);
      const embeddingsClient = new StubEmbeddingsClient();
      const memoryOrchestrator = createMemoryOrchestrator({
        config,
        recallPlanner: {
          search: new StubRecallSearchPlanner(planner),
          injection: new StubRecallInjectionPlanner(planner),
        },
        writebackPlanner: undefined,
        qualityAssessor: undefined,
      });

      return new RetrievalRuntimeService(
        config,
        new TriggerEngine(
          config,
          embeddingsClient,
          readModelRepository,
          dependencyGuard,
          logger,
          memoryOrchestrator?.recall?.search,
          memoryOrchestrator?.intent,
        ),
        new QueryEngine(config, readModelRepository, embeddingsClient, dependencyGuard, logger),
        embeddingsClient,
        new InjectionEngine(config),
        new WritebackEngine(
          config,
          storageClient,
          dependencyGuard,
          memoryOrchestrator?.writeback,
          memoryOrchestrator?.quality,
        ),
        repository,
        dependencyGuard,
        logger,
        new FinalizeIdempotencyCache(config),
        config.EMBEDDING_TIMEOUT_MS,
        memoryOrchestrator,
        undefined,
        storageClient,
      );
    };

    const firstService = createService();
    await firstService.prepareContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-restart-1",
      phase: "before_response",
      current_input: "照旧，按之前定的方式继续。",
    });

    const restartedService = createService();
    const second = await restartedService.prepareContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-restart-2",
      phase: "before_response",
      current_input: "继续上一轮的任务。",
    });

    expect(second.injection_block).not.toBeNull();
    expect(second.injection_block?.memory_records.some((record) => record.id === "mem-preference")).toBe(false);
    expect(second.injection_block?.memory_records.some((record) => record.id === "mem-task")).toBe(false);
  });

  it("allows updated records to break recent injection dedup", async () => {
    const planner = new StubLlmRecallPlanner({
      should_search: true,
      reason: "需要继续恢复偏好",
      requested_scopes: ["workspace", "task", "session", "user"],
      requested_memory_types: ["fact_preference", "task_state", "episodic"],
      importance_threshold: 3,
      query_hint: "恢复最新偏好",
      candidate_limit: 6,
    }, {
      should_inject: true,
      reason: "需要注入最新偏好",
      selected_record_ids: ["mem-preference"],
      memory_summary: "恢复最新偏好。",
    });
    const updatedPreference: CandidateMemory = {
      ...sampleRecords[1]!,
      updated_at: "2026-04-16T10:00:00.000Z",
      summary: "用户偏好：默认用中文，回答尽量简短直接，优先 TypeScript。",
    };
    const readModelRepository = new MutableReadModelRepository([sampleRecords[1]!]);
    const { service, repository } = createRuntime({
      llmRecallPlanner: planner,
      readModelRepository,
      config: {
        INJECTION_HARD_WINDOW_TURNS_FACT_PREFERENCE: 99,
        INJECTION_HARD_WINDOW_MS_FACT_PREFERENCE: 60 * 60 * 1000,
      },
    });

    await service.prepareContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-version-1",
      phase: "before_response",
      current_input: "继续按之前偏好来。",
    });

    readModelRepository.setRecords([updatedPreference]);

    const second = await service.prepareContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-version-2",
      phase: "before_response",
      current_input: "继续按当前最新偏好来。",
    });

    expect(second.injection_block?.memory_records.some((record) => record.id === "mem-preference")).toBe(true);
    const runs = await repository.getRuns({ trace_id: second.trace_id });
    expect(runs.recall_runs[0]?.replay_escape_reason).toBe("record_version_changed_escape");
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

  it("returns degraded skip reason when trigger-stage dependencies fail and recall is skipped", async () => {
    const { service } = createRuntime({
      embeddingsClient: new StubEmbeddingsClient([1, 0, 0], true),
    });

    const response = await service.prepareContext({
      host: "custom_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      phase: "before_response",
      current_input: "继续刚才那个方案",
    });

    expect(response.trigger).toBe(false);
    expect(response.degraded).toBe(true);
    expect(response.degraded_skip_reason).toBe("trigger_dependencies_unavailable");
  });

  it("uses lexical fallback scoring when embedding is pending on a relevant record", async () => {
    const { service } = createRuntime({
      records: [
        {
          id: "pending-embedding-pref",
          workspace_id: ids.workspace,
          user_id: ids.user,
          session_id: ids.session,
          task_id: ids.task,
          memory_type: "task_state",
          scope: "task",
          summary: "当前任务状态：继续补回归测试并检查迁移进度。",
          details: null,
          source: { turn_id: "pending-1" },
          importance: 4,
          confidence: 0.85,
          status: "active",
          updated_at: "2026-04-20T12:00:00.000Z",
          last_confirmed_at: null,
          summary_embedding: undefined,
          embedding_status: "pending",
        },
        {
          id: "unrelated-with-embedding",
          workspace_id: ids.workspace,
          user_id: ids.user,
          session_id: ids.session,
          task_id: ids.task,
          memory_type: "task_state",
          scope: "task",
          summary: "当前任务状态：整理发布说明。",
          details: null,
          source: { turn_id: "ok-1" },
          importance: 4,
          confidence: 0.85,
          status: "active",
          updated_at: "2026-04-20T12:00:00.000Z",
          last_confirmed_at: null,
          summary_embedding: [0, 1, 0],
          embedding_status: "ok",
        },
      ],
    });

    const response = await service.prepareContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-lexical-fallback",
      phase: "task_start",
      current_input: "开始当前任务，继续补回归测试。",
    });

    expect(response.memory_packet?.records[0]?.id).toBe("pending-embedding-pref");
    expect(response.memory_packet?.records[0]?.fallback_semantic_score).toBeGreaterThan(0);
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

  it("prefers task_state over episodic for older but still relevant task progress", async () => {
    const now = Date.now();
    const records: CandidateMemory[] = [
      {
        id: "task-state-older",
        workspace_id: ids.workspace,
        user_id: ids.user,
        session_id: ids.session,
        task_id: ids.task,
        memory_type: "task_state",
        scope: "task",
        summary: "当前任务状态：迁移做到第 3 步，下一步补回归测试。",
        details: null,
        source: { turn_id: "task-recency" },
        importance: 4,
        confidence: 0.9,
        status: "active",
        updated_at: new Date(now - 15 * 24 * 60 * 60 * 1000).toISOString(),
        last_confirmed_at: null,
        summary_embedding: [1, 0, 0],
      },
      {
        id: "episodic-newer",
        workspace_id: ids.workspace,
        user_id: ids.user,
        session_id: ids.session,
        task_id: ids.task,
        memory_type: "episodic",
        scope: "task",
        summary: "历史事件：之前试过一次迁移命令。",
        details: null,
        source: { turn_id: "episodic-recency" },
        importance: 4,
        confidence: 0.9,
        status: "active",
        updated_at: new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString(),
        last_confirmed_at: null,
        summary_embedding: [1, 0, 0],
      },
    ];
    const { service } = createRuntime({ records });

    const response = await service.prepareContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-task-recency-balance",
      phase: "task_start",
      current_input: "开始当前任务",
    });

    expect(response.memory_packet?.records[0]?.id).toBe("task-state-older");
    expect(response.injection_block?.memory_records[0]?.id).toBe("task-state-older");
  });

  it("actively checks memory llm health and records a healthy status", async () => {
    const { service } = createRuntime({
      llmExtractor: {
        extract: async () => ({ candidates: [] }),
        refine: async () => ({ refined_candidates: [] }),
        healthCheck: async () => undefined,
      },
    });

    const response = await service.checkMemoryLlm();
    const dependencies = await service.getDependencies();

    expect(response).toMatchObject({
      name: "memory_llm",
      status: "healthy",
      detail: "memory llm request completed",
    });
    expect(dependencies.memory_llm.status).toBe("healthy");
  });

  it("returns not configured style status when memory llm is missing", async () => {
    const { service } = createRuntime();

    const response = await service.checkMemoryLlm();

    expect(response).toMatchObject({
      name: "memory_llm",
      status: "unavailable",
      detail: "memory llm is not configured",
    });
  });

  it("returns the concrete memory llm failure reason during active health check", async () => {
    const { service } = createRuntime({
      llmExtractor: {
        extract: async () => ({ candidates: [] }),
        refine: async () => ({ refined_candidates: [] }),
        healthCheck: async () => {
          throw new Error("memory llm request failed with 401");
        },
      },
    });

    const response = await service.checkMemoryLlm();

    expect(response).toMatchObject({
      name: "memory_llm",
      status: "unavailable",
      detail: "memory llm request failed with 401",
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
    expect(response.write_back_candidates[0]?.source.source_type).toBe("memory_llm");
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
    expect(response.write_back_candidates.some((candidate) => candidate.source.source_type !== "memory_llm")).toBe(true);
  });

  it("keeps writeback flow available when quality assessor is configured", async () => {
    const { service } = createRuntime({
      llmExtractor: new StubLlmExtractor({
        candidates: [
          {
            candidate_type: "fact_preference",
            scope: "user",
            summary: "默认用中文输出",
            importance: 5,
            confidence: 0.92,
            write_reason: "stable preference confirmed in this turn",
          },
        ],
      }),
      qualityAssessor: new StubQualityAssessor([
        {
          candidate_id: undefined,
          quality_score: 0.4,
          confidence: 0.8,
          potential_conflicts: [],
          suggested_importance: 3,
          suggested_status: "pending_confirmation",
          issues: [
            {
              type: "low_quality",
              severity: "high",
              description: "信息不够稳定",
            },
          ],
          reason: "内容过于临时",
        },
      ]),
    });

    const response = await service.finalizeTurn({
      host: "codex_app_server",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      current_input: "后续都用中文输出",
      assistant_output: "收到，我会统一改成中文输出。",
    });

    expect(response.filtered_reasons).toContain("quality_blocked:fact_preference");
  });

  it("blocks llm-only new candidates when quality assessor is unavailable", async () => {
    const { service } = createRuntime({
      llmExtractor: new StubLlmExtractor({
        candidates: [
          {
            candidate_type: "fact_preference",
            scope: "user",
            summary: "默认用中文输出",
            importance: 5,
            confidence: 0.92,
            write_reason: "stable preference confirmed in this turn",
          },
        ],
      }),
      qualityAssessor: new StubQualityAssessor([], true),
    });

    const response = await service.finalizeTurn({
      host: "codex_app_server",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      current_input: "后续都用中文输出",
      assistant_output: "收到，我会统一改成中文输出。",
    });

    expect(response.write_back_candidates).toHaveLength(0);
    expect(response.filtered_reasons).toContain("quality_assessor_fallback_blocked:fact_preference");
  });

  it("keeps rule candidates when quality assessor is unavailable", async () => {
    const { service } = createRuntime({
      qualityAssessor: new StubQualityAssessor([], true),
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
    expect(response.write_back_candidates.some((candidate) => candidate.source.source_type !== "memory_llm")).toBe(true);
    expect(response.filtered_reasons).not.toContain("quality_assessor_fallback_blocked:fact_preference");
  });

  it("keeps writeback candidates compatible when quality assessor suggests manual review", async () => {
    const { service } = createRuntime({
      llmExtractor: new StubLlmExtractor({
        candidates: [
          {
            candidate_type: "fact_preference",
            scope: "user",
            summary: "默认用中文输出",
            importance: 5,
            confidence: 0.92,
            write_reason: "stable preference confirmed in this turn",
          },
        ],
      }),
      qualityAssessor: new StubQualityAssessor([
        {
          candidate_id: undefined,
          quality_score: 0.72,
          confidence: 0.86,
          potential_conflicts: ["rec-existing"],
          suggested_importance: 4,
          suggested_status: "pending_confirmation",
          issues: [
            {
              type: "conflict",
              severity: "medium",
              description: "与历史偏好接近",
            },
          ],
          reason: "建议人工确认",
        },
      ]),
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
    expect(response.write_back_candidates[0]?.summary).toBe("默认用中文输出");
  });

  it("records recall effectiveness evaluation after finalize-turn when injected memory was used", async () => {
    const evaluator = new StubRecallEffectivenessEvaluator(1);
    const { service, repository } = createRuntime({
      llmRecallPlanner: new StubLlmRecallPlanner({
        should_search: true,
        reason: "需要继续之前的任务",
        requested_scopes: ["workspace", "task", "session", "user"],
        requested_memory_types: ["fact_preference", "task_state", "episodic"],
        importance_threshold: 3,
        query_hint: "继续之前的任务状态",
        candidate_limit: 6,
      }, {
        should_inject: true,
        reason: "需要注入任务状态",
        selected_record_ids: ["mem-preference", "mem-task"],
        memory_summary: "继续之前的偏好和任务状态。",
      }),
      recallEffectivenessEvaluator: evaluator,
    });

    const prepared = await service.prepareContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "effectiveness-turn-1",
      phase: "before_response",
      current_input: "照旧，按之前定的方式继续。",
    });

    expect(prepared.injection_block).not.toBeNull();

    await service.finalizeTurn({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "effectiveness-turn-1",
      current_input: "照旧，按之前定的方式继续。",
      assistant_output: "收到，我会继续按之前的中文输出偏好和当前任务状态处理。",
    });

    const runs = await repository.getRuns({ trace_id: prepared.trace_id });
    expect(evaluator.callCount).toBe(1);
    expect(runs.memory_plan_runs.some((run) => run.plan_kind === "memory_effectiveness_plan")).toBe(true);
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
    const searchPlan = runs.memory_plan_runs.find((run) => run.plan_kind === "memory_search_plan");
    expect(runs.trigger_runs[0]?.memory_mode).toBe("workspace_only");
    expect(searchPlan).toBeTruthy();
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
    expect(runs.memory_plan_runs.some((run) => run.plan_kind === "memory_writeback_plan")).toBe(true);
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

  it("reports dedup and replay metrics from runtime traces", async () => {
    const planner = new StubLlmRecallPlanner({
      should_search: true,
      reason: "需要继续恢复记忆",
      requested_scopes: ["workspace", "task", "session", "user"],
      requested_memory_types: ["fact_preference", "task_state", "episodic"],
      importance_threshold: 3,
      query_hint: "继续当前记忆上下文",
      candidate_limit: 6,
    }, {
      should_inject: true,
      reason: "需要注入记忆",
      selected_record_ids: ["mem-preference", "mem-task"],
      memory_summary: "继续之前的偏好和任务状态。",
    });
    const { service, repository } = createRuntime({
      llmRecallPlanner: planner,
      config: {
        INJECTION_HARD_WINDOW_TURNS_FACT_PREFERENCE: 99,
        INJECTION_HARD_WINDOW_TURNS_TASK_STATE: 0,
        INJECTION_HARD_WINDOW_MS_FACT_PREFERENCE: 60 * 60 * 1000,
        INJECTION_HARD_WINDOW_MS_TASK_STATE: 0,
        INJECTION_SOFT_WINDOW_MS_TASK_STATE: 60 * 60 * 1000,
      },
    });

    await service.prepareContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-metrics-1",
      phase: "before_response",
      current_input: "继续当前任务。",
    });

    await service.prepareContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-metrics-2",
      phase: "before_response",
      current_input: "继续。",
    });

    await service.prepareContext({
      host: "memory_native_agent",
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      turn_id: "turn-metrics-3",
      phase: "before_response",
      current_input: "你还记得上次定过的偏好吗？",
    });

    const metrics = await repository.getMetrics();
    expect(metrics.dedup_filtered_rate).toBeGreaterThan(0);
    expect(metrics.soft_mark_rate).toBeGreaterThan(0);
    expect(metrics.replay_escape_rate).toBeGreaterThan(0);
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
      config,
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
      new WritebackEngine(
        config,
        storageClient,
        dependencyGuard,
        memoryOrchestrator?.writeback,
        memoryOrchestrator?.quality,
      ),
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
      config,
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
      new WritebackEngine(
        config,
        storageClient,
        dependencyGuard,
        memoryOrchestrator?.writeback,
        memoryOrchestrator?.quality,
      ),
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
    const memoryLlmCheckResponse = await app.inject({
      method: "POST",
      url: "/v1/runtime/dependency-status/memory-llm/check",
    });

    expect(prepareResponse.statusCode).toBe(200);
    expect(finalizeResponse.statusCode).toBe(200);
    expect(embeddingCheckResponse.statusCode).toBe(200);
    expect(memoryLlmCheckResponse.statusCode).toBe(200);
    expect(livenessResponse.json()).toEqual({ status: "alive" });
    expect(readinessResponse.json()).toEqual({ status: "ready" });
    expect(dependenciesResponse.json()).toHaveProperty("read_model");
    expect(embeddingCheckResponse.json()).toMatchObject({
      name: "embeddings",
      status: "healthy",
    });
    expect(memoryLlmCheckResponse.json()).toMatchObject({
      name: "memory_llm",
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

  it("surfaces maintenance conflict responses through the HTTP layer", async () => {
    const repository = new InMemoryRuntimeRepository();
    const logger = pino({ enabled: false });
    const dependencyGuard = new DependencyGuard(repository, logger);
    const readModelRepository = new InMemoryReadModelRepository(sampleRecords);
    const storageClient = new StubStorageClient();
    const embeddingsClient = new StubEmbeddingsClient();
    const worker = {
      runOnce: async () => {
        throw new ConflictAppError("maintenance workspace is already running", {
          workspace_id: ids.workspace,
        });
      },
    } as unknown as WritebackMaintenanceWorker;
    const memoryOrchestrator = createMemoryOrchestrator({ config: baseConfig });
    const service = new RetrievalRuntimeService(
      baseConfig,
      new TriggerEngine(
        baseConfig,
        embeddingsClient,
        readModelRepository,
        dependencyGuard,
        logger,
        memoryOrchestrator?.recall?.search,
      ),
      new QueryEngine(baseConfig, readModelRepository, embeddingsClient, dependencyGuard, logger),
      embeddingsClient,
      new InjectionEngine(baseConfig),
      new WritebackEngine(
        baseConfig,
        storageClient,
        dependencyGuard,
        memoryOrchestrator?.writeback,
        memoryOrchestrator?.quality,
      ),
      repository,
      dependencyGuard,
      logger,
      new FinalizeIdempotencyCache(baseConfig),
      baseConfig.EMBEDDING_TIMEOUT_MS,
      memoryOrchestrator,
      worker,
    );
    const app = createApp(service);

    const response = await app.inject({
      method: "POST",
      url: "/v1/runtime/writeback-maintenance/run",
      payload: {
        workspace_id: ids.workspace,
        force: true,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: {
        code: "conflict_error",
        message: "maintenance workspace is already running",
      },
    });
    await app.close();
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

  it("serves write projection statuses through the runtime HTTP layer", async () => {
    const { service } = createRuntime();
    const app = createApp(service);

    const response = await app.inject({
      method: "POST",
      url: "/v1/runtime/write-projection-status",
      payload: {
        job_ids: ["550e8400-e29b-41d4-a716-446655440030"],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [],
    });

    await app.close();
  });
});
