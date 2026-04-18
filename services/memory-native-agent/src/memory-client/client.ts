import { z } from "zod";

import {
  MemoryBadRequestError,
  MemoryTimeoutError,
  MemoryUnavailableError,
} from "./errors.js";
import {
  dependencyStatusSnapshotSchema,
  finalizeTurnRequestSchema,
  finalizeTurnResultSchema,
  healthEndpointSchema,
  memoryModeSchema,
  prepareContextRequestSchema,
  prepareContextResultSchema,
  runtimeErrorResponseSchema,
  sessionStartRequestSchema,
  sessionStartResultSchema,
  type DependencyStatusSnapshot,
  type FinalizeTurnRequest,
  type FinalizeTurnResult,
  type HealthEndpointResult,
  type PrepareContextRequest,
  type PrepareContextResult,
  type SessionStartRequest,
  type SessionStartResult,
} from "./schemas.js";

const MEMORY_NATIVE_AGENT_HOST = "memory_native_agent";
const DEFAULT_REQUEST_TIMEOUT_MS = 800;
const DEFAULT_FINALIZE_TIMEOUT_MS = 1500;

type MemoryClientLogger = {
  info?(payload: Record<string, unknown>, message?: string): void;
  warn?(payload: Record<string, unknown>, message?: string): void;
};

type RequestOptions<TResponse> = {
  method: "GET" | "POST";
  path: string;
  timeoutMs: number;
  responseSchema: z.ZodType<TResponse>;
  body?: Record<string, unknown>;
  operation: "session_start_context" | "prepare_context" | "finalize_turn" | "dependency_status" | "healthz";
  phase?: string;
  onDependencyUnavailable?: (message: string) => TResponse;
};

export interface MemoryClientConfig {
  baseUrl: string;
  requestTimeoutMs?: number;
  finalizeTimeoutMs?: number;
  logger?: MemoryClientLogger;
}

function buildUnknownDependencySnapshot(detail: string): DependencyStatusSnapshot {
  const timestamp = new Date().toISOString();
  return {
    read_model: {
      name: "read_model",
      status: "unknown",
      detail,
      last_checked_at: timestamp,
    },
    embeddings: {
      name: "embeddings",
      status: "unknown",
      detail,
      last_checked_at: timestamp,
    },
    storage_writeback: {
      name: "storage_writeback",
      status: "unknown",
      detail,
      last_checked_at: timestamp,
    },
  };
}

export class MemoryClient {
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly finalizeTimeoutMs: number;
  private readonly logger: MemoryClientLogger;

  constructor(config: MemoryClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.finalizeTimeoutMs = config.finalizeTimeoutMs ?? DEFAULT_FINALIZE_TIMEOUT_MS;
    this.logger = config.logger ?? {};
  }

  async sessionStartContext(request: SessionStartRequest): Promise<SessionStartResult> {
    const parsed = sessionStartRequestSchema.parse(request);
    return this.requestJson({
      method: "POST",
      path: "/v1/runtime/session-start-context",
      timeoutMs: this.requestTimeoutMs,
      responseSchema: sessionStartResultSchema,
      body: {
        ...parsed,
        host: MEMORY_NATIVE_AGENT_HOST,
      },
      operation: "session_start_context",
      phase: "session_start",
      onDependencyUnavailable: (message) => ({
        trace_id: "dependency_unavailable",
        additional_context: "",
        active_task_summary: null,
        injection_block: null,
        memory_mode: parsed.memory_mode ?? memoryModeSchema.Enum.workspace_plus_global,
        dependency_status: buildUnknownDependencySnapshot(message),
        degraded: true,
      }),
    });
  }

  async prepareContext(request: PrepareContextRequest): Promise<PrepareContextResult> {
    const parsed = prepareContextRequestSchema.parse(request);
    return this.requestJson({
      method: "POST",
      path: "/v1/runtime/prepare-context",
      timeoutMs: this.requestTimeoutMs,
      responseSchema: prepareContextResultSchema,
      body: {
        ...parsed,
        host: MEMORY_NATIVE_AGENT_HOST,
      },
      operation: "prepare_context",
      phase: parsed.phase,
      onDependencyUnavailable: (message) => ({
        trace_id: "dependency_unavailable",
        trigger: false,
        trigger_reason: "dependency_unavailable",
        memory_packet: null,
        injection_block: null,
        degraded: true,
        dependency_status: buildUnknownDependencySnapshot(message),
        budget_used: 0,
        memory_packet_ids: [],
      }),
    });
  }

