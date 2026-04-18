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
import type { RuntimeRepository } from "./runtime-repository.js";

export class FallbackRuntimeRepository implements RuntimeRepository {
  constructor(
    private readonly primary: RuntimeRepository,
    private readonly fallback: RuntimeRepository,
  ) {}

  async initialize(): Promise<void> {
    if ("initialize" in this.primary && typeof this.primary.initialize === "function") {
      try {
        await this.primary.initialize();
      } catch {
        // Let the write/read path fall back lazily.
      }
    }
  }

  async recordTurn(turn: RuntimeTurnRecord): Promise<void> {
    await this.tryPrimaryOrFallback((repository) => repository.recordTurn(turn));
  }

  async recordTriggerRun(run: TriggerRunRecord): Promise<void> {
    await this.tryPrimaryOrFallback((repository) => repository.recordTriggerRun(run));
  }

  async recordRecallRun(run: RecallRunRecord): Promise<void> {
    await this.tryPrimaryOrFallback((repository) => repository.recordRecallRun(run));
  }

  async recordInjectionRun(run: InjectionRunRecord): Promise<void> {
    await this.tryPrimaryOrFallback((repository) => repository.recordInjectionRun(run));
  }

  async recordWritebackSubmission(run: WritebackSubmissionRecord): Promise<void> {
    await this.tryPrimaryOrFallback((repository) => repository.recordWritebackSubmission(run));
  }

  async findTraceIdByTurn(input: {
    session_id: string;
    turn_id: string;
  }): Promise<string | null> {
    return this.tryRead((repository) => repository.findTraceIdByTurn(input));
  }

  async updateDependencyStatus(status: DependencyStatus): Promise<void> {
    await this.tryPrimaryOrFallback((repository) => repository.updateDependencyStatus(status));
  }

  async getDependencyStatus(): Promise<DependencyStatusSnapshot> {
    return this.tryRead((repository) => repository.getDependencyStatus());
  }

  async getRuns(filters?: ObserveRunsFilters): Promise<ObserveRunsResponse> {
    return this.tryRead((repository) => repository.getRuns(filters));
  }

  async getMetrics(): Promise<ObserveMetricsResponse> {
    return this.tryRead((repository) => repository.getMetrics());
  }

  private async tryPrimaryOrFallback(task: (repository: RuntimeRepository) => Promise<void>): Promise<void> {
    try {
      await task(this.primary);
    } catch {
      await task(this.fallback);
    }
  }

  private async tryRead<T>(task: (repository: RuntimeRepository) => Promise<T>): Promise<T> {
    try {
      return await task(this.primary);
    } catch {
      return task(this.fallback);
    }
  }
}
