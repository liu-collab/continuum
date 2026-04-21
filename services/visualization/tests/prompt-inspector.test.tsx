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
            phase_results: [
              {
                phase: "task_switch",
                trace_id: "trace-task-switch",
                degraded: false,
                injection_summary: "任务切换时命中了相关偏好",
              },
              {
                phase: "before_response",
                trace_id: "trace-before-response",
                degraded: false,
                injection_summary: "回复前命中了中文偏好",
              },
            ],
            tools: [],
          }}
        />
      </AgentI18nProvider>,
    );

    expect(screen.getByText("最终 Prompt 片段")).toBeInTheDocument();
    expect(screen.getByText("阶段命中记录")).toBeInTheDocument();
    expect(screen.getByText("core_system · fixed")).toBeInTheDocument();
    expect(screen.getByText("memory_high · high")).toBeInTheDocument();
    expect(screen.getByText("phase: before_response")).toBeInTheDocument();
    expect(screen.getByText("默认用中文回答")).toBeInTheDocument();
    expect(screen.getByText("task_switch")).toBeInTheDocument();
    expect(screen.getByText("任务切换时命中了相关偏好")).toBeInTheDocument();
  });
});
