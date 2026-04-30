import type { Logger } from "pino";

import type { AppConfig } from "./config.js";
import type { DependencyGuard } from "./dependency/dependency-guard.js";
import { RuntimeDependencyHealthChecker } from "./dependency/runtime-dependency-health-checker.js";
import {
  DEFAULT_RECENT_INJECTION_CONFIG,
  pickRecentInjectionConfig,
} from "./injection/recent-injection-policy.js";
import type { MemoryOrchestrator } from "./memory-orchestrator/index.js";
import type { RuntimeRepository } from "./observability/runtime-repository.js";
import {
  pickRuntimeGovernanceConfig,
  type RuntimeGovernanceConfig,
} from "./runtime-config.js";
import { PrepareContextService } from "./query/prepare-context-service.js";
import { createRuntimeServiceGraph } from "./runtime-service-graph.js";
import { nowIso } from "./shared/utils.js";
import type {
  CacheClearResponse,
  DependencyStatus,
  DependencyStatusSnapshot,
  FinalizeTurnInput,
  FinalizeTurnResponse,
  MaintenanceRunSummary,
  ObserveRunsFilters,
  PrepareContextResponse,
  SessionStartResponse,
  TriggerContext,
  WriteProjectionStatusSnapshot,
} from "./shared/types.js";
import type { EmbeddingCacheProvider, EmbeddingsClient } from "./query/embeddings-client.js";
import type { QueryEngine } from "./query/query-engine.js";
import { RecallPreflight } from "./trigger/recall-preflight.js";
import type { TriggerEngine } from "./trigger/trigger-engine.js";
import type { WritebackEngine } from "./writeback/writeback-engine.js";
import type { InjectionEngine } from "./injection/injection-engine.js";
import type { FinalizeIdempotencyCache } from "./writeback/finalize-idempotency-cache.js";
import { FinalizeTurnService } from "./writeback/finalize-turn-service.js";
import type { WritebackMaintenanceWorker } from "./writeback/maintenance-worker.js";
import type { StorageWritebackClient } from "./writeback/storage-client.js";

function hasEmbeddingCacheProvider(client: EmbeddingsClient): client is EmbeddingsClient & EmbeddingCacheProvider {
  return (
    typeof (client as Partial<EmbeddingCacheProvider>).stats === "function" &&
    typeof (client as Partial<EmbeddingCacheProvider>).clear === "function"
  );
}

export class RetrievalRuntimeService {
  private readonly embeddingsClient: EmbeddingsClient;
  private readonly repository: RuntimeRepository;
  private readonly dependencyGuard: DependencyGuard;
  private readonly logger: Logger;
  private readonly finalizeIdempotencyCache?: FinalizeIdempotencyCache;
  private readonly embeddingTimeoutMs: number;
  private readonly maintenanceWorker?: WritebackMaintenanceWorker;
  private readonly storageClient?: StorageWritebackClient;
  private readonly dependencyHealthChecker: RuntimeDependencyHealthChecker;
  private readonly prepareContextService: PrepareContextService;
  private readonly finalizeTurnService: FinalizeTurnService;
  private runtimeGovernanceConfig: RuntimeGovernanceConfig;

