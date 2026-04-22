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
      runtime_min_version: MNA_VERSION,
      dependencies: {
        retrieval_runtime: runtimeStatus,
      },
    };
  });

  app.get("/readyz", async () => {
    const runtimeDependency = await app.runtimeState.memoryClient.dependencyStatus()
      .then(() => ({
        status: "reachable" as const,
      }))
      .catch((error) => ({
        status: "unreachable" as const,
        detail: error instanceof Error ? error.message : String(error),
      }));

    return {
      liveness: {
        status: "alive",
      },
      readiness: {
        status: "ready",
      },
      dependencies: {
        retrieval_runtime: runtimeDependency,
      },
    };
  });

  app.get("/v1/agent/dependency-status", async () => {
    const runtime = await app.runtimeState.memoryClient.dependencyStatus().catch(() => null);
    const providerKey = `${app.runtimeState.provider.id()}:${app.runtimeState.provider.model()}`;
    const providerStatus = app.runtimeState.provider.status?.() ?? {
      status: "configured" as const,
      detail: undefined,
    };
    return {
      runtime: runtime ?? {
        status: "unavailable",
        base_url: app.runtimeState.config.runtime.baseUrl,
        memory_llm: {
          status: "unknown",
          detail: "runtime dependency status is unavailable",
        },
      },
      provider: {
        id: app.runtimeState.provider.id(),
        model: app.runtimeState.provider.model(),
        status: providerStatus.status,
        detail: providerStatus.detail,
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
    cache: {
      fs_read_hits: app.runtimeState.metrics.cache.fsReadHits,
      fs_read_misses: app.runtimeState.metrics.cache.fsReadMisses,
      embedding_hits: app.runtimeState.metrics.cache.embeddingHits,
      embedding_misses: app.runtimeState.metrics.cache.embeddingMisses,
    },
    planning: {
      generated_total: app.runtimeState.metrics.planning.generatedTotal,
      revised_total: app.runtimeState.metrics.planning.revisedTotal,
      confirm_required_total: app.runtimeState.metrics.planning.confirmRequiredTotal,
      confirmed_total: app.runtimeState.metrics.planning.confirmedTotal,
      cancelled_total: app.runtimeState.metrics.planning.cancelledTotal,
    },
    retries: {
      total: app.runtimeState.metrics.retries.total,
      by_tool: app.runtimeState.metrics.retries.toolTotal,
    },
    context_budget: {
      dropped_messages_total: app.runtimeState.metrics.contextBudget.droppedMessagesTotal,
    },
    tool_batches: {
      total: app.runtimeState.metrics.toolBatches.total,
      parallel_calls_total: app.runtimeState.metrics.toolBatches.parallelCallsTotal,
      max_batch_size: app.runtimeState.metrics.toolBatches.maxBatchSize,
    },
    latency_p50_ms: {
      prepare_context: percentile(app.runtimeState.metrics.latencySamples.prepareContextMs, 0.5),
      provider_first_token: percentile(app.runtimeState.metrics.latencySamples.providerFirstTokenMs, 0.5),
    },
    latency_p95_ms: {
      prepare_context: percentile(app.runtimeState.metrics.latencySamples.prepareContextMs, 0.95),
      provider_first_token: percentile(app.runtimeState.metrics.latencySamples.providerFirstTokenMs, 0.95),
    },
  }));

  app.get("/metrics", async (_request, reply) => {
    const metrics = app.runtimeState.metrics;
    const lines = [
      `mna_turns_total ${metrics.turnsTotal}`,
      `mna_stream_flushed_events_total ${metrics.streamFlushedEventsTotal}`,
      `mna_stream_dropped_after_abort_total ${metrics.streamDroppedAfterAbortTotal}`,
      `mna_cache_fs_read_hits_total ${metrics.cache.fsReadHits}`,
      `mna_cache_fs_read_misses_total ${metrics.cache.fsReadMisses}`,
      `mna_cache_embedding_hits_total ${metrics.cache.embeddingHits}`,
      `mna_cache_embedding_misses_total ${metrics.cache.embeddingMisses}`,
      `mna_planning_generated_total ${metrics.planning.generatedTotal}`,
      `mna_planning_revised_total ${metrics.planning.revisedTotal}`,
      `mna_planning_confirm_required_total ${metrics.planning.confirmRequiredTotal}`,
      `mna_planning_confirmed_total ${metrics.planning.confirmedTotal}`,
      `mna_planning_cancelled_total ${metrics.planning.cancelledTotal}`,
      `mna_retries_total ${metrics.retries.total}`,
      `mna_context_budget_dropped_messages_total ${metrics.contextBudget.droppedMessagesTotal}`,
      `mna_tool_batches_total ${metrics.toolBatches.total}`,
      `mna_tool_batch_parallel_calls_total ${metrics.toolBatches.parallelCallsTotal}`,
      `mna_tool_batch_max_size ${metrics.toolBatches.maxBatchSize}`,
    ];

    reply.header("content-type", "text/plain; version=0.0.4");
    return lines.join("\n");
  });
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
}
