import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PromptInspector } from "@/app/agent/_components/prompt-inspector";
import { AgentI18nProvider } from "@/app/agent/_i18n/provider";

describe("PromptInspector", () => {
  it("renders prompt segments metadata alongside raw messages", () => {
    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <PromptInspector
          open
          onClose={vi.fn()}
          payload={{
            turn_id: "turn-1",
            provider_id: "ollama",
            model: "qwen2.5-coder",
            round: 1,
            messages: [{ role: "system", content: "system prompt" }],
            prompt_segments: [
              {
                kind: "core_system",
                priority: "fixed",
                preview: "system prompt",
              },
              {
                kind: "memory_high",
                priority: "high",
                preview: "默认用中文回答",
                phase: "before_response",
                record_ids: ["pref-1"],
                record_count: 1,
              },
            ],
            tools: [],
          }}
        />
      </AgentI18nProvider>,
    );

    expect(screen.getByText("Prompt Segments")).toBeInTheDocument();
    expect(screen.getByText("core_system · fixed")).toBeInTheDocument();
    expect(screen.getByText("memory_high · high")).toBeInTheDocument();
    expect(screen.getByText("phase: before_response")).toBeInTheDocument();
    expect(screen.getByText("默认用中文回答")).toBeInTheDocument();
  });
});
