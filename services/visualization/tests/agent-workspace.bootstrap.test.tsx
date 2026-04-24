import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentWorkspace } from "@/app/agent/_components/agent-workspace";
import { AgentI18nProvider } from "@/app/agent/_i18n/provider";

vi.mock("@/app/agent/_hooks/use-agent-workspace", () => ({
  useAgentWorkspace: vi.fn()
}));

import { useAgentWorkspace } from "@/app/agent/_hooks/use-agent-workspace";

const mockedUseAgentWorkspace = vi.mocked(useAgentWorkspace);

function createWorkspaceState(status: "loading" | "mna_not_running" | "token_missing" | "token_invalid") {
  return {
    state: {
      bootstrapStatus: status,
      bootstrapReason: null,
      sessionId: null,
      session: null,
      sessionList: [],
      connection: "closed",
      degraded: false,
      turns: [],
      pendingConfirm: null,
      locale: "zh-CN",
      activeTask: null,
      recentTasks: [],
      replayGapDetected: false,
      sessionError: null,
      sessionErrorCode: null
    },
    activeTurn: null,
    fileTree: {
      path: ".",
      entries: []
    },
    workspaceList: [],
    skillList: [],
    selectedWorkspaceId: null,
    selectedFile: null,
    selectedFilePath: null,
    metrics: null,
    dependencyStatus: null,
    mcpState: null,
    promptInspector: null,
    promptInspectorOpen: false,
    setPromptInspectorOpen: vi.fn(),
    createNewSession: vi.fn(),
    openSession: vi.fn(),
    sendInput: vi.fn(),
    abortCurrentTurn: vi.fn(),
    confirmTool: vi.fn(),
    updateMemoryMode: vi.fn(),
    renameSession: vi.fn(),
    deleteSession: vi.fn(),
    updateProvider: vi.fn(),
    updateRuntimeConfig: vi.fn(),
    refreshMetrics: vi.fn(),
    refreshDependencyStatus: vi.fn(),
    refreshAgentConfig: vi.fn(),
    refreshMcpState: vi.fn(),
    refreshWorkspaceList: vi.fn(),
    registerWorkspace: vi.fn(),
    pickWorkspace: vi.fn(),
    selectWorkspace: vi.fn(),
    refreshFileTree: vi.fn(),
    openFile: vi.fn(),
    openPromptInspector: vi.fn(),
    restartMcpServer: vi.fn(),
    disableMcpServer: vi.fn()
  };
}

