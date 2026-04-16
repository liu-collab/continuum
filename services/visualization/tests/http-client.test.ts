import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchJsonFromSource } from "@/lib/server/http-client";

describe("fetchJsonFromSource", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves lastOkAt after a later upstream failure", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true })
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: "down" })
      } as Response);

    const success = await fetchJsonFromSource({
      sourceName: "runtime_api_test",
      sourceLabel: "Runtime API test",
      url: "http://example.test/runtime",
      timeoutMs: 50
    });

    const failure = await fetchJsonFromSource({
      sourceName: "runtime_api_test",
      sourceLabel: "Runtime API test",
      url: "http://example.test/runtime",
      timeoutMs: 50
    });

    expect(success.status.lastOkAt).not.toBeNull();
    expect(failure.status.lastOkAt).toBe(success.status.lastOkAt);
    expect(failure.status.lastCheckedAt).not.toBeNull();
  });
});
