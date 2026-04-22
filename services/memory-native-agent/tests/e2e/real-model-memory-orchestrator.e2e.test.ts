import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createServer } from "../../src/server.js";
import type { AgentConfig } from "../../src/config/index.js";
import { ToolDispatcher, ToolRegistry } from "../../src/tools/index.js";
import type { FastifyInstance } from "fastify";

type StorageAppModule = { createApp(service: unknown): FastifyInstance };
type StorageServiceModule = { createStorageService(input: Record<string, unknown>): StorageService };
type StorageMemoryRepoModule = { createMemoryRepositories(): unknown };
type RuntimeAppModule = { createApp(service: unknown): FastifyInstance };
type RuntimeServiceModule = { RetrievalRuntimeService: new (...args: unknown[]) => RuntimeService };
type TriggerModule = { TriggerEngine: new (...args: unknown[]) => unknown };
type QueryModule = { QueryEngine: new (...args: unknown[]) => unknown };
type InjectionModule = { InjectionEngine: new (...args: unknown[]) => unknown };
type WritebackModule = { WritebackEngine: new (...args: unknown[]) => unknown };
type DependencyModule = { DependencyGuard: new (...args: unknown[]) => unknown };
type RuntimeRepositoryModule = { InMemoryRuntimeRepository: new () => RuntimeRepository };
type StorageClientModule = { HttpStorageWritebackClient: new (...args: unknown[]) => unknown };
type LoggerModule = { createLogger(input: { LOG_LEVEL: string }): unknown };
type OrchestratorFactoryModule = { createMemoryOrchestrator(input: Record<string, unknown>): unknown };
type PromptModules = {
  HttpMemoryIntentAnalyzer: new (...args: unknown[]) => unknown;
  HttpMemoryRecallSearchPlanner: new (...args: unknown[]) => unknown;
  HttpMemoryRecallInjectionPlanner: new (...args: unknown[]) => unknown;
  HttpMemoryWritebackPlanner: new (...args: unknown[]) => unknown;
  HttpMemoryQualityAssessor: new (...args: unknown[]) => unknown;
  HttpMemoryRelationDiscoverer: new (...args: unknown[]) => unknown;
  HttpMemoryProactiveRecommender: new (...args: unknown[]) => unknown;
  HttpMemoryGovernancePlanner: new (...args: unknown[]) => unknown;
  HttpMemoryGovernanceVerifier: new (...args: unknown[]) => unknown;
  HttpMemoryEvolutionPlanner: new (...args: unknown[]) => unknown;
};
type MaintenanceWorkerModule = { WritebackMaintenanceWorker: new (...args: unknown[]) => unknown };
type IdempotencyModule = { FinalizeIdempotencyCache: new (...args: unknown[]) => unknown };

type RuntimeService = {
  getDependencies(): Promise<Record<string, unknown>>;
};

type RuntimeRepository = {
  getRuns(filters?: Record<string, unknown>): Promise<Record<string, unknown>>;
};

type StorageService = {
  processWriteJobs(): Promise<number>;
  listWriteJobs(limit?: number): Promise<Array<Record<string, unknown>>>;
  listRecords(filters: Record<string, unknown>): Promise<{ items: Array<Record<string, unknown>> }>;
};

const REPO_ROOT = path.resolve(process.cwd(), "..", "..");
const TEST_IDS = {
  workspace: "550e8400-e29b-41d4-a716-446655440000",
  user: "550e8400-e29b-41d4-a716-446655440001",
  task: "550e8400-e29b-41d4-a716-446655440003",
};

const MEMORY_MODEL = "gpt-5.3-codex-spark";
const REAL_BASE_URL = "http://localhost:8090/v1";

type RunningStack = {
  root: string;
  workspaceDir: string;
  mna: ReturnType<typeof createServer>;
  runtimeApp: FastifyInstance;
  runtimeRepository: RuntimeRepository;
  storageApp: FastifyInstance;
  storageService: StorageService;
  close(): Promise<void>;
  workerDrain(): Promise<void>;
};

