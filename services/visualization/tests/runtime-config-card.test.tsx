import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RuntimeConfigCard } from "@/app/agent/_components/runtime-config-card";
import { AgentI18nProvider } from "@/app/agent/_i18n/provider";

const baseConfig = {
  provider: {
    kind: "demo" as const,
    model: "continuum-demo",
    base_url: null,
    api_key: null,
    api_key_env: null,
    temperature: null,
    organization: null,
    keep_alive: null,
  },
  embedding: {
    base_url: null,
    model: null,
    api_key: null,
  },
};

describe("RuntimeConfigCard", () => {
  it("blocks save when provider model is empty", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <RuntimeConfigCard config={baseConfig} dependencyStatus={null} onSave={onSave} />
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
        <RuntimeConfigCard config={baseConfig} dependencyStatus={null} onSave={onSave} />
      </AgentI18nProvider>,
    );

    await user.type(screen.getByPlaceholderText("provider model"), "deepseek-chat");
    await user.type(screen.getByPlaceholderText("EMBEDDING_BASE_URL"), "https://api.openai.com/v1");
    await user.click(screen.getByRole("button", { name: "保存配置" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId("runtime-config-error")).toHaveTextContent(
      "填写 EMBEDDING_BASE_URL 后，还需要填写 EMBEDDING_MODEL。",
    );
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

    await user.selectOptions(screen.getByRole("combobox"), "openai-compatible");
    await user.clear(screen.getByPlaceholderText("provider model"));
    await user.type(screen.getByPlaceholderText("provider model"), "deepseek-chat");
    await user.type(screen.getByPlaceholderText("provider base_url"), "https://api.deepseek.com");
    await user.type(screen.getByPlaceholderText("provider api_key（可选）"), "demo-key");
    await user.type(screen.getByPlaceholderText("EMBEDDING_BASE_URL"), "https://api.openai.com/v1");
    await user.type(screen.getByPlaceholderText("EMBEDDING_MODEL"), "text-embedding-3-small");
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
      },
    });
    expect(screen.getByText("misconfigured")).toBeInTheDocument();
    expect(screen.getByText("not_configured")).toBeInTheDocument();
  });
});
