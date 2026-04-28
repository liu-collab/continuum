import "server-only";

import { ServiceHealthResponse, SourceStatus } from "@/lib/contracts";
import { getCachedValue } from "@/lib/cache";
import { getAppConfig } from "@/lib/env";
import { fetchRuntimeMetrics } from "@/lib/server/runtime-observe-client";
import { pingMemoryReadModel } from "@/lib/server/storage-read-model-client";
import { fetchStorageMetrics } from "@/lib/server/storage-observe-client";
import { createTranslator } from "@/lib/i18n/messages";
import { getRequestLocale } from "@/lib/i18n/server";

export async function getSourceHealth(): Promise<ServiceHealthResponse> {
  const { values } = getAppConfig();
  const locale = await getRequestLocale();
  const t = createTranslator(locale);

  return getCachedValue(`source-health:${locale}`, values.SOURCE_HEALTH_CACHE_MS, async () => {
    const checkedAt = new Date().toISOString();
    const [readModel, storageApi, runtimeApi] = await Promise.all([
      pingMemoryReadModel({ locale }),
      fetchStorageMetrics({ locale }).then((result) => result.status),
      fetchRuntimeMetrics({ locale }).then((result) => result.status)
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
            ? t("health.readinessDegraded")
            : t("health.readinessHealthy")
      },
      service: {
        name: "visualization",
        summary:
          degradedDependencies.length > 0
            ? t("health.serviceDegraded")
            : t("health.serviceHealthy")
      },
      dependencies
    };
  });
}
