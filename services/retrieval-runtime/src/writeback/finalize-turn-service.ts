import { createHash, randomUUID } from "node:crypto";

import type { DependencyGuard } from "../dependency/dependency-guard.js";
import { updateLogContext } from "../logger.js";
import type { RuntimeRepository } from "../observability/runtime-repository.js";
import type {
  FinalizeIdempotencyRecord,
  FinalizeTurnInput,
  FinalizeTurnResponse,
  MemoryMode,
  TriggerContext,
} from "../shared/types.js";
import { nowIso } from "../shared/utils.js";
import type { RecallEffectivenessService } from "../query/recall-effectiveness-service.js";
import type { FinalizeIdempotencyCache } from "./finalize-idempotency-cache.js";
import type { WritebackEngine } from "./writeback-engine.js";

type FinalizeTurnServiceOptions = {
  dependencyGuard: DependencyGuard;
  finalizeIdempotencyCache?: FinalizeIdempotencyCache;
  recallEffectivenessService: RecallEffectivenessService;
  repository: Pick<
    RuntimeRepository,
    | "enqueueUrgentMaintenanceWorkspace"
    | "enqueueWritebackOutbox"
    | "findFinalizeIdempotencyRecord"
    | "findLatestTraceIdBySession"
    | "findTraceIdByTurn"
    | "markWritebackOutboxSubmitted"
    | "recordMemoryPlanRun"
    | "recordTurn"
    | "recordWritebackSubmission"
    | "upsertFinalizeIdempotencyRecord"
  >;
  writebackEngine: Pick<WritebackEngine, "submit" | "submitCandidates">;
};

export class FinalizeTurnService {
  constructor(private readonly options: FinalizeTurnServiceOptions) {}

  async finalize(input: FinalizeTurnInput): Promise<FinalizeTurnResponse> {
    const normalizedInput = {
      ...input,
      memory_mode: resolveMemoryMode(input.memory_mode),
    };
    const finalizeCacheKey = buildFinalizeCacheKey(normalizedInput);
    const cached = await this.options.finalizeIdempotencyCache?.get(finalizeCacheKey);
    if (cached) {
      updateLogContext({ trace_id: cached.trace_id });
      return cached;
    }
    const persisted = await this.options.repository.findFinalizeIdempotencyRecord(finalizeCacheKey);
    if (persisted) {
      await this.options.finalizeIdempotencyCache?.set(finalizeCacheKey, persisted.response);
      updateLogContext({ trace_id: persisted.response.trace_id });
      return persisted.response;
    }
    const traceId = await resolveTraceId(this.options.repository, {
      session_id: normalizedInput.session_id,
      turn_id: normalizedInput.turn_id,
      phase: "after_response",
    });
    updateLogContext({ trace_id: traceId });
    const startedAt = Date.now();

    await this.options.repository.recordTurn({
      trace_id: traceId,
      host: normalizedInput.host,
      workspace_id: normalizedInput.workspace_id,
      user_id: normalizedInput.user_id,
      session_id: normalizedInput.session_id,
      phase: "after_response",
      task_id: normalizedInput.task_id,
      thread_id: normalizedInput.thread_id,
      turn_id: normalizedInput.turn_id,
      current_input: normalizedInput.current_input,
      assistant_output: normalizedInput.assistant_output,
      created_at: nowIso(),
    });

    const extraction = await this.options.writebackEngine.submit(normalizedInput);
    if (extraction.plan_observation) {
      await this.options.repository.recordMemoryPlanRun({
        trace_id: traceId,
        phase: "after_response",
        plan_kind: "memory_writeback_plan",
        input_summary: extraction.plan_observation.input_summary,
        output_summary: extraction.plan_observation.output_summary,
        prompt_version: extraction.plan_observation.prompt_version,
        schema_version: extraction.plan_observation.schema_version,
        degraded: extraction.plan_observation.degraded,
        degradation_reason: extraction.plan_observation.degradation_reason,
        result_state: extraction.plan_observation.result_state,
        duration_ms: extraction.plan_observation.duration_ms,
        created_at: nowIso(),
      });
    }

    let submittedJobs = extraction.candidates.map((candidate) => ({
      candidate_summary: candidate.summary,
      status: "accepted_async",
    })) as FinalizeTurnResponse["submitted_jobs"];
    let degraded = false;
    let degradationReason: string | undefined;

    if (extraction.candidates.length > 0) {
      const now = nowIso();
      const outboxRows = await this.options.repository.enqueueWritebackOutbox(
        extraction.candidates.map((candidate) => ({
          trace_id: traceId,
          session_id: normalizedInput.session_id,
          turn_id: normalizedInput.turn_id,
          candidate,
          idempotency_key: candidate.idempotency_key,
          next_retry_at: now,
        })),
      );

      const writebackResult = await this.options.writebackEngine.submitCandidates(extraction.candidates);

      if (writebackResult.ok) {
        submittedJobs = writebackResult.submitted_jobs;
        await this.options.repository.markWritebackOutboxSubmitted(
          outboxRows.map((row) => row.id),
          now,
        );
      } else {
        degraded = true;
        degradationReason = writebackResult.degradation_reason;
        submittedJobs = writebackResult.submitted_jobs;
      }
    }

    await this.options.repository.recordWritebackSubmission({
      trace_id: traceId,
      phase: "after_response",
      candidate_count: extraction.candidates.length,
      submitted_count: submittedJobs.filter((job) => job.status !== "dependency_unavailable" && job.status !== "rejected").length,
      memory_mode: normalizedInput.memory_mode,
      final_scopes: [...new Set(extraction.candidates.map((candidate) => candidate.scope))],
      filtered_count: extraction.filtered_count,
      filtered_reasons: extraction.filtered_reasons,
      scope_reasons: extraction.scope_reasons,
      result_state:
        extraction.candidates.length === 0
          ? "no_candidates"
          : degraded
            ? "failed"
            : "submitted",
      degraded,
      degradation_reason: degradationReason,
      duration_ms: Date.now() - startedAt,
      created_at: nowIso(),
    });

    const response = {
      trace_id: traceId,
      write_back_candidates: extraction.candidates,
      submitted_jobs: submittedJobs,
      memory_mode: normalizedInput.memory_mode,
      candidate_count: extraction.candidates.length,
      filtered_count: extraction.filtered_count,
      filtered_reasons: extraction.filtered_reasons,
      writeback_submitted: submittedJobs.some((job) => isWritebackAccepted(job.status)),
      degraded,
      dependency_status: await this.options.dependencyGuard.snapshot(),
    };
    const urgentMaintenance = shouldEnqueueUrgentMaintenance({
      candidates: response.write_back_candidates,
      submittedJobs: response.submitted_jobs,
    });
    if (urgentMaintenance) {
      await this.options.repository.enqueueUrgentMaintenanceWorkspace({
        workspace_id: normalizedInput.workspace_id,
        enqueued_at: nowIso(),
        reason: urgentMaintenance.reason,
        source: urgentMaintenance.source,
      });
    }
    await this.options.finalizeIdempotencyCache?.set(finalizeCacheKey, response);
    await this.options.repository.upsertFinalizeIdempotencyRecord(
      buildFinalizeIdempotencyRecord(
        finalizeCacheKey,
        response,
        this.options.finalizeIdempotencyCache?.ttlMs() ?? 5 * 60 * 1000,
      ),
    );
    await this.options.recallEffectivenessService.evaluateIfNeeded(normalizedInput, traceId);
    return response;
  }
}

