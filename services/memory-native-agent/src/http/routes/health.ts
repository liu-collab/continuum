import type { RuntimeFastifyInstance } from "../types.js";
import { MNA_VERSION } from "../../shared/types.js";

export function registerHealthRoutes(app: RuntimeFastifyInstance) {
  app.get("/healthz", async () => {
    const runtimeStatus = await app.runtimeState.memoryClient.dependencyStatus()
      .then(() => "reachable" as const)
      .catch(() => "unreachable" as const);

    return {
    status: "ok",
    version: MNA_VERSION,
    api_version: "v1",
    runtime_min_version: "0.1.3",
    dependencies: {
      retrieval_runtime: runtimeStatus,
    },
    };
  });

  app.get("/readyz", async (_request, reply) => {
    try {
      await app.runtimeState.memoryClient.dependencyStatus();
      return {
        status: "ready",
      };
    } catch {
      return reply.code(503).send({
        status: "not_ready",
      });
    }
  });

  app.get("/v1/agent/dependency-status", async () => {
    const runtime = await app.runtimeState.memoryClient.dependencyStatus().catch(() => null);
    const providerKey = `${app.runtimeState.provider.id()}:${app.runtimeState.provider.model()}`;
    return {
      runtime: runtime ?? {
        status: "unavailable",
        base_url: app.runtimeState.config.runtime.baseUrl,
      },
      provider: {
        id: app.runtimeState.provider.id(),
        model: app.runtimeState.provider.model(),
        status: "configured",
      },
      mcp: app.runtimeState.mcpRegistry.listServerStatuses(),
      provider_key: providerKey,
    };
  });

  app.get("/v1/agent/metrics", async () => ({
    uptime_s: Math.floor((Date.now() - app.runtimeState.metrics.startedAt) / 1000),
    turns_total: app.runtimeState.metrics.turnsTotal,
    turns_by_finish_reason: app.runtimeState.metrics.turnsByFinishReason,
    provider_calls_total: app.runtimeState.metrics.providerCallsTotal,
    provider_errors_total: app.runtimeState.metrics.providerErrorsTotal,
    tool_invocations_total: app.runtimeState.metrics.toolInvocationsTotal,
    tool_denials_total: app.runtimeState.metrics.toolDenialsTotal,
    stream_flushed_events_total: app.runtimeState.metrics.streamFlushedEventsTotal,
    stream_dropped_after_abort_total: app.runtimeState.metrics.streamDroppedAfterAbortTotal,
    runtime_errors_total: app.runtimeState.metrics.runtimeErrorsTotal,
  }));
}
