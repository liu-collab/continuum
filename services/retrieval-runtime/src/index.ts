import { loadConfig } from "./config.js";
import { DependencyGuard } from "./dependency/dependency-guard.js";
import { InjectionEngine } from "./injection/injection-engine.js";
import { createLogger } from "./logger.js";
import { HttpMemoryGovernancePlanner } from "./memory-orchestrator/governance/planner.js";
import { HttpMemoryGovernanceVerifier } from "./memory-orchestrator/governance/verifier.js";
import { createMemoryOrchestrator } from "./memory-orchestrator/index.js";
import { HttpMemoryQualityAssessor } from "./memory-orchestrator/writeback/quality-assessor.js";
import { HttpMemoryRecallInjectionPlanner } from "./memory-orchestrator/recall/injection-planner.js";
import { HttpMemoryRecallSearchPlanner } from "./memory-orchestrator/recall/search-planner.js";
import { HttpMemoryWritebackPlanner } from "./memory-orchestrator/writeback/planner.js";
import { FallbackRuntimeRepository } from "./observability/fallback-runtime-repository.js";
import { InMemoryRuntimeRepository } from "./observability/in-memory-runtime-repository.js";
import { PostgresRuntimeRepository } from "./observability/postgres-runtime-repository.js";
import { HttpEmbeddingsClient } from "./query/embeddings-client.js";
import { PostgresReadModelRepository } from "./query/postgres-read-model-repository.js";
import { QueryEngine } from "./query/query-engine.js";
import { RetrievalRuntimeService } from "./runtime-service.js";
import { TriggerEngine } from "./trigger/trigger-engine.js";
import { FinalizeIdempotencyCache } from "./writeback/finalize-idempotency-cache.js";
import { HttpStorageWritebackClient } from "./writeback/storage-client.js";
import { WritebackOutboxFlusher } from "./writeback/writeback-outbox-flusher.js";
import { WritebackMaintenanceWorker } from "./writeback/maintenance-worker.js";
import { WritebackEngine } from "./writeback/writeback-engine.js";
import { createApp } from "./app.js";
import { hasCompleteRuntimeEmbeddingConfig } from "./embedding-config.js";
import {
  hasCompleteRuntimeWritebackLlmConfig,
  resolveRuntimeWritebackLlmConfig,
} from "./writeback-llm-config.js";
import { nowIso } from "./shared/utils.js";

