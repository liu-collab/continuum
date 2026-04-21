import Fastify from "fastify";
import { z } from "zod";

import { ValidationError } from "./errors.js";
import { hostAdapters } from "./host-adapters/index.js";
import { finalizeTurnInputSchema, prepareContextInputSchema } from "./host-adapters/types.js";
import type { RetrievalRuntimeService } from "./runtime-service.js";
import { observeRunsQuerySchema } from "./api/schemas.js";

const memoryModeSchema = z.enum(["workspace_only", "workspace_plus_global"]);
const RETRIEVAL_RUNTIME_VERSION = "0.1.0";

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

  app.get("/healthz", async () => ({
    version: RETRIEVAL_RUNTIME_VERSION,
    api_version: "v1",
    liveness: (await runtimeService.getLiveness()).status,
    readiness: (await runtimeService.getReadiness()).status,
    dependencies: await runtimeService.getDependencies(),
  }));

  app.get("/v1/runtime/health/liveness", async () => runtimeService.getLiveness());
  app.get("/v1/runtime/health/readiness", async () => runtimeService.getReadiness());
  app.get("/v1/runtime/health/dependencies", async () => runtimeService.getDependencies());
  app.get("/v1/runtime/dependency-status", async () => runtimeService.getDependencies());
  app.post("/v1/runtime/dependency-status/embeddings/check", async () => runtimeService.checkEmbeddings());

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
      });
    const parsed = payloadSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid session-start payload", parsed.error.flatten());
    }

    const adapter = hostAdapters[parsed.data.host as keyof typeof hostAdapters];
    return runtimeService.sessionStartContext(adapter.toTriggerContext(parsed.data));
  });

  app.post("/v1/runtime/prepare-context", async (request) => {
    const parsed = prepareContextInputSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid prepare-context payload", parsed.error.flatten());
    }

    const adapter = hostAdapters[parsed.data.host as keyof typeof hostAdapters];
    return runtimeService.prepareContext(adapter.toTriggerContext(parsed.data));
  });

  app.post("/v1/runtime/finalize-turn", async (request) => {
    const parsed = finalizeTurnInputSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid finalize-turn payload", parsed.error.flatten());
    }

    const adapter = hostAdapters[parsed.data.host as keyof typeof hostAdapters];
    return runtimeService.finalizeTurn(adapter.toFinalizeInput(parsed.data));
  });

  app.get("/v1/runtime/observe/runs", async (request) => {
    const parsed = observeRunsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new ValidationError("Invalid observe runs query", parsed.error.flatten());
    }

    return runtimeService.getRuns(parsed.data);
  });

  app.get("/v1/runtime/observe/metrics", async () => runtimeService.getMetrics());

  return app;
}
