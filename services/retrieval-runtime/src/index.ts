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
import { HttpStorageWritebackClient } from "./writeback/storage-client.js";
import { WritebackEngine } from "./writeback/writeback-engine.js";
import { createApp } from "./app.js";

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
  const llmExtractor = config.WRITEBACK_LLM_BASE_URL ? new HttpLlmExtractor(config) : undefined;

  const runtimeService = new RetrievalRuntimeService(
    new TriggerEngine(config, embeddingsClient, readModelRepository, dependencyGuard, logger),
    new QueryEngine(config, readModelRepository, embeddingsClient, dependencyGuard, logger),
    new InjectionEngine(config),
    new WritebackEngine(config, storageClient, dependencyGuard, llmExtractor),
    repository,
    dependencyGuard,
    logger,
  );

  const app = createApp(runtimeService);

  try {
    await app.listen({ host: config.HOST, port: config.PORT });
    logger.info({ host: config.HOST, port: config.PORT }, "retrieval-runtime listening");
  } catch (error) {
    logger.error({ err: error }, "failed to start retrieval-runtime");
    process.exitCode = 1;
  }
}

void main();
