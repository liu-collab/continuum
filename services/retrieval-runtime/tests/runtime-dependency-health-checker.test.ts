import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RuntimeDependencyHealthChecker } from "../src/dependency/runtime-dependency-health-checker.js";
import type { MemoryOrchestrator } from "../src/memory-orchestrator/index.js";
import type { EmbeddingsClient } from "../src/query/embeddings-client.js";
import type { DependencyStatus } from "../src/shared/types.js";

function createRepository() {
  const statuses: DependencyStatus[] = [];
  return {
    statuses,
    repository: {
      updateDependencyStatus: vi.fn(async (status: DependencyStatus) => {
        statuses.push(status);
      }),
    },
  };
}

describe("RuntimeDependencyHealthChecker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks embeddings healthy after a successful probe", async () => {
    const { repository, statuses } = createRepository();
    const embeddingsClient: EmbeddingsClient = {
      embedText: vi.fn(async () => [0.1, 0.2]),
    };
    const checker = new RuntimeDependencyHealthChecker({
      embeddingsClient,
      repository,
      logger: pino({ enabled: false }),
      embeddingTimeoutMs: 100,
    });

    const status = await checker.checkEmbeddings();

    expect(status).toMatchObject({
      name: "embeddings",
      status: "healthy",
      detail: "embedding request completed",
    });
    expect(statuses.at(-1)).toEqual(status);
    expect(embeddingsClient.embedText).toHaveBeenCalledWith("embedding health check", expect.any(AbortSignal));
  });

  it("marks embeddings degraded when the probe times out", async () => {
    vi.useFakeTimers();
    const { repository, statuses } = createRepository();
    const embeddingsClient: EmbeddingsClient = {
      embedText: vi.fn(async (_text, signal) => {
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("embeddings timed out")), { once: true });
        });
        return [0.1, 0.2];
      }),
    };
    const checker = new RuntimeDependencyHealthChecker({
      embeddingsClient,
      repository,
      logger: pino({ enabled: false }),
      embeddingTimeoutMs: 50,
    });

    const request = checker.checkEmbeddings();
    await vi.advanceTimersByTimeAsync(50);
    const status = await request;

    expect(status).toMatchObject({
      name: "embeddings",
      status: "degraded",
      detail: "embeddings timed out",
    });
    expect(statuses.at(-1)).toEqual(status);
  });

  it("uses the memory llm recall health check when available", async () => {
    const { repository, statuses } = createRepository();
    const healthCheck = vi.fn(async () => undefined);
    const orchestrator = {
      recall: {
        search: {
          plan: vi.fn(),
          healthCheck,
        },
      },
    } satisfies MemoryOrchestrator;
    const checker = new RuntimeDependencyHealthChecker({
      embeddingsClient: { embedText: vi.fn() },
      repository,
      logger: pino({ enabled: false }),
      embeddingTimeoutMs: 100,
      memoryOrchestrator: orchestrator,
    });

    const status = await checker.checkMemoryLlm();

    expect(healthCheck).toHaveBeenCalledTimes(1);
    expect(status).toMatchObject({
      name: "memory_llm",
      status: "healthy",
      detail: "memory llm request completed",
    });
    expect(statuses.at(-1)).toEqual(status);
  });

  it("reports memory llm unavailable when no probe is configured", async () => {
    const { repository } = createRepository();
    const checker = new RuntimeDependencyHealthChecker({
      embeddingsClient: { embedText: vi.fn() },
      repository,
      logger: pino({ enabled: false }),
      embeddingTimeoutMs: 100,
    });

    const status = await checker.checkMemoryLlm();

    expect(status).toMatchObject({
      name: "memory_llm",
      status: "unavailable",
      detail: "memory llm is not configured",
    });
  });
});