  constructor(
    config: AppConfig,
    triggerEngine: TriggerEngine,
    queryEngine: QueryEngine,
    embeddingsClient: EmbeddingsClient,
    injectionEngine: InjectionEngine,
    writebackEngine: WritebackEngine,
    repository: RuntimeRepository,
    dependencyGuard: DependencyGuard,
    logger: Logger,
    finalizeIdempotencyCache?: FinalizeIdempotencyCache,
    embeddingTimeoutMs?: number,
    memoryOrchestrator?: MemoryOrchestrator,
    maintenanceWorker?: WritebackMaintenanceWorker,
    storageClient?: StorageWritebackClient,
  );
  constructor(
    triggerEngine: TriggerEngine,
    queryEngine: QueryEngine,
    embeddingsClient: EmbeddingsClient,
    injectionEngine: InjectionEngine,
    writebackEngine: WritebackEngine,
    repository: RuntimeRepository,
    dependencyGuard: DependencyGuard,
    logger: Logger,
    finalizeIdempotencyCache?: FinalizeIdempotencyCache,
    embeddingTimeoutMs?: number,
    memoryOrchestrator?: MemoryOrchestrator,
    maintenanceWorker?: WritebackMaintenanceWorker,
    storageClient?: StorageWritebackClient,
  );
  constructor(
    configOrTriggerEngine: AppConfig | TriggerEngine,
    triggerEngineOrQueryEngine: TriggerEngine | QueryEngine,
    queryEngineOrEmbeddingsClient: QueryEngine | EmbeddingsClient,
    embeddingsClientOrInjectionEngine: EmbeddingsClient | InjectionEngine,
    injectionEngineOrWritebackEngine: InjectionEngine | WritebackEngine,
    writebackEngineOrRepository: WritebackEngine | RuntimeRepository,
    repositoryOrDependencyGuard: RuntimeRepository | DependencyGuard,
    dependencyGuardOrLogger: DependencyGuard | Logger,
    loggerOrFinalizeIdempotencyCache: Logger | FinalizeIdempotencyCache | undefined,
    finalizeIdempotencyCacheOrEmbeddingTimeoutMs?: FinalizeIdempotencyCache | number,
    embeddingTimeoutMsOrMemoryOrchestrator?: number | MemoryOrchestrator,
    memoryOrchestratorOrMaintenanceWorker?: MemoryOrchestrator | WritebackMaintenanceWorker,
    maintenanceWorkerOrStorageClient?: WritebackMaintenanceWorker | StorageWritebackClient,
    storageClient?: StorageWritebackClient,
  ) {
    if (isAppConfig(configOrTriggerEngine)) {
      const triggerEngine = triggerEngineOrQueryEngine as TriggerEngine;
      const queryEngine = queryEngineOrEmbeddingsClient as QueryEngine;
      this.embeddingsClient = embeddingsClientOrInjectionEngine as EmbeddingsClient;
      this.repository = repositoryOrDependencyGuard as RuntimeRepository;
      this.dependencyGuard = dependencyGuardOrLogger as DependencyGuard;
      this.logger = loggerOrFinalizeIdempotencyCache as Logger;
      this.finalizeIdempotencyCache = finalizeIdempotencyCacheOrEmbeddingTimeoutMs as
        | FinalizeIdempotencyCache
        | undefined;
      this.embeddingTimeoutMs =
        typeof embeddingTimeoutMsOrMemoryOrchestrator === "number" ? embeddingTimeoutMsOrMemoryOrchestrator : 800;
      const memoryLlmTimeoutMs = configOrTriggerEngine.MEMORY_LLM_TIMEOUT_MS;
      this.runtimeGovernanceConfig = pickRuntimeGovernanceConfig(configOrTriggerEngine);
      const recallPreflight = new RecallPreflight(
        configOrTriggerEngine,
        queryEngine,
        this.dependencyGuard,
        this.logger,
      );
      const memoryOrchestrator =
        typeof embeddingTimeoutMsOrMemoryOrchestrator === "number"
          ? memoryOrchestratorOrMaintenanceWorker as MemoryOrchestrator | undefined
          : embeddingTimeoutMsOrMemoryOrchestrator;
      this.maintenanceWorker =
        typeof embeddingTimeoutMsOrMemoryOrchestrator === "number"
          ? maintenanceWorkerOrStorageClient as WritebackMaintenanceWorker | undefined
          : memoryOrchestratorOrMaintenanceWorker as WritebackMaintenanceWorker | undefined;
      this.storageClient =
        typeof embeddingTimeoutMsOrMemoryOrchestrator === "number"
          ? storageClient
          : maintenanceWorkerOrStorageClient as StorageWritebackClient | undefined;
      const graph = createRuntimeServiceGraph({
        triggerEngine,
        queryEngine,
        embeddingsClient: this.embeddingsClient,
        injectionEngine: injectionEngineOrWritebackEngine as InjectionEngine,
        writebackEngine: writebackEngineOrRepository as WritebackEngine,
        repository: this.repository,
        dependencyGuard: this.dependencyGuard,
        logger: this.logger,
        finalizeIdempotencyCache: this.finalizeIdempotencyCache,
        embeddingTimeoutMs: this.embeddingTimeoutMs,
        memoryLlmTimeoutMs,
        memoryOrchestrator,
        storageClient: this.storageClient,
        recallPreflight,
        recentInjectionConfig: pickRecentInjectionConfig(configOrTriggerEngine),
      });
      this.dependencyHealthChecker = graph.dependencyHealthChecker;
      this.prepareContextService = graph.prepareContextService;
      this.finalizeTurnService = graph.finalizeTurnService;
      return;
    }

    const triggerEngine = configOrTriggerEngine;
    const queryEngine = triggerEngineOrQueryEngine as QueryEngine;
    this.embeddingsClient = queryEngineOrEmbeddingsClient as EmbeddingsClient;
    this.repository = writebackEngineOrRepository as RuntimeRepository;
    this.dependencyGuard = repositoryOrDependencyGuard as DependencyGuard;
    this.logger = dependencyGuardOrLogger as Logger;
    this.finalizeIdempotencyCache = loggerOrFinalizeIdempotencyCache as FinalizeIdempotencyCache | undefined;
    this.embeddingTimeoutMs =
      typeof finalizeIdempotencyCacheOrEmbeddingTimeoutMs === "number"
        ? finalizeIdempotencyCacheOrEmbeddingTimeoutMs
        : 800;
    const memoryLlmTimeoutMs = this.embeddingTimeoutMs;
    this.runtimeGovernanceConfig = {
      WRITEBACK_MAINTENANCE_ENABLED: false,
      WRITEBACK_MAINTENANCE_INTERVAL_MS: 15 * 60 * 1000,
      WRITEBACK_GOVERNANCE_VERIFY_ENABLED: true,
      WRITEBACK_GOVERNANCE_SHADOW_MODE: false,
      WRITEBACK_MAINTENANCE_MAX_ACTIONS: 10,
    };
    const memoryOrchestrator =
      typeof finalizeIdempotencyCacheOrEmbeddingTimeoutMs === "number"
        ? embeddingTimeoutMsOrMemoryOrchestrator as MemoryOrchestrator | undefined
        : finalizeIdempotencyCacheOrEmbeddingTimeoutMs as MemoryOrchestrator | undefined;
    this.maintenanceWorker =
      typeof finalizeIdempotencyCacheOrEmbeddingTimeoutMs === "number"
        ? memoryOrchestratorOrMaintenanceWorker as WritebackMaintenanceWorker | undefined
        : embeddingTimeoutMsOrMemoryOrchestrator as WritebackMaintenanceWorker | undefined;
    this.storageClient =
      typeof finalizeIdempotencyCacheOrEmbeddingTimeoutMs === "number"
        ? maintenanceWorkerOrStorageClient as StorageWritebackClient | undefined
        : memoryOrchestratorOrMaintenanceWorker as StorageWritebackClient | undefined;
    const graph = createRuntimeServiceGraph({
      triggerEngine,
      queryEngine,
      embeddingsClient: this.embeddingsClient,
      injectionEngine: embeddingsClientOrInjectionEngine as InjectionEngine,
      writebackEngine: injectionEngineOrWritebackEngine as WritebackEngine,
      repository: this.repository,
      dependencyGuard: this.dependencyGuard,
      logger: this.logger,
      finalizeIdempotencyCache: this.finalizeIdempotencyCache,
      embeddingTimeoutMs: this.embeddingTimeoutMs,
      memoryLlmTimeoutMs,
      memoryOrchestrator,
      storageClient: this.storageClient,
      recentInjectionConfig: DEFAULT_RECENT_INJECTION_CONFIG,
    });
    this.dependencyHealthChecker = graph.dependencyHealthChecker;
    this.prepareContextService = graph.prepareContextService;
    this.finalizeTurnService = graph.finalizeTurnService;
  }

