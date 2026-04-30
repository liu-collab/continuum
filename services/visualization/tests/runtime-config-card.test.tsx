import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RuntimeConfigCard } from "@/app/agent/_components/runtime-config-card";
import { AgentI18nProvider } from "@/lib/i18n/agent/provider";

const baseConfig = {
  provider: {
    kind: "not-configured" as const,
    model: "",
    base_url: null,
    api_key: null,
    temperature: null,
    effort: null,
    max_tokens: null,
    organization: null,
    keep_alive: null,
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
    protocol: "openai-compatible" as const,
    timeout_ms: 15000,
    effort: null,
    max_tokens: null,
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

describe("RuntimeConfigCard", () => {
  it("blocks save when provider model is empty", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <RuntimeConfigCard
          config={{
            ...baseConfig,
            provider: {
              ...baseConfig.provider,
              kind: "openai-compatible",
              model: "deepseek-chat",
              base_url: "https://api.deepseek.com",
              api_key: "demo-key",
            },
          }}
          dependencyStatus={null}
          onSave={onSave}
        />
      </AgentI18nProvider>,
    );

    const providerModelInput = screen.getByPlaceholderText("provider model");
    await user.clear(providerModelInput);
    await user.click(screen.getByRole("button", { name: "保存配置" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId("runtime-config-error")).toHaveTextContent("provider model 不能为空。");
  });

  it("blocks save when embedding base url exists without embedding model", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <RuntimeConfigCard
          config={{
            ...baseConfig,
            provider: {
              ...baseConfig.provider,
              kind: "openai-compatible",
              model: "deepseek-chat",
              base_url: "https://api.deepseek.com",
              api_key: "demo-key",
            },
          }}
          dependencyStatus={null}
          onSave={onSave}
        />
      </AgentI18nProvider>,
    );

    await user.type(screen.getByPlaceholderText("EMBEDDING_BASE_URL"), "https://api.openai.com/v1");
    await user.click(screen.getByRole("button", { name: "保存配置" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId("runtime-config-error")).toHaveTextContent(
      "填写 EMBEDDING_BASE_URL 后，还需要填写 EMBEDDING_MODEL。",
    );
  });

  it("blocks save when embedding api key is empty", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <RuntimeConfigCard
          config={{
            ...baseConfig,
            provider: {
              ...baseConfig.provider,
              kind: "openai-compatible",
              model: "deepseek-chat",
              base_url: "https://api.deepseek.com",
              api_key: "demo-key",
            },
            embedding: {
              base_url: "https://api.openai.com/v1",
              model: "text-embedding-3-small",
              api_key: "",
            },
          }}
          dependencyStatus={null}
          onSave={onSave}
        />
      </AgentI18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "保存配置" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId("runtime-config-error")).toHaveTextContent("EMBEDDING_API_KEY 不能为空。");
    expect(screen.getByTestId("embedding-config-hint")).toHaveAccessibleName(
      /https:\/\/dashscope\.aliyuncs\.com\/compatible-mode\/v1/,
    );
    expect(screen.getByTestId("embedding-config-hint")).toHaveAccessibleName(/\/embeddings/);
  });

  it("submits provider and embedding config after validation passes", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <RuntimeConfigCard
          config={baseConfig}
          dependencyStatus={{
            runtime: {
              status: "unavailable",
              embeddings: {
                status: "not_configured",
                detail: "embedding config is not complete",
              },
            },
            provider: {
              status: "misconfigured",
              detail: "provider openai-compatible 缺少 API key 配置",
            },
          }}
          onSave={onSave}
        />
      </AgentI18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "OpenAI-compatible" }));
    await user.click(screen.getByRole("option", { name: "OpenAI-compatible" }));
    fireEvent.change(screen.getByPlaceholderText("provider model"), { target: { value: "deepseek-chat" } });
    fireEvent.change(screen.getByPlaceholderText("provider base_url"), {
      target: { value: "https://api.deepseek.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("provider api_key"), { target: { value: "demo-key" } });
    fireEvent.change(screen.getByPlaceholderText("EMBEDDING_BASE_URL"), {
      target: { value: "https://api.openai.com/v1" },
    });
    fireEvent.change(screen.getByPlaceholderText("EMBEDDING_MODEL"), {
      target: { value: "text-embedding-3-small" },
    });
    fireEvent.change(screen.getByPlaceholderText("EMBEDDING_API_KEY"), {
      target: { value: "embed-key" },
    });
    await user.click(screen.getByRole("button", { name: "保存配置" }));

    expect(onSave).toHaveBeenCalledWith({
      provider: {
        kind: "openai-compatible",
        model: "deepseek-chat",
        base_url: "https://api.deepseek.com",
        api_key: "demo-key",
      },
      embedding: {
        base_url: "https://api.openai.com/v1",
        model: "text-embedding-3-small",
        api_key: "embed-key",
      },
    });
    expect(screen.getByText("misconfigured")).toBeInTheDocument();
    expect(screen.getByText("not_configured")).toBeInTheDocument();
  });

  it("requires provider base_url for openai-compatible provider", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <RuntimeConfigCard config={baseConfig} dependencyStatus={null} onSave={onSave} />
      </AgentI18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "OpenAI-compatible" }));
    await user.click(screen.getByRole("option", { name: "OpenAI-compatible" }));
    await user.clear(screen.getByPlaceholderText("provider model"));
    await user.type(screen.getByPlaceholderText("provider model"), "deepseek-chat");
    await user.click(screen.getByRole("button", { name: "保存配置" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId("runtime-config-error")).toHaveTextContent("当前接口协议需要填写 base_url。");
  });

  it("requires provider api_key for openai-compatible provider", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <RuntimeConfigCard
          config={{
            ...baseConfig,
            provider: {
              ...baseConfig.provider,
              kind: "openai-compatible",
              model: "deepseek-chat",
              base_url: "https://api.deepseek.com",
            },
          }}
          dependencyStatus={null}
          onSave={onSave}
        />
      </AgentI18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "保存配置" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId("runtime-config-error")).toHaveTextContent("当前接口协议需要填写 api_key。");
  });

  it("exposes the common provider kinds in the selector", async () => {
    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <RuntimeConfigCard
          config={{
            ...baseConfig,
            provider: {
              ...baseConfig.provider,
              kind: "openai-compatible",
              model: "gpt-4.1-mini",
            },
          }}
          dependencyStatus={null}
          onSave={vi.fn()}
        />
      </AgentI18nProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "OpenAI-compatible" }));
    const options = screen.getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["OpenAI-compatible", "OpenAI Responses", "anthropic", "ollama"]);
  });

  it("keeps a hidden provider kind visible when existing config already uses it", async () => {
    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <RuntimeConfigCard
          config={{
            ...baseConfig,
            provider: {
              ...baseConfig.provider,
              kind: "record-replay",
              model: "fixture-model",
            },
          }}
          dependencyStatus={null}
          onSave={vi.fn()}
        />
      </AgentI18nProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "record-replay" }));
    const options = screen.getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["OpenAI-compatible", "OpenAI Responses", "anthropic", "ollama", "record-replay"]);
  });
});
