import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config.js";
import { createApp } from "../src/app.js";
import { DependencyGuard } from "../src/dependency/dependency-guard.js";
import { InjectionEngine } from "../src/injection/injection-engine.js";
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
  WRITEBACK_LLM_TIMEOUT_MS: 5_000,
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
  INJECTION_RECORD_LIMIT: 4,
  INJECTION_TOKEN_BUDGET: 512,
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
    summary: "当前任务状态：正在验证 Claude Code / Codex 的记忆注入链路。",
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
    summary: "本会话已确认：本轮需要看到宿主请求触发的记忆注入结果。",
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
  async submitCandidates(candidates: WriteBackCandidate[]): Promise<SubmittedWriteBackJob[]> {
    return candidates.map((candidate) => ({
      candidate_summary: candidate.summary,
      status: "accepted_async",
    }));
  }

  async listRecords(): Promise<RecordListPage> {
    return { items: [], total: 0, page: 1, page_size: 20 };
  }

  async patchRecord(_recordId: string, _payload: RecordPatchPayload): Promise<MemoryRecordSnapshot> {
    throw new Error("patchRecord is not used in host memory injection tests");
  }

  async archiveRecord(_recordId: string, _payload: StorageMutationPayload): Promise<MemoryRecordSnapshot> {
    throw new Error("archiveRecord is not used in host memory injection tests");
  }

  async listConflicts(): Promise<MemoryConflictSnapshot[]> {
    return [];
  }

  async resolveConflict(_conflictId: string, _payload: ResolveConflictPayload): Promise<MemoryConflictSnapshot> {
    throw new Error("resolveConflict is not used in host memory injection tests");
  }

  async submitGovernanceExecutions(): Promise<GovernanceExecutionResponseItem[]> {
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

  const service = new RetrievalRuntimeService(
    new TriggerEngine(config, embeddingsClient, readModelRepository, dependencyGuard, logger),
    new QueryEngine(config, readModelRepository, embeddingsClient, dependencyGuard, logger),
    embeddingsClient,
    new InjectionEngine(config),
    new WritebackEngine(config, storageClient, dependencyGuard),
    repository,
    dependencyGuard,
    logger,
    finalizeIdempotencyCache,
    config.EMBEDDING_TIMEOUT_MS,
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

function expectInjectedMemory(body: {
  trigger: boolean;
  memory_packet: { records: Array<{ id: string }>; injection_hint: string } | null;
  injection_block: {
    memory_summary: string;
    memory_records: Array<{ summary: string }>;
    requested_scopes: string[];
    selected_scopes: string[];
  } | null;
  dependency_status: {
    read_model: { status: string };
    embeddings: { status: string };
  };
}) {
  expect(body.trigger).toBe(true);
  expect(body.memory_packet).not.toBeNull();
  expect(body.injection_block).not.toBeNull();
  expect(body.memory_packet?.records).toHaveLength(4);
  expect(body.memory_packet?.injection_hint).toContain("优先");
  expect(body.injection_block?.memory_summary).toContain("偏好与约束");
  expect(body.injection_block?.memory_summary).toContain("当前任务");
  expect(body.injection_block?.memory_records.some((record) => record.summary.includes("默认中文输出"))).toBe(true);
  expect(body.injection_block?.memory_records.some((record) => record.summary.includes("回答简短直接"))).toBe(true);
  expect(body.injection_block?.memory_records.some((record) => record.summary.includes("记忆注入链路"))).toBe(true);
  expect(body.injection_block?.requested_scopes).toEqual(expect.arrayContaining(["workspace", "user", "task", "session"]));
  expect(body.injection_block?.selected_scopes).toEqual(expect.arrayContaining(["workspace", "user", "task", "session"]));
  expect(body.dependency_status.read_model.status).toBe("healthy");
  expect(body.dependency_status.embeddings.status).toBe("healthy");
}

describe("host memory injection", () => {
  it("injects memory for Claude Code prepare-context requests", async () => {
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
        thread_id: "claude-thread-1",
        turn_id: "claude-turn-1",
        phase: "before_response",
        current_input: "上次说过这个仓库默认中文输出，这轮继续按之前的约定处理。",
        cwd: "C:/workspace/work/agent-memory",
        source: "claude_hook",
      },
    });

    expect(response.statusCode).toBe(200);
    expectInjectedMemory(response.json());
  });

  it("injects memory for Codex prepare-context requests", async () => {
    const app = createRuntimeApp();
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/runtime/prepare-context",
      payload: {
        host: "codex_app_server",
        workspace_id: ids.workspace,
        user_id: ids.user,
        session_id: ids.session,
        task_id: ids.task,
        thread_id: "codex-thread-1",
        turn_id: "codex-turn-1",
        phase: "before_response",
        current_input: "之前已经记过我的输出偏好，这次在 Codex 里继续沿用。",
        cwd: "C:/workspace/work/agent-memory",
        source: "codex_proxy",
      },
    });

    expect(response.statusCode).toBe(200);
    expectInjectedMemory(response.json());
  });
});