  async runMaintenance(input?: { workspace_id?: string; force?: boolean }): Promise<MaintenanceRunSummary> {
    if (!this.maintenanceWorker) {
      const fallback: MaintenanceRunSummary = {
        workspace_ids_scanned: [],
        seeds_inspected: 0,
        related_fetched: 0,
        actions_proposed: 0,
        actions_applied: 0,
        actions_skipped: 0,
        conflicts_resolved: 0,
        degraded: true,
        degradation_reason: "maintenance_worker_disabled",
        next_checkpoint: nowIso(),
      };
      return fallback;
    }
    return this.maintenanceWorker.runOnce({
      workspaceId: input?.workspace_id,
      forced: input?.force ?? false,
    });
  }

  getRuntimeGovernanceConfig(): RuntimeGovernanceConfig {
    return this.maintenanceWorker?.getRuntimeConfig() ?? { ...this.runtimeGovernanceConfig };
  }

  updateRuntimeGovernanceConfig(config: Partial<RuntimeGovernanceConfig>): RuntimeGovernanceConfig {
    this.runtimeGovernanceConfig = {
      ...this.runtimeGovernanceConfig,
      ...config,
    };
    this.maintenanceWorker?.updateRuntimeConfig(config);
    return this.getRuntimeGovernanceConfig();
  }

