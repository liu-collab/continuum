import type { Logger } from "pino";

import type { DependencyGuard } from "./dependency/dependency-guard.js";
import { RuntimeDependencyHealthChecker } from "./dependency/runtime-dependency-health-checker.js";
import type { InjectionEngine } from "./injection/injection-engine.js";
import {
  RecentInjectionPolicy,
  type RecentInjectionRuntimeConfig,
} from "./injection/recent-injection-policy.js";
import type { MemoryOrchestrator } from "./memory-orchestrator/index.js";
import type { RuntimeRepository } from "./observability/runtime-repository.js";
import type { EmbeddingsClient } from "./query/embeddings-client.js";
import { PrepareContextFinalizer } from "./query/prepare-context-finalizer.js";
import { PrepareContextService } from "./query/prepare-context-service.js";
import { RecallAugmentationService } from "./query/recall-augmentation-service.js";
import { RecallEffectivenessService } from "./query/recall-effectiveness-service.js";
import type { QueryEngine } from "./query/query-engine.js";
import type { RecallPreflight } from "./trigger/recall-preflight.js";
import type { TriggerEngine } from "./trigger/trigger-engine.js";
import type { FinalizeIdempotencyCache } from "./writeback/finalize-idempotency-cache.js";
import { FinalizeTurnService } from "./writeback/finalize-turn-service.js";
import type { StorageWritebackClient } from "./writeback/storage-client.js";
import type { WritebackEngine } from "./writeback/writeback-engine.js";

type RuntimeServiceGraphInput = {
  triggerEngine: TriggerEngine;
  queryEngine: QueryEngine;
  embeddingsClient: EmbeddingsClient;
  injectionEngine: InjectionEngine;
  writebackEngine: WritebackEngine;
  repository: RuntimeRepository;
  dependencyGuard: DependencyGuard;
  logger: Logger;
  finalizeIdempotencyCache?: FinalizeIdempotencyCache;
  embeddingTimeoutMs: number;
  memoryLlmTimeoutMs: number;
  memoryOrchestrator?: MemoryOrchestrator;
  storageClient?: StorageWritebackClient;
  recallPreflight?: RecallPreflight;
  recentInjectionConfig: RecentInjectionRuntimeConfig;
};

export type RuntimeServiceGraph = {
  dependencyHealthChecker: RuntimeDependencyHealthChecker;
  prepareContextService: PrepareContextService;
  finalizeTurnService: FinalizeTurnService;
};

export function createRuntimeServiceGraph(input: RuntimeServiceGraphInput): RuntimeServiceGraph {
  const recentInjectionPolicy = new RecentInjectionPolicy({
    config: input.recentInjectionConfig,
    repository: input.repository,
    logger: input.logger,
  });
  const dependencyHealthChecker = new RuntimeDependencyHealthChecker({
    embeddingsClient: input.embeddingsClient,
    repository: input.repository,
    logger: input.logger,
    embeddingTimeoutMs: input.embeddingTimeoutMs,
    memoryOrchestrator: input.memoryOrchestrator,
  });
  const recallAugmentationService = new RecallAugmentationService({
    dependencyGuard: input.dependencyGuard,
    repository: input.repository,
    logger: input.logger,
    embeddingTimeoutMs: input.embeddingTimeoutMs,
    memoryLlmTimeoutMs: input.memoryLlmTimeoutMs,
    memoryOrchestrator: input.memoryOrchestrator,
    storageClient: input.storageClient,
  });
  const recallEffectivenessService = new RecallEffectivenessService({
    dependencyGuard: input.dependencyGuard,
    repository: input.repository,
    writebackEngine: input.writebackEngine,
    embeddingTimeoutMs: input.embeddingTimeoutMs,
    memoryLlmTimeoutMs: input.memoryLlmTimeoutMs,
    evaluator: input.memoryOrchestrator?.recall?.effectiveness,
  });
  const prepareContextFinalizer = new PrepareContextFinalizer({
    repository: input.repository,
    injectionEngine: input.injectionEngine,
    recentInjectionPolicy,
    recallEffectivenessService,
  });

  return {
    dependencyHealthChecker,
    prepareContextService: new PrepareContextService({
      dependencyGuard: input.dependencyGuard,
      memoryLlmTimeoutMs: input.memoryLlmTimeoutMs,
      memoryOrchestrator: input.memoryOrchestrator,
      prepareContextFinalizer,
      queryEngine: input.queryEngine,
      recentInjectionPolicy,
      recallAugmentationService,
      recallPreflight: input.recallPreflight,
      repository: input.repository,
      triggerEngine: input.triggerEngine,
    }),
    finalizeTurnService: new FinalizeTurnService({
      dependencyGuard: input.dependencyGuard,
      finalizeIdempotencyCache: input.finalizeIdempotencyCache,
      recallEffectivenessService,
      repository: input.repository,
      writebackEngine: input.writebackEngine,
    }),
  };
}
