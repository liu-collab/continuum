import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";

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
  WriteProjectionStatusSnapshot,
  WriteBackCandidate,
} from "../src/shared/types.js";
import { TriggerEngine } from "../src/trigger/trigger-engine.js";
import { FinalizeIdempotencyCache } from "../src/writeback/finalize-idempotency-cache.js";
import type {
  RecordListPage,
  RecordPatchPayload,
  ResolveConflictPayload,
  StorageMutationPayload,
  StorageWritebackClient,
} from "../src/writeback/storage-client.js";
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
  MEMORY_LLM_TIMEOUT_MS: 15_000,
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
  INJECTION_RECORD_LIMIT: 4,
  INJECTION_TOKEN_BUDGET: 512,
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

class StubEmbeddingsClient implements EmbeddingsClient {
  async embedText(): Promise<number[]> {
    return [1, 0, 0];
  }
}

class StubStorageClient implements StorageWritebackClient {
  async submitCandidates(
    candidates: WriteBackCandidate[],
  ): Promise<SubmittedWriteBackJob[]> {
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

  async patchRecord(
    _recordId: string,
    _payload: RecordPatchPayload,
  ): Promise<MemoryRecordSnapshot> {
    throw new Error("patchRecord is not used in host validation tests");
  }

  async archiveRecord(
    _recordId: string,
    _payload: StorageMutationPayload,
  ): Promise<MemoryRecordSnapshot> {
    throw new Error("archiveRecord is not used in host validation tests");
  }

  async listConflicts(): Promise<MemoryConflictSnapshot[]> {
    return [];
  }

  async resolveConflict(
    _conflictId: string,
    _payload: ResolveConflictPayload,
  ): Promise<MemoryConflictSnapshot> {
    throw new Error("resolveConflict is not used in host validation tests");
  }

  async upsertRelations() {
    return [];
  }

  async listRelations() {
    return [];
  }

  async submitGovernanceExecutions(): Promise<
    GovernanceExecutionResponseItem[]
  > {
    return [];
  }
}

function createRuntimeApp(records: CandidateMemory[] = []) {
  const repository = new InMemoryRuntimeRepository();
  const logger = pino({ enabled: false });
  const dependencyGuard = new DependencyGuard(repository, logger);
  const readModelRepository = new InMemoryReadModelRepository(records);
  const embeddingsClient = new StubEmbeddingsClient();
  const storageClient = new StubStorageClient();
  const finalizeIdempotencyCache = new FinalizeIdempotencyCache(config);
  const memoryOrchestrator = createMemoryOrchestrator({ config });

  const service = new RetrievalRuntimeService(
    config,
    new TriggerEngine(
      config,
      embeddingsClient,
      readModelRepository,
      dependencyGuard,
      logger,
      memoryOrchestrator?.recall?.search,
    ),
    new QueryEngine(
      config,
      readModelRepository,
      embeddingsClient,
      dependencyGuard,
      logger,
    ),
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

  return createApp(service);
}

const apps: Array<ReturnType<typeof createRuntimeApp>> = [];

afterEach(async () => {
  while (apps.length > 0) {
    const app = apps.pop();
    if (app) {
      await app.close();
    }
  }
});

const validPreparePayload = {
  host: "claude_code_plugin",
  workspace_id: "550e8400-e29b-41d4-a716-446655440000",
  user_id: "550e8400-e29b-41d4-a716-446655440001",
  session_id: "session-abc",
  phase: "before_response",
  current_input: "测试输入",
};

const validFinalizePayload = {
  host: "claude_code_plugin",
  workspace_id: "550e8400-e29b-41d4-a716-446655440000",
  user_id: "550e8400-e29b-41d4-a716-446655440001",
  session_id: "session-abc",
  current_input: "帮我看看这段代码",
  assistant_output: "代码没有问题。",
};

const validSessionStartPayload = {
  host: "claude_code_plugin",
  workspace_id: "550e8400-e29b-41d4-a716-446655440000",
  user_id: "550e8400-e29b-41d4-a716-446655440001",
  session_id: "session-abc",
};

describe("host input validation", () => {
  describe("prepare-context validation", () => {
    it("rejects missing workspace_id with 400", async () => {
      const app = createRuntimeApp([]);
      apps.push(app);
      const { workspace_id, ...payload } = validPreparePayload;

      const response = await app.inject({
        method: "POST",
        url: "/v1/runtime/prepare-context",
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toHaveProperty("error");
    });

    it("rejects missing user_id with 400", async () => {
      const app = createRuntimeApp([]);
      apps.push(app);
      const { user_id, ...payload } = validPreparePayload;

      const response = await app.inject({
        method: "POST",
        url: "/v1/runtime/prepare-context",
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toHaveProperty("error");
    });

    it("rejects missing session_id with 400", async () => {
      const app = createRuntimeApp([]);
      apps.push(app);
      const { session_id, ...payload } = validPreparePayload;

      const response = await app.inject({
        method: "POST",
        url: "/v1/runtime/prepare-context",
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toHaveProperty("error");
    });

    it("rejects invalid host value with 400", async () => {
      const app = createRuntimeApp([]);
      apps.push(app);

      const response = await app.inject({
        method: "POST",
        url: "/v1/runtime/prepare-context",
        payload: { ...validPreparePayload, host: "unknown_host" },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toHaveProperty("error");
    });

    it("rejects non-UUID workspace_id with 400", async () => {
      const app = createRuntimeApp([]);
      apps.push(app);

      const response = await app.inject({
        method: "POST",
        url: "/v1/runtime/prepare-context",
        payload: { ...validPreparePayload, workspace_id: "not-a-uuid" },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toHaveProperty("error");
    });

    it("rejects invalid phase value with 400", async () => {
      const app = createRuntimeApp([]);
      apps.push(app);

      const response = await app.inject({
        method: "POST",
        url: "/v1/runtime/prepare-context",
        payload: { ...validPreparePayload, phase: "invalid_phase" },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toHaveProperty("error");
    });

    it("rejects empty current_input with 400", async () => {
      const app = createRuntimeApp([]);
      apps.push(app);

      const response = await app.inject({
        method: "POST",
        url: "/v1/runtime/prepare-context",
        payload: { ...validPreparePayload, current_input: "" },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toHaveProperty("error");
    });

    it("rejects invalid memory_mode with 400", async () => {
      const app = createRuntimeApp([]);
      apps.push(app);

      const response = await app.inject({
        method: "POST",
        url: "/v1/runtime/prepare-context",
        payload: { ...validPreparePayload, memory_mode: "invalid_mode" },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toHaveProperty("error");
    });

    it("rejects empty body with 400", async () => {
      const app = createRuntimeApp([]);
      apps.push(app);

      const response = await app.inject({
        method: "POST",
        url: "/v1/runtime/prepare-context",
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toHaveProperty("error");
    });
  });

  describe("finalize-turn validation", () => {
    it("rejects missing assistant_output with 400", async () => {
      const app = createRuntimeApp([]);
      apps.push(app);
      const { assistant_output, ...payload } = validFinalizePayload;

      const response = await app.inject({
        method: "POST",
        url: "/v1/runtime/finalize-turn",
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toHaveProperty("error");
    });

    it("rejects missing current_input with 400", async () => {
      const app = createRuntimeApp([]);
      apps.push(app);
      const { current_input, ...payload } = validFinalizePayload;

      const response = await app.inject({
        method: "POST",
        url: "/v1/runtime/finalize-turn",
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toHaveProperty("error");
    });

    it("rejects invalid host with 400", async () => {
      const app = createRuntimeApp([]);
      apps.push(app);

      const response = await app.inject({
        method: "POST",
        url: "/v1/runtime/finalize-turn",
        payload: { ...validFinalizePayload, host: "bad_host" },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toHaveProperty("error");
    });
  });

  describe("session-start-context validation", () => {
    it("rejects missing workspace_id with 400", async () => {
      const app = createRuntimeApp([]);
      apps.push(app);
      const { workspace_id, ...payload } = validSessionStartPayload;

      const response = await app.inject({
        method: "POST",
        url: "/v1/runtime/session-start-context",
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toHaveProperty("error");
    });

    it("rejects invalid host with 400", async () => {
      const app = createRuntimeApp([]);
      apps.push(app);

      const response = await app.inject({
        method: "POST",
        url: "/v1/runtime/session-start-context",
        payload: { ...validSessionStartPayload, host: "bad_host" },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toHaveProperty("error");
    });
  });

  describe("boundary conditions", () => {
    it("returns valid response with empty memory store for prepare-context", async () => {
      const app = createRuntimeApp([]);
      apps.push(app);

      const response = await app.inject({
        method: "POST",
        url: "/v1/runtime/prepare-context",
        payload: validPreparePayload,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty("trigger");
      expect(body).toHaveProperty("dependency_status");
      expect(typeof body.trigger).toBe("boolean");
    });

    it("returns valid response with empty memory store for session-start", async () => {
      const app = createRuntimeApp([]);
      apps.push(app);

      const response = await app.inject({
        method: "POST",
        url: "/v1/runtime/session-start-context",
        payload: validSessionStartPayload,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty("dependency_status");
      expect(body).toHaveProperty("additional_context");
    });
  });
});
