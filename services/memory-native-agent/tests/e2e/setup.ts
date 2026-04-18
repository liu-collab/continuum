import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { FastifyInstance } from "fastify";

import { createServer } from "../../src/server.js";
import type { AgentConfig } from "../../src/config/index.js";

type RuntimeAppModule = { createApp(service: unknown): FastifyInstance };
type RuntimeRepositoryModule = { InMemoryRuntimeRepository: new () => { getRuns(filters?: Record<string, unknown>): Promise<Record<string, unknown>> } };
type RuntimeServiceModule = { RetrievalRuntimeService: new (...args: unknown[]) => unknown };
type TriggerModule = { TriggerEngine: new (...args: unknown[]) => unknown };
type QueryModule = { QueryEngine: new (...args: unknown[]) => unknown };
type InjectionModule = { InjectionEngine: new (...args: unknown[]) => unknown };
type WritebackModule = { WritebackEngine: new (...args: unknown[]) => unknown };
type DependencyModule = { DependencyGuard: new (...args: unknown[]) => unknown };
type StorageClientModule = { HttpStorageWritebackClient: new (...args: unknown[]) => unknown };
type StorageAppModule = { createApp(service: unknown): FastifyInstance };
type StorageServiceModule = { createStorageService(input: Record<string, unknown>): RunningE2eStack["storageService"] };
type StorageMemoryRepoModule = { createMemoryRepositories(): unknown };

type MemoryMode = "workspace_only" | "workspace_plus_global";
type Scope = "workspace" | "user" | "task" | "session";
type RecordStatus = "active" | "pending_confirmation" | "superseded" | "archived" | "deleted";

export interface E2eCandidateMemory {
  id: string;
  workspace_id: string;
  user_id: string;
  session_id: string | null;
  task_id: string | null;
  memory_type: "fact_preference" | "task_state" | "episodic";
  scope: Scope;
  summary: string;
  details: Record<string, unknown> | null;
  source: Record<string, unknown> | null;
  importance: number;
  confidence: number;
  status: RecordStatus;
  updated_at: string;
  last_confirmed_at: string | null;
  summary_embedding: number[];
}

export interface TestIds {
  workspace: string;
  user: string;
  task: string;
}

