import React from "react";
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAgentWorkspace } from "@/app/agent/_hooks/use-agent-workspace";
import { MnaRequestError } from "@/app/agent/_lib/mna-client";

const replace = vi.fn();
const push = vi.fn();
const mockUseAgentClient = vi.fn();
const mockUsePathname = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace,
    push
  }),
  usePathname: () => mockUsePathname()
}));

vi.mock("@/app/agent/_hooks/use-agent-client", () => ({
  useAgentClient: () => mockUseAgentClient()
}));

function HookProbe({ sessionId }: { sessionId?: string }) {
  useAgentWorkspace({
    sessionId,
    uiLocale: "zh-CN"
  });
  return null;
}

function createSessionSummary(id: string, workspaceId = "workspace-1") {
  return {
    id,
    workspace_id: workspaceId,
    user_id: "user-1",
    title: id,
    memory_mode: "workspace_plus_global" as const,
    locale: "zh-CN" as const,
    created_at: "2026-04-21T00:00:00Z",
    last_active_at: "2026-04-21T00:00:00Z",
    closed_at: null,
    latest_turn_id: null
  };
}

function createClientMock() {
  return {
    bootstrap: vi.fn(),
    listSessions: vi.fn(),
    getSession: vi.fn(),
    createSession: vi.fn(),
    connectSessionStream: vi.fn(),
    getFileTree: vi.fn(),
    getMetrics: vi.fn(),
    getDependencyStatus: vi.fn(),
    getConfig: vi.fn(),
    getMcpServers: vi.fn(),
    getFile: vi.fn(),
    updateMemoryMode: vi.fn(),
    renameSession: vi.fn(),
    deleteSession: vi.fn(),
    updateProvider: vi.fn(),
    updateConfig: vi.fn(),
    getPromptInspector: vi.fn(),
    restartMcpServer: vi.fn(),
    disableMcpServer: vi.fn()
  };
}

describe("useAgentWorkspace bootstrap recovery", () => {
  afterEach(() => {
    replace.mockReset();
    push.mockReset();
    mockUseAgentClient.mockReset();
    mockUsePathname.mockReset();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("falls back to another available session when the current session is not found", async () => {
    const client = createClientMock();
    client.bootstrap.mockResolvedValue({
      status: "ok",
      token: "token-1",
      reason: null,
      mnaBaseUrl: "http://127.0.0.1:4193",
      baseUrl: "http://127.0.0.1:4193"
    });
    client.listSessions.mockResolvedValue({
      items: [createSessionSummary("stale-session"), createSessionSummary("fresh-session")],
      next_cursor: null
    });
    client.getSession.mockRejectedValue(
      new MnaRequestError("session missing", 404, "session_not_found")
    );
    mockUseAgentClient.mockReturnValue(client);
    mockUsePathname.mockReturnValue("/agent/stale-session");

    render(<HookProbe sessionId="stale-session" />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/agent/fresh-session");
    });
    expect(client.createSession).not.toHaveBeenCalled();
  });

  it("creates a new session when the current session workspace mismatches and there is no fallback session", async () => {
    const client = createClientMock();
    client.bootstrap.mockResolvedValue({
      status: "ok",
      token: "token-1",
      reason: null,
      mnaBaseUrl: "http://127.0.0.1:4193",
      baseUrl: "http://127.0.0.1:4193"
    });
    client.listSessions.mockResolvedValue({
      items: [createSessionSummary("stale-session")],
      next_cursor: null
    });
    client.getSession.mockRejectedValue(
      new MnaRequestError("workspace mismatch", 409, "workspace_mismatch")
    );
    client.createSession.mockResolvedValue({
      session_id: "new-session",
      ws_url: "ws://127.0.0.1:4193/v1/agent/sessions/new-session/stream",
      memory_mode: "workspace_plus_global",
      workspace_id: "workspace-1",
      locale: "zh-CN"
    });
    mockUseAgentClient.mockReturnValue(client);
    mockUsePathname.mockReturnValue("/agent/stale-session");

    render(<HookProbe sessionId="stale-session" />);

    await waitFor(() => {
      expect(client.createSession).toHaveBeenCalledWith({
        locale: "zh-CN"
      });
      expect(replace).toHaveBeenCalledWith("/agent/new-session");
    });
  });
});
