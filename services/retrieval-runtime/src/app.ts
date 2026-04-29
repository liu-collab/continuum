import Fastify, { type FastifyRequest } from "fastify";
import { z } from "zod";

import { runWithLogContext, type LogContextFields } from "./logger.js";
import { ValidationError } from "./errors.js";
import { hostAdapters } from "./host-adapters/index.js";
import { finalizeTurnInputSchema, prepareContextInputSchema } from "./host-adapters/types.js";
import type { RetrievalRuntimeService } from "./runtime-service.js";
import {
  resolveManagedRuntimeConfigPath,
  runtimeGovernanceConfigUpdateSchema,
  writeManagedRuntimeGovernanceConfigFile,
} from "./runtime-config.js";
import { observeRunsQuerySchema } from "./api/schemas.js";

const memoryModeSchema = z.enum(["workspace_only", "workspace_plus_global"]);
const RETRIEVAL_RUNTIME_VERSION = "0.1.0";

type RuntimePayloadLogContext = {
  host?: string;
  workspace_id?: string;
  task_id?: string;
  session_id?: string;
  thread_id?: string;
  turn_id?: string;
  phase?: string;
  memory_mode?: string;
};

function firstHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).find(Boolean);
  }
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function requestPath(request: FastifyRequest) {
  return request.url.split("?")[0] ?? request.url;
}

function requestLogContext(request: FastifyRequest): LogContextFields {
  return {
    request_id: firstHeaderValue(request.headers["x-request-id"]) ?? request.id,
    http_method: request.method,
    http_path: requestPath(request),
  };
}

function runtimePayloadLogContext(
  input: RuntimePayloadLogContext,
  phaseOverride?: string,
): LogContextFields {
  return {
    host: input.host,
    workspace_id: input.workspace_id,
    task_id: input.task_id,
    session_id: input.session_id,
    thread_id: input.thread_id,
    turn_id: input.turn_id,
    phase: phaseOverride ?? input.phase,
    memory_mode: input.memory_mode,
  };
}

function withRequestLogContext<T>(
  request: FastifyRequest,
  fields: LogContextFields,
  callback: () => T,
): T {
  return runWithLogContext(
    {
      ...requestLogContext(request),
      ...fields,
    },
    callback,
  );
}