export interface RunningE2eStack {
  ids: TestIds;
  homeDir: string;
  workspaceDir: string;
  mna: ReturnType<typeof createServer>;
  runtimeApp?: FastifyInstance;
  runtimeRepository?: {
    getRuns(filters?: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  storageApp?: FastifyInstance;
  storageService?: {
    processWriteJobs(): Promise<number>;
    listWriteJobs(limit?: number): Promise<Array<Record<string, unknown>>>;
    listRecords(filters: Record<string, unknown>): Promise<{ items: Array<Record<string, unknown>> }>;
  };
  stopStorage(): Promise<void>;
  restartStorage(): Promise<void>;
  invalidateRecord(recordId: string, input?: {
    actor_type?: "system" | "user" | "operator";
    actor_id?: string;
    reason?: string;
  }): Promise<Record<string, unknown>>;
  close(): Promise<void>;
  workerDrain(): Promise<void>;
}

const DEFAULT_IDS: TestIds = {
  workspace: "550e8400-e29b-41d4-a716-446655440000",
  user: "550e8400-e29b-41d4-a716-446655440001",
  task: "550e8400-e29b-41d4-a716-446655440003",
};

const RUNTIME_BASE_CONFIG = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 0,
  LOG_LEVEL: "silent",
  DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/continuum_test",
  READ_MODEL_SCHEMA: "storage_shared_v1",
  READ_MODEL_TABLE: "memory_read_model_v1",
  RUNTIME_SCHEMA: "runtime_private",
  STORAGE_WRITEBACK_URL: "http://127.0.0.1:3001",
  EMBEDDING_BASE_URL: "http://127.0.0.1:8090/v1",
  EMBEDDING_MODEL: "text-embedding-3-small",
  EMBEDDING_API_KEY: "test-key",
  WRITEBACK_LLM_MODEL: "claude-haiku-4-5-20251001",
  WRITEBACK_LLM_TIMEOUT_MS: 5_000,
  WRITEBACK_MAX_CANDIDATES: 3,
  QUERY_TIMEOUT_MS: 100,
  STORAGE_TIMEOUT_MS: 100,
  EMBEDDING_TIMEOUT_MS: 100,
  QUERY_CANDIDATE_LIMIT: 30,
  PACKET_RECORD_LIMIT: 10,
  INJECTION_RECORD_LIMIT: 4,
  INJECTION_TOKEN_BUDGET: 512,
  SEMANTIC_TRIGGER_THRESHOLD: 0.72,
  IMPORTANCE_THRESHOLD_SESSION_START: 4,
  IMPORTANCE_THRESHOLD_DEFAULT: 3,
  IMPORTANCE_THRESHOLD_SEMANTIC: 4,
} as const;

const REPO_ROOT = path.resolve(process.cwd(), "..", "..");

async function importRuntimeAppModule(): Promise<RuntimeAppModule> {
  return import(pathToFileURL(path.join(REPO_ROOT, "services/retrieval-runtime/src/app.ts")).href) as Promise<RuntimeAppModule>;
}

async function importRuntimeRepositoryModule(): Promise<RuntimeRepositoryModule> {
  return import(
    pathToFileURL(path.join(REPO_ROOT, "services/retrieval-runtime/src/observability/in-memory-runtime-repository.ts")).href
  ) as Promise<RuntimeRepositoryModule>;
}

async function importRuntimeServiceModule(): Promise<RuntimeServiceModule> {
  return import(
    pathToFileURL(path.join(REPO_ROOT, "services/retrieval-runtime/src/runtime-service.ts")).href
  ) as Promise<RuntimeServiceModule>;
}

async function importTriggerModule(): Promise<TriggerModule> {
  return import(pathToFileURL(path.join(REPO_ROOT, "services/retrieval-runtime/src/trigger/trigger-engine.ts")).href) as Promise<TriggerModule>;
}

async function importQueryModule(): Promise<QueryModule> {
  return import(pathToFileURL(path.join(REPO_ROOT, "services/retrieval-runtime/src/query/query-engine.ts")).href) as Promise<QueryModule>;
}

async function importInjectionModule(): Promise<InjectionModule> {
  return import(pathToFileURL(path.join(REPO_ROOT, "services/retrieval-runtime/src/injection/injection-engine.ts")).href) as Promise<InjectionModule>;
}

async function importWritebackModule(): Promise<WritebackModule> {
  return import(
    pathToFileURL(path.join(REPO_ROOT, "services/retrieval-runtime/src/writeback/writeback-engine.ts")).href
  ) as Promise<WritebackModule>;
}

async function importDependencyModule(): Promise<DependencyModule> {
  return import(
    pathToFileURL(path.join(REPO_ROOT, "services/retrieval-runtime/src/dependency/dependency-guard.ts")).href
  ) as Promise<DependencyModule>;
}

async function importStorageClientModule(): Promise<StorageClientModule> {
  return import(
    pathToFileURL(path.join(REPO_ROOT, "services/retrieval-runtime/src/writeback/storage-client.ts")).href
  ) as Promise<StorageClientModule>;
}

async function importStorageAppModule(): Promise<StorageAppModule> {
  return import(pathToFileURL(path.join(REPO_ROOT, "services/storage/src/api/app.ts")).href) as Promise<StorageAppModule>;
}

async function importStorageServiceModule(): Promise<StorageServiceModule> {
  return import(pathToFileURL(path.join(REPO_ROOT, "services/storage/src/services.ts")).href) as Promise<StorageServiceModule>;
}

async function importStorageMemoryRepoModule(): Promise<StorageMemoryRepoModule> {
  return import(pathToFileURL(path.join(REPO_ROOT, "services/storage/tests/memory-repositories.ts")).href) as Promise<StorageMemoryRepoModule>;
}

class DeterministicEmbeddingsClient {
  async embedText(text: string): Promise<number[]> {
    const normalized = text.toLowerCase();
    if (normalized.includes("typescript")) {
      return [1, 0, 0];
    }
    if (normalized.includes("中文")) {
      return [0.95, 0.05, 0];
    }
    return [0.8, 0.2, 0];
  }
}

class StorageReadModelRepository {
  constructor(
    private readonly getStorageService: () =>
      | {
          listRecords(filters: Record<string, unknown>): Promise<{ items: Array<Record<string, unknown>> }>;
        }
      | undefined,
    private readonly isStorageAvailable: () => boolean,
  ) {}

