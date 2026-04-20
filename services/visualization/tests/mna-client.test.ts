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

  it("retries once after a 401 by reloading bootstrap", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce({
        json: async () => ({
          status: "ok",
          token: "token-1",
          reason: null,
          mnaBaseUrl: "http://127.0.0.1:4193",
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          error: {
            code: "token_invalid",
            message: "expired",
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({
          status: "ok",
          token: "token-2",
          reason: null,
          mnaBaseUrl: "http://127.0.0.1:4193",
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [],
          next_cursor: null,
        }),
      } as Response);

    const client = new MnaClient();
    const payload = await client.listSessions();

    expect(payload).toEqual({
      items: [],
      next_cursor: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const retryRequest = fetchMock.mock.calls[3];
    const headers = new Headers((retryRequest?.[1] as RequestInit | undefined)?.headers);
    expect(headers.get("Authorization")).toBe("Bearer token-2");
  });

  it("surfaces workspace_mismatch as a typed request error", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce({
        json: async () => ({
          status: "ok",
          token: "token-1",
          reason: null,
          mnaBaseUrl: "http://127.0.0.1:4193",
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          error: {
            code: "workspace_mismatch",
            message: "Session workspace does not match the current workspace.",
          },
        }),
      } as Response);

    const client = new MnaClient();

    await expect(client.getSession("session-cross-workspace")).rejects.toMatchObject({
      name: "MnaRequestError",
      statusCode: 409,
      code: "workspace_mismatch",
      message: "Session workspace does not match the current workspace.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("loads and updates runtime config through the config endpoint", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce({
        json: async () => ({
          status: "ok",
          token: "token-1",
          reason: null,
          mnaBaseUrl: "http://127.0.0.1:4193",
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          provider: {
            kind: "demo",
            model: "continuum-demo",
            base_url: null,
            api_key: null,
            temperature: null,
          },
          embedding: {
            base_url: null,
            model: null,
            api_key: null,
          },
          mcp: {
            servers: [],
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
        }),
      } as Response);

    const client = new MnaClient();
    const config = await client.getConfig();
    await client.updateConfig({
      provider: {
        kind: "openai-compatible",
        model: "deepseek-chat",
      },
      embedding: {
        base_url: "https://api.openai.com/v1",
        model: "text-embedding-3-small",
      },
      mcp: {
        servers: [],
      },
    });

    expect(config.provider.kind).toBe("demo");
    const updateRequest = fetchMock.mock.calls[2];
    expect(updateRequest?.[0]).toBe("http://127.0.0.1:4193/v1/agent/config");
    expect(JSON.parse(String((updateRequest?.[1] as RequestInit).body))).toEqual({
      provider: {
        kind: "openai-compatible",
        model: "deepseek-chat",
      },
      embedding: {
        base_url: "https://api.openai.com/v1",
        model: "text-embedding-3-small",
      },
      mcp: {
        servers: [],
      },
    });
  });
});