type ManagedMnaConfig = {
  provider?: {
    model?: string;
    base_url?: string;
    api_key?: string;
  };
};

async function importModule<T>(relativePath: string): Promise<T> {
  return import(pathToFileURL(path.join(REPO_ROOT, relativePath)).href) as Promise<T>;
}

async function importStorageAppModule() {
  return importModule<StorageAppModule>("services/storage/src/api/app.ts");
}

async function importStorageServiceModule() {
  return importModule<StorageServiceModule>("services/storage/src/services.ts");
}

async function importStorageMemoryRepoModule() {
  return importModule<StorageMemoryRepoModule>("services/storage/tests/memory-repositories.ts");
}

async function importRuntimeAppModule() {
  return importModule<RuntimeAppModule>("services/retrieval-runtime/src/app.ts");
}

async function importRuntimeServiceModule() {
  return importModule<RuntimeServiceModule>("services/retrieval-runtime/src/runtime-service.ts");
}

async function importTriggerModule() {
  return importModule<TriggerModule>("services/retrieval-runtime/src/trigger/trigger-engine.ts");
}

async function importQueryModule() {
  return importModule<QueryModule>("services/retrieval-runtime/src/query/query-engine.ts");
}

async function importInjectionModule() {
  return importModule<InjectionModule>("services/retrieval-runtime/src/injection/injection-engine.ts");
}

async function importWritebackModule() {
  return importModule<WritebackModule>("services/retrieval-runtime/src/writeback/writeback-engine.ts");
}

async function importDependencyModule() {
  return importModule<DependencyModule>("services/retrieval-runtime/src/dependency/dependency-guard.ts");
}

async function importRuntimeRepositoryModule() {
  return importModule<RuntimeRepositoryModule>("services/retrieval-runtime/src/observability/in-memory-runtime-repository.ts");
}

async function importStorageClientModule() {
  return importModule<StorageClientModule>("services/retrieval-runtime/src/writeback/storage-client.ts");
}

async function importLoggerModule() {
  return importModule<LoggerModule>("services/retrieval-runtime/dist/src/logger.js");
}

async function importOrchestratorFactoryModule() {
  return importModule<OrchestratorFactoryModule>("services/retrieval-runtime/src/memory-orchestrator/index.ts");
}