  async searchCandidates(query: {
    workspace_id: string;
    user_id: string;
    session_id: string;
    task_id?: string;
    scope_filter: Scope[];
    memory_type_filter: Array<"fact_preference" | "task_state" | "episodic">;
    status_filter: RecordStatus[];
    importance_threshold: number;
    candidate_limit: number;
  }) {
    if (!this.isStorageAvailable()) {
      throw new Error("storage unavailable");
    }
    const filters = {
      workspace_id: query.workspace_id,
      page: 1,
      page_size: 100,
    };
    const storageService = this.getStorageService();
    if (!storageService) {
      throw new Error("storage unavailable");
    }
    const result = await storageService.listRecords(filters);
    return result.items
      .filter((record) => query.status_filter.includes(record.status as RecordStatus))
      .filter((record) => query.scope_filter.includes(record.scope as Scope))
      .filter((record) => query.memory_type_filter.includes(record.memory_type as E2eCandidateMemory["memory_type"]))
      .filter((record) => Number(record.importance ?? 0) >= query.importance_threshold)
      .filter((record) => {
        if (record.scope === "workspace") {
          return record.workspace_id === query.workspace_id;
        }
        if (record.scope === "user") {
          return record.user_id === query.user_id;
        }
        if (record.scope === "task") {
          return record.workspace_id === query.workspace_id && record.task_id === query.task_id;
        }
        if (record.scope === "session") {
          return record.workspace_id === query.workspace_id && record.session_id === query.session_id;
        }
        return false;
      })
      .map((record) => ({
        id: String(record.id),
        workspace_id: String(record.workspace_id),
        user_id: String(record.user_id),
        session_id: record.session_id ? String(record.session_id) : null,
        task_id: record.task_id ? String(record.task_id) : null,
        memory_type: record.memory_type as E2eCandidateMemory["memory_type"],
        scope: record.scope as Scope,
        summary: String(record.summary),
        details: (record.details_json as Record<string, unknown> | null) ?? null,
        source: {
          service_name: record.created_by_service,
          source_type: record.source_type,
          source_ref: record.source_ref,
        },
        importance: Number(record.importance),
        confidence: Number(record.confidence),
        status: record.status as RecordStatus,
        updated_at: String(record.updated_at),
        last_confirmed_at: record.last_confirmed_at ? String(record.last_confirmed_at) : null,
        summary_embedding: summaryToVector(String(record.summary)),
      }))
      .slice(0, query.candidate_limit);
  }
}

function summaryToVector(summary: string): number[] {
  const normalized = summary.toLowerCase();
  if (normalized.includes("typescript")) {
    return [1, 0, 0];
  }
  if (normalized.includes("中文")) {
    return [0.95, 0.05, 0];
  }
  return [0.8, 0.2, 0];
}

async function startFastify(app: FastifyInstance, port = 0) {
  await app.listen({ host: "127.0.0.1", port });
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("server address unavailable");
  }
  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
    port: address.port,
  };
}

async function startStubProviderServer() {
  const { default: Fastify } = await import("fastify");
  const app = Fastify({ logger: false });

  app.post("/api/chat", async (request, reply) => {
    const body = request.body as {
      stream?: boolean;
      messages?: Array<{ role: string; content: string }>;
    };
    const messages = body.messages ?? [];
    const lastUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
    const injectionMessage = messages.find(
      (message) => message.role === "system" && typeof message.content === "string" && message.content.includes("<memory_injection"),
    )?.content ?? "";
    const replyText = buildProviderReply(lastUserMessage, injectionMessage);

    if (body.stream) {
      reply.type("application/x-ndjson");
      return [
        JSON.stringify({
          model: "test-model",
          message: {
            role: "assistant",
            content: replyText,
          },
          done: false,
        }),
        JSON.stringify({
          model: "test-model",
          done: true,
          done_reason: "stop",
          prompt_eval_count: 16,
          eval_count: 8,
        }),
      ].join("\n");
    }

    return {
      model: "test-model",
      message: {
        role: "assistant",
        content: replyText,
      },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 16,
      eval_count: 8,
    };
  });

  return startFastify(app);
}