function resolveMemoryMode(memoryMode?: MemoryMode): MemoryMode {
  return memoryMode ?? "workspace_plus_global";
}

function isWritebackAccepted(status: FinalizeTurnResponse["submitted_jobs"][number]["status"]): boolean {
  return status === "accepted" || status === "accepted_async" || status === "merged";
}

function buildFinalizeCacheKey(input: Pick<FinalizeTurnInput, "session_id" | "turn_id" | "current_input">): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        session_id: input.session_id,
        turn_id: input.turn_id ?? null,
        current_input: input.current_input,
      }),
    )
    .digest("hex");
}

function buildFinalizeIdempotencyRecord(
  key: string,
  response: FinalizeTurnResponse,
  ttlMs: number,
): FinalizeIdempotencyRecord {
  const createdAt = nowIso();
  return {
    idempotency_key: key,
    response,
    created_at: createdAt,
    expires_at: new Date(Date.parse(createdAt) + ttlMs).toISOString(),
  };
}

function shouldEnqueueUrgentMaintenance(input: {
  candidates: FinalizeTurnResponse["write_back_candidates"];
  submittedJobs: FinalizeTurnResponse["submitted_jobs"];
}): { source: "open_conflict" | "pending_confirmation"; reason: string } | null {
  if (input.candidates.some((candidate) => candidate.suggested_status === "pending_confirmation")) {
    return {
      source: "pending_confirmation",
      reason: "writeback produced pending confirmation candidates",
    };
  }

  if (input.submittedJobs.some((job) => job.reason?.includes("open_conflict"))) {
    return {
      source: "open_conflict",
      reason: "writeback reported an open conflict",
    };
  }

  return null;
}

async function resolveTraceId(
  repository: Pick<RuntimeRepository, "findLatestTraceIdBySession" | "findTraceIdByTurn">,
  input: {
    session_id: string;
    turn_id?: string;
    phase: TriggerContext["phase"] | "after_response";
  },
) {
  if (input.turn_id) {
    return (
      (await repository.findTraceIdByTurn({
        session_id: input.session_id,
        turn_id: input.turn_id,
      })) ?? randomUUID()
    );
  }

  if (input.phase === "session_start") {
    return (
      (await repository.findLatestTraceIdBySession({
        session_id: input.session_id,
      })) ?? randomUUID()
    );
  }

  return randomUUID();
}