async function importPromptModules() {
  const [
    intent,
    recallSearch,
    recallInject,
    writebackPlanner,
    quality,
    relation,
    recommendation,
    governancePlanner,
    governanceVerifier,
    evolution,
  ] = await Promise.all([
    importModule<{ HttpMemoryIntentAnalyzer: PromptModules["HttpMemoryIntentAnalyzer"] }>("services/retrieval-runtime/src/memory-orchestrator/intent/intent-analyzer.ts"),
    importModule<{ HttpMemoryRecallSearchPlanner: PromptModules["HttpMemoryRecallSearchPlanner"] }>("services/retrieval-runtime/src/memory-orchestrator/recall/search-planner.ts"),
    importModule<{ HttpMemoryRecallInjectionPlanner: PromptModules["HttpMemoryRecallInjectionPlanner"] }>("services/retrieval-runtime/src/memory-orchestrator/recall/injection-planner.ts"),
    importModule<{ HttpMemoryWritebackPlanner: PromptModules["HttpMemoryWritebackPlanner"] }>("services/retrieval-runtime/src/memory-orchestrator/writeback/planner.ts"),
    importModule<{ HttpMemoryQualityAssessor: PromptModules["HttpMemoryQualityAssessor"] }>("services/retrieval-runtime/src/memory-orchestrator/writeback/quality-assessor.ts"),
    importModule<{ HttpMemoryRelationDiscoverer: PromptModules["HttpMemoryRelationDiscoverer"] }>("services/retrieval-runtime/src/memory-orchestrator/relation/relation-discoverer.ts"),
    importModule<{ HttpMemoryProactiveRecommender: PromptModules["HttpMemoryProactiveRecommender"] }>("services/retrieval-runtime/src/memory-orchestrator/recommendation/proactive-recommender.ts"),
    importModule<{ HttpMemoryGovernancePlanner: PromptModules["HttpMemoryGovernancePlanner"] }>("services/retrieval-runtime/src/memory-orchestrator/governance/planner.ts"),
    importModule<{ HttpMemoryGovernanceVerifier: PromptModules["HttpMemoryGovernanceVerifier"] }>("services/retrieval-runtime/src/memory-orchestrator/governance/verifier.ts"),
    importModule<{ HttpMemoryEvolutionPlanner: PromptModules["HttpMemoryEvolutionPlanner"] }>("services/retrieval-runtime/src/memory-orchestrator/governance/evolution-planner.ts"),
  ]);

  return {
    HttpMemoryIntentAnalyzer: intent.HttpMemoryIntentAnalyzer,
    HttpMemoryRecallSearchPlanner: recallSearch.HttpMemoryRecallSearchPlanner,
    HttpMemoryRecallInjectionPlanner: recallInject.HttpMemoryRecallInjectionPlanner,
    HttpMemoryWritebackPlanner: writebackPlanner.HttpMemoryWritebackPlanner,
    HttpMemoryQualityAssessor: quality.HttpMemoryQualityAssessor,
    HttpMemoryRelationDiscoverer: relation.HttpMemoryRelationDiscoverer,
    HttpMemoryProactiveRecommender: recommendation.HttpMemoryProactiveRecommender,
    HttpMemoryGovernancePlanner: governancePlanner.HttpMemoryGovernancePlanner,
    HttpMemoryGovernanceVerifier: governanceVerifier.HttpMemoryGovernanceVerifier,
    HttpMemoryEvolutionPlanner: evolution.HttpMemoryEvolutionPlanner,
  } satisfies PromptModules;
}

async function importMaintenanceWorkerModule() {
  return importModule<MaintenanceWorkerModule>("services/retrieval-runtime/src/writeback/maintenance-worker.ts");
}

async function importIdempotencyModule() {
  return importModule<IdempotencyModule>("services/retrieval-runtime/src/writeback/finalize-idempotency-cache.ts");
}

function createHomeAndWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mna-real-e2e-"));
  const workspaceDir = path.join(root, "workspace");
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(path.join(workspaceDir, "README.md"), "# real e2e\n", "utf8");
  return { root, workspaceDir };
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