function buildProviderReply(lastUserMessage: string, injectionMessage: string): string {
  const normalizedInjection = injectionMessage.toLowerCase();
  if (lastUserMessage.includes("我偏好什么")) {
    if (normalizedInjection.includes("typescript")) {
      return "你偏好使用 TypeScript。";
    }
    return "当前没有恢复到相关偏好。";
  }
  if (lastUserMessage.includes("记住") || lastUserMessage.includes("偏好")) {
    return "已确认，我会记住你偏好使用 TypeScript。";
  }
  return "收到。";
}

async function createRuntimeStack(storageBaseUrl: string) {
  const [
    { createApp },
    { InMemoryRuntimeRepository },
    { RetrievalRuntimeService },
    { TriggerEngine },
    { QueryEngine },
    { InjectionEngine },
    { WritebackEngine },
    { DependencyGuard },
    { HttpStorageWritebackClient },
    runtimeLoggerModule,
  ] = await Promise.all([
    importRuntimeAppModule(),
    importRuntimeRepositoryModule(),
    importRuntimeServiceModule(),
    importTriggerModule(),
    importQueryModule(),
    importInjectionModule(),
    importWritebackModule(),
    importDependencyModule(),
    importStorageClientModule(),
    import(pathToFileURL(path.join(REPO_ROOT, "services/retrieval-runtime/dist/src/logger.js")).href),
  ]);

  const runtimeRepository = new InMemoryRuntimeRepository();
  const logger = runtimeLoggerModule.createLogger({ LOG_LEVEL: "silent" });
  const dependencyGuard = new DependencyGuard(runtimeRepository, logger);
  const embeddingsClient = new DeterministicEmbeddingsClient();

  return {
    createApp,
    runtimeRepository,
    createService(readModelRepository: StorageReadModelRepository) {
      return new RetrievalRuntimeService(
        new TriggerEngine(RUNTIME_BASE_CONFIG, embeddingsClient, readModelRepository, dependencyGuard, logger),
        new QueryEngine(RUNTIME_BASE_CONFIG, readModelRepository, embeddingsClient, dependencyGuard, logger),
        new InjectionEngine(RUNTIME_BASE_CONFIG),
        new WritebackEngine(
          { ...RUNTIME_BASE_CONFIG, STORAGE_WRITEBACK_URL: storageBaseUrl },
          new HttpStorageWritebackClient({ ...RUNTIME_BASE_CONFIG, STORAGE_WRITEBACK_URL: storageBaseUrl }),
          dependencyGuard,
        ),
        runtimeRepository,
        dependencyGuard,
        logger,
      );
    },
  };
}

async function createStorageStack(repositories: unknown, port = 0) {
  const [
    { createApp },
    { createStorageService },
  ] = await Promise.all([
    importStorageAppModule(),
    importStorageServiceModule(),
  ]);
  const service = createStorageService({
    repositories,
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
    },
    config: {
      port: 3001,
      host: "127.0.0.1",
      log_level: "silent",
      database_url: "postgres://example",
      storage_schema_private: "storage_private",
      storage_schema_shared: "storage_shared_v1",
      write_job_poll_interval_ms: 1_000,
      write_job_batch_size: 10,
      write_job_max_retries: 3,
      read_model_refresh_max_retries: 2,
      embedding_base_url: undefined,
      embedding_api_key: undefined,
      embedding_model: "text-embedding-3-small",
      redis_url: undefined,
    },
  });
  const app = createApp(service);
  const started = await startFastify(app, port);

  return {
    app: started.app,
    baseUrl: started.baseUrl,
    port: started.port,
    service,
  };
}

async function stopFastify(app?: FastifyInstance) {
  if (!app) {
    return;
  }
  await app.close().catch(() => undefined);
}

async function stopFastifyWithTimeout(app?: FastifyInstance, timeoutMs = 1_500) {
  if (!app) {
    return;
  }
  await Promise.race([
    stopFastify(app),
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    }),
  ]);
}

