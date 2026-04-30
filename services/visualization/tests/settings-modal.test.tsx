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
    const onListProviderModels = vi.fn(async () => ({
      models: [
        { id: "gpt-4.1-mini", label: "gpt-4.1-mini" },
        { id: "gpt-4.1", label: "gpt-4.1" },
      ],
    }));

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
          onListProviderModels={onListProviderModels}
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

    expect(screen.getByTestId("setup-protocol-select")).toHaveTextContent("OpenAI Responses");
    expect(screen.queryByTestId("setup-protocol-summary")).not.toBeInTheDocument();
    expect(screen.getByLabelText("base_url")).toHaveValue("https://api.openai.com/v1");
    await user.click(screen.getByTestId("setup-wizard-next"));
    expect(screen.getByTestId("setup-api-key-env-detected")).toHaveTextContent(
      "已检测到环境变量 OPENAI_API_KEY，可直接使用。",
    );
    await user.click(screen.getByTestId("setup-wizard-next"));
    expect(onListProviderModels).toHaveBeenCalledWith({
      kind: "openai-responses",
      base_url: "https://api.openai.com/v1",
      api_key_env: "OPENAI_API_KEY",
    });
    expect(await screen.findByTestId("setup-model-select")).toHaveTextContent("请选择模型");
    await user.click(screen.getByTestId("setup-model-select"));
    await user.click(screen.getByRole("option", { name: "gpt-4.1-mini" }));
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

  it("saves an OpenAI-compatible provider from the setup wizard", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSaveRuntime = vi.fn(async () => undefined);
    const onListProviderModels = vi.fn(async () => ({
      models: [
        { id: "deepseek-chat", label: "deepseek-chat" },
        { id: "deepseek-reasoner", label: "deepseek-reasoner" },
      ],
    }));

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
          onListProviderModels={onListProviderModels}
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
    expect(screen.getByTestId("provider-setup-wizard")).toHaveTextContent("1. 填写 base_url");
    expect(screen.getByTestId("setup-protocol-select")).toHaveTextContent("OpenAI-compatible");
    await user.type(screen.getByLabelText("base_url"), "https://api.deepseek.com");
    await user.click(screen.getByTestId("setup-wizard-next"));
    await user.type(screen.getByLabelText("API Key"), "sk-test");
    await user.click(screen.getByTestId("setup-wizard-next"));
    expect(onListProviderModels).toHaveBeenCalledWith({
      kind: "openai-compatible",
      base_url: "https://api.deepseek.com",
      api_key: "sk-test",
    });
    expect(await screen.findByTestId("setup-model-select")).toHaveTextContent("请选择模型");
    await user.click(screen.getByTestId("setup-model-select"));
    await user.click(screen.getByRole("option", { name: "deepseek-chat" }));
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
    const onListProviderModels = vi.fn(async () => ({
      models: [
        { id: "qwen-plus", label: "qwen-plus" },
        { id: "qwen-max", label: "qwen-max" },
      ],
    }));

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
          onListProviderModels={onListProviderModels}
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

    await user.type(
      screen.getByLabelText("base_url"),
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    );
    await user.click(screen.getByTestId("setup-wizard-next"));
    await user.type(screen.getByLabelText("API Key"), "sk-custom");
    await user.click(screen.getByTestId("setup-wizard-next"));
    expect(onListProviderModels).toHaveBeenCalledWith({
      kind: "openai-compatible",
      base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      api_key: "sk-custom",
    });
    await user.click(screen.getByTestId("setup-model-select"));
    await user.click(screen.getByRole("option", { name: "qwen-plus" }));
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

  it("preserves a custom base_url when changing protocol in the setup wizard", async () => {
    const user = userEvent.setup();
    const onSaveRuntime = vi.fn(async () => undefined);
    const onListProviderModels = vi.fn(async () => ({
      models: [
        { id: "openrouter/auto", label: "openrouter/auto" },
      ],
    }));

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
          onListProviderModels={onListProviderModels}
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

    await user.type(screen.getByLabelText("base_url"), "https://openrouter.ai/api/v1");
    await user.click(screen.getByTestId("setup-protocol-select"));
    await user.click(screen.getByRole("option", { name: "OpenAI Responses (/v1/responses)" }));
    expect(screen.getByLabelText("base_url")).toHaveValue("https://openrouter.ai/api/v1");
    await user.click(screen.getByTestId("setup-wizard-next"));
    await user.type(screen.getByLabelText("API Key"), "sk-router");
    await user.click(screen.getByTestId("setup-wizard-next"));
    expect(onListProviderModels).toHaveBeenCalledWith({
      kind: "openai-responses",
      base_url: "https://openrouter.ai/api/v1",
      api_key: "sk-router",
    });
    await user.click(screen.getByTestId("setup-model-select"));
    await user.click(screen.getByRole("option", { name: "openrouter/auto" }));
    await user.click(screen.getByTestId("setup-wizard-save"));

    expect(onSaveRuntime).toHaveBeenCalledWith({
      provider: {
        kind: "openai-responses",
        model: "openrouter/auto",
        base_url: "https://openrouter.ai/api/v1",
        api_key: "sk-router",
        effort: null,
      },
    });
  });

  it("blocks Ollama setup when base_url is an OpenAI-compatible endpoint", async () => {
    const user = userEvent.setup();
    const onListProviderModels = vi.fn(async () => ({
      models: [],
    }));

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
          onSaveRuntime={vi.fn(async () => undefined)}
          onListProviderModels={onListProviderModels}
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

    await user.click(screen.getByTestId("setup-protocol-select"));
    await user.click(screen.getByRole("option", { name: "Ollama (/api/chat)" }));
    await user.clear(screen.getByLabelText("base_url"));
    await user.type(screen.getByLabelText("base_url"), "http://localhost:8090/v1");
    await user.click(screen.getByTestId("setup-wizard-next"));

    expect(onListProviderModels).not.toHaveBeenCalled();
    expect(screen.getByTestId("runtime-config-error")).toHaveTextContent(
      "当前 base_url 是 OpenAI-compatible 的 /v1 地址",
    );
    expect(screen.getByTestId("runtime-config-error")).toHaveClass("notice-danger");
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
      expect(within(primaryConfig).getByPlaceholderText("provider base_url")).toHaveValue("https://api.deepseek.com");
    });
    expect(within(primaryConfig).getByPlaceholderText("provider model")).toHaveValue("");
    expect(within(primaryConfig).getByPlaceholderText("provider base_url")).toHaveValue("https://api.deepseek.com");
    expect(screen.getByTestId("runtime-config-provider-api-key-env")).toHaveTextContent(
      "已检测到环境变量 DEEPSEEK_API_KEY，可直接使用。",
    );

    await user.click(screen.getByTestId("runtime-config-save"));

    expect(onSaveRuntime).not.toHaveBeenCalled();
    expect(screen.getByTestId("runtime-config-error")).toHaveTextContent(
      "provider model 不能为空。",
    );
    expect(screen.getByTestId("runtime-config-error")).toHaveClass("notice-danger");
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
              api_key: "openai-key",
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
    expect(screen.getByTestId("embedding-config-hint")).toHaveAccessibleName(
      /https:\/\/dashscope\.aliyuncs\.com\/compatible-mode\/v1/,
    );
    expect(screen.getByTestId("embedding-config-hint")).toHaveAccessibleName(/\/embeddings/);
    const memoryConfig = screen.getByTestId("memory-model-config");
    expect(screen.getByTestId("memory-model-mode-select")).toHaveTextContent("与主模型一致");
    expect(within(memoryConfig).getByRole("button", { name: "类型" })).toHaveTextContent("OpenAI-compatible");
    expect(within(memoryConfig).getByPlaceholderText("provider model")).toHaveValue("gpt-4.1-mini");
    expect(within(memoryConfig).getByPlaceholderText("provider base_url")).toHaveValue("https://api.openai.com/v1");
    expect(within(memoryConfig).getByPlaceholderText("provider api_key")).toHaveValue("openai-key");
    await user.click(screen.getByTestId("runtime-config-save"));

    expect(onSaveRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        embedding: expect.objectContaining({
          base_url: "https://api.openai.com/v1",
          model: "text-embedding-3-small",
          api_key: "openai-key",
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
    const memoryConfig = screen.getByTestId("memory-model-config");
    await user.clear(within(memoryConfig).getByPlaceholderText("provider model"));
    await user.type(within(memoryConfig).getByPlaceholderText("provider model"), "claude-sonnet-4-5");
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
    await user.clear(within(screen.getByTestId("memory-model-config")).getByPlaceholderText("provider model"));
    await user.click(screen.getByTestId("runtime-config-save"));

    expect(onSaveRuntime).not.toHaveBeenCalled();
    expect(screen.getByTestId("runtime-config-error")).toHaveTextContent(
      "填写 MEMORY_LLM_BASE_URL 后，还需要填写 MEMORY_LLM_MODEL。",
    );
  });

  it("validates embedding api key before saving", async () => {
    const user = userEvent.setup();
    const onSaveRuntime = vi.fn(async () => undefined);

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <SettingsModal
          open
          onClose={vi.fn()}
          config={{
            ...baseConfig,
            embedding: {
              ...baseConfig.embedding,
              api_key: "",
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

    await openAdvancedSettings(user);
    await user.click(screen.getByTestId("runtime-config-save"));

    expect(onSaveRuntime).not.toHaveBeenCalled();
    expect(screen.getByTestId("runtime-config-error")).toHaveTextContent("EMBEDDING_API_KEY 不能为空。");
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
    const memoryConfig = screen.getByTestId("memory-model-config");
    expect(within(memoryConfig).getByRole("button", { name: "类型" })).toHaveTextContent("anthropic");
    await user.click(within(memoryConfig).getByRole("button", { name: "类型" }));
    expect(screen.getByRole("option", { name: "OpenAI-compatible" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "OpenAI Responses" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "anthropic" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "ollama" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "OpenAI Responses" }));
    expect(within(memoryConfig).getByRole("button", { name: "类型" })).toHaveTextContent("OpenAI Responses");
    expect(within(memoryConfig).getByPlaceholderText("provider model")).toHaveValue("claude-haiku-4-5-20251001");
    expect(within(memoryConfig).getByPlaceholderText("provider base_url")).toHaveValue("https://api.anthropic.com");
    expect(within(memoryConfig).getByPlaceholderText("provider api_key")).toHaveValue("writeback-key");
    expect(within(memoryConfig).queryByPlaceholderText("记忆模型最大输出 token")).not.toBeInTheDocument();
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
    const memoryConfig = screen.getByTestId("memory-model-config");
    expect(within(memoryConfig).getByPlaceholderText("provider model")).toHaveValue(baseConfig.provider.model);
    expect(within(memoryConfig).getByPlaceholderText("provider base_url")).toHaveValue(baseConfig.provider.base_url);
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
    expect(within(memoryConfig).queryByPlaceholderText("记忆模型最大输出 token")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("memory-model-advanced-toggle"));
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

  it("can mirror OpenAI Responses as the memory model protocol", async () => {
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
              kind: "openai-responses",
              model: "gpt-4.1-mini",
              base_url: "https://api.openai.com/v1",
            },
            memory_llm: {
              base_url: "https://api.openai.com/v1",
              model: "gpt-4.1-mini",
              api_key: baseConfig.provider.api_key,
              protocol: "openai-responses",
              timeout_ms: 15000,
              effort: baseConfig.provider.effort,
              max_tokens: baseConfig.provider.max_tokens,
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

    await openAdvancedSettings(user);
    expect(screen.getByTestId("memory-model-mode-select")).toHaveTextContent("与主模型一致");
    expect(within(screen.getByTestId("memory-model-config")).getByRole("button", { name: "类型" })).toHaveTextContent("OpenAI Responses");
    await user.click(screen.getByTestId("runtime-config-save"));

    expect(onSaveRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        memory_llm: expect.objectContaining({
          base_url: "https://api.openai.com/v1",
          model: "gpt-4.1-mini",
          protocol: "openai-responses",
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