async function waitForWritebackJob(storageService: StorageService, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const jobs = await storageService.listWriteJobs(20);
    if (jobs.length > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("timed out waiting for storage writeback job");
}

async function waitForMemoryWritebackPlan(
  runtimeRepository: RuntimeRepository,
  timeoutMs = 90_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const runs = await runtimeRepository.getRuns({ page: 1, page_size: 100 });
    const memoryPlanRuns = (runs.memory_plan_runs as Array<Record<string, unknown>> | undefined) ?? [];
    const writebackPlan = memoryPlanRuns.find((run) => run.plan_kind === "memory_writeback_plan");
    if (writebackPlan) {
      return {
        writebackPlan,
        runs,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("timed out waiting for memory_writeback_plan");
}

async function loadManagedMnaConfig(): Promise<ManagedMnaConfig> {
  const configPath = path.join(os.homedir(), ".continuum", "managed", "mna", "config.json");
  const text = await fs.promises.readFile(configPath, "utf8");
  return JSON.parse(text) as ManagedMnaConfig;
}

class DeterministicEmbeddingsClient {
  async embedText(text: string): Promise<number[]> {
    const normalized = text.toLowerCase();
    if (normalized.includes("typescript")) {
      return [1, 0, 0];
    }
    return [0.8, 0.2, 0];
  }
}

class StorageReadModelRepository {
  constructor(
    private readonly getStorageService: () => StorageService,
  ) {}

  async searchCandidates(query: {
    workspace_id: string;
    user_id: string;
    session_id: string;
    task_id?: string;
    scope_filter: Array<"workspace" | "user" | "task" | "session">;
    memory_type_filter: Array<"fact_preference" | "task_state" | "episodic">;
    status_filter: Array<"active" | "pending_confirmation" | "superseded" | "archived" | "deleted">;
    importance_threshold: number;
    candidate_limit: number;
  }) {
    const result = await this.getStorageService().listRecords({
      workspace_id: query.workspace_id,
      page: 1,
      page_size: 100,
    });

    return result.items
      .filter((record) => query.status_filter.includes(String(record.status) as never))
      .filter((record) => query.scope_filter.includes(String(record.scope) as never))
      .filter((record) => query.memory_type_filter.includes(String(record.memory_type) as never))
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
        memory_type: String(record.memory_type) as "fact_preference" | "task_state" | "episodic",
        scope: String(record.scope) as "workspace" | "user" | "task" | "session",
        summary: String(record.summary),
        details: (record.details_json as Record<string, unknown> | null) ?? null,
        source: {
          service_name: record.created_by_service,
          source_type: record.source_type,
          source_ref: record.source_ref,
        },
        importance: Number(record.importance),
        confidence: Number(record.confidence),
        status: String(record.status) as "active" | "pending_confirmation" | "superseded" | "archived" | "deleted",
        updated_at: String(record.updated_at),
        last_confirmed_at: record.last_confirmed_at ? String(record.last_confirmed_at) : null,
        summary_embedding: [1, 0, 0],
      }))
      .slice(0, query.candidate_limit);
  }
}

function createAgentConfig(input: {
  workspaceDir: string;
  runtimeBaseUrl: string;
  ids: typeof TEST_IDS;
  model: string;
  baseUrl: string;
  apiKey: string;
}): AgentConfig {
  return {
    runtime: {
      baseUrl: input.runtimeBaseUrl,
      requestTimeoutMs: 30_000,
      finalizeTimeoutMs: 90_000,
    },
    provider: {
      kind: "openai-compatible",
      model: input.model,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      temperature: 0.2,
      effort: "medium",
      maxTokens: 256,
    },
    memory: {
      mode: "workspace_plus_global",
      userId: input.ids.user,
      workspaceId: input.ids.workspace,
      cwd: input.workspaceDir,
    },
    mcp: {
      servers: [],
    },
    tools: {
      maxOutputChars: 8_192,
      approvalMode: "confirm",
      shellExec: {
        enabled: false,
        timeoutMs: 30_000,
        denyPatterns: [],
      },
    },
    cli: {
      systemPrompt: null,
    },
    context: {
      maxTokens: null,
      reserveTokens: 4_096,
      compactionStrategy: "truncate",
    },
    planning: {
      planMode: "advisory",
    },
    logging: {
      level: "silent",
      format: "json",
    },
    streaming: {
      flushChars: 4,
      flushIntervalMs: 1,
    },
    skills: {
      enabled: false,
      autoDiscovery: false,
      discoveryPaths: [],
    },
    locale: "zh-CN",
  };
}

