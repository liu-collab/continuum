import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MnaClient } from "@/app/agent/_lib/mna-client";

class MockWebSocket {
  static OPEN = 1;

  readonly url: string;
  readyState = MockWebSocket.OPEN;
  sent: string[] = [];
  private listeners = new Map<string, Set<(event?: any) => void>>();

  constructor(url: string) {
    this.url = url;
    sockets.push(this);
  }

  addEventListener(type: string, listener: (event?: any) => void) {
    const bucket = this.listeners.get(type) ?? new Set();
    bucket.add(listener);
    this.listeners.set(type, bucket);
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  close() {
    this.emit("close");
  }

  emit(type: string, event?: any) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

const sockets: MockWebSocket[] = [];

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("MnaClient websocket stream", () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const originalSetTimeout = globalThis.setTimeout;
  const originalWindowWebSocket = window.WebSocket;
  const originalWindowSetInterval = window.setInterval;
  const originalWindowClearInterval = window.clearInterval;
  const originalWindowSetTimeout = window.setTimeout;

  beforeEach(() => {
    sockets.length = 0;
    vi.restoreAllMocks();
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
    vi.stubGlobal("setInterval", vi.fn(() => 1) as unknown as typeof setInterval);
    vi.stubGlobal("clearInterval", vi.fn() as unknown as typeof clearInterval);
    vi.stubGlobal("setTimeout", ((fn: TimerHandler) => {
      if (typeof fn === "function") {
        fn();
      }
      return 1;
    }) as unknown as typeof setTimeout);
    Object.defineProperty(window, "WebSocket", {
      value: MockWebSocket,
      configurable: true,
      writable: true
    });
    window.setInterval = globalThis.setInterval;
    window.clearInterval = globalThis.clearInterval;
    window.setTimeout = globalThis.setTimeout;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.WebSocket = originalWebSocket;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    globalThis.setTimeout = originalSetTimeout;
    Object.defineProperty(window, "WebSocket", {
      value: originalWindowWebSocket,
      configurable: true,
      writable: true
    });
    window.setInterval = originalWindowSetInterval;
    window.clearInterval = originalWindowClearInterval;
    window.setTimeout = originalWindowSetTimeout;
  });

  it("reconnects with the latest last_event_id and emits heartbeat after reopen", async () => {
    const onEvent = vi.fn();
    const onConnectionChange = vi.fn();
    const onError = vi.fn();

    const client = new MnaClient();
    vi.spyOn(client, "bootstrap").mockResolvedValue({
      status: "ok",
      token: "token-123",
      reason: null,
      mnaBaseUrl: "http://127.0.0.1:4193",
      baseUrl: "http://127.0.0.1:4193"
    });
    const handle = client.connectSessionStream("session-1", {
      onEvent,
      onConnectionChange,
      onError
    });

    await flushAsyncWork();

    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.url).toContain("/v1/agent/sessions/session-1/ws");
    expect(sockets[0]?.url).toContain("token=token-123");
    expect(sockets[0]?.url).not.toContain("last_event_id=");

    sockets[0]?.emit("open");
    expect(onConnectionChange).toHaveBeenCalledWith("connecting");
    expect(onConnectionChange).toHaveBeenCalledWith("open");
    expect(globalThis.setInterval).toHaveBeenCalledTimes(1);

    const heartbeatCallback = vi.mocked(globalThis.setInterval).mock.calls[0]?.[0] as (() => void) | undefined;
    heartbeatCallback?.();
    expect(sockets[0]?.sent).toContain(JSON.stringify({ kind: "ping" }));

    sockets[0]?.emit("message", {
      data: JSON.stringify({
        event_id: 7,
        kind: "assistant_delta",
        turn_id: "turn-1",
        text: "partial"
      })
    });

    expect(onEvent).toHaveBeenCalledWith({
      event_id: 7,
      kind: "assistant_delta",
      turn_id: "turn-1",
      text: "partial"
    });

    sockets[0]?.emit("close");
    await flushAsyncWork();

    expect(sockets).toHaveLength(2);
    expect(onConnectionChange).toHaveBeenCalledWith("reconnecting");
    expect(sockets[1]?.url).toContain("last_event_id=7");

    sockets[1]?.emit("open");
    const secondHeartbeat = vi.mocked(globalThis.setInterval).mock.calls[1]?.[0] as (() => void) | undefined;
    secondHeartbeat?.();
    expect(sockets[1]?.sent).toContain(JSON.stringify({ kind: "ping" }));

    handle.close();
    expect(onConnectionChange).toHaveBeenLastCalledWith("closed");
    expect(onError).not.toHaveBeenCalled();
    expect(client.bootstrap).toHaveBeenCalledTimes(2);
  });

  it("forces a fresh bootstrap before websocket reconnect", async () => {
    const client = new MnaClient();
    const bootstrapSpy = vi
      .spyOn(client, "bootstrap")
      .mockResolvedValue({
        status: "ok",
        token: "token-123",
        reason: null,
        mnaBaseUrl: "http://127.0.0.1:4193",
        baseUrl: "http://127.0.0.1:4193"
      });

    client.connectSessionStream("session-2", {
      onEvent: vi.fn(),
      onConnectionChange: vi.fn(),
      onError: vi.fn()
    });

    await flushAsyncWork();
    sockets[0]?.emit("open");
    sockets[0]?.emit("message", {
      data: JSON.stringify({
        event_id: 9,
        kind: "assistant_delta",
        turn_id: "turn-2",
        text: "hello"
      })
    });
    sockets[0]?.emit("close");
    await flushAsyncWork();

    expect(bootstrapSpy).toHaveBeenNthCalledWith(1, false);
    expect(bootstrapSpy).toHaveBeenNthCalledWith(2, true);
    expect(sockets[1]?.url).toContain("last_event_id=9");
  });

  it("closes after exceeding reconnect retries", async () => {
    const onConnectionChange = vi.fn();
    const client = new MnaClient();
    vi.spyOn(client, "bootstrap").mockResolvedValue({
      status: "ok",
      token: "token-123",
      reason: null,
      mnaBaseUrl: "http://127.0.0.1:4193",
      baseUrl: "http://127.0.0.1:4193"
    });

    client.connectSessionStream("session-1", {
      onEvent: vi.fn(),
      onConnectionChange,
      onError: vi.fn()
    });

    await flushAsyncWork();

    for (let attempt = 0; attempt < 6; attempt += 1) {
      sockets.at(-1)?.emit("error");
      await flushAsyncWork();
    }

    expect(onConnectionChange).toHaveBeenLastCalledWith("closed");
    expect(sockets.length).toBeGreaterThanOrEqual(5);
  });
});
