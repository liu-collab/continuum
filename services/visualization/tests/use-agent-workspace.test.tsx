import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAgentWorkspace } from "@/app/agent/_hooks/use-agent-workspace";
import { MnaRequestError } from "@/app/agent/_lib/mna-client";

const replace = vi.fn();
const push = vi.fn();
const router = { replace, push };
const mockUseAgentClient = vi.fn();
const mockUsePathname = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => mockUsePathname()
}));

vi.mock("@/app/agent/_hooks/use-agent-client", () => ({
  useAgentClient: () => mockUseAgentClient()
}));

function HookProbe({ sessionId }: { sessionId?: string }) {
  (globalThis as { __lastWorkspaceHook?: ReturnType<typeof useAgentWorkspace> }).__lastWorkspaceHook = useAgentWorkspace({
    sessionId,
    uiLocale: "zh-CN"
  });
  return null;
}

function createSessionSummary(id: string, workspaceId = "workspace-1") {
  return {
    id,
    workspace_id: workspaceId,
    user_id: "00000000-0000-4000-8000-000000000001",
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
    checkEmbeddings: vi.fn(),
    checkMemoryLlm: vi.fn(),
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

  it("aligns the file tree to the active session workspace", async () => {
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
        user_id: "00000000-0000-4000-8000-000000000001",
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

    expect(client.getFileTree).toHaveBeenCalledWith(".", "workspace-1");
  });

  it("restores the last active session when returning to the agent root route", async () => {
    const client = createClientMock();
    client.bootstrap.mockResolvedValue({
      status: "ok",
      token: "token-1",
      reason: null,
      mnaBaseUrl: "http://127.0.0.1:4193",
      baseUrl: "http://127.0.0.1:4193"
    });
    client.listSessions.mockResolvedValue({
      items: [createSessionSummary("older-session"), createSessionSummary("recent-session")],
      next_cursor: null
    });
    client.listSkills.mockResolvedValue({
      items: []
    });
    client.listWorkspaces.mockResolvedValue({
      items: []
    });
    mockUseAgentClient.mockReturnValue(client);
    mockUsePathname.mockReturnValue("/agent");
    window.localStorage.setItem("continuum.agent.lastSessionId", "recent-session");

    render(<HookProbe />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/agent/recent-session");
    });
    expect(client.createSession).not.toHaveBeenCalled();
  });

  it("reuses an existing session in the picked workspace", async () => {
    const client = createClientMock();
    client.bootstrap.mockResolvedValue({
      status: "ok",
      token: "token-1",
      reason: null,
      mnaBaseUrl: "http://127.0.0.1:4193",
      baseUrl: "http://127.0.0.1:4193"
    });
    client.listSessions
      .mockResolvedValueOnce({
        items: [createSessionSummary("session-1", "workspace-1"), createSessionSummary("session-2", "workspace-2")],
        next_cursor: null
      })
      .mockResolvedValueOnce({
        items: [createSessionSummary("session-1", "workspace-1"), createSessionSummary("session-2", "workspace-2")],
        next_cursor: null
      });
    client.listSkills.mockResolvedValue({ items: [] });
    client.listWorkspaces
      .mockResolvedValueOnce({
        items: [
          { workspace_id: "workspace-1", cwd: "C:/repo-1", label: "repo-1", is_current: true },
          { workspace_id: "workspace-2", cwd: "C:/repo-2", label: "repo-2", is_current: false }
        ]
      })
      .mockResolvedValueOnce({
        items: [
          { workspace_id: "workspace-1", cwd: "C:/repo-1", label: "repo-1", is_current: true },
          { workspace_id: "workspace-2", cwd: "C:/repo-2", label: "repo-2", is_current: false }
        ]
      });
    client.pickWorkspace.mockResolvedValue({
      cancelled: false,
      workspace: {
        workspace_id: "workspace-2",
        short_id: "workspac",
        cwd: "C:/repo-2",
        label: "repo-2",
        is_current: false
      }
    });
    mockUseAgentClient.mockReturnValue(client);
    mockUsePathname.mockReturnValue("/agent/session-1");

    render(<HookProbe sessionId="session-1" />);

    await waitFor(() => {
      expect(client.listSessions).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await (globalThis as unknown as { __lastWorkspaceHook: ReturnType<typeof useAgentWorkspace> }).__lastWorkspaceHook.pickWorkspace();
    });

    expect(push).toHaveBeenCalledWith("/agent/session-2");
    expect(client.createSession).not.toHaveBeenCalled();
  });

  it("creates a new session in the selected workspace when none exists yet", async () => {
    const client = createClientMock();
    client.bootstrap.mockResolvedValue({
      status: "ok",
      token: "token-1",
      reason: null,
      mnaBaseUrl: "http://127.0.0.1:4193",
      baseUrl: "http://127.0.0.1:4193"
    });
    client.listSessions
      .mockResolvedValueOnce({
        items: [createSessionSummary("session-1", "workspace-1")],
        next_cursor: null
      })
      .mockResolvedValueOnce({
        items: [],
        next_cursor: null
      })
      .mockResolvedValueOnce({
        items: [
          createSessionSummary("session-1", "workspace-1"),
          createSessionSummary("session-2", "workspace-2")
        ],
        next_cursor: null
      });
    client.listSkills.mockResolvedValue({ items: [] });
    client.listWorkspaces
      .mockResolvedValueOnce({
        items: [
          { workspace_id: "workspace-1", cwd: "C:/repo-1", label: "repo-1", is_current: true },
          { workspace_id: "workspace-2", cwd: "C:/repo-2", label: "repo-2", is_current: false }
        ]
      })
      .mockResolvedValueOnce({
        items: [
          { workspace_id: "workspace-1", cwd: "C:/repo-1", label: "repo-1", is_current: true },
          { workspace_id: "workspace-2", cwd: "C:/repo-2", label: "repo-2", is_current: false }
        ]
      });
    client.pickWorkspace.mockResolvedValue({
      cancelled: false,
      workspace: {
        workspace_id: "workspace-2",
        short_id: "workspac",
        cwd: "C:/repo-2",
        label: "repo-2",
        is_current: false
      }
    });
    client.createSession.mockResolvedValue({
      session_id: "session-2",
      ws_url: "ws://127.0.0.1:4193/v1/agent/sessions/session-2/ws",
      memory_mode: "workspace_plus_global",
      workspace_id: "workspace-2",
      locale: "zh-CN"
    });
    mockUseAgentClient.mockReturnValue(client);
    mockUsePathname.mockReturnValue("/agent/session-1");

    render(<HookProbe sessionId="session-1" />);

    await waitFor(() => {
      expect(client.listSessions).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await (globalThis as unknown as { __lastWorkspaceHook: ReturnType<typeof useAgentWorkspace> }).__lastWorkspaceHook.pickWorkspace();
    });

    expect(client.createSession).toHaveBeenCalledWith({
      workspace_id: "workspace-2",
      locale: "zh-CN"
    });
    expect(push).toHaveBeenCalledWith("/agent/session-2");
  });

  it("updates dependency status locally after checking memory llm", async () => {
    const client = createClientMock();
    client.bootstrap.mockResolvedValue({
      status: "ok",
      token: "token-1",
      reason: null,
      mnaBaseUrl: "http://127.0.0.1:4193",
      baseUrl: "http://127.0.0.1:4193"
    });
    client.listSessions.mockResolvedValue({
      items: [createSessionSummary("session-1", "workspace-1")],
      next_cursor: null
    });
    client.listSkills.mockResolvedValue({ items: [] });
    client.listWorkspaces.mockResolvedValue({
      items: [
        { workspace_id: "workspace-1", cwd: "C:/repo-1", label: "repo-1", is_current: true }
      ]
    });
    client.getSession.mockResolvedValue({
      session: {
        id: "session-1",
        workspace_id: "workspace-1",
        user_id: "00000000-0000-4000-8000-000000000001",
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
    client.getDependencyStatus.mockResolvedValue({
      runtime: {
        status: "reachable",
        memory_llm: {
          status: "unknown",
          detail: "dependency has not been checked yet"
        },
        embeddings: {
          status: "healthy",
          detail: "embedding request completed"
        }
      },
      provider: {
        id: "openai-compatible",
        model: "deepseek-chat",
        status: "configured"
      },
      mcp: [],
      provider_key: "openai-compatible:deepseek-chat"
    });
    client.getConfig.mockResolvedValue(null);
    client.getMcpServers.mockResolvedValue({ servers: [], tools: [] });
    client.checkMemoryLlm.mockResolvedValue({
      name: "memory_llm",
      status: "healthy",
      detail: "memory llm request completed",
      last_checked_at: "now"
    });
    mockUseAgentClient.mockReturnValue(client);
    mockUsePathname.mockReturnValue("/agent/session-1");

    render(<HookProbe sessionId="session-1" />);

    await waitFor(() => {
      expect(client.getSession).toHaveBeenCalled();
    });

    await act(async () => {
      await (globalThis as unknown as { __lastWorkspaceHook: ReturnType<typeof useAgentWorkspace> }).__lastWorkspaceHook.checkMemoryLlm();
    });

    const hook = (globalThis as unknown as { __lastWorkspaceHook: ReturnType<typeof useAgentWorkspace> }).__lastWorkspaceHook;
    expect(hook.dependencyStatus?.runtime.memory_llm).toMatchObject({
      status: "healthy",
      detail: "memory llm request completed",
      last_checked_at: "now"
    });
    expect(client.getDependencyStatus).toHaveBeenCalledTimes(1);
  });
});