  async finalizeTurn(request: FinalizeTurnRequest): Promise<FinalizeTurnResult> {
    const parsed = finalizeTurnRequestSchema.parse(request);
    return this.requestJson({
      method: "POST",
      path: "/v1/runtime/finalize-turn",
      timeoutMs: this.finalizeTimeoutMs,
      responseSchema: finalizeTurnResultSchema,
      body: {
        ...parsed,
        host: MEMORY_NATIVE_AGENT_HOST,
      },
      operation: "finalize_turn",
      onDependencyUnavailable: (message) => ({
        trace_id: "dependency_unavailable",
        write_back_candidates: [],
        submitted_jobs: [],
        memory_mode: parsed.memory_mode ?? memoryModeSchema.Enum.workspace_plus_global,
        candidate_count: 0,
        filtered_count: 0,
        filtered_reasons: ["dependency_unavailable"],
        writeback_submitted: false,
        degraded: true,
        dependency_status: buildUnknownDependencySnapshot(message),
      }),
    });
  }

  async dependencyStatus(): Promise<DependencyStatusSnapshot> {
    return this.requestJson({
      method: "GET",
      path: "/v1/runtime/dependency-status",
      timeoutMs: this.requestTimeoutMs,
      responseSchema: dependencyStatusSnapshotSchema,
      operation: "dependency_status",
    });
  }

  async healthz(): Promise<HealthEndpointResult> {
    return this.requestJson({
      method: "GET",
      path: "/healthz",
      timeoutMs: this.requestTimeoutMs,
      responseSchema: healthEndpointSchema,
      operation: "healthz",
    });
  }

  private async requestJson<TResponse>(options: RequestOptions<TResponse>): Promise<TResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(new URL(options.path, `${this.baseUrl}/`), {
        method: options.method,
        headers: {
          Accept: "application/json",
          ...(options.body ? { "content-type": "application/json" } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const parsedError = runtimeErrorResponseSchema.safeParse(payload);
        const serviceCode = parsedError.success ? parsedError.data.error.code : undefined;
        const message = parsedError.success
          ? parsedError.data.error.message
          : `retrieval-runtime returned HTTP ${response.status}`;

        if (serviceCode === "dependency_unavailable" && options.onDependencyUnavailable) {
          const fallback = options.onDependencyUnavailable(message);
          this.logSuccess(options, fallback, response.status, Date.now() - startedAt);
          return fallback;
        }

        if (response.status >= 400 && response.status < 500) {
          throw new MemoryBadRequestError(message, {
            statusCode: response.status,
            serviceCode,
            details: payload,
          });
        }

        throw new MemoryUnavailableError(message, {
          statusCode: response.status,
          serviceCode,
          details: payload,
        });
      }

      const parsedResponse = options.responseSchema.safeParse(payload);
      if (!parsedResponse.success) {
        throw new MemoryUnavailableError("retrieval-runtime returned an invalid response payload", {
          details: parsedResponse.error.flatten(),
        });
      }

      this.logSuccess(options, parsedResponse.data, response.status, Date.now() - startedAt);
      return parsedResponse.data;
    } catch (error) {
      if (error instanceof MemoryBadRequestError || error instanceof MemoryUnavailableError) {
        this.logFailure(options, error, Date.now() - startedAt);
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        const timeoutError = new MemoryTimeoutError(`memory request timed out after ${options.timeoutMs}ms`, {
          details: {
            operation: options.operation,
            timeout_ms: options.timeoutMs,
          },
          cause: error,
        });
        this.logFailure(options, timeoutError, Date.now() - startedAt);
        throw timeoutError;
      }

      const unavailableError = new MemoryUnavailableError("failed to reach retrieval-runtime", {
        details: error,
        cause: error,
      });
      this.logFailure(options, unavailableError, Date.now() - startedAt);
      throw unavailableError;
    } finally {
      clearTimeout(timeout);
    }
  }

  private logSuccess<TResponse>(
    options: RequestOptions<TResponse>,
    payload: TResponse,
    statusCode: number,
    latencyMs: number,
  ) {
    this.logger.info?.(
      {
        operation: options.operation,
        phase: options.phase,
        status: statusCode,
        latency_ms: latencyMs,
        trace_id: this.extractTraceId(payload),
      },
      "memory client request completed",
    );
  }

  private logFailure<TResponse>(options: RequestOptions<TResponse>, error: Error, latencyMs: number) {
    this.logger.warn?.(
      {
        operation: options.operation,
        phase: options.phase,
        latency_ms: latencyMs,
        error_name: error.name,
        error_message: error.message,
      },
      "memory client request failed",
    );
  }

  private extractTraceId(payload: unknown): string | null {
    if (!payload || typeof payload !== "object") {
      return null;
    }

    const traceId = (payload as Record<string, unknown>).trace_id;
    return typeof traceId === "string" ? traceId : null;
  }
}
