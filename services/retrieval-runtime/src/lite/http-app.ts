import Fastify from "fastify";
import { z } from "zod";

import { FileMemoryStore } from "./file-store.js";
import { MemoryOrchestrator } from "./memory-orchestrator.js";
import { resolveLiteMemoryModel, type LiteMemoryModelConfigSource, type LiteMemoryModelResolution } from "./memory-model-config.js";
import { LiteTraceStore } from "./trace-store.js";
import { LiteWritebackEngine } from "./writeback-engine.js";
import { LiteWritebackOutbox } from "./writeback-outbox.js";
import { HttpMemoryWritebackPlanner } from "../memory-orchestrator/writeback/planner.js";

const hostSchema = z.enum(["claude_code_plugin", "codex_app_server", "custom_agent", "memory_native_agent"]);
const memoryModeSchema = z.enum(["workspace_only", "workspace_plus_global"]);
const runtimePhaseSchema = z.enum([
  "session_start",
  "task_start",
  "task_switch",
  "before_plan",
  "before_response",
  "after_response",
]);

const recentTurnSchema = z.object({
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string(),
  turn_id: z.string().optional(),
});

const writebackRecentTurnSchema = z.object({
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string().optional(),
  summary: z.string().optional(),
  turn_id: z.string().optional(),
}).refine((turn) => Boolean(turn.content || turn.summary), {
  message: "content or summary is required",
});

const prepareContextSchema = z.object({
  host: hostSchema,
  workspace_id: z.string().min(1),
  user_id: z.string().min(1),
  session_id: z.string().min(1),
  phase: runtimePhaseSchema,
  current_input: z.string(),
  task_id: z.string().optional(),
  thread_id: z.string().optional(),
  turn_id: z.string().optional(),
  recent_context_summary: z.string().optional(),
  recent_turns: z.array(recentTurnSchema).optional(),
  memory_mode: memoryModeSchema.optional(),
  injection_token_budget: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

const afterResponseSchema = z.object({
  trace_id: z.string().optional(),
  host: hostSchema,
  workspace_id: z.string().min(1),
  user_id: z.string().min(1),
  session_id: z.string().min(1),
  current_input: z.string(),
  assistant_output: z.string(),
  task_id: z.string().optional(),
  thread_id: z.string().optional(),
  turn_id: z.string().optional(),
  recent_context_summary: z.string().optional(),
  recent_turns: z.array(writebackRecentTurnSchema).optional(),
  tool_results_summary: z.string().optional(),
  memory_mode: memoryModeSchema.optional(),
  candidates: z.array(z.unknown()).optional(),
});

export interface LiteRuntimeHttpOptions {
  memoryDir: string;
  configSource?: LiteMemoryModelConfigSource;
  store?: FileMemoryStore;
  traces?: LiteTraceStore;
  outbox?: LiteWritebackOutbox;
  writebackEngine?: LiteWritebackEngine;
}

export function createLiteRuntimeApp(options: LiteRuntimeHttpOptions) {
  const app = Fastify({ logger: false });
  const store = options.store ?? new FileMemoryStore({ memoryDir: options.memoryDir });
  const memoryModel = resolveLiteMemoryModel(options.configSource ?? {});
  const orchestrator = new MemoryOrchestrator({
    store,
    memoryModelStatus: memoryModel.status,
  });
  const traces = options.traces ?? new LiteTraceStore();
  const outbox = options.outbox ?? new LiteWritebackOutbox({ memoryDir: options.memoryDir });
  const writebackEngine = options.writebackEngine ?? new LiteWritebackEngine({
    store,
    outbox,
    memoryModelStatus: memoryModel.status,
    writebackPlanner: createLiteWritebackPlanner(memoryModel),
  });

  app.setErrorHandler((error, _request, reply) => {
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    reply.status(statusCode).send({
      error: {
        code: "lite_runtime_error",
        message: error instanceof Error ? error.message : "Lite runtime error",
      },
    });
  });

  app.get("/v1/lite/healthz", async () => {
    await store.load();
    return {
      ok: true,
      mode: "lite",
      storage: {
        path: store.path,
        records: store.size(),
        write_queue: store.writeQueueStats(),
        writeback_outbox_path: outbox.path,
      },
      memory_model_status: memoryModel.status,
      traces: {
        count: traces.size(),
      },
    };
  });

  app.post("/v1/lite/prepare-context", async (request, reply) => {
    const parsed = prepareContextSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return {
        error: {
          code: "invalid_prepare_context",
          message: "Invalid lite prepare-context payload",
          details: parsed.error.flatten(),
        },
      };
    }

    const result = await orchestrator.prepareContext(parsed.data);
    traces.upsertPrepare(result.trace);
    return result;
  });

  app.post("/v1/lite/after-response", async (request, reply) => {
    const parsed = afterResponseSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return {
        error: {
          code: "invalid_after_response",
          message: "Invalid lite after-response payload",
          details: parsed.error.flatten(),
        },
      };
    }

    const result = await writebackEngine.process(parsed.data);
    traces.appendWriteback({
      trace_id: result.trace_id,
      accepted_record_ids: result.accepted_record_ids,
      accepted_count: result.accepted_count,
      filtered_reasons: result.filtered_reasons,
      outbox_queued_count: result.outbox_queued_count,
      outbox_retry: result.outbox_retry,
      extractor: result.extractor,
      degraded: result.degraded,
      degradation_reason: result.degradation_reason,
      created_at: new Date().toISOString(),
    });
    return result;
  });

  app.get("/v1/lite/traces/:trace_id", async (request, reply) => {
    const params = z.object({ trace_id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) {
      reply.status(400);
      return {
        error: {
          code: "invalid_trace_id",
          message: "Invalid trace id",
        },
      };
    }

    const trace = traces.get(params.data.trace_id);
    if (!trace) {
      reply.status(404);
      return {
        error: {
          code: "trace_not_found",
          message: "Trace not found",
        },
      };
    }
    return trace;
  });

  return app;
}

function createLiteWritebackPlanner(memoryModel: LiteMemoryModelResolution) {
  if (!memoryModel.status.configured) {
    return undefined;
  }

  return new HttpMemoryWritebackPlanner({
    MEMORY_LLM_BASE_URL: memoryModel.config.baseUrl,
    MEMORY_LLM_MODEL: memoryModel.config.model ?? "memory-model",
    MEMORY_LLM_API_KEY: memoryModel.config.apiKey,
    MEMORY_LLM_PROTOCOL: memoryModel.config.protocol ?? "openai-compatible",
    MEMORY_LLM_TIMEOUT_MS: memoryModel.config.timeoutMs ?? 45_000,
    MEMORY_LLM_EFFORT: memoryModel.config.effort ?? undefined,
    MEMORY_LLM_MAX_TOKENS: memoryModel.config.maxTokens ?? 600,
    MEMORY_LLM_REFINE_MAX_TOKENS: 800,
    WRITEBACK_MAX_CANDIDATES: 5,
  });
}
