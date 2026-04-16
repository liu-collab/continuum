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
    this.turns.unshift(turn);
  }

  async recordTriggerRun(run: TriggerRunRecord): Promise<void> {
    this.triggerRuns.unshift(run);
  }

  async recordRecallRun(run: RecallRunRecord): Promise<void> {
    this.recallRuns.unshift(run);
  }

  async recordInjectionRun(run: InjectionRunRecord): Promise<void> {
    this.injectionRuns.unshift(run);
  }

  async recordWritebackSubmission(run: WritebackSubmissionRecord): Promise<void> {
    this.writebackSubmissions.unshift(run);
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

    const total = filteredTurns.length;
    const offset = (page - 1) * pageSize;
    const turns = filteredTurns.slice(offset, offset + pageSize);
    const traceIds = new Set(turns.map((turn) => turn.trace_id));
    const byTrace = <T extends { trace_id: string }>(records: T[]): T[] => {
      if (traceIds.size === 0) {
        return [];
      }
      return records.filter((record) => traceIds.has(record.trace_id));
    };

    return {
      turns,
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
}
