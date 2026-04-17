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

export interface RuntimeRepository {
  initialize?(): Promise<void>;
  recordTurn(turn: RuntimeTurnRecord): Promise<void>;
  recordTriggerRun(run: TriggerRunRecord): Promise<void>;
  recordRecallRun(run: RecallRunRecord): Promise<void>;
  recordInjectionRun(run: InjectionRunRecord): Promise<void>;
  recordWritebackSubmission(run: WritebackSubmissionRecord): Promise<void>;
  findTraceIdForFinalize(input: {
    session_id: string;
    turn_id?: string;
    thread_id?: string;
    current_input?: string;
  }): Promise<string | null>;
  updateDependencyStatus(status: DependencyStatus): Promise<void>;
  getDependencyStatus(): Promise<DependencyStatusSnapshot>;
  getRuns(filters?: ObserveRunsFilters): Promise<ObserveRunsResponse>;
  getMetrics(): Promise<ObserveMetricsResponse>;
}