export function createApp(runtimeService: RetrievalRuntimeService) {
  const app = Fastify({
    logger: false,
  });

  app.setErrorHandler((error, _request, reply) => {
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    const code =
      typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
        ? error.code
        : "internal_error";
    const message = error instanceof Error ? error.message : "Internal server error";

    reply.status(statusCode).send({
      error: {
        code,
        message,
      },
    });
  });

  app.get("/healthz", async (request) =>
    withRequestLogContext(request, {}, async () => ({
      version: RETRIEVAL_RUNTIME_VERSION,
      api_version: "v1",
      liveness: (await runtimeService.getLiveness()).status,
      readiness: (await runtimeService.getReadiness()).status,
      dependencies: await runtimeService.getDependencies(),
    })),
  );

  app.get("/v1/runtime/health/liveness", async (request) =>
    withRequestLogContext(request, {}, () => runtimeService.getLiveness()),
  );
  app.get("/v1/runtime/health/readiness", async (request) =>
    withRequestLogContext(request, {}, () => runtimeService.getReadiness()),
  );
  app.get("/v1/runtime/health/dependencies", async (request) =>
    withRequestLogContext(request, {}, () => runtimeService.getDependencies()),
  );
  app.get("/v1/runtime/dependency-status", async (request) =>
    withRequestLogContext(request, {}, () => runtimeService.getDependencies()),
  );
  app.get("/v1/runtime/config", async (request) =>
    withRequestLogContext(request, {}, () => ({
      governance: runtimeService.getRuntimeGovernanceConfig(),
    })),
  );
  app.put("/v1/runtime/config", async (request) => {
    const payloadSchema = z.object({
      governance: runtimeGovernanceConfigUpdateSchema.optional(),
    });
    const parsed = payloadSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw new ValidationError("Invalid runtime config payload", parsed.error.flatten());
    }

    return withRequestLogContext(request, {}, async () => {
      const update = parsed.data.governance ?? {};
      const next = {
        ...runtimeService.getRuntimeGovernanceConfig(),
        ...update,
      };
      await writeManagedRuntimeGovernanceConfigFile(resolveManagedRuntimeConfigPath(), next);
      runtimeService.updateRuntimeGovernanceConfig(update);
      return {
        ok: true,
        governance: next,
      };
    });
  });
  app.post("/v1/runtime/dependency-status/embeddings/check", async (request) =>
    withRequestLogContext(request, { dependency: "embeddings" }, () => runtimeService.checkEmbeddings()),
  );
  app.post("/v1/runtime/dependency-status/memory-llm/check", async (request) =>
    withRequestLogContext(request, { dependency: "memory_llm" }, () => runtimeService.checkMemoryLlm()),
  );

  app.post("/v1/runtime/session-start-context", async (request) => {
    const payloadSchema = z
      .object({
        host: z.enum(["claude_code_plugin", "codex_app_server", "custom_agent", "memory_native_agent"]),
        session_id: z.string().min(1),
        cwd: z.string().optional(),
        source: z.string().optional(),
        user_id: z.string().uuid(),
        workspace_id: z.string().uuid(),
        task_id: z.string().uuid().optional(),
        recent_context_summary: z.string().optional(),
        memory_mode: memoryModeSchema.optional(),
        injection_token_budget: z.coerce.number().int().positive().optional(),
      });
    const parsed = payloadSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid session-start payload", parsed.error.flatten());
    }

    const adapter = hostAdapters[parsed.data.host as keyof typeof hostAdapters];
    return withRequestLogContext(
      request,
      runtimePayloadLogContext(parsed.data, "session_start"),
      () => runtimeService.sessionStartContext(adapter.toTriggerContext(parsed.data)),
    );
  });

  app.post("/v1/runtime/prepare-context", async (request) => {
    const parsed = prepareContextInputSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid prepare-context payload", parsed.error.flatten());
    }

    const adapter = hostAdapters[parsed.data.host as keyof typeof hostAdapters];
    return withRequestLogContext(
      request,
      runtimePayloadLogContext(parsed.data),
      () => runtimeService.prepareContext(adapter.toTriggerContext(parsed.data)),
    );
  });

  app.post("/v1/runtime/finalize-turn", async (request) => {
    const parsed = finalizeTurnInputSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid finalize-turn payload", parsed.error.flatten());
    }

    const adapter = hostAdapters[parsed.data.host as keyof typeof hostAdapters];
    return withRequestLogContext(
      request,
      runtimePayloadLogContext(parsed.data, "after_response"),
      () => runtimeService.finalizeTurn(adapter.toFinalizeInput(parsed.data)),
    );
  });

  app.post("/v1/runtime/write-projection-status", async (request) => {
    const payloadSchema = z.object({
      job_ids: z.array(z.string().uuid()).min(1).max(100),
    });
    const parsed = payloadSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid write projection status payload", parsed.error.flatten());
    }

    return withRequestLogContext(request, { job_count: parsed.data.job_ids.length }, async () => ({
      items: await runtimeService.getWriteProjectionStatuses(parsed.data.job_ids),
    }));
  });

  app.get("/v1/runtime/observe/runs", async (request) => {
    const parsed = observeRunsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new ValidationError("Invalid observe runs query", parsed.error.flatten());
    }

    return withRequestLogContext(
      request,
      {
        session_id: parsed.data.session_id,
        turn_id: parsed.data.turn_id,
        trace_id: parsed.data.trace_id,
      },
      () => runtimeService.getRuns(parsed.data),
    );
  });

  app.get("/v1/runtime/observe/metrics", async (request) =>
    withRequestLogContext(request, {}, () => runtimeService.getMetrics()),
  );

  app.post("/v1/runtime/cache/clear", async (request) => {
    const payloadSchema = z.object({
      embedding_cache: z.boolean().optional(),
      finalize_idempotency_cache: z.boolean().optional(),
    });
    const parsed = payloadSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw new ValidationError("Invalid cache clear payload", parsed.error.flatten());
    }

    return withRequestLogContext(
      request,
      {
        cache_clear_embedding: parsed.data.embedding_cache ?? true,
        cache_clear_finalize_idempotency: parsed.data.finalize_idempotency_cache ?? true,
      },
      () => runtimeService.clearCaches(parsed.data),
    );
  });

  app.post("/v1/runtime/writeback-maintenance/run", async (request) => {
    const payloadSchema = z
      .object({
        workspace_id: z.string().uuid().optional(),
        force: z.boolean().optional(),
      });
    const parsed = payloadSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw new ValidationError("Invalid writeback-maintenance payload", parsed.error.flatten());
    }
    return withRequestLogContext(
      request,
      {
        workspace_id: parsed.data.workspace_id,
        maintenance_force: parsed.data.force,
      },
      () => runtimeService.runMaintenance(parsed.data),
    );
  });

  return app;
}