async function waitForWritebackJob(
  storageService: NonNullable<RunningE2eStack["storageService"]>,
  timeoutMs = 5_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const jobs = await storageService.listWriteJobs(20);
    if (jobs.length > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("timed out waiting for storage writeback job");
}

function createHomeAndWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mna-e2e-"));
  const workspaceDir = path.join(root, "workspace");
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(path.join(workspaceDir, "README.md"), "# e2e\n", "utf8");
  return {
    root,
    workspaceDir,
  };
}

function createAgentConfig(input: {
  workspaceDir: string;
  runtimeBaseUrl: string;
  providerBaseUrl: string;
  ids: TestIds;
  memoryMode?: MemoryMode;
}): AgentConfig {
  return {
    runtime: {
      baseUrl: input.runtimeBaseUrl,
      requestTimeoutMs: 800,
      finalizeTimeoutMs: 1_500,
    },
    provider: {
      kind: "ollama",
      model: "test-model",
      baseUrl: input.providerBaseUrl,
      temperature: 0.2,
    },
    memory: {
      mode: input.memoryMode ?? "workspace_plus_global",
      userId: input.ids.user,
      workspaceId: input.ids.workspace,
      cwd: input.workspaceDir,
    },
    mcp: {
      servers: [],
    },
    tools: {
      shellExec: {
        enabled: true,
        timeoutMs: 30_000,
        denyPatterns: [],
      },
    },
    cli: {
      systemPrompt: null,
    },
    streaming: {
      flushChars: 4,
      flushIntervalMs: 1,
    },
    locale: "zh-CN",
  };
}

export async function createE2eStack(options?: {
  withRuntime?: boolean;
  withStorage?: boolean;
  memoryMode?: MemoryMode;
  ids?: Partial<TestIds>;
}): Promise<RunningE2eStack> {
  const ids = {
    ...DEFAULT_IDS,
    ...options?.ids,
  };
  const withStorage = options?.withStorage ?? true;
  const withRuntime = options?.withRuntime ?? true;
  const { root, workspaceDir } = createHomeAndWorkspace();
  const startedApps: FastifyInstance[] = [];
  const { createMemoryRepositories } = await importStorageMemoryRepoModule();
  const storageRepositories = createMemoryRepositories();

  const providerServer = await startStubProviderServer();
  startedApps.push(providerServer.app);

  let storageApp: FastifyInstance | undefined;
  let storageService: RunningE2eStack["storageService"] | undefined;
  let storageBaseUrl = "http://127.0.0.1:1";
  let storageOnline = false;

  let storagePort = 0;

  if (withStorage) {
    const storageStack = await createStorageStack(storageRepositories);
    storageApp = storageStack.app;
    storageService = storageStack.service;
    storageBaseUrl = storageStack.baseUrl;
    storagePort = storageStack.port;
    storageOnline = true;
    startedApps.push(storageStack.app);
  }

  let runtimeApp: FastifyInstance | undefined;
  let runtimeRepository: RunningE2eStack["runtimeRepository"] | undefined;
  let runtimeBaseUrl = "http://127.0.0.1:2";

  if (withRuntime) {
    if (!storageService) {
      throw new Error("runtime stack requires storage service");
    }

    const runtimeStack = await createRuntimeStack(storageBaseUrl);
    const runtimeService = runtimeStack.createService(
      new StorageReadModelRepository(() => storageService, () => storageOnline),
    );
    const startedRuntime = await startFastify(runtimeStack.createApp(runtimeService));
    runtimeApp = startedRuntime.app;
    runtimeRepository = runtimeStack.runtimeRepository;
    runtimeBaseUrl = startedRuntime.baseUrl;
    startedApps.push(startedRuntime.app);
  }

  const mna = createServer(
    createAgentConfig({
      workspaceDir,
      runtimeBaseUrl,
      providerBaseUrl: providerServer.baseUrl,
      ids,
      memoryMode: options?.memoryMode,
    }),
    {
      homeDirectory: root,
    },
  );
  await mna.listen({ host: "127.0.0.1", port: 0 });
  startedApps.push(mna);

  return {
    ids,
    homeDir: root,
    workspaceDir,
    mna,
    runtimeApp,
    runtimeRepository,
    storageApp,
    storageService,
    async stopStorage() {
      if (!storageApp) {
        return;
      }
      storageOnline = false;
      const index = startedApps.indexOf(storageApp);
      if (index >= 0) {
        startedApps.splice(index, 1);
      }
      await stopFastify(storageApp);
      storageApp = undefined;
    },
    async restartStorage() {
      if (storageApp) {
        return;
      }
      const storageStack = await createStorageStack(storageRepositories, storagePort);
      storageApp = storageStack.app;
      storageService = storageStack.service;
      storagePort = storageStack.port;
      storageOnline = true;
      startedApps.push(storageStack.app);
    },
    async invalidateRecord(recordId, input) {
      if (!storageApp) {
        throw new Error("storage app unavailable");
      }
      const address = storageApp.server.address();
      if (!address || typeof address === "string") {
        throw new Error("storage address unavailable");
      }
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/storage/records/${recordId}/invalidate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          actor: {
            actor_type: input?.actor_type ?? "operator",
            actor_id: input?.actor_id ?? "mna-e2e",
          },
          reason: input?.reason ?? "e2e invalidate record",
        }),
      });
      if (!response.ok) {
        throw new Error(`invalidate record failed: ${response.status}`);
      }
      const payload = (await response.json()) as {
        data?: Record<string, unknown>;
      };
      return payload.data ?? {};
    },
    async workerDrain() {
      if (!storageService) {
        return;
      }
      await waitForWritebackJob(storageService);
      await storageService.processWriteJobs();
    },
    async close() {
      for (const app of [...startedApps].reverse()) {
        await stopFastifyWithTimeout(app);
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

export async function createSession(stack: RunningE2eStack, input?: {
  workspace_id?: string;
  memory_mode?: MemoryMode;
}) {
  const address = stack.mna.server.address();
  if (!address || typeof address === "string") {
    throw new Error("mna address unavailable");
  }
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/agent/sessions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${stack.mna.mnaToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      workspace_id: input?.workspace_id ?? stack.ids.workspace,
      memory_mode: input?.memory_mode,
    }),
  });
  if (!response.ok) {
    throw new Error(`create session failed: ${response.status}`);
  }
  return response.json() as Promise<{
    session_id: string;
    ws_url: string;
    memory_mode: MemoryMode;
  }>;
}

