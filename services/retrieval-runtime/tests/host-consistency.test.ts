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
    memory_type: "fact_preference",
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
    memory_type: "fact_preference",
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
    summary: "当前任务：正在验证宿主记忆注入一致性。",
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
    summary: "本会话已确认：两个宿主的记忆注入结果应该一致。",
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
    throw new Error("patchRecord is not used in host consistency tests");
  }

  async archiveRecord(
    _recordId: string,
    _payload: StorageMutationPayload,
  ): Promise<MemoryRecordSnapshot> {
    throw new Error("archiveRecord is not used in host consistency tests");
  }

  async listConflicts(): Promise<MemoryConflictSnapshot[]> {
    return [];
  }

  async resolveConflict(
    _conflictId: string,
    _payload: ResolveConflictPayload,
  ): Promise<MemoryConflictSnapshot> {
    throw new Error("resolveConflict is not used in host consistency tests");
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

describe("host consistency across Claude Code and Codex", () => {
  it("prepare-context returns same memory_packet structure for both hosts", async () => {
    const app1 = createRuntimeApp();
    const app2 = createRuntimeApp();
    apps.push(app1, app2);

    const basePayload = {
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      task_id: ids.task,
      phase: "before_response" as const,
      current_input: "继续按之前约定处理",
      cwd: "C:/workspace/work/agent-memory",
    };

    const claudeRes = await app1.inject({
      method: "POST",
      url: "/v1/runtime/prepare-context",
      payload: {
        ...basePayload,
        host: "claude_code_plugin",
        source: "claude_hook",
      },
    });

    const codexRes = await app2.inject({
      method: "POST",
      url: "/v1/runtime/prepare-context",
      payload: {
        ...basePayload,
        host: "codex_app_server",
        source: "codex_proxy",
      },
    });

    expect(claudeRes.statusCode).toBe(200);
    expect(codexRes.statusCode).toBe(200);

    const claudeBody = claudeRes.json();
    const codexBody = codexRes.json();

    // 两者的 trigger 行为一致
    expect(claudeBody.trigger).toBe(codexBody.trigger);

    // memory_packet 结构一致（两者都有或都没有）
    if (claudeBody.memory_packet && codexBody.memory_packet) {
      expect(claudeBody.memory_packet.records.length).toBe(
        codexBody.memory_packet.records.length,
      );
      // 验证记录 ID 集合相同
      const claudeIds = claudeBody.memory_packet.records
        .map((r: any) => r.id)
        .sort();
      const codexIds = codexBody.memory_packet.records
        .map((r: any) => r.id)
        .sort();
      expect(claudeIds).toEqual(codexIds);
    } else {
      expect(claudeBody.memory_packet).toEqual(codexBody.memory_packet);
    }

    // injection_block 格式一致
    if (claudeBody.injection_block && codexBody.injection_block) {
      expect(claudeBody.injection_block.memory_records.length).toBe(
        codexBody.injection_block.memory_records.length,
      );
      expect(claudeBody.injection_block.requested_scopes.sort()).toEqual(
        codexBody.injection_block.requested_scopes.sort(),
      );
    }
  });

  it("session-start-context returns same structure for both hosts", async () => {
    const app1 = createRuntimeApp();
    const app2 = createRuntimeApp();
    apps.push(app1, app2);

    const basePayload = {
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
    };

    const claudeRes = await app1.inject({
      method: "POST",
      url: "/v1/runtime/session-start-context",
      payload: {
        ...basePayload,
        host: "claude_code_plugin",
        source: "claude_hook",
      },
    });

    const codexRes = await app2.inject({
      method: "POST",
      url: "/v1/runtime/session-start-context",
      payload: {
        ...basePayload,
        host: "codex_app_server",
        source: "codex_proxy",
      },
    });

    expect(claudeRes.statusCode).toBe(200);
    expect(codexRes.statusCode).toBe(200);

    const claudeBody = claudeRes.json();
    const codexBody = codexRes.json();

    // additional_context 都存在
    expect(typeof claudeBody.additional_context).toBe("string");
    expect(typeof codexBody.additional_context).toBe("string");

    // dependency_status 结构一致
    expect(claudeBody.dependency_status.read_model.status).toBe(
      codexBody.dependency_status.read_model.status,
    );
    expect(claudeBody.dependency_status.embeddings.status).toBe(
      codexBody.dependency_status.embeddings.status,
    );

    // injection_block 一致性
    if (claudeBody.injection_block && codexBody.injection_block) {
      expect(claudeBody.injection_block.memory_records.length).toBe(
        codexBody.injection_block.memory_records.length,
      );
    }
  });

  it("finalize-turn returns same structure for both hosts", async () => {
    const app1 = createRuntimeApp();
    const app2 = createRuntimeApp();
    apps.push(app1, app2);

    const basePayload = {
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      current_input: "帮我看看这段代码的问题",
      assistant_output: "代码看起来没有问题，结构清晰。",
    };

    const claudeRes = await app1.inject({
      method: "POST",
      url: "/v1/runtime/finalize-turn",
      payload: { ...basePayload, host: "claude_code_plugin" },
    });

    const codexRes = await app2.inject({
      method: "POST",
      url: "/v1/runtime/finalize-turn",
      payload: { ...basePayload, host: "codex_app_server" },
    });

    expect(claudeRes.statusCode).toBe(200);
    expect(codexRes.statusCode).toBe(200);

    const claudeBody = claudeRes.json();
    const codexBody = codexRes.json();

    // 响应结构字段类型一致
    expect(typeof claudeBody.writeback_submitted).toBe("boolean");
    expect(typeof codexBody.writeback_submitted).toBe("boolean");
    expect(typeof claudeBody.candidate_count).toBe("number");
    expect(typeof codexBody.candidate_count).toBe("number");
    expect(typeof claudeBody.degraded).toBe("boolean");
    expect(typeof codexBody.degraded).toBe("boolean");
  });

  it("adapter toTriggerContext output only differs in host field", async () => {
    const { ClaudeCodeAdapter } =
      await import("../src/host-adapters/claude-code-adapter.js");
    const { CodexAppServerAdapter } =
      await import("../src/host-adapters/codex-app-server-adapter.js");

    const input = {
      host: "claude_code_plugin" as const,
      workspace_id: ids.workspace,
      user_id: ids.user,
      session_id: ids.session,
      phase: "before_response" as const,
      current_input: "测试",
      thread_id: "th-1",
      turn_id: "tu-1",
    };

    const claude = new ClaudeCodeAdapter();
    const codex = new CodexAppServerAdapter();

    const claudeCtx = claude.toTriggerContext(input);
    const codexCtx = codex.toTriggerContext({
      ...input,
      host: "codex_app_server" as const,
    });

    // 除 host 外所有字段相同
    expect(claudeCtx.host).toBe("claude_code_plugin");
    expect(codexCtx.host).toBe("codex_app_server");
    expect(claudeCtx.workspace_id).toBe(codexCtx.workspace_id);
    expect(claudeCtx.user_id).toBe(codexCtx.user_id);
    expect(claudeCtx.session_id).toBe(codexCtx.session_id);
    expect(claudeCtx.phase).toBe(codexCtx.phase);
    expect(claudeCtx.current_input).toBe(codexCtx.current_input);
    expect(claudeCtx.thread_id).toBe(codexCtx.thread_id);
    expect(claudeCtx.turn_id).toBe(codexCtx.turn_id);
  });
});
