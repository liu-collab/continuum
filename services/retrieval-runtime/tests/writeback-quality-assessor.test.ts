import pino from "pino";
import { describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config.js";
import { DependencyGuard } from "../src/dependency/dependency-guard.js";
import { InMemoryRuntimeRepository } from "../src/observability/in-memory-runtime-repository.js";
import type { QualityAssessor, WritebackPlanner } from "../src/memory-orchestrator/types.js";
import type { EmbeddingsClient } from "../src/query/embeddings-client.js";
import type {
  GovernanceExecutionResponseItem,
  MemoryConflictSnapshot,
  MemoryRecordSnapshot,
  SubmittedWriteBackJob,
  WriteProjectionStatusSnapshot,
  WriteBackCandidate,
} from "../src/shared/types.js";
import type {
  RecordListPage,
  RecordPatchPayload,
  ResolveConflictPayload,
  StorageMutationPayload,
  StorageWritebackClient,
} from "../src/writeback/storage-client.js";
import { EmbeddingCrossReferenceEngine } from "../src/writeback/cross-reference.js";
import { WritebackEngine } from "../src/writeback/writeback-engine.js";

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
  RECALL_LLM_JUDGE_ENABLED: true,
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
  IMPORTANCE_THRESHOLD_SESSION_START: 4,
  IMPORTANCE_THRESHOLD_DEFAULT: 3,
  IMPORTANCE_THRESHOLD_SEMANTIC: 4,
};

class StubStorageClient implements StorageWritebackClient {
  async submitCandidates(candidates: WriteBackCandidate[]): Promise<SubmittedWriteBackJob[]> {
    return candidates.map((candidate) => ({
      candidate_summary: candidate.summary,
      status: "accepted_async",
    }));
  }

  async getWriteProjectionStatuses(): Promise<WriteProjectionStatusSnapshot[]> {
    return [];
  }

  async listRecords(): Promise<RecordListPage> {
    return { items: [], total: 0, page: 1, page_size: 20 };
  }

  async getRecordsByIds(): Promise<MemoryRecordSnapshot[]> {
    return [];
  }

  async patchRecord(_recordId: string, _payload: RecordPatchPayload): Promise<MemoryRecordSnapshot> {
    throw new Error("not implemented");
  }

  async archiveRecord(_recordId: string, _payload: StorageMutationPayload): Promise<MemoryRecordSnapshot> {
    throw new Error("not implemented");
  }

  async listConflicts(): Promise<MemoryConflictSnapshot[]> {
    return [];
  }

  async resolveConflict(_conflictId: string, _payload: ResolveConflictPayload): Promise<MemoryConflictSnapshot> {
    throw new Error("not implemented");
  }

  async upsertRelations() {
    return [];
  }

  async listRelations() {
    return [];
  }

  async submitGovernanceExecutions(): Promise<GovernanceExecutionResponseItem[]> {
    return [];
  }
}

class StubQualityAssessor implements QualityAssessor {
  constructor(
    private readonly quality_score: number,
    private readonly suggested_status: "active" | "pending_confirmation",
    private readonly suggested_importance: number,
  ) {}

  async assess(input: { writeback_candidates: Array<{ idempotency_key: string }> }) {
    return {
      assessments: input.writeback_candidates.map((candidate) => ({
        candidate_id: candidate.idempotency_key,
        quality_score: this.quality_score,
        confidence: 0.88,
        potential_conflicts: ["rec-existing"],
        suggested_importance: this.suggested_importance,
        suggested_status: this.suggested_status,
        issues: [],
        reason: this.suggested_status === "pending_confirmation" ? "建议人工确认" : "质量稳定",
      })),
    };
  }
}

class StubWritebackPlanner implements WritebackPlanner {
  public refineCallCount = 0;
  public lastRuleHints: Parameters<WritebackPlanner["extract"]>[0]["rule_hints"] = [];

  constructor(private readonly summary: string) {}

  async extract(input: Parameters<WritebackPlanner["extract"]>[0]) {
    this.lastRuleHints = input.rule_hints ?? [];
    return {
      candidates: [
        {
          candidate_type: "preference" as const,
          scope: "user" as const,
          summary: this.summary,
          importance: 4,
          confidence: 0.92,
          write_reason: "llm extracted a durable preference",
        },
      ],
    };
  }

  async refine() {
    this.refineCallCount += 1;
    return { refined_candidates: [] };
  }
}

class SemanticStubEmbeddingsClient implements EmbeddingsClient {
  public callCount = 0;

  async embedText(text: string): Promise<number[]> {
    this.callCount += 1;
    if (text.includes("中文")) {
      return [1, 0, 0];
    }
    return [0, 1, 0];
  }
}

