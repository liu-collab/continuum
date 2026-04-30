import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import pino from "pino";

import type { AppConfig } from "../../src/config.js";
import { createApp } from "../../src/app.js";
import { DependencyGuard } from "../../src/dependency/dependency-guard.js";
import { InjectionEngine } from "../../src/injection/injection-engine.js";
import { createMemoryOrchestrator } from "../../src/memory-orchestrator/index.js";
import { InMemoryRuntimeRepository } from "../../src/observability/in-memory-runtime-repository.js";
import type { EmbeddingsClient } from "../../src/query/embeddings-client.js";
import { InMemoryReadModelRepository } from "../../src/query/in-memory-read-model-repository.js";
import { QueryEngine } from "../../src/query/query-engine.js";
import { RetrievalRuntimeService } from "../../src/runtime-service.js";
import type {
  CandidateMemory,
  GovernanceExecutionResponseItem,
  MemoryConflictSnapshot,
  MemoryRecordSnapshot,
  SubmittedWriteBackJob,
  WriteProjectionStatusSnapshot,
  WriteBackCandidate,
} from "../../src/shared/types.js";
import { TriggerEngine } from "../../src/trigger/trigger-engine.js";
import { FinalizeIdempotencyCache } from "../../src/writeback/finalize-idempotency-cache.js";
import type {
  RecordListPage,
  RecordPatchPayload,
  ResolveConflictPayload,
  StorageMutationPayload,
  StorageWritebackClient,
} from "../../src/writeback/storage-client.js";
import { WritebackEngine } from "../../src/writeback/writeback-engine.js";

// ---------------------------------------------------------------------------
// Runtime 配置 & stub（与 host-integration-claude-code.test.ts 一致）
// ---------------------------------------------------------------------------

const config: AppConfig = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 0, // 随机端口
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
};

const sampleRecords: CandidateMemory[] = [
  {
    id: "mem-e2e-workspace-rule",
    workspace_id: ids.workspace,
    user_id: ids.user,
    session_id: null,
    task_id: null,
    memory_type: "preference",
    scope: "workspace",
    summary: "E2E 验证：工作区约束，默认中文输出。",
    details: null,
    source: { turn_id: "e2e-seed-1" },
    importance: 5,
    confidence: 0.96,
    status: "active",
    updated_at: "2026-04-20T09:00:00.000Z",
    last_confirmed_at: "2026-04-20T09:00:00.000Z",
    summary_embedding: [1, 0, 0],
  },
  {
    id: "mem-e2e-user-pref",
    workspace_id: ids.workspace,
    user_id: ids.user,
    session_id: null,
    task_id: null,
    memory_type: "preference",
    scope: "user",
    summary: "E2E 验证：用户偏好，回答简短。",
    details: null,
    source: { turn_id: "e2e-seed-2" },
    importance: 5,
    confidence: 0.95,
    status: "active",
    updated_at: "2026-04-20T10:00:00.000Z",
    last_confirmed_at: "2026-04-20T10:00:00.000Z",
    summary_embedding: [1, 0, 0],
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
    throw new Error("patchRecord not used in Claude E2E tests");
  }

  async archiveRecord(
    _recordId: string,
    _payload: StorageMutationPayload,
  ): Promise<MemoryRecordSnapshot> {
    throw new Error("archiveRecord not used in Claude E2E tests");
  }

  async listConflicts(): Promise<MemoryConflictSnapshot[]> {
    return [];
  }

  async resolveConflict(
    _conflictId: string,
    _payload: ResolveConflictPayload,
  ): Promise<MemoryConflictSnapshot> {
    throw new Error("resolveConflict not used in Claude E2E tests");
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

// ---------------------------------------------------------------------------
// 测试：启动 in-process runtime，通过真实 bridge 子进程走完整链路
// ---------------------------------------------------------------------------

const bridgeScript = path.resolve(
  process.cwd(),
  "host-adapters/memory-claude-plugin/bin/memory-bridge.mjs",
);

let runtimeBaseUrl = "";
let app: ReturnType<typeof createRuntimeApp>;

beforeAll(async () => {
  app = createRuntimeApp();
  // 监听随机端口
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  runtimeBaseUrl = address; // e.g. "http://127.0.0.1:xxxxx"
});

afterAll(async () => {
  if (app) {
    await app.close();
  }
});

interface BridgeResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function runBridge(
  mode: "session-start" | "prepare-context" | "finalize-turn",
  event: Record<string, unknown>,
): Promise<BridgeResult> {
  return new Promise<BridgeResult>((resolve, reject) => {
    const child = spawn(process.execPath, [bridgeScript, mode], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MEMORY_RUNTIME_BASE_URL: runtimeBaseUrl,
        MEMORY_USER_ID: ids.user,
        MEMORY_WORKSPACE_ID: ids.workspace,
        MEMORY_SESSION_ID: ids.session,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode });
    });

    child.stdin.write(JSON.stringify(event));
    child.stdin.end();
  });
}

/**
 * 断言 bridge 子进程成功退出，失败时打印 stdout/stderr 方便排查。
 */
function expectBridgeSuccess(result: BridgeResult) {
  expect(
    result.exitCode,
    `bridge 非零退出\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  ).toBe(0);
}

describe("Claude 本地宿主链路", () => {
  it("session-start 可通过真实 bridge 访问 runtime", async () => {
    const result = await runBridge("session-start", {
      session_id: ids.session,
      cwd: process.cwd(),
      user_id: ids.user,
      workspace_id: ids.workspace,
      source: "claude_hook",
      recent_context_summary: "本地 Claude 宿主 session start 验证",
    });

    expectBridgeSuccess(result);
    const payload = JSON.parse(result.stdout);
    expect(payload.hookSpecificOutput?.hookEventName).toBe("SessionStart");
    expect(typeof payload.traceId).toBe("string");
  });

  it("prepare-context 可通过真实 bridge 返回注入内容", async () => {
    const result = await runBridge("prepare-context", {
      session_id: ids.session,
      turn_id: "local-turn-prepare-001",
      cwd: process.cwd(),
      user_id: ids.user,
      workspace_id: ids.workspace,
      source: "claude_hook",
      phase: "before_response",
      user_prompt: "请读取当前本地宿主 E2E 测试链路并说明是否命中记忆",
    });

    expectBridgeSuccess(result);
    const payload = JSON.parse(result.stdout);
    expect(payload.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
    expect(payload).toHaveProperty("memoryPacketIds");
  });

  it("finalize-turn 可通过真实 bridge 提交轮次收尾", async () => {
    const result = await runBridge("finalize-turn", {
      session_id: ids.session,
      turn_id: "local-turn-finalize-001",
      cwd: process.cwd(),
      user_id: ids.user,
      workspace_id: ids.workspace,
      source: "claude_hook",
      user_prompt: "请帮我记录这次本地 Claude 验证",
      assistant_final: "已完成本地 Claude 验证说明。",
      tool_trace_summary: "local-e2e: bridge finalize",
    });

    expectBridgeSuccess(result);
    const payload = JSON.parse(result.stdout);
    expect(payload.hookSpecificOutput?.hookEventName).toBe("Stop");
    expect(typeof payload.candidateCount).toBe("number");
  });
});
