import type { LitePrepareContextTrace } from "./memory-orchestrator.js";

export interface LiteWritebackTrace {
  trace_id: string;
  accepted_record_ids: string[];
  accepted_count: number;
  filtered_reasons: string[];
  degraded: boolean;
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

  size(): number {
    return this.traces.size;
  }
}
