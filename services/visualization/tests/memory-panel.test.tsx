import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MemoryPanel } from "@/app/agent/_components/memory-panel";
import { AgentI18nProvider } from "@/lib/i18n/agent/provider";
import type { AgentTurnState } from "@/app/agent/_lib/event-reducer";

function createTurn(overrides: Partial<AgentTurnState> = {}): AgentTurnState {
  return {
    turnId: "turn-default",
    userInput: "",
    assistantOutput: "",
    toolMessages: [],
    toolCalls: [],
    phases: [],
    injection: null,
    finishReason: "stop",
    promptAvailable: true,
    errors: [],
    taskLabel: null,
    plan: null,
    evaluations: [],
    traceSpans: [],
    status: "complete",
    ...overrides
  };
}

describe("MemoryPanel", () => {
  it("shows an empty state when the active turn has no injection block", () => {
    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <MemoryPanel activeTurn={null} />
      </AgentI18nProvider>
    );

    expect(screen.getByTestId("memory-panel")).toHaveTextContent("记忆面板");
    expect(screen.getByText("当前轮次没有注入块")).toBeInTheDocument();
    expect(screen.getByText("当本轮命中并注入记忆后，这里会显示注入摘要和命中记录。")).toBeInTheDocument();
  });

  it("renders the active turn injection summary and matched records only", () => {
    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <MemoryPanel
          activeTurn={createTurn({
            injection: {
              phase: "before_response",
              injection_reason: "用户问题需要延续当前工作区约定。",
              memory_summary: "已注入 3 条与当前任务相关的记忆。",
              memory_records: [
                {
                  id: "memory-workspace",
                  memory_type: "fact_preference",
                  scope: "workspace",
                  summary: "当前项目默认使用中文短句说明。",
                  importance: 5,
                  confidence: 0.9
                },
                {
                  id: "memory-task",
                  memory_type: "task_state",
                  scope: "task",
                  summary: "记忆面板只展示本轮注入结果。",
                  importance: 4,
                  confidence: 0.8
                },
                {
                  id: "memory-user",
                  memory_type: "episodic",
                  scope: "user",
                  summary: "用户上次要求按边界推进。",
                  importance: 3,
                  confidence: 0.7
                }
              ]
            }
          })}
        />
      </AgentI18nProvider>
    );

    expect(screen.getByTestId("memory-panel-phase")).toHaveTextContent("回复前");
    expect(screen.getByTestId("memory-panel-summary")).toHaveTextContent("已注入 3 条与当前任务相关的记忆。");
    expect(screen.getByTestId("memory-panel-summary")).toHaveTextContent("用户问题需要延续当前工作区约定。");
    expect(screen.getByText("工作区 1")).toBeInTheDocument();
    expect(screen.getByText("任务 1")).toBeInTheDocument();
    expect(screen.getByText("用户 1")).toBeInTheDocument();

    const records = within(screen.getByTestId("memory-panel-records"));
    expect(records.getByText("当前项目默认使用中文短句说明。")).toBeInTheDocument();
    expect(records.getByText("偏好")).toBeInTheDocument();
    expect(records.getByText("importance 5 / confidence 0.9")).toBeInTheDocument();
    expect(records.getByText("记忆面板只展示本轮注入结果。")).toBeInTheDocument();
    expect(records.getByText("任务状态")).toBeInTheDocument();
    expect(records.getByText("用户上次要求按边界推进。")).toBeInTheDocument();
    expect(records.getByText("片段")).toBeInTheDocument();
  });

  it("keeps the panel bounded when an injection has no detailed records", () => {
    render(
      <AgentI18nProvider defaultLocale="en-US">
        <MemoryPanel
          activeTurn={createTurn({
            injection: {
              phase: "before_plan",
              injection_reason: "No matched record was selected.",
              memory_summary: "No memory was injected.",
              memory_records: []
            }
          })}
        />
      </AgentI18nProvider>
    );

    expect(screen.getByTestId("memory-panel-phase")).toHaveTextContent("Before planning");
    expect(screen.getByText("No memory was injected.")).toBeInTheDocument();
    expect(screen.getByTestId("memory-panel-records-empty")).toHaveTextContent("No detailed records in this turn.");
    expect(screen.queryByTestId("memory-panel-records")).not.toBeInTheDocument();
  });

  it("keeps long injected content inside the bounded panel", () => {
    const longSummary = "memory-panel-long-summary-without-natural-breaks-".repeat(6);
    const longReason = "memory-panel-long-reason-without-natural-breaks-".repeat(6);
    const longRecord = "memory-panel-long-record-without-natural-breaks-".repeat(6);

    render(
      <AgentI18nProvider defaultLocale="en-US">
        <MemoryPanel
          activeTurn={createTurn({
            injection: {
              phase: "before_response",
              injection_reason: longReason,
              memory_summary: longSummary,
              memory_records: [
                {
                  id: "memory-long",
                  memory_type: "fact_preference",
                  scope: "workspace",
                  summary: longRecord,
                  importance: 5,
                  confidence: 0.9
                }
              ]
            }
          })}
        />
      </AgentI18nProvider>
    );

    expect(screen.getByTestId("memory-panel")).toHaveClass("min-h-0");
    expect(screen.getByTestId("memory-panel-summary")).toHaveClass("break-words");
    expect(screen.getByText(longSummary)).toHaveClass("break-words");
    expect(screen.getByText(longReason)).toHaveClass("break-words");
    expect(screen.getByText(longRecord)).toHaveClass("break-words");
  });

  it("falls back to raw scope and type values that are not yet translated", () => {
    render(
      <AgentI18nProvider defaultLocale="en-US">
        <MemoryPanel
          activeTurn={createTurn({
            injection: {
              phase: "after_response",
              injection_reason: "A custom source matched.",
              memory_summary: "A custom memory was injected.",
              memory_records: [
                {
                  id: "memory-custom",
                  memory_type: "custom_type",
                  scope: "organization",
                  summary: "Use the raw labels for unknown values.",
                  importance: 2,
                  confidence: 0.5
                }
              ]
            }
          })}
        />
      </AgentI18nProvider>
    );

    expect(screen.getByText("organization 1")).toBeInTheDocument();
    expect(screen.getByText("custom_type")).toBeInTheDocument();
    expect(screen.getAllByText("organization")).toHaveLength(1);
  });
});