describe("writeback quality assessor integration", () => {
  it("blocks candidates below the quality threshold", async () => {
    const engine = new WritebackEngine(
      config,
      new StubStorageClient(),
      new DependencyGuard(new InMemoryRuntimeRepository(), pino({ enabled: false })),
      undefined,
      new StubQualityAssessor(0.4, "pending_confirmation", 3),
    );

    const result = await engine.extractCandidates({
      host: "codex_app_server",
      workspace_id: "550e8400-e29b-41d4-a716-446655440000",
      user_id: "550e8400-e29b-41d4-a716-446655440001",
      session_id: "550e8400-e29b-41d4-a716-446655440002",
      current_input: "我偏好: 默认中文输出",
      assistant_output: "已确认: 后续都用中文。",
    });

    expect(result.candidates).toHaveLength(0);
    expect(result.filtered_reasons).toContain("quality_blocked:preference");
  });

  it("marks candidates as pending confirmation when quality assessor requests review", async () => {
    const engine = new WritebackEngine(
      config,
      new StubStorageClient(),
      new DependencyGuard(new InMemoryRuntimeRepository(), pino({ enabled: false })),
      undefined,
      new StubQualityAssessor(0.72, "pending_confirmation", 4),
    );

    const result = await engine.extractCandidates({
      host: "codex_app_server",
      workspace_id: "550e8400-e29b-41d4-a716-446655440000",
      user_id: "550e8400-e29b-41d4-a716-446655440001",
      session_id: "550e8400-e29b-41d4-a716-446655440002",
      current_input: "我偏好: 默认中文输出",
      assistant_output: "已确认: 后续都用中文。",
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.suggested_status).toBe("pending_confirmation");
    expect(result.candidates[0]?.importance).toBe(4);
    expect(result.candidates[0]?.details).toMatchObject({
      quality_score: 0.72,
      quality_reason: "建议人工确认",
      potential_conflicts: ["rec-existing"],
    });
  });

  it("extracts expanded rule patterns and keeps project defaults in workspace scope", async () => {
    const engine = new WritebackEngine(
      config,
      new StubStorageClient(),
      new DependencyGuard(new InMemoryRuntimeRepository(), pino({ enabled: false })),
    );

    const result = await engine.extractCandidates({
      host: "codex_app_server",
      workspace_id: "550e8400-e29b-41d4-a716-446655440000",
      user_id: "550e8400-e29b-41d4-a716-446655440001",
      session_id: "550e8400-e29b-41d4-a716-446655440002",
      task_id: "550e8400-e29b-41d4-a716-446655440003",
      current_input: "这个项目默认用 4 空格缩进",
      assistant_output: "还剩 API 层需要补测试。",
    });

    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidate_type: "fact",
          scope: "workspace",
          summary: expect.stringContaining("这个项目默认用 4 空格缩进"),
        }),
        expect.objectContaining({
          candidate_type: "task_state",
          scope: "task",
          summary: expect.stringContaining("API 层"),
        }),
      ]),
    );
  });

  it("filters low-overlap llm candidates with the method-specific overlap threshold", async () => {
    const engine = new WritebackEngine(
      config,
      new StubStorageClient(),
      new DependencyGuard(new InMemoryRuntimeRepository(), pino({ enabled: false })),
      new StubWritebackPlanner("使用 Kotlin 编写移动端模块"),
    );

    const result = await engine.extractCandidates({
      host: "codex_app_server",
      workspace_id: "550e8400-e29b-41d4-a716-446655440000",
      user_id: "550e8400-e29b-41d4-a716-446655440001",
      session_id: "550e8400-e29b-41d4-a716-446655440002",
      current_input: "我偏好: 默认中文输出",
      assistant_output: "已确认: 默认中文输出。",
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.summary).toBe("默认中文输出");
    expect(result.filtered_reasons).toContain("low_input_overlap:preference");
  });

  it("merges independently confirmed rule and llm candidates without calling refine", async () => {
    const planner = new StubWritebackPlanner("用户默认中文输出");
    const embeddingsClient = new SemanticStubEmbeddingsClient();
    const engine = new WritebackEngine(
      config,
      new StubStorageClient(),
      new DependencyGuard(new InMemoryRuntimeRepository(), pino({ enabled: false })),
      planner,
      undefined,
      undefined,
      new EmbeddingCrossReferenceEngine(embeddingsClient, {
        confirmationThreshold: 0.85,
        partialMatchThreshold: 0.7,
      }),
    );

    const result = await engine.extractCandidates({
      host: "codex_app_server",
      workspace_id: "550e8400-e29b-41d4-a716-446655440000",
      user_id: "550e8400-e29b-41d4-a716-446655440001",
      session_id: "550e8400-e29b-41d4-a716-446655440002",
      current_input: "我偏好: 默认中文输出",
      assistant_output: "已确认: 默认中文输出。",
    });

    expect(planner.refineCallCount).toBe(0);
    expect(planner.lastRuleHints).toEqual([
      expect.objectContaining({
        candidate_type: "preference",
        summary: "默认中文输出",
      }),
    ]);
    expect(embeddingsClient.callCount).toBe(2);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.details).toMatchObject({
      cross_reference: "independent_confirmation",
      rule_summary: "默认中文输出",
      llm_summary: "用户默认中文输出",
    });
    expect(result.candidates[0]?.details.cross_reference_similarity).toBeGreaterThanOrEqual(0.85);
  });
});
