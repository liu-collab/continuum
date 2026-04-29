import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SettingsModal } from "@/app/agent/_components/settings-modal";
import { AgentI18nProvider } from "@/lib/i18n/agent/provider";

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

const baseRuntimeConfig = {
  governance: {
    WRITEBACK_MAINTENANCE_ENABLED: false,
    WRITEBACK_MAINTENANCE_INTERVAL_MS: 900000,
    WRITEBACK_GOVERNANCE_VERIFY_ENABLED: true,
    WRITEBACK_GOVERNANCE_SHADOW_MODE: false,
    WRITEBACK_MAINTENANCE_MAX_ACTIONS: 10,
  },
};

async function openAdvancedSettings(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("advanced-settings-toggle"));
}

describe("SettingsModal", () => {
  it("uses a detected OpenAI API key env hint in the setup wizard", async () => {
    const user = userEvent.setup();
    const onSaveRuntime = vi.fn(async () => undefined);

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <SettingsModal
          open
          setupWizard
          onClose={vi.fn()}
          config={{
            ...baseConfig,
            provider: {
              ...baseConfig.provider,
              kind: "not-configured",
              model: "",
              base_url: null,
              api_key: null,
            },
            env_hints: {
              provider_api_key_env: "OPENAI_API_KEY",
            },
          }}
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

    expect(screen.getByTestId("setup-provider-openai")).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByTestId("setup-wizard-next"));
    expect(screen.getByTestId("setup-api-key-env-detected")).toHaveTextContent(
      "已检测到环境变量 OPENAI_API_KEY，可直接使用。",
    );
    await user.click(screen.getByTestId("setup-wizard-next"));
    expect(screen.getByLabelText("模型名")).toHaveValue("gpt-4.1-mini");
    await user.click(screen.getByTestId("setup-wizard-save"));

    expect(onSaveRuntime).toHaveBeenCalledWith({
      provider: {
        kind: "openai-responses",
        model: "gpt-4.1-mini",
        base_url: "https://api.openai.com/v1",
        api_key_env: "OPENAI_API_KEY",
        effort: null,
      },
    });
  });

  it("saves a real provider from the setup wizard", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSaveRuntime = vi.fn(async () => undefined);

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <SettingsModal
          open
          setupWizard
          onClose={onClose}
          config={{
            ...baseConfig,
            provider: {
              ...baseConfig.provider,
              kind: "not-configured",
              model: "",
              base_url: null,
              api_key: null,
            },
          }}
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

    expect(screen.getByText("配置主模型")).toBeInTheDocument();
    expect(screen.getByTestId("provider-setup-wizard")).toHaveTextContent("1. 选择提供商");
    await user.click(screen.getByTestId("setup-provider-deepseek"));
    await user.click(screen.getByTestId("setup-wizard-next"));
    await user.type(screen.getByLabelText("API Key"), "sk-test");
    await user.click(screen.getByTestId("setup-wizard-next"));
    expect(screen.getByLabelText("模型名")).toHaveValue("deepseek-chat");
    await user.click(screen.getByTestId("setup-wizard-save"));

    expect(onSaveRuntime).toHaveBeenCalledWith({
      provider: {
        kind: "openai-compatible",
        model: "deepseek-chat",
        base_url: "https://api.deepseek.com",
        api_key: "sk-test",
        effort: null,
      },
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("saves a custom OpenAI-compatible provider from the setup wizard", async () => {
    const user = userEvent.setup();
    const onSaveRuntime = vi.fn(async () => undefined);

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <SettingsModal
          open
          setupWizard
          onClose={vi.fn()}
          config={{
            ...baseConfig,
            provider: {
              ...baseConfig.provider,
              kind: "not-configured",
              model: "",
              base_url: null,
              api_key: null,
            },
          }}
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

    await user.click(screen.getByTestId("setup-provider-custom"));
    await user.click(screen.getByTestId("setup-wizard-next"));
    await user.type(screen.getByLabelText("API Key"), "sk-custom");
    expect(screen.getByLabelText("provider base_url")).toHaveValue("https://api.example.com/v1");
    await user.clear(screen.getByLabelText("provider base_url"));
    await user.type(
      screen.getByLabelText("provider base_url"),
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    );
    await user.click(screen.getByTestId("setup-wizard-next"));
    await user.clear(screen.getByLabelText("模型名"));
    await user.type(screen.getByLabelText("模型名"), "qwen-plus");
    await user.click(screen.getByTestId("setup-wizard-save"));

    expect(onSaveRuntime).toHaveBeenCalledWith({
      provider: {
        kind: "openai-compatible",
        model: "qwen-plus",
        base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        api_key: "sk-custom",
        effort: null,
      },
    });
  });

  it("allows editing the preset provider base_url in the setup wizard", async () => {
    const user = userEvent.setup();
    const onSaveRuntime = vi.fn(async () => undefined);

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <SettingsModal
          open
          setupWizard
          onClose={vi.fn()}
          config={{
            ...baseConfig,
            provider: {
              ...baseConfig.provider,
              kind: "not-configured",
              model: "",
              base_url: null,
              api_key: null,
            },
          }}
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

    await user.click(screen.getByTestId("setup-provider-openai"));
    await user.click(screen.getByTestId("setup-wizard-next"));
    await user.type(screen.getByLabelText("API Key"), "sk-router");
    await user.clear(screen.getByLabelText("provider base_url"));
    await user.type(screen.getByLabelText("provider base_url"), "https://openrouter.ai/api/v1");
    await user.click(screen.getByTestId("setup-wizard-next"));
    await user.click(screen.getByTestId("setup-wizard-save"));

    expect(onSaveRuntime).toHaveBeenCalledWith({
      provider: {
        kind: "openai-responses",
        model: "gpt-4.1-mini",
        base_url: "https://openrouter.ai/api/v1",
        api_key: "sk-router",
        effort: null,
      },
    });
  });

  it("prefills provider settings from a detected DeepSeek API key env hint", async () => {
    const user = userEvent.setup();
    const onSaveRuntime = vi.fn(async () => undefined);

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <SettingsModal
          open
          onClose={vi.fn()}
          config={{
            ...baseConfig,
            provider: {
              ...baseConfig.provider,
              kind: "not-configured",
              model: "",
              base_url: null,
              api_key: null,
            },
            env_hints: {
              provider_api_key_env: "DEEPSEEK_API_KEY",
            },
          }}
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

    const primaryConfig = screen.getByTestId("primary-model-config");
    await waitFor(() => {
      expect(within(primaryConfig).getByPlaceholderText("provider model")).toHaveValue("deepseek-chat");
    });
    expect(within(primaryConfig).getByPlaceholderText("provider base_url")).toHaveValue("https://api.deepseek.com");
    expect(screen.getByTestId("runtime-config-provider-api-key-env")).toHaveTextContent(
      "已检测到环境变量 DEEPSEEK_API_KEY，可直接使用。",
    );

    await user.click(screen.getByTestId("runtime-config-save"));

    expect(onSaveRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({
          kind: "openai-compatible",
          model: "deepseek-chat",
          base_url: "https://api.deepseek.com",
          api_key_env: "DEEPSEEK_API_KEY",
        }),
      }),
    );
  });

  it("defaults embedding and memory llm to the primary model path for OpenAI users", async () => {
    const user = userEvent.setup();
    const onSaveRuntime = vi.fn(async () => undefined);

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <SettingsModal
          open
          onClose={vi.fn()}
          config={{
            ...baseConfig,
            provider: {
              ...baseConfig.provider,
              kind: "openai-compatible",
              model: "gpt-4.1-mini",
              base_url: "https://api.openai.com/v1",
              api_key: "openai-key",
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
          }}
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

    expect(screen.queryByTestId("embedding-config")).not.toBeInTheDocument();
    expect(screen.queryByTestId("memory-model-config")).not.toBeInTheDocument();

    await openAdvancedSettings(user);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("EMBEDDING_MODEL")).toHaveValue("text-embedding-3-small");
    });
    expect(screen.getByTestId("memory-model-mode-select")).toHaveTextContent("与主模型一致");
    await user.click(screen.getByTestId("runtime-config-save"));

    expect(onSaveRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        embedding: expect.objectContaining({
          base_url: "https://api.openai.com/v1",
          model: "text-embedding-3-small",
        }),
        memory_llm: expect.objectContaining({
          base_url: "https://api.openai.com/v1",
          model: "gpt-4.1-mini",
          api_key: "openai-key",
          protocol: "openai-compatible",
        }),
      }),
    );
  });

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

    await openAdvancedSettings(user);
    await user.clear(screen.getByPlaceholderText("EMBEDDING_MODEL"));
    await user.type(screen.getByPlaceholderText("EMBEDDING_MODEL"), "text-embedding-v4");
    await user.click(screen.getByTestId("runtime-config-check-embeddings"));

    expect(screen.getByTestId("runtime-config-feedback")).toHaveTextContent(
      "请先保存当前 embedding 配置，再执行检查。",
    );
    const modal = screen.getByTestId("runtime-config-card");
    expect(modal.firstElementChild).toHaveAttribute("data-testid", "runtime-config-feedback");
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

    await openAdvancedSettings(user);
    await user.clear(screen.getByPlaceholderText("MEMORY_LLM_MODEL"));
    await user.type(screen.getByPlaceholderText("MEMORY_LLM_MODEL"), "claude-sonnet-4-5");
    await user.click(screen.getByTestId("runtime-config-check-memory-llm"));

    expect(onCheckMemoryLlm).not.toHaveBeenCalled();
    expect(screen.getByTestId("runtime-config-feedback")).toHaveTextContent(
      "请先保存当前 memory llm 配置，再执行检查。",
    );
  });

  it("runs memory llm health check when memory model follows the primary model", async () => {
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
          config={{
            ...baseConfig,
            memory_llm: {
              base_url: baseConfig.provider.base_url,
              model: baseConfig.provider.model,
              api_key: baseConfig.provider.api_key,
              protocol: "openai-compatible",
              timeout_ms: 15000,
              effort: baseConfig.provider.effort,
              max_tokens: baseConfig.provider.max_tokens,
            },
          }}
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

    await openAdvancedSettings(user);
    expect(screen.getByTestId("memory-model-mode-select")).toHaveTextContent("与主模型一致");
    await user.click(screen.getByTestId("runtime-config-check-memory-llm"));

    expect(onCheckMemoryLlm).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("runtime-config-feedback")).toHaveTextContent(
      "healthy: memory llm request completed",
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

    await openAdvancedSettings(user);
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

    await openAdvancedSettings(user);
    await user.click(screen.getByTestId("runtime-config-check-memory-llm"));

    expect(onCheckMemoryLlm).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("runtime-config-feedback")).toHaveTextContent(
      "healthy: memory llm request completed",
    );
  });

  it("shows memory llm protocol options and keeps saved protocol", async () => {
    const user = userEvent.setup();

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

    await openAdvancedSettings(user);
    expect(screen.getByRole("button", { name: "MEMORY_LLM_PROTOCOL" })).toHaveTextContent("Anthropic");
    expect(screen.getByTestId("memory-model-mode-select")).toBeInTheDocument();
  });

  it("detects mirrored memory model config and defaults to same-as-primary mode", async () => {
    const user = userEvent.setup();

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <SettingsModal
          open
          onClose={vi.fn()}
          config={{
            ...baseConfig,
            memory_llm: {
              base_url: baseConfig.provider.base_url,
              model: baseConfig.provider.model,
              api_key: baseConfig.provider.api_key,
              protocol: "openai-compatible",
              timeout_ms: 15000,
              effort: baseConfig.provider.effort,
              max_tokens: baseConfig.provider.max_tokens,
            },
          }}
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

    await openAdvancedSettings(user);
    expect(screen.getByTestId("memory-model-mode-select")).toHaveTextContent("与主模型一致");
    expect(screen.queryByPlaceholderText("MEMORY_LLM_MODEL")).not.toBeInTheDocument();
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

    await openAdvancedSettings(user);
    const primaryConfig = screen.getByTestId("primary-model-config");
    const memoryConfig = screen.getByTestId("memory-model-config");

    await user.click(within(primaryConfig).getByRole("button", { name: "思考模式" }));
    await user.click(screen.getByRole("option", { name: "最大" }));
    await user.clear(within(primaryConfig).getByPlaceholderText("最大输出 token"));
    await user.type(within(primaryConfig).getByPlaceholderText("最大输出 token"), "8192");
    await user.click(within(memoryConfig).getByRole("button", { name: "记忆模型思考模式" }));
    await user.click(screen.getByRole("option", { name: "超高" }));
    await user.clear(within(memoryConfig).getByPlaceholderText("记忆模型最大输出 token"));
    await user.type(within(memoryConfig).getByPlaceholderText("记忆模型最大输出 token"), "2048");
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

  it("can save the memory model as the same config as the primary model", async () => {
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

    await openAdvancedSettings(user);
    await user.click(screen.getByTestId("memory-model-mode-select"));
    await user.click(screen.getByRole("option", { name: "与主模型一致" }));
    await user.click(screen.getByTestId("runtime-config-save"));

    expect(onSaveRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        memory_llm: expect.objectContaining({
          base_url: baseConfig.provider.base_url,
          model: baseConfig.provider.model,
          api_key: baseConfig.provider.api_key,
          protocol: "openai-compatible",
          effort: baseConfig.provider.effort,
          max_tokens: baseConfig.provider.max_tokens,
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

  it("saves automatic governance config with runtime settings", async () => {
    const user = userEvent.setup();
    const onSaveGovernanceConfig = vi.fn(async () => undefined);

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <SettingsModal
          open
          onClose={vi.fn()}
          config={baseConfig}
          runtimeConfig={baseRuntimeConfig}
          dependencyStatus={null}
          memoryMode="workspace_plus_global"
          onMemoryModeChange={vi.fn()}
          onSaveRuntime={vi.fn(async () => undefined)}
          onSaveGovernanceConfig={onSaveGovernanceConfig}
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

    const governanceConfig = screen.getByTestId("governance-config");
    await user.click(within(governanceConfig).getByLabelText("启用自动治理"));
    await user.click(within(governanceConfig).getByLabelText("Verifier 二次校验"));
    await user.click(within(governanceConfig).getByLabelText("Shadow 模式"));
    await user.clear(within(governanceConfig).getByPlaceholderText("扫描间隔（分钟）"));
    await user.type(within(governanceConfig).getByPlaceholderText("扫描间隔（分钟）"), "5");
    await user.clear(within(governanceConfig).getByPlaceholderText("每次扫描最大动作数"));
    await user.type(within(governanceConfig).getByPlaceholderText("每次扫描最大动作数"), "4");
    await user.click(screen.getByTestId("runtime-config-save"));

    expect(onSaveGovernanceConfig).toHaveBeenCalledWith({
      WRITEBACK_MAINTENANCE_ENABLED: true,
      WRITEBACK_MAINTENANCE_INTERVAL_MS: 300000,
      WRITEBACK_GOVERNANCE_VERIFY_ENABLED: false,
      WRITEBACK_GOVERNANCE_SHADOW_MODE: true,
      WRITEBACK_MAINTENANCE_MAX_ACTIONS: 4,
    });
  });
});
