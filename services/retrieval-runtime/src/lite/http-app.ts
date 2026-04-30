import Fastify from "fastify";
import { z } from "zod";

import { FileMemoryStore, type LiteMemoryRecord } from "./file-store.js";
import { MemoryOrchestrator } from "./memory-orchestrator.js";
import { resolveLiteMemoryModel, type LiteMemoryModelConfigSource } from "./memory-model-config.js";
import { LiteTraceStore } from "./trace-store.js";
import type { HostKind, MemoryMode, MemoryType, ScopeType, WriteBackCandidate } from "../shared/types.js";

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
  tool_results_summary: z.string().optional(),
  memory_mode: memoryModeSchema.optional(),
  candidates: z.array(z.unknown()).optional(),
});

export interface LiteRuntimeHttpOptions {
  memoryDir: string;
  configSource?: LiteMemoryModelConfigSource;
  store?: FileMemoryStore;
  traces?: LiteTraceStore;
}

export interface LiteAfterResponseResult {
  trace_id: string;
  writeback_status: "accepted" | "skipped";
  accepted_count: number;
  filtered_reasons: string[];
  accepted_record_ids: string[];
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

    await store.load();
    const result = await appendLiteWritebackCandidates(store, parsed.data);
    traces.appendWriteback({
      trace_id: result.trace_id,
      accepted_record_ids: result.accepted_record_ids,
      accepted_count: result.accepted_count,
      filtered_reasons: result.filtered_reasons,
      degraded: false,
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

async function appendLiteWritebackCandidates(
  store: FileMemoryStore,
  input: z.infer<typeof afterResponseSchema>,
): Promise<LiteAfterResponseResult> {
  const accepted: LiteMemoryRecord[] = [];
  const filteredReasons: string[] = [];
  const candidates = input.candidates ?? [];

  for (const rawCandidate of candidates) {
    const candidate = normalizeWriteBackCandidate(rawCandidate, input);
    if (!candidate) {
      filteredReasons.push("invalid_candidate");
      continue;
    }

    if (containsSecret(candidate.summary) || containsSecret(JSON.stringify(candidate.details))) {
      filteredReasons.push("sensitive_content");
      continue;
    }

    if (isDuplicate(store, candidate)) {
      filteredReasons.push("ignore_duplicate");
      continue;
    }

    accepted.push(candidate);
  }

  for (const record of accepted) {
    await store.appendRecord(record);
  }

  return {
    trace_id: input.trace_id ?? input.turn_id ?? `lite-${Date.now()}`,
    writeback_status: accepted.length > 0 ? "accepted" : "skipped",
    accepted_count: accepted.length,
    filtered_reasons: filteredReasons,
    accepted_record_ids: accepted.map((record) => record.id),
  };
}

function normalizeWriteBackCandidate(
  rawCandidate: unknown,
  input: z.infer<typeof afterResponseSchema>,
): LiteMemoryRecord | null {
  if (!rawCandidate || typeof rawCandidate !== "object") {
    return null;
  }

  const candidate = rawCandidate as Partial<WriteBackCandidate> & {
    memory_type?: unknown;
    candidate_type?: unknown;
    scope?: unknown;
    summary?: unknown;
    details?: unknown;
    importance?: unknown;
    confidence?: unknown;
    idempotency_key?: unknown;
    status?: unknown;
  };
  const memoryType = normalizeMemoryType(candidate.candidate_type ?? candidate.memory_type);
  const scope = normalizeScope(candidate.scope);
  const summary = typeof candidate.summary === "string" ? candidate.summary.trim() : "";
  const details = candidate.details && typeof candidate.details === "object" && !Array.isArray(candidate.details)
    ? candidate.details as Record<string, unknown>
    : {};

  if (!memoryType || !scope || summary.length < 4) {
    return null;
  }

  const now = new Date().toISOString();
  const id = `lite_${hashLiteRecord([
    input.workspace_id,
    input.user_id,
    input.session_id,
    input.task_id ?? "",
    memoryType,
    scope,
    summary,
  ].join("|"))}`;

  return {
    id,
    workspace_id: input.workspace_id,
    user_id: scope === "workspace" ? null : input.user_id,
    task_id: scope === "task" ? input.task_id ?? null : null,
    session_id: scope === "session" ? input.session_id : null,
    memory_type: memoryType,
    scope,
    status: candidate.status === "pending_confirmation" ? "pending_confirmation" : "active",
    summary,
    details,
    importance: normalizeNumber(candidate.importance, 3, 1, 5),
    confidence: normalizeNumber(candidate.confidence, 0.7, 0, 1),
    dedupe_key: typeof candidate.idempotency_key === "string" ? candidate.idempotency_key : `${memoryType}:${scope}:${summary}`,
    created_at: now,
    updated_at: now,
  };
}

function normalizeMemoryType(value: unknown): MemoryType | undefined {
  return value === "fact" || value === "preference" || value === "task_state" || value === "episodic"
    ? value
    : undefined;
}

function normalizeScope(value: unknown): ScopeType | undefined {
  return value === "workspace" || value === "user" || value === "task" || value === "session"
    ? value
    : undefined;
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function isDuplicate(store: FileMemoryStore, record: LiteMemoryRecord): boolean {
  const dedupeKey = record.dedupe_key;
  return store.listRecords().some((existing) =>
    existing.status === "active"
    && (
      (dedupeKey && existing.dedupe_key === dedupeKey)
      || (
        existing.memory_type === record.memory_type
        && existing.scope === record.scope
        && existing.summary === record.summary
      )
    ),
  );
}

function containsSecret(value: string): boolean {
  return /\b(sk-[a-z0-9_-]{12,}|api[_-]?key|bearer\s+[a-z0-9._-]{12,}|token\s*[:=])/iu.test(value);
}

function hashLiteRecord(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
