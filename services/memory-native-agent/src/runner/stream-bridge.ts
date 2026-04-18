import type { ChatChunk, ToolCall } from "../providers/types.js";
import type { ToolResult } from "../tools/index.js";

export interface StreamBridgeSink {
  emitAssistantDelta(turnId: string, text: string): void;
  emitToolCallStart(turnId: string, call: ToolCall): void;
  emitToolCallResult(callId: string, result: ToolResult): void;
  emitTurnEnd(turnId: string, finishReason: string): void;
  emitError(scope: "turn" | "session", error: Error & { code?: string }): void;
}

export interface StreamBridgeOptions {
  flushChars: number;
  flushIntervalMs: number;
}

export class StreamBridge {
  private pendingText = "";
  private flushTimer: NodeJS.Timeout | null = null;
  private droppedAfterAbort = 0;
  private flushedEvents = 0;
  private aborted = false;

  constructor(
    private readonly turnId: string,
    private readonly sink: StreamBridgeSink,
    private readonly options: StreamBridgeOptions,
  ) {}

  async handle(chunk: ChatChunk): Promise<void> {
    if (this.aborted) {
      this.droppedAfterAbort += 1;
      return;
    }

    if (chunk.type === "text_delta") {
      this.pendingText += chunk.text;
      if (this.pendingText.length >= this.options.flushChars) {
        this.flushPending();
        return;
      }
      this.scheduleFlush();
      return;
    }

    this.flushPending();

    if (chunk.type === "tool_call") {
      this.sink.emitToolCallStart(this.turnId, chunk.call);
      return;
    }

    this.sink.emitTurnEnd(this.turnId, chunk.finish_reason);
  }

  flushPending() {
    if (!this.pendingText) {
      return;
    }

    this.clearTimer();
    this.flushedEvents += 1;
    this.sink.emitAssistantDelta(this.turnId, this.pendingText);
    this.pendingText = "";
  }

  abort() {
    this.aborted = true;
    this.flushPending();
  }

  metrics() {
    return {
      flushed_events_total: this.flushedEvents,
      dropped_after_abort_total: this.droppedAfterAbort,
    };
  }

  private scheduleFlush() {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushPending();
    }, this.options.flushIntervalMs);
  }

  private clearTimer() {
    if (!this.flushTimer) {
      return;
    }

    clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }
}