async function main() {
  const config = loadConfig();
  const logger = createLogger(config);
  const repository = new FallbackRuntimeRepository(
    new PostgresRuntimeRepository(config),
    new InMemoryRuntimeRepository(),
  );
  await repository.initialize?.();
  const dependencyGuard = new DependencyGuard(repository, logger);
  const readModelRepository = new PostgresReadModelRepository(config);
  const embeddingsClient = new HttpEmbeddingsClient(config);
  const storageClient = new HttpStorageWritebackClient(config);
  const activeWritebackLlmConfig = resolveRuntimeWritebackLlmConfig(config);
  const writebackPlanner = hasCompleteRuntimeWritebackLlmConfig(config)
    ? new HttpMemoryWritebackPlanner({
        ...config,
        MEMORY_LLM_BASE_URL: activeWritebackLlmConfig.baseUrl,
        MEMORY_LLM_MODEL: activeWritebackLlmConfig.model ?? config.MEMORY_LLM_MODEL,
        MEMORY_LLM_API_KEY: activeWritebackLlmConfig.apiKey,
        MEMORY_LLM_PROTOCOL: activeWritebackLlmConfig.protocol ?? config.MEMORY_LLM_PROTOCOL,
        MEMORY_LLM_TIMEOUT_MS: activeWritebackLlmConfig.timeoutMs ?? config.MEMORY_LLM_TIMEOUT_MS,
        MEMORY_LLM_EFFORT: activeWritebackLlmConfig.effort ?? config.MEMORY_LLM_EFFORT,
        MEMORY_LLM_MAX_TOKENS: activeWritebackLlmConfig.maxTokens ?? config.MEMORY_LLM_MAX_TOKENS,
      })
    : undefined;
  const recallSearchPlanner = hasCompleteRuntimeWritebackLlmConfig(config)
    ? new HttpMemoryRecallSearchPlanner({
        MEMORY_LLM_BASE_URL: activeWritebackLlmConfig.baseUrl,
        MEMORY_LLM_MODEL: activeWritebackLlmConfig.model ?? config.MEMORY_LLM_MODEL,
        MEMORY_LLM_API_KEY: activeWritebackLlmConfig.apiKey,
        MEMORY_LLM_PROTOCOL: activeWritebackLlmConfig.protocol ?? config.MEMORY_LLM_PROTOCOL,
        MEMORY_LLM_TIMEOUT_MS: activeWritebackLlmConfig.timeoutMs ?? config.MEMORY_LLM_TIMEOUT_MS,
        MEMORY_LLM_EFFORT: activeWritebackLlmConfig.effort ?? config.MEMORY_LLM_EFFORT,
        RECALL_LLM_JUDGE_MAX_TOKENS: config.RECALL_LLM_JUDGE_MAX_TOKENS,
        RECALL_LLM_CANDIDATE_LIMIT: config.RECALL_LLM_CANDIDATE_LIMIT,
      })
    : undefined;
  const recallInjectionPlanner = hasCompleteRuntimeWritebackLlmConfig(config)
    ? new HttpMemoryRecallInjectionPlanner({
        MEMORY_LLM_BASE_URL: activeWritebackLlmConfig.baseUrl,
        MEMORY_LLM_MODEL: activeWritebackLlmConfig.model ?? config.MEMORY_LLM_MODEL,
        MEMORY_LLM_API_KEY: activeWritebackLlmConfig.apiKey,
        MEMORY_LLM_PROTOCOL: activeWritebackLlmConfig.protocol ?? config.MEMORY_LLM_PROTOCOL,
        MEMORY_LLM_TIMEOUT_MS: activeWritebackLlmConfig.timeoutMs ?? config.MEMORY_LLM_TIMEOUT_MS,
        MEMORY_LLM_EFFORT: activeWritebackLlmConfig.effort ?? config.MEMORY_LLM_EFFORT,
        RECALL_LLM_JUDGE_MAX_TOKENS: config.RECALL_LLM_JUDGE_MAX_TOKENS,
        RECALL_LLM_CANDIDATE_LIMIT: config.RECALL_LLM_CANDIDATE_LIMIT,
      })
    : undefined;
  const maintenancePlanner = hasCompleteRuntimeWritebackLlmConfig(config)
    ? new HttpMemoryGovernancePlanner({
        MEMORY_LLM_BASE_URL: activeWritebackLlmConfig.baseUrl,
        MEMORY_LLM_MODEL: activeWritebackLlmConfig.model ?? config.MEMORY_LLM_MODEL,
        MEMORY_LLM_API_KEY: activeWritebackLlmConfig.apiKey,
        MEMORY_LLM_PROTOCOL: activeWritebackLlmConfig.protocol ?? config.MEMORY_LLM_PROTOCOL,
        MEMORY_LLM_TIMEOUT_MS: activeWritebackLlmConfig.timeoutMs ?? config.MEMORY_LLM_TIMEOUT_MS,
        MEMORY_LLM_EFFORT: activeWritebackLlmConfig.effort ?? config.MEMORY_LLM_EFFORT,
        WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS: config.WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS,
        WRITEBACK_MAINTENANCE_MAX_ACTIONS: config.WRITEBACK_MAINTENANCE_MAX_ACTIONS,
      })
    : undefined;
  const qualityAssessor = hasCompleteRuntimeWritebackLlmConfig(config)
    ? new HttpMemoryQualityAssessor({
        MEMORY_LLM_BASE_URL: activeWritebackLlmConfig.baseUrl,
        MEMORY_LLM_MODEL: activeWritebackLlmConfig.model ?? config.MEMORY_LLM_MODEL,
        MEMORY_LLM_API_KEY: activeWritebackLlmConfig.apiKey,
        MEMORY_LLM_PROTOCOL: activeWritebackLlmConfig.protocol ?? config.MEMORY_LLM_PROTOCOL,
        MEMORY_LLM_TIMEOUT_MS: activeWritebackLlmConfig.timeoutMs ?? config.MEMORY_LLM_TIMEOUT_MS,
        MEMORY_LLM_EFFORT: activeWritebackLlmConfig.effort ?? config.MEMORY_LLM_EFFORT,
        WRITEBACK_LLM_REFINE_MAX_TOKENS: config.WRITEBACK_LLM_REFINE_MAX_TOKENS,
      })
    : undefined;
  const governanceVerifier = hasCompleteRuntimeWritebackLlmConfig(config)
    ? new HttpMemoryGovernanceVerifier({
        MEMORY_LLM_BASE_URL: activeWritebackLlmConfig.baseUrl,
        MEMORY_LLM_MODEL: activeWritebackLlmConfig.model ?? config.MEMORY_LLM_MODEL,
        MEMORY_LLM_API_KEY: activeWritebackLlmConfig.apiKey,
        MEMORY_LLM_PROTOCOL: activeWritebackLlmConfig.protocol ?? config.MEMORY_LLM_PROTOCOL,
        MEMORY_LLM_TIMEOUT_MS: activeWritebackLlmConfig.timeoutMs ?? config.MEMORY_LLM_TIMEOUT_MS,
        MEMORY_LLM_EFFORT: activeWritebackLlmConfig.effort ?? config.MEMORY_LLM_EFFORT,
        WRITEBACK_GOVERNANCE_VERIFY_MAX_TOKENS: config.WRITEBACK_GOVERNANCE_VERIFY_MAX_TOKENS,
      })
    : undefined;
  const finalizeIdempotencyCache = new FinalizeIdempotencyCache(config);
  const outboxFlusher = new WritebackOutboxFlusher(repository, storageClient, config, logger);
  const maintenanceWorker = new WritebackMaintenanceWorker(
    repository,
    storageClient,
    maintenancePlanner,
    governanceVerifier,
    dependencyGuard,
    config,
    logger,
  );
  const memoryOrchestrator = createMemoryOrchestrator({
    config,
    recallPlanner:
      recallSearchPlanner && recallInjectionPlanner
        ? {
            search: recallSearchPlanner,
            injection: recallInjectionPlanner,
          }
        : undefined,
    writebackPlanner,
    qualityAssessor,
    governancePlanner: maintenancePlanner,
    governanceVerifier,
  });

  const runtimeService = new RetrievalRuntimeService(
    new TriggerEngine(
      config,
      embeddingsClient,
      readModelRepository,
      dependencyGuard,
      logger,
      memoryOrchestrator?.recall?.search,
    ),
    new QueryEngine(config, readModelRepository, embeddingsClient, dependencyGuard, logger),
    embeddingsClient,
    new InjectionEngine(config),
    new WritebackEngine(
      config,
      storageClient,
      dependencyGuard,
      memoryOrchestrator?.writeback,
      memoryOrchestrator?.quality,
      logger,
    ),
    repository,
    dependencyGuard,
    logger,
    finalizeIdempotencyCache,
    config.EMBEDDING_TIMEOUT_MS,
    memoryOrchestrator,
    maintenanceWorker,
  );

  if (!hasCompleteRuntimeEmbeddingConfig(config)) {
    await repository.updateDependencyStatus({
      name: "embeddings",
      status: "unavailable",
      detail: "embedding config is not complete",
      last_checked_at: nowIso(),
    });
  }

  if (!hasCompleteRuntimeWritebackLlmConfig(config)) {
    await repository.updateDependencyStatus({
      name: "memory_llm",
      status: "unavailable",
      detail: "memory llm is not configured",
      last_checked_at: nowIso(),
    });
  }

  const app = createApp(runtimeService);
  app.addHook("onClose", async () => {
    outboxFlusher.stop();
    maintenanceWorker.stop();
  });

  try {
    outboxFlusher.start();
    maintenanceWorker.start();
    await app.listen({ host: config.HOST, port: config.PORT });
    logger.info({ host: config.HOST, port: config.PORT }, "retrieval-runtime listening");
  } catch (error) {
    logger.error({ err: error }, "failed to start retrieval-runtime");
    process.exitCode = 1;
  }
}

void main();
