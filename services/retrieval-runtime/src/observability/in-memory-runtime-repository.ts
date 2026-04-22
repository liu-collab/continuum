import type {
  DependencyStatus,
  DependencyStatusSnapshot,
  FinalizeIdempotencyRecord,
  InjectionRunRecord,
  MaintenanceCheckpointRecord,
  MemoryPlanRunRecord,
  ObserveMetricsResponse,
  ObserveRunsFilters,
  ObserveRunsResponse,
  RecallRunRecord,
  RuntimeTurnRecord,
  TriggerRunRecord,
  WritebackOutboxRecord,
  WritebackSubmissionRecord,
} from "../shared/types.js";
import { nowIso, percentile } from "../shared/utils.js";
import type { RuntimeRepository } from "./runtime-repository.js";

function defaultDependencyStatus(name: DependencyStatus["name"]): DependencyStatus {
  return {
    name,
    status: "unknown",
    detail: "dependency has not been checked yet",
    last_checked_at: nowIso(),
  };
}

export class InMemoryRuntimeRepository implements RuntimeRepository {
  private readonly turns: RuntimeTurnRecord[] = [];
  private readonly triggerRuns: TriggerRunRecord[] = [];
  private readonly recallRuns: RecallRunRecord[] = [];
  private readonly injectionRuns: InjectionRunRecord[] = [];
  private readonly memoryPlanRuns: MemoryPlanRunRecord[] = [];
  private readonly writebackSubmissions: WritebackSubmissionRecord[] = [];
  private readonly writebackOutbox: WritebackOutboxRecord[] = [];
  private readonly finalizeIdempotencyRecords = new Map<string, FinalizeIdempotencyRecord>();
  private readonly maintenanceCheckpoints = new Map<string, MaintenanceCheckpointRecord>();
  private readonly dependencies: Map<DependencyStatus["name"], DependencyStatus> = new Map([
    ["read_model", defaultDependencyStatus("read_model")],
    ["embeddings", defaultDependencyStatus("embeddings")],
    ["storage_writeback", defaultDependencyStatus("storage_writeback")],
    ["memory_llm", defaultDependencyStatus("memory_llm")],
  ]);

  async initialize(): Promise<void> {
    return Promise.resolve();
  }

  async recordTurn(turn: RuntimeTurnRecord): Promise<void> {
    const existingIndex = this.turns.findIndex((entry) => entry.trace_id === turn.trace_id && entry.phase === turn.phase);
    if (existingIndex >= 0) {
      const existing = this.turns[existingIndex];
      if (existing) {
        this.turns[existingIndex] = {
          ...existing,
          ...turn,
          assistant_output: turn.assistant_output ?? existing.assistant_output,
        };
      }
      return;
    }

    this.turns.unshift(turn);
  }

  async recordTriggerRun(run: TriggerRunRecord): Promise<void> {
    this.upsertByTraceAndPhase(this.triggerRuns, run);
  }

  async recordRecallRun(run: RecallRunRecord): Promise<void> {
    this.upsertByTraceAndPhase(this.recallRuns, run);
  }

  async recordInjectionRun(run: InjectionRunRecord): Promise<void> {
    this.upsertByTraceAndPhase(this.injectionRuns, run);
  }

  async recordMemoryPlanRun(run: MemoryPlanRunRecord): Promise<void> {
    this.upsertByTracePhaseAndKind(this.memoryPlanRuns, run);
  }

  async recordWritebackSubmission(run: WritebackSubmissionRecord): Promise<void> {
    this.upsertByTraceAndPhase(this.writebackSubmissions, run);
  }

