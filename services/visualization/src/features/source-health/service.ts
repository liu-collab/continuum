import "server-only";

import { ServiceHealthResponse, SourceStatus } from "@/lib/contracts";
import { getCachedValue } from "@/lib/cache";
import { getAppConfig } from "@/lib/env";
import { fetchRuntimeMetrics } from "@/lib/server/runtime-observe-client";
import { pingMemoryReadModel } from "@/lib/server/storage-read-model-client";
import { fetchStorageMetrics } from "@/lib/server/storage-observe-client";

export async function getSourceHealth(): Promise<ServiceHealthResponse> {
  const { values } = getAppConfig();

  return getCachedValue("source-health", values.SOURCE_HEALTH_CACHE_MS, async () => {
    const checkedAt = new Date().toISOString();
    const [readModel, storageApi, runtimeApi] = await Promise.all([
      pingMemoryReadModel(),
      fetchStorageMetrics().then((result) => result.status),
      fetchRuntimeMetrics().then((result) => result.status)
    ]);

    const dependencies: SourceStatus[] = [readModel, storageApi, runtimeApi];
    const degradedDependencies = dependencies.filter((item) => item.status !== "healthy");

    return {
      liveness: {
        status: "ok",
        checkedAt
      },
      readiness: {
        status: "ready",
        checkedAt,
        summary:
          degradedDependencies.length > 0
            ? "Visualization is ready and serving degraded responses while some dependencies are unhealthy."
            : "Visualization is ready and dependencies are healthy."
      },
      service: {
        name: "visualization",
        summary:
          degradedDependencies.length > 0
            ? "The service is healthy; the current issue is isolated to upstream dependencies."
            : "The service is healthy and no dependency issue is currently visible."
      },
      dependencies
    };
  });
}