  async prepareContext(context: TriggerContext): Promise<PrepareContextResponse> {
    return this.prepareContextService.prepareContext(context);
  }

  async sessionStartContext(context: TriggerContext): Promise<SessionStartResponse> {
    const prepared = await this.prepareContext({ ...context, phase: "session_start" });
    const additionalContext = prepared.injection_block
      ? `${prepared.injection_block.injection_reason}\n${prepared.injection_block.memory_summary}`
      : "";
    const activeTaskSummary =
      prepared.injection_block?.memory_records.find((record) => record.memory_type === "task_state")?.summary ?? null;

    return {
      trace_id: prepared.trace_id,
      additional_context: additionalContext,
      active_task_summary: activeTaskSummary,
      injection_block: prepared.injection_block,
      proactive_recommendations: prepared.proactive_recommendations,
      memory_mode: context.memory_mode ?? "workspace_plus_global",
      dependency_status: prepared.dependency_status,
      degraded: prepared.degraded,
    };
  }

  async finalizeTurn(input: FinalizeTurnInput): Promise<FinalizeTurnResponse> {
    return this.finalizeTurnService.finalize(input);
  }

  async getWriteProjectionStatuses(jobIds: string[]): Promise<WriteProjectionStatusSnapshot[]> {
    if (!this.storageClient || jobIds.length === 0) {
      return [];
    }

    const result = await this.dependencyGuard.run(
      "storage_writeback",
      this.embeddingTimeoutMs,
      (signal) => this.storageClient?.getWriteProjectionStatuses(jobIds, signal) ?? Promise.resolve([]),
    );

    if (!result.ok) {
      this.logger.warn(
        {
          code: result.error?.code,
          detail: result.error?.message,
          job_count: jobIds.length,
        },
        "write projection status lookup degraded",
      );
      return [];
    }

    return result.value ?? [];
  }

  async getLiveness(): Promise<{ status: "alive" }> {
    return { status: "alive" };
  }

  async getReadiness(): Promise<{ status: "ready" }> {
    return { status: "ready" };
  }

  async getDependencies(): Promise<DependencyStatusSnapshot> {
    return this.dependencyGuard.snapshot();
  }

  async checkEmbeddings(): Promise<DependencyStatus> {
    return this.dependencyHealthChecker.checkEmbeddings();
  }

  async checkMemoryLlm(): Promise<DependencyStatus> {
    return this.dependencyHealthChecker.checkMemoryLlm();
  }

  async getRuns(filters?: ObserveRunsFilters) {
    return this.repository.getRuns(filters);
  }

  async getMetrics() {
    const metrics = await this.repository.getMetrics();
    return {
      ...metrics,
      ...(hasEmbeddingCacheProvider(this.embeddingsClient)
        ? { embedding_cache: this.embeddingsClient.stats() }
        : {}),
      ...(this.finalizeIdempotencyCache
        ? { finalize_idempotency_cache: this.finalizeIdempotencyCache.stats() }
        : {}),
    };
  }

  async clearCaches(input?: {
    embedding_cache?: boolean;
    finalize_idempotency_cache?: boolean;
  }): Promise<CacheClearResponse> {
    const clearEmbeddingCache = input?.embedding_cache ?? true;
    const clearFinalizeIdempotencyCache = input?.finalize_idempotency_cache ?? true;
    const cleared: string[] = [];

    if (clearEmbeddingCache && hasEmbeddingCacheProvider(this.embeddingsClient)) {
      this.embeddingsClient.clear();
      cleared.push("embedding_cache");
    }

    if (clearFinalizeIdempotencyCache && this.finalizeIdempotencyCache) {
      this.finalizeIdempotencyCache.clear();
      await this.repository.clearFinalizeIdempotencyRecords?.();
      cleared.push("finalize_idempotency_cache");
    }

    return {
      cleared,
      ...(hasEmbeddingCacheProvider(this.embeddingsClient)
        ? { embedding_cache: this.embeddingsClient.stats() }
        : {}),
      ...(this.finalizeIdempotencyCache
        ? { finalize_idempotency_cache: this.finalizeIdempotencyCache.stats() }
        : {}),
    };
  }

}

function isAppConfig(value: AppConfig | TriggerEngine): value is AppConfig {
  return typeof value === "object" && value !== null && "DATABASE_URL" in value;
}
