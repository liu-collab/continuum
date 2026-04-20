import type {
  DependencyStatus,
  DependencyStatusSnapshot,
  FinalizeIdempotencyRecord,
  InjectionRunRecord,
  ObserveMetricsResponse,
  ObserveRunsFilters,
  ObserveRunsResponse,
  RecallRunRecord,
  RuntimeTurnRecord,
  TriggerRunRecord,
  WritebackOutboxRecord,
  WritebackSubmissionRecord,
} from "../shared/types.js";

export interface RuntimeRepository {
  initialize?(): Promise<void>;
  recordTurn(turn: RuntimeTurnRecord): Promise<void>;
  recordTriggerRun(run: TriggerRunRecord): Promise<void>;
  recordRecallRun(run: RecallRunRecord): Promise<void>;
  recordInjectionRun(run: InjectionRunRecord): Promise<void>;
  recordWritebackSubmission(run: WritebackSubmissionRecord): Promise<void>;
  enqueueWritebackOutbox(records: Array<{
    trace_id: string;
    session_id: string;
    turn_id?: string;
    candidate: WritebackOutboxRecord["candidate"];
    idempotency_key: string;
    next_retry_at: string;
  }>): Promise<WritebackOutboxRecord[]>;
  markWritebackOutboxSubmitted(ids: string[], submittedAt: string): Promise<void>;
  claimPendingWritebackOutbox(limit: number, now: string): Promise<WritebackOutboxRecord[]>;
  requeueWritebackOutbox(id: string, nextRetryAt: string, lastError: string): Promise<void>;
  markWritebackOutboxDeadLetter(id: string, lastError: string): Promise<void>;
  getWritebackOutboxMetrics(now: string): Promise<{
    pending_count: number;
    dead_letter_count: number;
    submit_latency_ms: number;
  }>;
  findTraceIdByTurn(input: {
    session_id: string;
    turn_id: string;
  }): Promise<string | null>;
  findFinalizeIdempotencyRecord(key: string): Promise<FinalizeIdempotencyRecord | null>;
  upsertFinalizeIdempotencyRecord(record: FinalizeIdempotencyRecord): Promise<void>;
  updateDependencyStatus(status: DependencyStatus): Promise<void>;
  getDependencyStatus(): Promise<DependencyStatusSnapshot>;
  getRuns(filters?: ObserveRunsFilters): Promise<ObserveRunsResponse>;
  getMetrics(): Promise<ObserveMetricsResponse>;
}
