import { loadConfig } from "./config.js";
import { DependencyGuard } from "./dependency/dependency-guard.js";
import { InjectionEngine } from "./injection/injection-engine.js";
import { createLogger } from "./logger.js";
import { FallbackRuntimeRepository } from "./observability/fallback-runtime-repository.js";
import { InMemoryRuntimeRepository } from "./observability/in-memory-runtime-repository.js";
import { PostgresRuntimeRepository } from "./observability/postgres-runtime-repository.js";
import { HttpEmbeddingsClient } from "./query/embeddings-client.js";
import { PostgresReadModelRepository } from "./query/postgres-read-model-repository.js";
import { QueryEngine } from "./query/query-engine.js";
import { RetrievalRuntimeService } from "./runtime-service.js";
import { TriggerEngine } from "./trigger/trigger-engine.js";
import { HttpLlmExtractor } from "./writeback/llm-extractor.js";
import { FinalizeIdempotencyCache } from "./writeback/finalize-idempotency-cache.js";
import { HttpStorageWritebackClient } from "./writeback/storage-client.js";
import { WritebackOutboxFlusher } from "./writeback/writeback-outbox-flusher.js";
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
  const llmExtractor = hasCompleteRuntimeWritebackLlmConfig(config)
    ? new HttpLlmExtractor({
        ...config,
      WRITEBACK_LLM_BASE_URL: activeWritebackLlmConfig.baseUrl,
      WRITEBACK_LLM_MODEL: activeWritebackLlmConfig.model ?? config.WRITEBACK_LLM_MODEL,
      WRITEBACK_LLM_API_KEY: activeWritebackLlmConfig.apiKey,
      WRITEBACK_LLM_PROTOCOL: activeWritebackLlmConfig.protocol ?? config.WRITEBACK_LLM_PROTOCOL,
      WRITEBACK_LLM_TIMEOUT_MS: activeWritebackLlmConfig.timeoutMs ?? config.WRITEBACK_LLM_TIMEOUT_MS,
    })
    : undefined;
  const finalizeIdempotencyCache = new FinalizeIdempotencyCache(config);
  const outboxFlusher = new WritebackOutboxFlusher(repository, storageClient, config, logger);

  const runtimeService = new RetrievalRuntimeService(
    new TriggerEngine(config, embeddingsClient, readModelRepository, dependencyGuard, logger),
    new QueryEngine(config, readModelRepository, embeddingsClient, dependencyGuard, logger),
    embeddingsClient,
    new InjectionEngine(config),
    new WritebackEngine(config, storageClient, dependencyGuard, llmExtractor),
    repository,
    dependencyGuard,
    logger,
    finalizeIdempotencyCache,
    config.EMBEDDING_TIMEOUT_MS,
    llmExtractor,
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
      name: "writeback_llm",
      status: "unavailable",
      detail: "writeback llm is not configured",
      last_checked_at: nowIso(),
    });
  }

  const app = createApp(runtimeService);
  app.addHook("onClose", async () => {
    outboxFlusher.stop();
  });

  try {
    outboxFlusher.start();
    await app.listen({ host: config.HOST, port: config.PORT });
    logger.info({ host: config.HOST, port: config.PORT }, "retrieval-runtime listening");
  } catch (error) {
    logger.error({ err: error }, "failed to start retrieval-runtime");
    process.exitCode = 1;
  }
}

void main();
