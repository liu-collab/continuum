import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchWithTimeout } from "../src/shared/fetch.js";

describe("fetchWithTimeout", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("aborts the request when the timeout elapses", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;

    globalThis.fetch = (async (_input, init) => {
      requestSignal = init?.signal as AbortSignal | undefined;

      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), { once: true });
      });
    }) as typeof fetch;

    const request = fetchWithTimeout("https://example.test/slow", {
      timeoutMs: 100,
      timeoutReason: "test_timeout",
    });
    const assertion = expect(request).rejects.toBe("test_timeout");

    await vi.advanceTimersByTimeAsync(100);

    await assertion;
    expect(requestSignal?.aborted).toBe(true);
  });
});
