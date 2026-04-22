import { afterEach, describe, expect, it, vi } from "vitest";

import { MnaClient } from "@/app/agent/_lib/mna-client";
import { MnaRequestError } from "@/app/agent/_lib/mna-client";

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
            effort: null,
            max_tokens: null,
          },
          embedding: {
            base_url: null,
            model: null,
            api_key: null,
          },
          memory_llm: {
            base_url: null,
            model: "claude-haiku-4-5-20251001",
            api_key: null,
            protocol: "openai-compatible",
            timeout_ms: 15000,
            effort: null,
            max_tokens: null,
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
        effort: "high",
        max_tokens: 6000,
      },
      embedding: {
        base_url: "https://api.openai.com/v1",
        model: "text-embedding-3-small",
      },
      memory_llm: {
        base_url: "https://api.anthropic.com",
        model: "claude-haiku-4-5-20251001",
        protocol: "anthropic",
        timeout_ms: 8000,
        effort: "medium",
        max_tokens: 1200,
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
        effort: "high",
        max_tokens: 6000,
      },
      embedding: {
        base_url: "https://api.openai.com/v1",
        model: "text-embedding-3-small",
      },
      memory_llm: {
        base_url: "https://api.anthropic.com",
        model: "claude-haiku-4-5-20251001",
        protocol: "anthropic",
        timeout_ms: 8000,
        effort: "medium",
        max_tokens: 1200,
      },
      mcp: {
        servers: [],
      },
    });
  });

  it("triggers an active embedding health check", async () => {
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
          name: "embeddings",
          status: "healthy",
          detail: "embedding request completed",
          last_checked_at: "2026-04-21T12:00:00.000Z",
        }),
      } as Response);

    const client = new MnaClient();
    const payload = await client.checkEmbeddings();

    expect(payload.status).toBe("healthy");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:4193/v1/agent/dependency-status/embeddings/check",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("triggers an active memory llm health check", async () => {
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
          name: "memory_llm",
          status: "healthy",
          detail: "memory llm request completed",
          last_checked_at: "2026-04-21T12:00:00.000Z",
        }),
      } as Response);

    const client = new MnaClient();
    const payload = await client.checkMemoryLlm();

    expect(payload.status).toBe("healthy");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:4193/v1/agent/dependency-status/memory-llm/check",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("loads the imported skill list", async () => {
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
          items: [
            {
              id: "codex-skill-smoke-check",
              name: "Smoke Check",
              description: "A minimal visible skill for verifying MNA slash-command activation.",
              slash_name: "smoke-check",
              source_kind: "codex-skill",
              root_dir: "C:/workspace/.mna/skills/smoke-check",
              entry_file: "C:/workspace/.mna/skills/smoke-check/SKILL.md",
              imported_path: "C:/workspace/.mna/skills/smoke-check",
              user_invocable: true,
              model_invocable: true,
              preapproved_tools: [],
            },
          ],
        }),
      } as Response);

    const client = new MnaClient();
    const payload = await client.listSkills();

    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]?.slash_name).toBe("smoke-check");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:4193/v1/skills",
      expect.objectContaining({
        cache: "no-store",
      }),
    );
  });

  it("registers a workspace after the local picker returns a path", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cancelled: false,
          cwd: "C:/workspace/repo",
        }),
      } as Response)
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
          workspace: {
            workspace_id: "workspace-1",
            short_id: "workspace",
            cwd: "C:/workspace/repo",
            label: "repo",
            is_current: false,
          },
        }),
      } as Response);

    const client = new MnaClient();
    const payload = await client.pickWorkspace();

    expect(payload).toEqual({
      cancelled: false,
      workspace: {
        workspace_id: "workspace-1",
        short_id: "workspace",
        cwd: "C:/workspace/repo",
        label: "repo",
        is_current: false,
      },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/agent/workspaces/pick",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:4193/v1/agent/workspaces",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("accepts proxied workspace payload without re-registering", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cancelled: false,
          workspace: {
            workspace_id: "workspace-2",
            short_id: "abcd1234",
            cwd: "C:/workspace/proxied",
            label: "proxied",
            is_current: false,
          },
        }),
      } as Response);

    const client = new MnaClient();
    const payload = await client.pickWorkspace();

    expect(payload).toEqual({
      cancelled: false,
      workspace: {
        workspace_id: "workspace-2",
        short_id: "abcd1234",
        cwd: "C:/workspace/proxied",
        label: "proxied",
        is_current: false,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/agent/workspaces/pick",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
      }),
    );
  });

  it("surfaces local picker failures as typed request errors", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({
        error: {
          code: "workspace_picker_failed",
          message: "打开文件夹选择器失败。",
        },
      }),
    } as Response);

    const client = new MnaClient();

    await expect(client.pickWorkspace()).rejects.toMatchObject({
      name: "MnaRequestError",
      statusCode: 500,
      code: "workspace_picker_failed",
      message: "打开文件夹选择器失败。",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

