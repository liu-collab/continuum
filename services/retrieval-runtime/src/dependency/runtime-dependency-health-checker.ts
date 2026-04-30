import type { Logger } from "pino";

import type { MemoryOrchestrator } from "../memory-orchestrator/index.js";
import type { RuntimeRepository } from "../observability/runtime-repository.js";
import type { EmbeddingsClient } from "../query/embeddings-client.js";
import type { DependencyStatus } from "../shared/types.js";
import { nowIso } from "../shared/utils.js";

type RuntimeDependencyHealthCheckerOptions = {
  embeddingsClient: EmbeddingsClient;
  repository: Pick<RuntimeRepository, "updateDependencyStatus">;
  logger: Logger;
  embeddingTimeoutMs: number;
  memoryOrchestrator?: MemoryOrchestrator;
};

export class RuntimeDependencyHealthChecker {
  constructor(private readonly options: RuntimeDependencyHealthCheckerOptions) {}

  async checkEmbeddings(): Promise<DependencyStatus> {
    const controller = new AbortController();
    let rejectTimeout: ((error: Error) => void) | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      rejectTimeout = reject;
    });
    const timeoutHandle = setTimeout(() => {
      if (controller.signal.aborted) {
        return;
      }
      controller.abort("timeout");
      rejectTimeout?.(new Error("embeddings timed out"));
    }, this.options.embeddingTimeoutMs);

    try {
      await Promise.race([
        this.options.embeddingsClient.embedText("embedding health check", controller.signal),
        timeoutPromise,
      ]);
      const status: DependencyStatus = {
        name: "embeddings",
        status: "healthy",
        detail: "embedding request completed",
        last_checked_at: nowIso(),
      };
      await this.options.repository.updateDependencyStatus(status);
      return status;
    } catch (error) {
      const status: DependencyStatus = {
        name: "embeddings",
        status: controller.signal.aborted ? "degraded" : "unavailable",
        detail:
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : controller.signal.aborted
              ? "embeddings timed out"
              : "embeddings unavailable",
        last_checked_at: nowIso(),
      };
      await this.options.repository.updateDependencyStatus(status);
      this.options.logger.warn({ dependency: "embeddings", err: error }, "embedding health check failed");
      return status;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  async checkMemoryLlm(): Promise<DependencyStatus> {
    const healthCheck = this.resolveMemoryLlmHealthCheck();
    if (!healthCheck) {
      const status: DependencyStatus = {
        name: "memory_llm",
        status: "unavailable",
        detail: "memory llm is not configured",
        last_checked_at: nowIso(),
      };
      await this.options.repository.updateDependencyStatus(status);
      return status;
    }

    try {
      await healthCheck();
      const status: DependencyStatus = {
        name: "memory_llm",
        status: "healthy",
        detail: "memory llm request completed",
        last_checked_at: nowIso(),
      };
      await this.options.repository.updateDependencyStatus(status);
      return status;
    } catch (error) {
      const detail =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "memory llm unavailable";
      const status: DependencyStatus = {
        name: "memory_llm",
        status: detail.includes("timeout") ? "degraded" : "unavailable",
        detail,
        last_checked_at: nowIso(),
      };
      await this.options.repository.updateDependencyStatus(status);
      this.options.logger.warn({ dependency: "memory_llm", err: error }, "memory llm health check failed");
      return status;
    }
  }

  private resolveMemoryLlmHealthCheck(): (() => Promise<void> | undefined) | undefined {
    const recallSearch = this.options.memoryOrchestrator?.recall?.search;
    if (recallSearch?.healthCheck) {
      return () => recallSearch.healthCheck?.();
    }

    const recallInjection = this.options.memoryOrchestrator?.recall?.injection;
    if (recallInjection?.healthCheck) {
      return () => recallInjection.healthCheck?.();
    }

    const writeback = this.options.memoryOrchestrator?.writeback;
    if (writeback?.healthCheck) {
      return () => writeback.healthCheck?.();
    }

    return undefined;
  }
}
