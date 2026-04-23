import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { spawn, type ChildProcess } from "node:child_process";
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
// Runtime 配置 & stub
// ---------------------------------------------------------------------------

const config: AppConfig = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 0,
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

const sampleRecords: CandidateMemory[] = [
  {
    id: "mem-codex-e2e-workspace",
    workspace_id: "550e8400-e29b-41d4-a716-446655440000",
    user_id: "550e8400-e29b-41d4-a716-446655440001",
    session_id: null,
    task_id: null,
    memory_type: "fact_preference",
    scope: "workspace",
    summary: "Codex E2E 验证：工作区规则。",
    details: null,
    source: { turn_id: "codex-e2e-seed-1" },
    importance: 5,
    confidence: 0.95,
    status: "active",
    updated_at: "2026-04-20T09:00:00.000Z",
    last_confirmed_at: "2026-04-20T09:00:00.000Z",
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
    throw new Error("patchRecord not used in Codex E2E tests");
  }

  async archiveRecord(
    _recordId: string,
    _payload: StorageMutationPayload,
  ): Promise<MemoryRecordSnapshot> {
    throw new Error("archiveRecord not used in Codex E2E tests");
  }

  async listConflicts(): Promise<MemoryConflictSnapshot[]> {
    return [];
  }

  async resolveConflict(
    _conflictId: string,
    _payload: ResolveConflictPayload,
  ): Promise<MemoryConflictSnapshot> {
    throw new Error("resolveConflict not used in Codex E2E tests");
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
// 自启动 runtime 实例
// ---------------------------------------------------------------------------

const proxyScript = path.resolve(
  process.cwd(),
  "host-adapters/memory-codex-adapter/bin/memory-codex-proxy.mjs",
);
const mcpScript = path.resolve(
  process.cwd(),
  "host-adapters/memory-codex-adapter/mcp/memory-mcp-server.mjs",
);

let runtimeBaseUrl = "";
let app: ReturnType<typeof createRuntimeApp>;

beforeAll(async () => {
  app = createRuntimeApp();
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  runtimeBaseUrl = address;
});

afterAll(async () => {
  if (app) {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type WsMessageData = Buffer | ArrayBuffer | Buffer[] | Uint8Array;

function readJsonRpc(ws: WebSocket) {
  return new Promise<any>((resolve, reject) => {
    const onMessage = (data: WsMessageData) => {
      cleanup();
      resolve(JSON.parse(String(data)));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      ws.off("message", onMessage);
      ws.off("error", onError);
    };
    ws.on("message", onMessage);
    ws.on("error", onError);
  });
}

/**
 * 在随机端口启动一个 HTTP server，返回 { server, wss, port }
 */
function startUpstreamServer(): Promise<{
  server: http.Server;
  wss: WebSocketServer;
  port: number;
}> {
  return new Promise((resolve) => {
    const server = http.createServer();
    const wss = new WebSocketServer({ server });

    // 监听端口 0 让系统分配随机端口
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, wss, port });
    });
  });
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe("Codex 本地宿主链路", () => {
  let upstreamServer: http.Server | null = null;
  let upstreamWss: WebSocketServer | null = null;
  let proxyProcess: ChildProcess | null = null;

  afterEach(async () => {
    proxyProcess?.kill();
    proxyProcess = null;

    await new Promise<void>((resolve) => {
      if (!upstreamWss) {
        resolve();
        return;
      }
      upstreamWss.close(() => resolve());
      upstreamWss = null;
    });

    await new Promise<void>((resolve) => {
      if (!upstreamServer) {
        resolve();
        return;
      }
      upstreamServer.close(() => resolve());
      upstreamServer = null;
    });
  });

  it("proxy 可连接真实 runtime，并把会话流量转成注入请求", async () => {
    // 启动上游 mock WS 服务器（随机端口）
    const upstream = await startUpstreamServer();
    upstreamServer = upstream.server;
    upstreamWss = upstream.wss;

    const upstreamMessages: any[] = [];
    upstreamWss.on("connection", (socket: WebSocket) => {
      socket.on("message", (data: WsMessageData) => {
        const message = JSON.parse(String(data));
        upstreamMessages.push(message);

        if (message.method === "conversation/start") {
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: {
                conversationId: "conv-local-001",
              },
            }),
          );
          return;
        }

        if (message.method === "conversation/respond") {
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "conversation/item",
              params: {
                item: {
                  type: "agentMessage",
                  text: "本地 Codex 宿主链路验证通过。",
                },
              },
            }),
          );
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: {
                done: true,
              },
            }),
          );
        }
      });
    });

    // 为 proxy 监听找一个空闲端口
    const proxyPortServer = http.createServer();
    const proxyPort = await new Promise<number>((resolve) => {
      proxyPortServer.listen(0, "127.0.0.1", () => {
        const addr = proxyPortServer.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        proxyPortServer.close(() => resolve(port));
      });
    });

    const proxyListenUrl = `ws://127.0.0.1:${proxyPort}`;
    const upstreamUrl = `ws://127.0.0.1:${upstream.port}`;

    proxyProcess = spawn(process.execPath, [proxyScript], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MEMORY_RUNTIME_BASE_URL: runtimeBaseUrl,
        MEMORY_CODEX_PROXY_LISTEN_URL: proxyListenUrl,
        CODEX_APP_SERVER_URL: upstreamUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // 等待 proxy 启动
    await wait(1200);

    const client = new WebSocket(proxyListenUrl);
    await new Promise<void>((resolve, reject) => {
      client.once("open", () => resolve());
      client.once("error", reject);
    });

    client.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "conversation/start",
        params: {
          cwd: process.cwd(),
          threadId: "thread-local-001",
          input: [{ type: "text", text: "请验证本地 Codex 宿主链路" }],
        },
      }),
    );

    const startResponse = await readJsonRpc(client);
    expect(startResponse.id).toBe(1);

    client.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "conversation/respond",
        params: {
          threadId: "thread-local-001",
          turnId: "turn-local-001",
          input: [{ type: "text", text: "继续说明记忆注入情况" }],
        },
      }),
    );

    const injectedMessage = await readJsonRpc(client);
    expect(injectedMessage.method).toBeDefined();

    const respondDone = await readJsonRpc(client);
    expect(respondDone.id).toBe(2);

    expect(
      upstreamMessages.some(
        (message) => message.method === "conversation/start",
      ),
    ).toBe(true);
    expect(
      upstreamMessages.some(
        (message) => message.method === "conversation/respond",
      ),
    ).toBe(true);

    client.close();
  });

  it("mcp server 可通过真实 runtime 返回工具列表", async () => {
    const child = spawn(process.execPath, [mcpScript], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MEMORY_RUNTIME_BASE_URL: runtimeBaseUrl,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const lines: string[] = [];
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      lines.push(...String(chunk).split(/\r?\n/).filter(Boolean));
    });

    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`,
    );
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`,
    );
    child.stdin.end();

    await new Promise<void>((resolve) => child.on("close", () => resolve()));

    const responses = lines.map((line) => JSON.parse(line));
    const toolList = responses.find((item) => item.id === 2);
    expect(Array.isArray(toolList?.result?.tools)).toBe(true);
    expect(
      toolList.result.tools.some(
        (tool: { name: string }) => tool.name === "memory_search",
      ),
    ).toBe(true);
  });
});
