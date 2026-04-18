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
            ? "可视化服务仍可用，但当前有部分依赖处于降级状态。"
            : "可视化服务已就绪，依赖状态正常。"
      },
      service: {
        name: "visualization",
        summary:
          degradedDependencies.length > 0
            ? "当前问题被限制在上游依赖，可视化服务本身仍然健康。"
            : "可视化服务和依赖都处于健康状态。"
      },
      dependencies
    };
  });
}
