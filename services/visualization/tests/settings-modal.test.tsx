import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SettingsModal } from "@/app/agent/_components/settings-modal";
import { AgentI18nProvider } from "@/app/agent/_i18n/provider";

const baseConfig = {
  provider: {
    kind: "openai-compatible" as const,
    model: "deepseek-chat",
    base_url: "https://api.deepseek.com",
    api_key: "provider-key",
    temperature: null,
    effort: "high" as const,
    max_tokens: 6000,
    organization: null,
    keep_alive: null,
  },
  embedding: {
    base_url: "https://api.openai.com/v1",
    model: "text-embedding-3-small",
    api_key: "embed-key",
  },
  memory_llm: {
    base_url: "https://api.anthropic.com",
    model: "claude-haiku-4-5-20251001",
    api_key: "writeback-key",
    protocol: "anthropic" as const,
    timeout_ms: 15000,
    effort: "medium" as const,
    max_tokens: 1200,
  },
  tools: {
    approval_mode: "confirm" as const,
  },
  planning: {
    plan_mode: "advisory" as const,
  },
  mcp: {
    servers: [],
  },
};

describe("SettingsModal", () => {
  it("asks the user to save before running embedding health check on unsaved changes", async () => {
    const user = userEvent.setup();

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <SettingsModal
          open
          onClose={vi.fn()}
          config={baseConfig}
          dependencyStatus={{
            runtime: {
              status: "unavailable",
              embeddings: {
                status: "unknown",
                detail: "dependency has not been checked yet",
              },
            },
            provider: {
              status: "configured",
            },
          }}
          memoryMode="workspace_plus_global"
          onMemoryModeChange={vi.fn()}
          onSaveRuntime={vi.fn(async () => undefined)}
          onCheckEmbeddings={vi.fn(async () => ({
            status: "healthy",
            detail: "embedding request completed",
          }))}
          onCheckMemoryLlm={vi.fn(async () => ({
            status: "healthy",
            detail: "memory llm request completed",
          }))}
        />
      </AgentI18nProvider>,
    );

    await user.clear(screen.getByPlaceholderText("EMBEDDING_MODEL"));
    await user.type(screen.getByPlaceholderText("EMBEDDING_MODEL"), "text-embedding-v4");
    await user.click(screen.getByTestId("runtime-config-check-embeddings"));

    expect(screen.getByTestId("runtime-config-feedback")).toHaveTextContent(
      "请先保存当前 embedding 配置，再执行检查。",
    );
  });

  it("asks the user to save before running memory llm health check on unsaved changes", async () => {
    const user = userEvent.setup();
    const onCheckMemoryLlm = vi.fn(async () => ({
      status: "healthy",
      detail: "memory llm request completed",
    }));

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <SettingsModal
          open
          onClose={vi.fn()}
          config={baseConfig}
          dependencyStatus={{
            runtime: {
              status: "unavailable",
              embeddings: {
                status: "unknown",
                detail: "dependency has not been checked yet",
              },
              memory_llm: {
                status: "unknown",
                detail: "dependency has not been checked yet",
              },
            },
            provider: {
              status: "configured",
            },
          }}
          memoryMode="workspace_plus_global"
          onMemoryModeChange={vi.fn()}
          onSaveRuntime={vi.fn(async () => undefined)}
          onCheckEmbeddings={vi.fn(async () => ({
            status: "healthy",
            detail: "embedding request completed",
          }))}
          onCheckMemoryLlm={onCheckMemoryLlm}
        />
      </AgentI18nProvider>,
    );

    await user.clear(screen.getByPlaceholderText("MEMORY_LLM_MODEL"));
    await user.type(screen.getByPlaceholderText("MEMORY_LLM_MODEL"), "claude-sonnet-4-5");
    await user.click(screen.getByTestId("runtime-config-check-memory-llm"));

    expect(onCheckMemoryLlm).not.toHaveBeenCalled();
    expect(screen.getByTestId("runtime-config-feedback")).toHaveTextContent(
      "请先保存当前 memory llm 配置，再执行检查。",
    );
  });

  it("runs embedding health check with the saved config", async () => {
    const user = userEvent.setup();
    const onCheckEmbeddings = vi.fn(async () => ({
      status: "healthy",
      detail: "embedding request completed",
    }));

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <SettingsModal
          open
          onClose={vi.fn()}
          config={baseConfig}
          dependencyStatus={{
            runtime: {
              status: "unavailable",
              embeddings: {
                status: "unknown",
                detail: "dependency has not been checked yet",
              },
            },
            provider: {
              status: "configured",
            },
          }}
          memoryMode="workspace_plus_global"
          onMemoryModeChange={vi.fn()}
          onSaveRuntime={vi.fn(async () => undefined)}
          onCheckEmbeddings={onCheckEmbeddings}
          onCheckMemoryLlm={vi.fn(async () => ({
            status: "healthy",
            detail: "memory llm request completed",
          }))}
        />
      </AgentI18nProvider>,
    );

    await user.click(screen.getByTestId("runtime-config-check-embeddings"));

    expect(onCheckEmbeddings).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("runtime-config-feedback")).toHaveTextContent(
      "healthy: embedding request completed",
    );
  });

  it("validates memory llm fields before saving", async () => {
    const user = userEvent.setup();
    const onSaveRuntime = vi.fn(async () => undefined);

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <SettingsModal
          open
          onClose={vi.fn()}
          config={baseConfig}
          dependencyStatus={null}
          memoryMode="workspace_plus_global"
          onMemoryModeChange={vi.fn()}
          onSaveRuntime={onSaveRuntime}
          onCheckEmbeddings={vi.fn(async () => ({
            status: "healthy",
            detail: "embedding request completed",
          }))}
          onCheckMemoryLlm={vi.fn(async () => ({
            status: "healthy",
            detail: "memory llm request completed",
          }))}
        />
      </AgentI18nProvider>,
    );

    await user.clear(screen.getByPlaceholderText("MEMORY_LLM_MODEL"));
    await user.click(screen.getByTestId("runtime-config-save"));

    expect(onSaveRuntime).not.toHaveBeenCalled();
    expect(screen.getByTestId("runtime-config-error")).toHaveTextContent(
      "填写 MEMORY_LLM_BASE_URL 后，还需要填写 MEMORY_LLM_MODEL。",
    );
  });

  it("runs memory llm health check with the saved config", async () => {
    const user = userEvent.setup();
    const onCheckMemoryLlm = vi.fn(async () => ({
      status: "healthy",
      detail: "memory llm request completed",
    }));

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <SettingsModal
          open
          onClose={vi.fn()}
          config={baseConfig}
          dependencyStatus={{
            runtime: {
              status: "unavailable",
              embeddings: {
                status: "unknown",
                detail: "dependency has not been checked yet",
              },
              memory_llm: {
                status: "unknown",
                detail: "dependency has not been checked yet",
              },
            },
            provider: {
              status: "configured",
            },
          }}
          memoryMode="workspace_plus_global"
          onMemoryModeChange={vi.fn()}
          onSaveRuntime={vi.fn(async () => undefined)}
          onCheckEmbeddings={vi.fn(async () => ({
            status: "healthy",
            detail: "embedding request completed",
          }))}
          onCheckMemoryLlm={onCheckMemoryLlm}
        />
      </AgentI18nProvider>,
    );

    await user.click(screen.getByTestId("runtime-config-check-memory-llm"));

    expect(onCheckMemoryLlm).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("runtime-config-feedback")).toHaveTextContent(
      "healthy: memory llm request completed",
    );
  });

  it("shows memory llm protocol options and keeps saved protocol", () => {
    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <SettingsModal
          open
          onClose={vi.fn()}
          config={baseConfig}
          dependencyStatus={null}
          memoryMode="workspace_plus_global"
          onMemoryModeChange={vi.fn()}
          onSaveRuntime={vi.fn(async () => undefined)}
          onCheckEmbeddings={vi.fn(async () => ({
            status: "healthy",
            detail: "embedding request completed",
          }))}
          onCheckMemoryLlm={vi.fn(async () => ({
            status: "healthy",
            detail: "memory llm request completed",
          }))}
        />
      </AgentI18nProvider>,
    );

    expect(screen.getByDisplayValue("Anthropic")).toBeInTheDocument();
    expect(screen.getByText(/记忆模型支持两种协议/)).toBeInTheDocument();
  });

  it("shows and submits provider and memory llm thinking config", async () => {
    const user = userEvent.setup();
    const onSaveRuntime = vi.fn(async () => undefined);

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <SettingsModal
          open
          onClose={vi.fn()}
          config={baseConfig}
          dependencyStatus={null}
          memoryMode="workspace_plus_global"
          onMemoryModeChange={vi.fn()}
          onSaveRuntime={onSaveRuntime}
          onCheckEmbeddings={vi.fn(async () => ({
            status: "healthy",
            detail: "embedding request completed",
          }))}
          onCheckMemoryLlm={vi.fn(async () => ({
            status: "healthy",
            detail: "memory llm request completed",
          }))}
        />
      </AgentI18nProvider>,
    );

    await user.selectOptions(screen.getAllByRole("combobox")[3]!, "max");
    await user.clear(screen.getByPlaceholderText("最大输出 token"));
    await user.type(screen.getByPlaceholderText("最大输出 token"), "8192");
    await user.selectOptions(screen.getAllByRole("combobox")[5]!, "xhigh");
    await user.clear(screen.getByPlaceholderText("记忆模型最大输出 token"));
    await user.type(screen.getByPlaceholderText("记忆模型最大输出 token"), "2048");
    await user.click(screen.getByTestId("runtime-config-save"));

    expect(onSaveRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({
          effort: "max",
          max_tokens: 8192,
        }),
        planning: expect.objectContaining({
          plan_mode: "advisory",
        }),
        memory_llm: expect.objectContaining({
          effort: "xhigh",
          max_tokens: 2048,
        }),
      }),
    );
  });

  it("submits confirm plan mode when user switches it", async () => {
    const user = userEvent.setup();
    const onSaveRuntime = vi.fn(async () => undefined);

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <SettingsModal
          open
          onClose={vi.fn()}
          config={baseConfig}
          dependencyStatus={null}
          memoryMode="workspace_plus_global"
          onMemoryModeChange={vi.fn()}
          onSaveRuntime={onSaveRuntime}
          onCheckEmbeddings={vi.fn(async () => ({
            status: "healthy",
            detail: "embedding request completed",
          }))}
          onCheckMemoryLlm={vi.fn(async () => ({
            status: "healthy",
            detail: "memory llm request completed",
          }))}
        />
      </AgentI18nProvider>,
    );

    await user.click(screen.getByTestId("plan-mode-confirm"));
    await user.click(screen.getByTestId("runtime-config-save"));

    expect(onSaveRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        planning: {
          plan_mode: "confirm",
        },
      }),
    );
  });
});

