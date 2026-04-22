import { describe, expect, it } from "vitest";

import { RuntimeTracer } from "../runtime-tracer.js";

describe("RuntimeTracer", () => {
  it("records spans and filters by trace id", () => {
    const tracer = new RuntimeTracer();
    const root = tracer.startSpan({
      traceId: "trace-1",
      name: "turn",
      kind: "turn",
      attributes: { session_id: "session-1" },
    });
    const child = tracer.startSpan({
      traceId: "trace-1",
      parentId: root.span.id,
      name: "tool_call",
      kind: "tool",
    });
    child.finish("ok", { tool_name: "fs_read" });
    root.finish("ok");

    const trace = tracer.listSpans("trace-1");
    expect(trace).toHaveLength(2);
    expect(trace[1]).toMatchObject({
      trace_id: "trace-1",
      parent_id: root.span.id,
      name: "tool_call",
      status: "ok",
      attributes: {
        tool_name: "fs_read",
      },
    });
  });
});
