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

const listMemoryQuerySchema = z.object({
  workspace_id: z.string().optional(),
  user_id: z.string().optional(),
  task_id: z.string().optional(),
  session_id: z.string().optional(),
  memory_type: z.enum(["fact", "preference", "task_state", "episodic"]).optional(),
  scope: z.enum(["workspace", "user", "task", "session"]).optional(),
  status: z.enum(["active", "pending_confirmation", "superseded", "archived", "deleted"]).optional(),
  memory_view_mode: memoryModeSchema.optional(),
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().max(100).optional(),
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
        load_state: store.loadState(),
        write_queue: store.writeQueueStats(),
        writeback_outbox_path: outbox.path,
      },
      memory_model_status: memoryModel.status,
      traces: {
        count: traces.size(),
      },
    };
  });

  app.get("/v1/lite/memories", async (request, reply) => {
    const parsed = listMemoryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      reply.status(400);
      return {
        error: {
          code: "invalid_lite_memory_query",
          message: "Invalid lite memory list query",
          details: parsed.error.flatten(),
        },
      };
    }

    await store.load();
    const page = parsed.data.page ?? 1;
    const pageSize = parsed.data.page_size ?? 20;
    const records = store.listRecords()
      .filter((record) => !parsed.data.workspace_id || record.workspace_id === parsed.data.workspace_id)
      .filter((record) => !parsed.data.user_id || record.scope !== "user" || record.user_id === parsed.data.user_id)
      .filter((record) => !parsed.data.task_id || record.scope !== "task" || record.task_id === parsed.data.task_id)
      .filter((record) => !parsed.data.session_id || record.scope !== "session" || record.session_id === parsed.data.session_id)
      .filter((record) => !parsed.data.memory_type || record.memory_type === parsed.data.memory_type)
      .filter((record) => !parsed.data.scope || record.scope === parsed.data.scope)
      .filter((record) => parsed.data.memory_view_mode !== "workspace_only" || record.scope !== "user")
      .filter((record) => !parsed.data.status || record.status === parsed.data.status);
    const offset = (page - 1) * pageSize;

    return {
      items: records.slice(offset, offset + pageSize),
      total: records.length,
      page,
      page_size: pageSize,
      memory_model_status: memoryModel.status,
      storage: {
        path: store.path,
        records: store.size(),
        load_state: store.loadState(),
      },
    };
  });

  app.get("/v1/lite/memories/:record_id", async (request, reply) => {
    const params = z.object({ record_id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) {
      reply.status(400);
      return {
        error: {
          code: "invalid_lite_record_id",
          message: "Invalid lite record id",
        },
      };
    }

    await store.load();
    const record = store.get(params.data.record_id);
    if (!record) {
      reply.status(404);
      return {
        error: {
          code: "lite_record_not_found",
          message: "Lite record not found",
        },
      };
    }
    return record;
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
      host: parsed.data.host,
      workspace_id: parsed.data.workspace_id,
      user_id: parsed.data.user_id,
      session_id: parsed.data.session_id,
      ...(parsed.data.task_id ? { task_id: parsed.data.task_id } : {}),
      ...(parsed.data.thread_id ? { thread_id: parsed.data.thread_id } : {}),
      ...(parsed.data.turn_id ? { turn_id: parsed.data.turn_id } : {}),
      current_input: parsed.data.current_input,
      assistant_output: parsed.data.assistant_output,
      memory_mode: parsed.data.memory_mode ?? "workspace_plus_global",
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

  app.get("/v1/lite/traces", async () => ({
    items: traces.list(),
    total: traces.size(),
    memory_model_status: memoryModel.status,
  }));

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
