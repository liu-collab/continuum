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
    listSkills: vi.fn(),
    listWorkspaces: vi.fn(),
    registerWorkspace: vi.fn(),
    pickWorkspace: vi.fn(),
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
    client.listSkills.mockResolvedValue({
      items: []
    });
    client.listWorkspaces.mockResolvedValue({
      items: []
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
    client.listSkills.mockResolvedValue({
      items: []
    });
    client.listWorkspaces.mockResolvedValue({
      items: []
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

  it("does not auto-load file tree from the session workspace when the user has not selected one", async () => {
    const client = createClientMock();
    client.bootstrap.mockResolvedValue({
      status: "ok",
      token: "token-1",
      reason: null,
      mnaBaseUrl: "http://127.0.0.1:4193",
      baseUrl: "http://127.0.0.1:4193"
    });
    client.listSessions.mockResolvedValue({
      items: [createSessionSummary("session-1")],
      next_cursor: null
    });
    client.listSkills.mockResolvedValue({
      items: [
        {
          id: "codex-skill-smoke-check",
          name: "Smoke Check",
          description: "A minimal visible skill for verifying MNA slash-command activation.",
          slash_name: "smoke-check",
          source_kind: "codex-skill",
          root_dir: "C:/repo/.mna/skills/smoke-check",
          entry_file: "C:/repo/.mna/skills/smoke-check/SKILL.md",
          imported_path: "C:/repo/.mna/skills/smoke-check",
          user_invocable: true,
          model_invocable: true,
          preapproved_tools: []
        }
      ]
    });
    client.listWorkspaces.mockResolvedValue({
      items: [
        {
          workspace_id: "workspace-1",
          cwd: "C:/repo",
          label: "repo",
          is_current: true
        }
      ]
    });
    client.getSession.mockResolvedValue({
      session: {
        id: "session-1",
        workspace_id: "workspace-1",
        user_id: "user-1",
        title: null,
        memory_mode: "workspace_plus_global",
        locale: "zh-CN",
        created_at: "2026-04-21T00:00:00Z",
        last_active_at: "2026-04-21T00:00:00Z",
        closed_at: null
      },
      messages: [],
      latest_event_id: null
    });
    client.connectSessionStream.mockReturnValue({
      send: vi.fn(),
      close: vi.fn()
    });
    client.getMetrics.mockResolvedValue(null);
    client.getDependencyStatus.mockResolvedValue(null);
    client.getConfig.mockResolvedValue(null);
    client.getMcpServers.mockResolvedValue({ servers: [], tools: [] });
    mockUseAgentClient.mockReturnValue(client);
    mockUsePathname.mockReturnValue("/agent/session-1");

    render(<HookProbe sessionId="session-1" />);

    await waitFor(() => {
      expect(client.getSession).toHaveBeenCalled();
    });

    expect(client.getFileTree).not.toHaveBeenCalled();
  });
});
