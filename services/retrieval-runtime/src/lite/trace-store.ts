import type { LitePrepareContextTrace } from "./memory-orchestrator.js";

export interface LiteWritebackTrace {
  trace_id: string;
  host?: string;
  workspace_id?: string;
  user_id?: string;
  session_id?: string;
  task_id?: string;
  thread_id?: string;
  turn_id?: string;
  current_input?: string;
  assistant_output?: string;
  memory_mode?: "workspace_only" | "workspace_plus_global";
  accepted_record_ids: string[];
  accepted_count: number;
  filtered_reasons: string[];
  outbox_queued_count?: number;
  outbox_retry?: {
    attempted: number;
    submitted: number;
    failed: number;
  };
  extractor?: {
    source: "provided_candidates" | "rules" | "rules_and_llm";
    rules_count: number;
    llm_attempted: boolean;
    llm_degraded: boolean;
    recent_turns_count: number;
  };
  degraded: boolean;
  degradation_reason?: string;
  created_at: string;
}

export interface LiteTraceSnapshot {
  prepare?: LitePrepareContextTrace;
  writebacks: LiteWritebackTrace[];
}

export class LiteTraceStore {
  private readonly traces = new Map<string, LiteTraceSnapshot>();

  upsertPrepare(trace: LitePrepareContextTrace): void {
    const existing = this.traces.get(trace.trace_id);
    this.traces.set(trace.trace_id, {
      prepare: trace,
      writebacks: existing?.writebacks ?? [],
    });
  }

  appendWriteback(trace: LiteWritebackTrace): void {
    const existing = this.traces.get(trace.trace_id);
    this.traces.set(trace.trace_id, {
      prepare: existing?.prepare,
      writebacks: [...(existing?.writebacks ?? []), trace],
    });
  }

  get(traceId: string): LiteTraceSnapshot | undefined {
    return this.traces.get(traceId);
  }

  list(): LiteTraceSnapshot[] {
    return [...this.traces.values()].sort((left, right) => {
      const leftCreatedAt = left.prepare?.created_at ?? left.writebacks.at(-1)?.created_at ?? "";
      const rightCreatedAt = right.prepare?.created_at ?? right.writebacks.at(-1)?.created_at ?? "";
      return rightCreatedAt.localeCompare(leftCreatedAt);
    });
  }

  size(): number {
    return this.traces.size;
  }
}
