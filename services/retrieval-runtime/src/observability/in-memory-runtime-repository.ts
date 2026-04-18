import type {
  DependencyStatus,
  DependencyStatusSnapshot,
  InjectionRunRecord,
  ObserveMetricsResponse,
  ObserveRunsFilters,
  ObserveRunsResponse,
  RecallRunRecord,
  RuntimeTurnRecord,
  TriggerRunRecord,
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
  private readonly writebackSubmissions: WritebackSubmissionRecord[] = [];
  private readonly dependencies: Map<DependencyStatus["name"], DependencyStatus> = new Map([
    ["read_model", defaultDependencyStatus("read_model")],
    ["embeddings", defaultDependencyStatus("embeddings")],
    ["storage_writeback", defaultDependencyStatus("storage_writeback")],
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

  async recordWritebackSubmission(run: WritebackSubmissionRecord): Promise<void> {
    this.upsertByTraceAndPhase(this.writebackSubmissions, run);
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

  async updateDependencyStatus(status: DependencyStatus): Promise<void> {
    this.dependencies.set(status.name, status);
  }

  async getDependencyStatus(): Promise<DependencyStatusSnapshot> {
    return {
      read_model: this.dependencies.get("read_model") ?? defaultDependencyStatus("read_model"),
      embeddings: this.dependencies.get("embeddings") ?? defaultDependencyStatus("embeddings"),
      storage_writeback: this.dependencies.get("storage_writeback") ?? defaultDependencyStatus("storage_writeback"),
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
}
