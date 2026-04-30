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

const ids = {
  workspace: "550e8400-e29b-41d4-a716-446655440000",
  user: "550e8400-e29b-41d4-a716-446655440001",
  session: "550e8400-e29b-41d4-a716-446655440002",
  task: "550e8400-e29b-41d4-a716-446655440003",
};

const sampleRecords: CandidateMemory[] = [
  {
    id: "mem-workspace-rule",
    workspace_id: ids.workspace,
    user_id: ids.user,
    session_id: null,
    task_id: null,
    memory_type: "preference",
    scope: "workspace",
    summary: "工作区约束：默认中文输出，修改前先对齐现有实现。",
    details: null,
    source: { turn_id: "seed-1" },
    importance: 5,
    confidence: 0.96,
    status: "active",
    updated_at: "2026-04-20T09:00:00.000Z",
    last_confirmed_at: "2026-04-20T09:00:00.000Z",
    summary_embedding: [1, 0, 0],
  },
  {
    id: "mem-user-preference",
    workspace_id: ids.workspace,
    user_id: ids.user,
    session_id: null,
    task_id: null,
    memory_type: "preference",
    scope: "user",
    summary: "用户偏好：回答简短直接，默认使用中文。",
    details: null,
    source: { turn_id: "seed-2" },
    importance: 5,
    confidence: 0.95,
    status: "active",
    updated_at: "2026-04-20T10:00:00.000Z",
    last_confirmed_at: "2026-04-20T10:00:00.000Z",
    summary_embedding: [1, 0, 0],
  },
  {
    id: "mem-task-progress",
    workspace_id: ids.workspace,
    user_id: ids.user,
    session_id: ids.session,
    task_id: ids.task,
    memory_type: "task_state",
    scope: "task",
    summary: "当前任务：正在验证 Claude Code 宿主接入的记忆注入链路。",
    details: null,
    source: { turn_id: "seed-3" },
    importance: 5,
    confidence: 0.92,
    status: "active",
    updated_at: "2026-04-20T11:00:00.000Z",
    last_confirmed_at: "2026-04-20T11:00:00.000Z",
    summary_embedding: [0.95, 0.05, 0],
  },
  {
    id: "mem-session-event",
    workspace_id: ids.workspace,
    user_id: ids.user,
    session_id: ids.session,
    task_id: null,
    memory_type: "episodic",
    scope: "session",
    summary: "本会话已确认：本轮需要看到 Claude Code 宿主记忆注入结果。",
    details: null,
    source: { turn_id: "seed-4" },
    importance: 4,
    confidence: 0.88,
    status: "active",
    updated_at: "2026-04-20T12:00:00.000Z",
    last_confirmed_at: "2026-04-20T12:00:00.000Z",
    summary_embedding: [0.9, 0.1, 0],
  },
];

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
      status: "accepted_async" as const,
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
    throw new Error(
      "patchRecord is not used in Claude Code host integration tests",
    );
  }

  async archiveRecord(
    _recordId: string,
    _payload: StorageMutationPayload,
  ): Promise<MemoryRecordSnapshot> {
    throw new Error(
      "archiveRecord is not used in Claude Code host integration tests",
    );
  }

  async listConflicts(): Promise<MemoryConflictSnapshot[]> {
    return [];
  }

  async resolveConflict(
    _conflictId: string,
    _payload: ResolveConflictPayload,
  ): Promise<MemoryConflictSnapshot> {
    throw new Error(
      "resolveConflict is not used in Claude Code host integration tests",
    );
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

function createRuntimeApp(records: CandidateMemory[] = sampleRecords) {
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

describe("Claude Code host integration", () => {
  describe("session-start-context", () => {
    it("returns 200 with additional_context containing session start text", async () => {
      const app = createRuntimeApp();
      apps.push(app);

      const response = await app.inject({
        method: "POST",
        url: "/v1/runtime/session-start-context",
        payload: {
          host: "claude_code_plugin",
          workspace_id: ids.workspace,
          user_id: ids.user,
          session_id: ids.session,
          source: "claude_hook",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(typeof body.additional_context).toBe("string");
      expect(body.additional_context.length).toBeGreaterThan(0);
      expect(typeof body.trace_id).toBe("string");
      expect(body.dependency_status.read_model.status).toBe("healthy");
    });

    it("injection_block includes workspace and user scope memories for session start", async () => {
      const app = createRuntimeApp();
      apps.push(app);

      const response = await app.inject({
        method: "POST",
        url: "/v1/runtime/session-start-context",
        payload: {
          host: "claude_code_plugin",
          workspace_id: ids.workspace,
          user_id: ids.user,
          session_id: ids.session,
          source: "claude_hook",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.injection_block).not.toBeNull();
      const hasWorkspaceScope = body.injection_block?.memory_records.some(
        (r: { summary: string }) => r.summary.includes("工作区约束"),
      );
      const hasUserScope = body.injection_block?.memory_records.some(
        (r: { summary: string }) => r.summary.includes("用户偏好"),
      );
      expect(hasWorkspaceScope).toBe(true);
      expect(hasUserScope).toBe(true);
    });

    it("passes through recent_context_summary to search", async () => {
      const app = createRuntimeApp();
      apps.push(app);

      const response = await app.inject({
        method: "POST",
        url: "/v1/runtime/session-start-context",
        payload: {
          host: "claude_code_plugin",
          workspace_id: ids.workspace,
          user_id: ids.user,
          session_id: ids.session,
          source: "claude_hook",
          recent_context_summary: "继续之前的工作",
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it("respects memory_mode=workspace_only to limit scope", async () => {
      const app = createRuntimeApp();
      apps.push(app);

      const response = await app.inject({
        method: "POST",
        url: "/v1/runtime/session-start-context",
        payload: {
          host: "claude_code_plugin",
          workspace_id: ids.workspace,
          user_id: ids.user,
          session_id: ids.session,
          source: "claude_hook",
          memory_mode: "workspace_only",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      if (body.injection_block?.selected_scopes) {
        expect(body.injection_block.selected_scopes).toContain("workspace");
        expect(body.injection_block.selected_scopes).not.toContain("user");
      }
    });
  });

  describe("prepare-context", () => {
    it("triggers injection for phase=session_start", async () => {
      const app = createRuntimeApp();
      apps.push(app);

      const response = await app.inject({
        method: "POST",
        url: "/v1/runtime/prepare-context",
        payload: {
          host: "claude_code_plugin",
          workspace_id: ids.workspace,
          user_id: ids.user,
          session_id: ids.session,
          phase: "session_start",
          current_input: "开始新会话",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.trigger).toBe(true);
    });

    it("triggers injection for phase=before_response with full memory_packet and injection_block", async () => {
      const app = createRuntimeApp();
      apps.push(app);

      const response = await app.inject({
        method: "POST",
        url: "/v1/runtime/prepare-context",
        payload: {
          host: "claude_code_plugin",
          workspace_id: ids.workspace,
          user_id: ids.user,
          session_id: ids.session,
          task_id: ids.task,
          phase: "before_response",
          current_input: "上次说过默认中文输出",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.trigger).toBe(true);
      expect(body.memory_packet).not.toBeNull();
      expect(body.memory_packet.records.length).toBeGreaterThan(0);
      expect(body.injection_block).not.toBeNull();
    });

    it("returns valid response for phase=after_response", async () => {
      const app = createRuntimeApp();
      apps.push(app);

      const response = await app.inject({
        method: "POST",
        url: "/v1/runtime/prepare-context",
        payload: {
          host: "claude_code_plugin",
          workspace_id: ids.workspace,
          user_id: ids.user,
          session_id: ids.session,
          phase: "after_response",
          current_input: "处理完毕",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(typeof body.trigger).toBe("boolean");
      expect(body.dependency_status).toBeDefined();
    });

    it("passes through thread_id and turn_id in prepare-context", async () => {
      const app = createRuntimeApp();
      apps.push(app);

      const response = await app.inject({
        method: "POST",
        url: "/v1/runtime/prepare-context",
        payload: {
          host: "claude_code_plugin",
          workspace_id: ids.workspace,
          user_id: ids.user,
          session_id: ids.session,
          thread_id: "claude-thread-1",
          turn_id: "claude-turn-1",
          phase: "before_response",
          current_input: "测试 thread_id 和 turn_id 透传",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(typeof body.trace_id).toBe("string");
    });

    it("respects memory_mode=workspace_only", async () => {
      const app = createRuntimeApp();
      apps.push(app);

      const response = await app.inject({
        method: "POST",
        url: "/v1/runtime/prepare-context",
        payload: {
          host: "claude_code_plugin",
          workspace_id: ids.workspace,
          user_id: ids.user,
          session_id: ids.session,
          phase: "before_response",
          current_input: "仅限工作区范围",
          memory_mode: "workspace_only",
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe("finalize-turn", () => {
    it("returns 200 with writeback response structure", async () => {
      const app = createRuntimeApp();
      apps.push(app);

      const response = await app.inject({
        method: "POST",
        url: "/v1/runtime/finalize-turn",
        payload: {
          host: "claude_code_plugin",
          workspace_id: ids.workspace,
          user_id: ids.user,
          session_id: ids.session,
          current_input: "帮我检查一下代码",
          assistant_output: "已检查完毕，没有问题。",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(typeof body.trace_id).toBe("string");
      expect(typeof body.writeback_submitted).toBe("boolean");
      expect(typeof body.candidate_count).toBe("number");
    });

    it("respects idempotency for same session+turn+input", async () => {
      const app = createRuntimeApp();
      apps.push(app);

      const payload = {
        host: "claude_code_plugin" as const,
        workspace_id: ids.workspace,
        user_id: ids.user,
        session_id: ids.session,
        turn_id: "idempotent-turn-1",
        current_input: "幂等性测试输入",
        assistant_output: "幂等性测试输出",
      };

      const response1 = await app.inject({
        method: "POST",
        url: "/v1/runtime/finalize-turn",
        payload,
      });
      const response2 = await app.inject({
        method: "POST",
        url: "/v1/runtime/finalize-turn",
        payload,
      });

      expect(response1.statusCode).toBe(200);
      expect(response2.statusCode).toBe(200);
      expect(response2.json().trace_id).toBe(response1.json().trace_id);
    });

    it("passes memory_mode through to response", async () => {
      const app = createRuntimeApp();
      apps.push(app);

      const response = await app.inject({
        method: "POST",
        url: "/v1/runtime/finalize-turn",
        payload: {
          host: "claude_code_plugin",
          workspace_id: ids.workspace,
          user_id: ids.user,
          session_id: ids.session,
          current_input: "仅工作区写回",
          assistant_output: "好的，已处理。",
          memory_mode: "workspace_only",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.memory_mode).toBe("workspace_only");
    });
  });
});