  async enqueueWritebackOutbox(records: Array<{
    trace_id: string;
    session_id: string;
    turn_id?: string;
    candidate: WritebackOutboxRecord["candidate"];
    idempotency_key: string;
    next_retry_at: string;
  }>): Promise<WritebackOutboxRecord[]> {
    const created: WritebackOutboxRecord[] = [];
    for (const record of records) {
      const existing = this.writebackOutbox.find((entry) => entry.idempotency_key === record.idempotency_key);
      if (existing) {
        created.push(existing);
        continue;
      }

      const next: WritebackOutboxRecord = {
        id: `outbox-${this.writebackOutbox.length + 1}`,
        trace_id: record.trace_id,
        session_id: record.session_id,
        turn_id: record.turn_id,
        candidate: record.candidate,
        idempotency_key: record.idempotency_key,
        status: "pending",
        retry_count: 0,
        next_retry_at: record.next_retry_at,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      this.writebackOutbox.unshift(next);
      created.push(next);
    }
    return created;
  }

  async markWritebackOutboxSubmitted(ids: string[], submittedAt: string): Promise<void> {
    const idSet = new Set(ids);
    for (const record of this.writebackOutbox) {
      if (idSet.has(record.id)) {
        record.status = "submitted";
        record.submitted_at = submittedAt;
        record.updated_at = submittedAt;
      }
    }
  }

  async claimPendingWritebackOutbox(limit: number, now: string): Promise<WritebackOutboxRecord[]> {
    return this.writebackOutbox
      .filter((record) => record.status === "pending" && Date.parse(record.next_retry_at) <= Date.parse(now))
      .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at))
      .slice(0, limit);
  }

  async requeueWritebackOutbox(id: string, nextRetryAt: string, lastError: string): Promise<void> {
    const record = this.writebackOutbox.find((entry) => entry.id === id);
    if (!record) {
      return;
    }
    record.retry_count += 1;
    record.last_error = lastError;
    record.next_retry_at = nextRetryAt;
    record.updated_at = nowIso();
  }

  async markWritebackOutboxDeadLetter(id: string, lastError: string): Promise<void> {
    const record = this.writebackOutbox.find((entry) => entry.id === id);
    if (!record) {
      return;
    }
    record.retry_count += 1;
    record.last_error = lastError;
    record.status = "dead_letter";
    record.updated_at = nowIso();
  }

  async getWritebackOutboxMetrics(now: string): Promise<{
    pending_count: number;
    dead_letter_count: number;
    submit_latency_ms: number;
  }> {
    const submitted = this.writebackOutbox.filter((record) => record.status === "submitted" && record.submitted_at);
    const submitLatencyMs =
      submitted.length === 0
        ? 0
        : Math.round(
            submitted.reduce((sum, record) => {
              return sum + (Date.parse(record.submitted_at!) - Date.parse(record.created_at));
            }, 0) / submitted.length,
          );
    return {
      pending_count: this.writebackOutbox.filter((record) => record.status === "pending" && Date.parse(record.next_retry_at) <= Date.parse(now)).length,
      dead_letter_count: this.writebackOutbox.filter((record) => record.status === "dead_letter").length,
      submit_latency_ms: submitLatencyMs,
    };
  }

  async findTraceIdByTurn(input: {
    session_id: string;
    turn_id: string;
  }): Promise<string | null> {
    const candidates = this.turns.filter((turn) => {
      return turn.session_id === input.session_id && turn.turn_id === input.turn_id && turn.phase !== "after_response";
    });

    const latest = candidates.sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))[0];
    return latest?.trace_id ?? null;
  }

  async findLatestTraceIdBySession(input: {
    session_id: string;
  }): Promise<string | null> {
    const candidates = this.turns.filter((turn) => turn.session_id === input.session_id);
    const latest = candidates.sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))[0];
    return latest?.trace_id ?? null;
  }

  async findFinalizeIdempotencyRecord(key: string): Promise<FinalizeIdempotencyRecord | null> {
    const record = this.finalizeIdempotencyRecords.get(key);
    if (!record) {
      return null;
    }

    if (Date.parse(record.expires_at) <= Date.now()) {
      this.finalizeIdempotencyRecords.delete(key);
      return null;
    }

    return record;
  }

  async upsertFinalizeIdempotencyRecord(record: FinalizeIdempotencyRecord): Promise<void> {
    this.finalizeIdempotencyRecords.set(record.idempotency_key, record);
  }

  async updateDependencyStatus(status: DependencyStatus): Promise<void> {
    this.dependencies.set(status.name, status);
  }

  async getDependencyStatus(): Promise<DependencyStatusSnapshot> {
    return {
      read_model: this.dependencies.get("read_model") ?? defaultDependencyStatus("read_model"),
      embeddings: this.dependencies.get("embeddings") ?? defaultDependencyStatus("embeddings"),
      storage_writeback: this.dependencies.get("storage_writeback") ?? defaultDependencyStatus("storage_writeback"),
      memory_llm: this.dependencies.get("memory_llm") ?? defaultDependencyStatus("memory_llm"),
    };
  }

  async getRuns(filters?: ObserveRunsFilters): Promise<ObserveRunsResponse> {
    const page = filters?.page ?? 1;
    const pageSize = filters?.page_size ?? 20;
    const filteredTurns = this.turns.filter((turn) => {
      if (filters?.session_id && turn.session_id !== filters.session_id) {
        return false;
      }
      if (filters?.turn_id && turn.turn_id !== filters.turn_id) {
        return false;
      }
      if (filters?.trace_id && turn.trace_id !== filters.trace_id) {
        return false;
      }
      return true;
    });
    const latestTurns = Array.from(
      filteredTurns.reduce((acc, turn) => {
        const current = acc.get(turn.trace_id);
        if (!current || Date.parse(turn.created_at) > Date.parse(current.created_at)) {
          acc.set(turn.trace_id, turn);
        }
        return acc;
      }, new Map<string, RuntimeTurnRecord>()).values(),
    ).sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));

    const total = latestTurns.length;
    const offset = (page - 1) * pageSize;
    const pagedTurns = latestTurns.slice(offset, offset + pageSize);
    const traceIds = new Set(pagedTurns.map((turn) => turn.trace_id));
    const byTrace = <T extends { trace_id: string }>(records: T[]): T[] => {
      if (traceIds.size === 0) {
        return [];
      }
      return records.filter((record) => traceIds.has(record.trace_id));
    };

    return {
      turns: byTrace(filteredTurns).sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at)),
      trigger_runs: byTrace(this.triggerRuns),
      recall_runs: byTrace(this.recallRuns),
      injection_runs: byTrace(this.injectionRuns),
      memory_plan_runs: byTrace(this.memoryPlanRuns),
      writeback_submissions: byTrace(this.writebackSubmissions),
      total,
      page,
      page_size: pageSize,
      dependency_status: await this.getDependencyStatus(),
    };
  }

  async getMetrics(): Promise<ObserveMetricsResponse> {
    const recallCount = this.recallRuns.length;
    const triggerCount = this.triggerRuns.length;
    const injectionCount = this.injectionRuns.length;
    const writebackCount = this.writebackSubmissions.length;
    const triggered = this.triggerRuns.filter((run) => run.trigger_hit).length;
    const recallHits = this.recallRuns.filter((run) => run.selected_count > 0).length;
    const emptyRecalls = this.recallRuns.filter((run) => run.trigger_hit && run.selected_count === 0).length;
    const injected = this.injectionRuns.filter((run) => run.injected).length;
    const trimmed = this.injectionRuns.filter((run) => run.trimmed_record_ids.length > 0).length;
    const submitted = this.writebackSubmissions.filter((run) => run.submitted_count > 0).length;

    return {
      trigger_rate: triggerCount === 0 ? 0 : triggered / triggerCount,
      recall_hit_rate: recallCount === 0 ? 0 : recallHits / recallCount,
      empty_recall_rate: recallCount === 0 ? 0 : emptyRecalls / recallCount,
      injection_rate: injectionCount === 0 ? 0 : injected / injectionCount,
      injection_trim_rate: injectionCount === 0 ? 0 : trimmed / injectionCount,
      writeback_submission_rate: writebackCount === 0 ? 0 : submitted / writebackCount,
      query_p95_ms: percentile(this.recallRuns.map((run) => run.duration_ms), 0.95),
      injection_p95_ms: percentile(this.injectionRuns.map((run) => run.duration_ms), 0.95),
      outbox_pending_count: this.writebackOutbox.filter((record) => record.status === "pending").length,
      outbox_dead_letter_count: this.writebackOutbox.filter((record) => record.status === "dead_letter").length,
      outbox_submit_latency_ms: (() => {
        const submittedOutbox = this.writebackOutbox.filter((record) => record.status === "submitted" && record.submitted_at);
        if (submittedOutbox.length === 0) {
          return 0;
        }
        return Math.round(
          submittedOutbox.reduce((sum, record) => sum + (Date.parse(record.submitted_at!) - Date.parse(record.created_at)), 0) /
            submittedOutbox.length,
        );
      })(),
    };
  }

  private upsertByTraceAndPhase<T extends { trace_id: string; phase: string }>(records: T[], next: T) {
    const existingIndex = records.findIndex((record) => record.trace_id === next.trace_id && record.phase === next.phase);
    if (existingIndex >= 0) {
      records[existingIndex] = next;
      return;
    }

    records.unshift(next);
  }

  private upsertByTracePhaseAndKind<T extends { trace_id: string; phase: string; plan_kind: string }>(records: T[], next: T) {
    const existingIndex = records.findIndex((record) => {
      return record.trace_id === next.trace_id && record.phase === next.phase && record.plan_kind === next.plan_kind;
    });
    if (existingIndex >= 0) {
      records[existingIndex] = next;
      return;
    }

    records.unshift(next);
  }

  async getMaintenanceCheckpoints(
    now: string,
    minIntervalMs: number,
    limit: number,
  ): Promise<MaintenanceCheckpointRecord[]> {
    const nowMs = Date.parse(now);
    if (!Number.isFinite(nowMs)) {
      return [];
    }
    return [...this.maintenanceCheckpoints.values()]
      .filter((record) => nowMs - Date.parse(record.last_scanned_at) >= minIntervalMs)
      .sort((a, b) => Date.parse(a.last_scanned_at) - Date.parse(b.last_scanned_at))
      .slice(0, limit)
      .map((record) => ({ ...record }));
  }

  async upsertMaintenanceCheckpoint(record: MaintenanceCheckpointRecord): Promise<void> {
    this.maintenanceCheckpoints.set(record.workspace_id, { ...record });
  }

  async listWorkspacesWithRecentWrites(sinceIso: string, limit: number): Promise<string[]> {
    const sinceMs = Date.parse(sinceIso);
    if (!Number.isFinite(sinceMs)) {
      return [];
    }
    const seen = new Set<string>();
    for (const turn of this.turns) {
      if (seen.size >= limit) {
        break;
      }
      if (Date.parse(turn.created_at) >= sinceMs) {
        seen.add(turn.workspace_id);
      }
    }
    return [...seen];
  }
}
