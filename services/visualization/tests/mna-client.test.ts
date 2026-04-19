import { afterEach, describe, expect, it, vi } from "vitest";

import { MnaClient } from "@/app/agent/_lib/mna-client";

describe("MnaClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not force JSON content-type for bodyless delete requests", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce({
        json: async () => ({
          status: "ok",
          token: "token-123",
          reason: null,
          mnaBaseUrl: "http://127.0.0.1:4193",
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          purged: true,
        }),
      } as Response);

    const client = new MnaClient();
    await client.deleteSession("session-1", true);

    const request = fetchMock.mock.calls[1];
    expect(request).toBeDefined();

    const init = request?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(init?.method).toBe("DELETE");
    expect(headers.get("Content-Type")).toBeNull();
    expect(headers.get("Authorization")).toBe("Bearer token-123");
  });
});