describe("AgentWorkspace bootstrap states", () => {
  it("shows a neutral bootstrap state while agent is initializing", () => {
    mockedUseAgentWorkspace.mockReturnValue(createWorkspaceState("loading") as never);

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <AgentWorkspace />
      </AgentI18nProvider>
    );

    expect(screen.getByTestId("agent-bootstrap-loading-state")).toHaveTextContent("正在初始化");
    expect(screen.getByTestId("agent-bootstrap-loading-state")).toHaveTextContent(
      "正在初始化 agent 连接。"
    );
    expect(screen.queryByTestId("agent-offline-state")).not.toBeInTheDocument();
  });

  it("shows a specific message when mna is not running", () => {
    mockedUseAgentWorkspace.mockReturnValue(createWorkspaceState("mna_not_running") as never);

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <AgentWorkspace />
      </AgentI18nProvider>
    );

    expect(screen.getByTestId("agent-offline-state")).toHaveTextContent(
      "未检测到 memory-native-agent，请先启动本地服务。"
    );
  });

  it("shows a specific message when token is missing", () => {
    mockedUseAgentWorkspace.mockReturnValue(createWorkspaceState("token_missing") as never);

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <AgentWorkspace />
      </AgentI18nProvider>
    );

    expect(screen.getByTestId("agent-offline-state")).toHaveTextContent(
      "未找到可用 token，请确认 mna 已启动并已生成 token 文件。"
    );
  });

  it("shows a specific message when token is invalid", () => {
    mockedUseAgentWorkspace.mockReturnValue(createWorkspaceState("token_invalid") as never);

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <AgentWorkspace />
      </AgentI18nProvider>
    );

    expect(screen.getByTestId("agent-offline-state")).toHaveTextContent(
      "token 无法使用，请检查 token 文件或重新启动 mna。"
    );
  });

  it("renders runtime config entry and header dependency badges after bootstrap succeeds", () => {
    const createNewSession = vi.fn();
    mockedUseAgentWorkspace.mockReturnValue({
      state: {
        bootstrapStatus: "ok",
        bootstrapReason: null,
        sessionId: "session-1",
        session: {
          id: "session-1",
          memory_mode: "workspace_plus_global",
        },
        sessionList: [],
        connection: "open",
        degraded: false,
        turns: [],
        pendingConfirm: null,
        locale: "zh-CN",
        activeTask: null,
        recentTasks: [],
        replayGapDetected: false,
        sessionError: null,
        sessionErrorCode: null
      },
      activeTurn: null,
      fileTree: {
        path: ".",
        entries: []
      },
      workspaceList: [],
      skillList: [],
      selectedWorkspaceId: null,
      selectedFile: null,
      metrics: null,
      dependencyStatus: {
        runtime: {
          status: "unavailable",
          embeddings: {
            status: "not_configured",
            detail: "embedding config is not complete"
          },
          memory_llm: {
            status: "unknown",
            detail: "memory llm is not configured"
          }
        },
        provider: {
          id: "openai-compatible",
          model: "deepseek-chat",
          status: "misconfigured",
          detail: "provider openai-compatible 缺少 API key 配置"
        },
        mcp: [],
        provider_key: "openai-compatible:deepseek-chat"
      },
      agentConfig: {
        provider: {
          kind: "openai-compatible",
          model: "deepseek-chat",
          base_url: "https://api.deepseek.com",
          api_key: null,
          temperature: 0.2,
          effort: null,
          max_tokens: null,
          organization: null,
          keep_alive: null
        },
        embedding: {
          base_url: null,
          model: null,
          api_key: null
        },
        memory_llm: {
          base_url: null,
          model: "claude-haiku-4-5-20251001",
          api_key: null,
          protocol: "openai-compatible",
          timeout_ms: 15000,
          effort: null,
          max_tokens: null
        },
        tools: {
          approval_mode: "confirm"
        },
        mcp: {
          servers: []
        }
      },
      mcpState: {
        servers: [],
        tools: []
      },
      promptInspector: null,
      promptInspectorOpen: false,
      setPromptInspectorOpen: vi.fn(),
      createNewSession,
      openSession: vi.fn(),
      sendInput: vi.fn(),
      abortCurrentTurn: vi.fn(),
      confirmTool: vi.fn(),
      updateMemoryMode: vi.fn(),
      renameSession: vi.fn(),
      deleteSession: vi.fn(),
      updateProvider: vi.fn(),
      updateRuntimeConfig: vi.fn(),
      refreshMetrics: vi.fn(),
      refreshDependencyStatus: vi.fn(),
      refreshAgentConfig: vi.fn(),
      refreshMcpState: vi.fn(),
      refreshWorkspaceList: vi.fn(),
      checkEmbeddings: vi.fn(),
      checkMemoryLlm: vi.fn(),
      registerWorkspace: vi.fn(),
      pickWorkspace: vi.fn(),
      selectWorkspace: vi.fn(),
      refreshFileTree: vi.fn(),
      openFile: vi.fn(),
      openPromptInspector: vi.fn(),
      restartMcpServer: vi.fn(),
      disableMcpServer: vi.fn()
    } as never);

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <AgentWorkspace />
      </AgentI18nProvider>
    );

    expect(screen.getByText("openai · deepseek-chat")).toBeInTheDocument();
    expect(screen.getByTestId("chat-provider-model")).toHaveTextContent("openai · deepseek-chat");
    expect(screen.getByTestId("agent-provider-badge")).toHaveAttribute("data-state", "misconfigured");
    expect(screen.getByTestId("agent-embedding-badge")).toHaveAttribute("data-state", "not_configured");
    expect(screen.getByTestId("agent-memory-llm-badge")).toHaveAttribute("data-state", "unknown");
    expect(screen.queryByText("记忆面板")).not.toBeInTheDocument();
    expect(screen.queryByText("轮次")).not.toBeInTheDocument();
    expect(screen.queryByTitle("会话")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /设置/ }));
    expect(screen.getByTestId("runtime-config-card")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /新建会话/ }));
    expect(createNewSession).toHaveBeenCalledTimes(1);
  });
});