async function createRealE2eStack(): Promise<RunningStack> {
  const managed = await loadManagedMnaConfig();
  const apiKey = managed.provider?.api_key;
  const baseUrl = managed.provider?.base_url ?? REAL_BASE_URL;
  const mainModel = managed.provider?.model ?? "gpt-5.4";

  if (!apiKey) {
    throw new Error("mna 托管配置里缺少 api key");
  }

  const { root, workspaceDir } = createHomeAndWorkspace();
  const startedApps: FastifyInstance[] = [];

  const [
    { createApp: createStorageApp },
    { createStorageService },
    { createMemoryRepositories },
    { createApp: createRuntimeApp },
    { RetrievalRuntimeService },
    { TriggerEngine },
    { QueryEngine },
    { InjectionEngine },
    { WritebackEngine },
    { DependencyGuard },
    { InMemoryRuntimeRepository },
    { HttpStorageWritebackClient },
    loggerModule,
    { createMemoryOrchestrator },
    promptModules,
    { WritebackMaintenanceWorker },
    { FinalizeIdempotencyCache },
  ] = await Promise.all([
    importStorageAppModule(),
    importStorageServiceModule(),
    importStorageMemoryRepoModule(),
    importRuntimeAppModule(),
    importRuntimeServiceModule(),
    importTriggerModule(),
    importQueryModule(),
    importInjectionModule(),
    importWritebackModule(),
    importDependencyModule(),
    importRuntimeRepositoryModule(),
    importStorageClientModule(),
    importLoggerModule(),
    importOrchestratorFactoryModule(),
    importPromptModules(),
    importMaintenanceWorkerModule(),
    importIdempotencyModule(),
  ]);

  const repositories = createMemoryRepositories();
  const storageService = createStorageService({
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
  const storageApp = createStorageApp(storageService);
  const startedStorage = await startFastify(storageApp);
  startedApps.push(startedStorage.app);

  const runtimeConfig = {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 0,
    LOG_LEVEL: "silent",
    DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/continuum_test",
    READ_MODEL_SCHEMA: "storage_shared_v1",
    READ_MODEL_TABLE: "memory_read_model_v1",
    RUNTIME_SCHEMA: "runtime_private",
    STORAGE_WRITEBACK_URL: startedStorage.baseUrl,
    EMBEDDING_BASE_URL: REAL_BASE_URL,
    EMBEDDING_MODEL: "text-embedding-3-small",
    EMBEDDING_API_KEY: apiKey,
    MEMORY_LLM_BASE_URL: baseUrl,
    MEMORY_LLM_MODEL: MEMORY_MODEL,
    MEMORY_LLM_API_KEY: apiKey,
    MEMORY_LLM_PROTOCOL: "openai-compatible" as const,
    MEMORY_LLM_TIMEOUT_MS: 20_000,
    MEMORY_LLM_FALLBACK_ENABLED: true,
    MEMORY_LLM_DEGRADED_THRESHOLD: 0.5,
    MEMORY_LLM_RECOVERY_INTERVAL_MS: 5 * 60 * 1000,
    MEMORY_LLM_EFFORT: "medium" as const,
    MEMORY_LLM_MAX_TOKENS: 600,
    RECALL_LLM_JUDGE_ENABLED: true,
    RECALL_LLM_JUDGE_MAX_TOKENS: 1_000,
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
    WRITEBACK_MAINTENANCE_TIMEOUT_MS: 10_000,
    WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS: 1_500,
    WRITEBACK_MAINTENANCE_MAX_ACTIONS: 10,
    WRITEBACK_MAINTENANCE_MIN_IMPORTANCE: 2,
    WRITEBACK_MAINTENANCE_ACTOR_ID: "retrieval-runtime-maintenance",
    WRITEBACK_GOVERNANCE_VERIFY_ENABLED: true,
    WRITEBACK_GOVERNANCE_VERIFY_MAX_TOKENS: 1_000,
    WRITEBACK_GOVERNANCE_ARCHIVE_MIN_CONFIDENCE: 0.85,
    WRITEBACK_GOVERNANCE_DELETE_MIN_CONFIDENCE: 0.92,
    WRITEBACK_GOVERNANCE_SHADOW_MODE: false,
    FINALIZE_IDEMPOTENCY_TTL_MS: 5 * 60 * 1000,
    FINALIZE_IDEMPOTENCY_MAX_ENTRIES: 500,
    WRITEBACK_INPUT_OVERLAP_THRESHOLD: 0.2,
    QUERY_TIMEOUT_MS: 800,
    STORAGE_TIMEOUT_MS: 800,
    EMBEDDING_TIMEOUT_MS: 3_000,
    QUERY_CANDIDATE_LIMIT: 30,
    PACKET_RECORD_LIMIT: 10,
    INJECTION_RECORD_LIMIT: 4,
    INJECTION_TOKEN_BUDGET: 512,
    SEMANTIC_TRIGGER_THRESHOLD: 0.72,
    IMPORTANCE_THRESHOLD_SESSION_START: 4,
    IMPORTANCE_THRESHOLD_DEFAULT: 3,
    IMPORTANCE_THRESHOLD_SEMANTIC: 4,
  };

  const runtimeRepository = new InMemoryRuntimeRepository();
  const logger = loggerModule.createLogger({ LOG_LEVEL: "silent" });
  const dependencyGuard = new DependencyGuard(runtimeRepository, logger);
  const embeddingsClient = new DeterministicEmbeddingsClient();
  const readModelRepository = new StorageReadModelRepository(() => storageService);
  const storageClient = new HttpStorageWritebackClient(runtimeConfig);

  const memoryLlmConfig = {
    MEMORY_LLM_BASE_URL: baseUrl,
    MEMORY_LLM_MODEL: MEMORY_MODEL,
    MEMORY_LLM_API_KEY: apiKey,
    MEMORY_LLM_PROTOCOL: "openai-compatible" as const,
    MEMORY_LLM_TIMEOUT_MS: 20_000,
    MEMORY_LLM_EFFORT: "medium" as const,
  };

  const intentAnalyzer = new promptModules.HttpMemoryIntentAnalyzer({
    ...memoryLlmConfig,
    RECALL_LLM_JUDGE_MAX_TOKENS: runtimeConfig.RECALL_LLM_JUDGE_MAX_TOKENS,
  });
  const recallSearchPlanner = new promptModules.HttpMemoryRecallSearchPlanner({
    ...memoryLlmConfig,
    RECALL_LLM_JUDGE_MAX_TOKENS: runtimeConfig.RECALL_LLM_JUDGE_MAX_TOKENS,
    RECALL_LLM_CANDIDATE_LIMIT: runtimeConfig.RECALL_LLM_CANDIDATE_LIMIT,
  });
  const recallInjectionPlanner = new promptModules.HttpMemoryRecallInjectionPlanner({
    ...memoryLlmConfig,
    RECALL_LLM_JUDGE_MAX_TOKENS: runtimeConfig.RECALL_LLM_JUDGE_MAX_TOKENS,
    RECALL_LLM_CANDIDATE_LIMIT: runtimeConfig.RECALL_LLM_CANDIDATE_LIMIT,
  });
  const writebackPlanner = new promptModules.HttpMemoryWritebackPlanner({
    ...memoryLlmConfig,
    MEMORY_LLM_MAX_TOKENS: runtimeConfig.MEMORY_LLM_MAX_TOKENS,
    WRITEBACK_LLM_REFINE_MAX_TOKENS: runtimeConfig.WRITEBACK_LLM_REFINE_MAX_TOKENS,
    WRITEBACK_MAX_CANDIDATES: runtimeConfig.WRITEBACK_MAX_CANDIDATES,
  });
  const qualityAssessor = new promptModules.HttpMemoryQualityAssessor({
    ...memoryLlmConfig,
    WRITEBACK_LLM_REFINE_MAX_TOKENS: runtimeConfig.WRITEBACK_LLM_REFINE_MAX_TOKENS,
  });
  const relationDiscoverer = new promptModules.HttpMemoryRelationDiscoverer({
    ...memoryLlmConfig,
    WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS: runtimeConfig.WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS,
  });
  const proactiveRecommender = new promptModules.HttpMemoryProactiveRecommender({
    ...memoryLlmConfig,
    RECALL_LLM_JUDGE_MAX_TOKENS: runtimeConfig.RECALL_LLM_JUDGE_MAX_TOKENS,
    RECALL_LLM_CANDIDATE_LIMIT: runtimeConfig.RECALL_LLM_CANDIDATE_LIMIT,
  });
  const governancePlanner = new promptModules.HttpMemoryGovernancePlanner({
    ...memoryLlmConfig,
    WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS: runtimeConfig.WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS,
    WRITEBACK_MAINTENANCE_MAX_ACTIONS: runtimeConfig.WRITEBACK_MAINTENANCE_MAX_ACTIONS,
  });
  const governanceVerifier = new promptModules.HttpMemoryGovernanceVerifier({
    ...memoryLlmConfig,
    WRITEBACK_GOVERNANCE_VERIFY_MAX_TOKENS: runtimeConfig.WRITEBACK_GOVERNANCE_VERIFY_MAX_TOKENS,
  });
  const evolutionPlanner = new promptModules.HttpMemoryEvolutionPlanner({
    ...memoryLlmConfig,
    WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS: runtimeConfig.WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS,
  });

  const memoryOrchestrator = createMemoryOrchestrator({
    config: runtimeConfig,
    intentAnalyzer,
    recallPlanner: {
      search: recallSearchPlanner,
      injection: recallInjectionPlanner,
    },
    writebackPlanner,
    qualityAssessor,
    relationDiscoverer,
    proactiveRecommender,
    governancePlanner,
    governanceVerifier,
    evolutionPlanner,
  }) as
    | {
        recall?: { search?: unknown; injection?: unknown };
        intent?: unknown;
        writeback?: unknown;
        quality?: unknown;
      }
    | undefined;

  const maintenanceWorker = new WritebackMaintenanceWorker(
    runtimeRepository,
    storageClient,
    governancePlanner,
    governanceVerifier,
    dependencyGuard,
    runtimeConfig,
    logger,
    relationDiscoverer,
    evolutionPlanner,
  );
  const finalizeIdempotencyCache = new FinalizeIdempotencyCache(runtimeConfig);

  const runtimeService = new RetrievalRuntimeService(
    new TriggerEngine(
      runtimeConfig,
      embeddingsClient,
      readModelRepository,
      dependencyGuard,
      logger,
      memoryOrchestrator?.recall?.search,
      memoryOrchestrator?.intent,
    ),
    new QueryEngine(runtimeConfig, readModelRepository, embeddingsClient, dependencyGuard, logger),
    embeddingsClient,
    new InjectionEngine(runtimeConfig),
    new WritebackEngine(
      runtimeConfig,
      storageClient,
      dependencyGuard,
      memoryOrchestrator?.writeback,
      memoryOrchestrator?.quality,
      logger,
    ),
    runtimeRepository,
    dependencyGuard,
    logger,
    finalizeIdempotencyCache,
    runtimeConfig.EMBEDDING_TIMEOUT_MS,
    memoryOrchestrator,
    maintenanceWorker,
    storageClient,
  );

  const runtimeApp = createRuntimeApp(runtimeService);
  const startedRuntime = await startFastify(runtimeApp);
  startedApps.push(startedRuntime.app);

  const mnaConfig = createAgentConfig({
    workspaceDir,
    runtimeBaseUrl: startedRuntime.baseUrl,
    ids: TEST_IDS,
    model: mainModel,
    baseUrl,
    apiKey,
  });
  const mna = createServer(mnaConfig, {
    homeDirectory: root,
    env: process.env,
  });
  // Local 8090 provider currently fails with tool schemas enabled, so real E2E
  // here validates main-model + memory-model chain without tool calls.
  mna.runtimeState.tools = new ToolDispatcher({
    registry: new ToolRegistry(),
    defaultMaxOutputChars: 8_192,
  });
  await mna.listen({ host: "127.0.0.1", port: 0 });
  startedApps.push(mna);

  return {
    root,
    workspaceDir,
    mna,
    runtimeApp: startedRuntime.app,
    runtimeRepository,
    storageApp: startedStorage.app,
    storageService,
    async workerDrain() {
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

async function createSession(stack: RunningStack) {
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
      workspace_id: TEST_IDS.workspace,
      memory_mode: "workspace_plus_global",
    }),
  });
  if (!response.ok) {
    throw new Error(`create session failed: ${response.status}`);
  }
  return response.json() as Promise<{
    session_id: string;
    ws_url: string;
  }>;
}

async function runTurn(wsUrl: string, input: { turnId: string; text: string; timeoutMs?: number; settleMs?: number }) {
  const events: Array<Record<string, unknown>> = [];
  const ws = new WebSocket(wsUrl);

  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("websocket open failed")), { once: true });
  });

  const completion = new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for turn_end: ${JSON.stringify(messages.slice(-20), null, 2)}`));
    }, input.timeoutMs ?? 40_000);

    ws.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data)) as Record<string, unknown>;
      events.push(payload);
      if (payload.kind === "turn_end" && payload.turn_id === input.turnId) {
        clearTimeout(timer);
        setTimeout(() => resolve(events), input.settleMs ?? 0);
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

function collectAssistantText(events: Array<Record<string, unknown>>): string {
  return events
    .filter((event) => event.kind === "assistant_delta")
    .map((event) => String(event.text ?? ""))
    .join("");
}

describe("memory-native-agent real model memory orchestrator e2e", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).reverse().map((cleanup) => cleanup()));
  }, 60_000);

  it("uses real main model and real memory llm across writeback and next-turn recall", async () => {
    const stack = await createRealE2eStack();
    cleanups.push(() => stack.close());

    const firstSession = await createSession(stack);
    const firstTurn = await runTurn(firstSession.ws_url, {
      turnId: "turn-remember-real",
      text: "请记住，我偏好使用 TypeScript。回复一句确认即可。",
      settleMs: 1_500,
    });
    const firstErrors = firstTurn.filter((event) => event.kind === "error");
    const firstPhaseResults = firstTurn.filter((event) => event.kind === "phase_result");
    expect(firstErrors, JSON.stringify(firstTurn, null, 2)).toEqual([]);
    expect(firstPhaseResults.length, JSON.stringify(firstTurn, null, 2)).toBeGreaterThan(0);

    const firstWriteback = await waitForMemoryWritebackPlan(stack.runtimeRepository);
    await stack.workerDrain();

    const secondSession = await createSession(stack);
    const secondTurn = await runTurn(secondSession.ws_url, {
      turnId: "turn-recall-real",
      text: "我偏好什么语言？请只回答一句话。",
      settleMs: 1_500,
    });

    const secondAnswer = collectAssistantText(secondTurn).toLowerCase();
    const injectionBanner = secondTurn.find(
      (event) => event.kind === "injection_banner" && event.turn_id === "turn-recall-real",
    );

    expect(firstTurn.some((event) => event.kind === "turn_end")).toBe(true);
    expect(String(firstWriteback.writebackPlan.output_summary ?? "")).not.toContain("candidates=0");
    expect(secondTurn.some((event) => event.kind === "turn_end")).toBe(true);
    expect(injectionBanner).toBeTruthy();
    expect(String((injectionBanner as { injection?: { memory_summary?: string } }).injection?.memory_summary ?? "").toLowerCase()).toContain("typescript");
    expect(secondAnswer).toContain("typescript");

    const records = await stack.storageService.listRecords({
      workspace_id: TEST_IDS.workspace,
      user_id: TEST_IDS.user,
      page: 1,
      page_size: 50,
    });
    expect(records.items.some((record) => String(record.summary).toLowerCase().includes("typescript"))).toBe(true);

    const runs = await stack.runtimeRepository.getRuns({ page: 1, page_size: 100 });
    const memoryPlanRuns = (runs.memory_plan_runs as Array<Record<string, unknown>> | undefined) ?? [];
    expect(memoryPlanRuns.some((run) => run.plan_kind === "memory_writeback_plan")).toBe(true);
    expect(memoryPlanRuns.some((run) => run.plan_kind === "memory_intent_plan")).toBe(true);
    expect(memoryPlanRuns.some((run) => run.plan_kind === "memory_search_plan")).toBe(true);
    expect(memoryPlanRuns.some((run) => run.plan_kind === "memory_injection_plan")).toBe(true);
  }, 180_000);
});