export async function updateSessionMode(stack: RunningE2eStack, sessionId: string, memoryMode: MemoryMode) {
  const address = stack.mna.server.address();
  if (!address || typeof address === "string") {
    throw new Error("mna address unavailable");
  }
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/agent/sessions/${sessionId}/mode`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${stack.mna.mnaToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      memory_mode: memoryMode,
    }),
  });
  if (!response.ok) {
    throw new Error(`update session mode failed: ${response.status}`);
  }
}

export async function fetchDependencyStatus(stack: RunningE2eStack) {
  const address = stack.mna.server.address();
  if (!address || typeof address === "string") {
    throw new Error("mna address unavailable");
  }
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/agent/dependency-status`, {
    headers: {
      authorization: `Bearer ${stack.mna.mnaToken}`,
    },
  });
  if (!response.ok) {
    throw new Error(`dependency status failed: ${response.status}`);
  }
  return response.json() as Promise<Record<string, unknown>>;
}

export async function runTurn(wsUrl: string, input: {
  turnId: string;
  text: string;
  settleMs?: number;
}) {
  const messages: Array<Record<string, unknown>> = [];
  const ws = new WebSocket(wsUrl);

  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("websocket open failed")), { once: true });
  });

  const completion = new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("timed out waiting for turn_end"));
    }, 8_000);

    ws.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data)) as Record<string, unknown>;
      messages.push(payload);
      if (payload.kind === "turn_end" && payload.turn_id === input.turnId) {
        clearTimeout(timer);
        setTimeout(() => resolve(messages), input.settleMs ?? 0);
      }
    });

    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("websocket message failed"));
    });
  });

  ws.send(JSON.stringify({
    kind: "user_input",
    turn_id: input.turnId,
    text: input.text,
  }));

  const result = await completion.finally(() => {
    ws.close();
  });
  return result;
}
