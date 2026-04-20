import { describe, expect, it, vi } from "vitest";

import { StreamBridge } from "../stream-bridge.js";

describe("StreamBridge", () => {
  it("coalesces text deltas and emits tool calls", async () => {
    const sink = {
      emitAssistantDelta: vi.fn(),
      emitToolCallStart: vi.fn(),
      emitToolCallResult: vi.fn(),
      emitTurnEnd: vi.fn(),
      emitError: vi.fn(),
    };
    const bridge = new StreamBridge("turn-1", sink, {
      flushChars: 4,
      flushIntervalMs: 1000,
    });

    await bridge.handle({ type: "text_delta", text: "he" });
    await bridge.handle({ type: "text_delta", text: "llo" });
    await bridge.handle({
      type: "tool_call",
      call: {
        id: "call-1",
        name: "fs_read",
        args: { path: "README.md" },
      },
    });

    expect(sink.emitAssistantDelta).toHaveBeenCalledWith("turn-1", "hello");
    expect(sink.emitToolCallStart).toHaveBeenCalled();
  });

  it("drops chunks after abort and reports metrics", async () => {
    const sink = {
      emitAssistantDelta: vi.fn(),
      emitToolCallStart: vi.fn(),
      emitToolCallResult: vi.fn(),
      emitTurnEnd: vi.fn(),
      emitError: vi.fn(),
    };
    const bridge = new StreamBridge("turn-1", sink, {
      flushChars: 32,
      flushIntervalMs: 1000,
    });

    bridge.abort();
    await bridge.handle({ type: "text_delta", text: "ignored" });

    expect(bridge.metrics().dropped_after_abort_total).toBe(1);
  });

  it("does not emit turn_end for tool_use boundaries", async () => {
    const sink = {
      emitAssistantDelta: vi.fn(),
      emitToolCallStart: vi.fn(),
      emitToolCallResult: vi.fn(),
      emitTurnEnd: vi.fn(),
      emitError: vi.fn(),
    };
    const bridge = new StreamBridge("turn-1", sink, {
      flushChars: 32,
      flushIntervalMs: 1000,
    });

    await bridge.handle({
      type: "end",
      finish_reason: "tool_use",
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
      },
    });

    expect(sink.emitTurnEnd).not.toHaveBeenCalled();
  });
});
