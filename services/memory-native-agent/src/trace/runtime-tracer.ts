import { randomUUID } from "node:crypto";

export interface RuntimeSpan {
  id: string;
  trace_id: string;
  parent_id?: string;
  name: string;
  kind: "turn" | "memory" | "llm" | "tool" | "writeback" | "plan" | "evaluation" | "sandbox" | "cache";
  started_at: string;
  ended_at?: string;
  status: "ok" | "error" | "cancelled";
  attributes: Record<string, string | number | boolean>;
}

export interface SpanHandle {
  span: RuntimeSpan;
  finish(status?: RuntimeSpan["status"], attributes?: Record<string, string | number | boolean>): RuntimeSpan;
}

export class RuntimeTracer {
  private readonly spans: RuntimeSpan[] = [];

  startSpan(input: {
    traceId?: string | null;
    parentId?: string;
    name: string;
    kind: RuntimeSpan["kind"];
    attributes?: Record<string, string | number | boolean>;
  }): SpanHandle {
    const span: RuntimeSpan = {
      id: randomUUID(),
      trace_id: input.traceId ?? randomUUID(),
      parent_id: input.parentId,
      name: input.name,
      kind: input.kind,
      started_at: new Date().toISOString(),
      status: "ok",
      attributes: { ...(input.attributes ?? {}) },
    };
    this.spans.push(span);

    return {
      span,
      finish: (status = "ok", attributes = {}) => {
        span.status = status;
        span.ended_at = new Date().toISOString();
        span.attributes = {
          ...span.attributes,
          ...attributes,
        };
        return span;
      },
    };
  }

  listSpans(traceId?: string | null): RuntimeSpan[] {
    if (!traceId) {
      return [...this.spans];
    }

    return this.spans.filter((span) => span.trace_id === traceId);
  }
}
