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
    organization: null,
    keep_alive: null,
  },
  embedding: {
    base_url: "https://api.openai.com/v1",
    model: "text-embedding-3-small",
    api_key: "embed-key",
  },
  writeback_llm: {
    base_url: "https://api.anthropic.com",
    model: "claude-haiku-4-5-20251001",
    api_key: "writeback-key",
    timeout_ms: 5000,
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
        />
      </AgentI18nProvider>,
    );

    await user.click(screen.getByTestId("runtime-config-check-embeddings"));

    expect(onCheckEmbeddings).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("runtime-config-feedback")).toHaveTextContent(
      "healthy: embedding request completed",
    );
  });

  it("validates writeback llm fields before saving", async () => {
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
        />
      </AgentI18nProvider>,
    );

    await user.clear(screen.getByPlaceholderText("WRITEBACK_LLM_MODEL"));
    await user.click(screen.getByTestId("runtime-config-save"));

    expect(onSaveRuntime).not.toHaveBeenCalled();
    expect(screen.getByTestId("runtime-config-error")).toHaveTextContent(
      "填写 WRITEBACK_LLM_BASE_URL 后，还需要填写 WRITEBACK_LLM_MODEL。",
    );
  });
});
