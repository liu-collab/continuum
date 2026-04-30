import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChatPanel } from "@/app/agent/_components/chat-panel";
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
    ...overrides,
  };
}

describe("ChatPanel", () => {
  it("submits only once when pressing Enter", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <ChatPanel
          turns={[]}
          connection="open"
          degraded={false}
          activeTaskLabel={null}
          skills={[]}
          onSend={onSend}
          onAbort={vi.fn()}
          onOpenPrompt={vi.fn()}
        />
      </AgentI18nProvider>,
    );

    const input = screen.getByTestId("agent-input");
    await user.type(input, "测试连通性");
    await user.keyboard("{Enter}");

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("测试连通性");
    expect(screen.getByTestId("agent-input")).toHaveValue("");
  });

  it("keeps draft input but does not submit a new turn while one is running", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <ChatPanel
          turns={[
            createTurn({
              turnId: "turn-running",
              userInput: "先处理这个",
              assistantOutput: "处理中",
              status: "streaming",
              finishReason: null,
            }),
          ]}
          connection="open"
          degraded={false}
          activeTaskLabel={null}
          skills={[]}
          onSend={onSend}
          onAbort={vi.fn()}
          onOpenPrompt={vi.fn()}
        />
      </AgentI18nProvider>,
    );

    const input = screen.getByTestId("agent-input");
    await user.type(input, "下一条先放这里");
    await user.keyboard("{Enter}");

    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByTestId("send-message")).toBeDisabled();
    expect(input).toHaveValue("下一条先放这里");
  });

  it("renders chat messages in conversation order", () => {
    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <ChatPanel
          turns={[
            createTurn({
              turnId: "turn-1",
              userInput: "你好",
              assistantOutput: "你好，我在。",
            }),
          ]}
          connection="open"
          degraded={false}
          activeTaskLabel={null}
          skills={[]}
          onSend={vi.fn()}
          onAbort={vi.fn()}
          onOpenPrompt={vi.fn()}
        />
      </AgentI18nProvider>,
    );

    expect(screen.getByTestId("user-message-turn-1")).toHaveTextContent("你好");
    expect(screen.getByTestId("assistant-message-turn-1")).toHaveTextContent("你好，我在。");
  });

  it("renders assistant markdown instead of showing raw markdown text", () => {
    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <ChatPanel
          turns={[
            createTurn({
              turnId: "turn-markdown",
              userInput: "给我一个总结",
              assistantOutput: "# 总结\n\n- 第一项\n- 第二项",
            }),
          ]}
          connection="open"
          degraded={false}
          activeTaskLabel={null}
          skills={[]}
          onSend={vi.fn()}
          onAbort={vi.fn()}
          onOpenPrompt={vi.fn()}
        />
      </AgentI18nProvider>,
    );

    const assistantMessage = screen.getByTestId("assistant-message-turn-markdown");
    expect(assistantMessage.querySelector("h1")).toHaveTextContent("总结");
    expect(assistantMessage.querySelectorAll("li")).toHaveLength(2);
    expect(assistantMessage).not.toHaveTextContent("# 总结");
    expect(assistantMessage.className).not.toContain("whitespace-pre-wrap");
  });

  it("adds a copy button to assistant code blocks", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <ChatPanel
          turns={[
            createTurn({
              turnId: "turn-code",
              userInput: "给我代码",
              assistantOutput: "```ts\nconst value = 1;\n```",
            }),
          ]}
          connection="open"
          degraded={false}
          activeTaskLabel={null}
          skills={[]}
          onSend={vi.fn()}
          onAbort={vi.fn()}
          onOpenPrompt={vi.fn()}
        />
      </AgentI18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "复制" }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("const value = 1;"));
    expect(screen.getByRole("button", { name: "已复制" })).toBeInTheDocument();
  });

  it("renders tool calls inline with the assistant message", () => {
    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <ChatPanel
          turns={[
            createTurn({
              turnId: "turn-tool",
              userInput: "读取 README",
              assistantOutput: "我先读取一下文件。",
              toolCalls: [
                {
                  callId: "call-1",
                  name: "fs_read",
                  argsPreview: "{\"path\":\"README.md\"}",
                  status: "ok",
                  outputPreview: "读取成功",
                  trustLevel: "builtin_read",
                  artifactRef: null,
                },
              ],
              finishReason: "tool_use",
            }),
          ]}
          connection="open"
          degraded={false}
          activeTaskLabel={null}
          skills={[]}
          onSend={vi.fn()}
          onAbort={vi.fn()}
          onOpenPrompt={vi.fn()}
        />
      </AgentI18nProvider>,
    );

    expect(screen.getByTestId("tool-call-call-1")).toHaveTextContent("fs_read");
    expect(screen.getByTestId("tool-call-call-1")).toHaveTextContent("已完成");
    expect(screen.getByTestId("tool-call-call-1")).not.toHaveTextContent("读取成功");
    expect(screen.getByTestId("assistant-message-turn-tool")).toHaveTextContent("我先读取一下文件。");
  });

  it("renders denied tool feedback inside the tool call card", () => {
    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <ChatPanel
          turns={[
            createTurn({
              turnId: "turn-tool-denied",
              userInput: "创建文件",
              toolCalls: [
                {
                  callId: "call-denied",
                  name: "fs_write",
                  argsPreview: "{\"path\":\"demo.txt\"}",
                  status: "error",
                  outputPreview: "Tool execution was denied.",
                  trustLevel: "builtin_write",
                  artifactRef: null,
                },
              ],
              finishReason: "tool_use",
            }),
          ]}
          connection="open"
          degraded={false}
          activeTaskLabel={null}
          skills={[]}
          onSend={vi.fn()}
          onAbort={vi.fn()}
          onOpenPrompt={vi.fn()}
        />
      </AgentI18nProvider>,
    );

    expect(screen.getByTestId("tool-call-call-denied")).toHaveTextContent("fs_write");
    expect(screen.getByTestId("tool-call-call-denied")).toHaveTextContent("执行失败");
    expect(screen.getByTestId("tool-call-output-call-denied")).toHaveTextContent("Tool execution was denied.");
  });

  it("hides older turns behind a load earlier button", async () => {
    const user = userEvent.setup();
    const turns = Array.from({ length: 14 }, (_, index) => createTurn({
      turnId: `turn-${index + 1}`,
      userInput: `用户消息 ${index + 1}`,
      assistantOutput: `助手消息 ${index + 1}`,
    }));

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <ChatPanel
          turns={turns}
          connection="open"
          degraded={false}
          activeTaskLabel={null}
          skills={[]}
          onSend={vi.fn()}
          onAbort={vi.fn()}
          onOpenPrompt={vi.fn()}
        />
      </AgentI18nProvider>,
    );

    expect(screen.queryByTestId("user-message-turn-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("user-message-turn-14")).toHaveTextContent("用户消息 14");
    expect(screen.getByTestId("load-earlier-turns")).toHaveTextContent("还有 2 轮");

    await user.click(screen.getByTestId("load-earlier-turns"));

    expect(screen.getByTestId("user-message-turn-1")).toHaveTextContent("用户消息 1");
    expect(screen.queryByTestId("load-earlier-turns")).not.toBeInTheDocument();
  });

  it("renders the assistant thread inside a dedicated scroll viewport", () => {
    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <ChatPanel
          turns={[
            createTurn({
              turnId: "turn-scroll",
              userInput: "测试滚动",
              assistantOutput: "这里应该在独立滚动区域里显示。",
            }),
          ]}
          connection="open"
          degraded={false}
          activeTaskLabel={null}
          skills={[]}
          onSend={vi.fn()}
          onAbort={vi.fn()}
          onOpenPrompt={vi.fn()}
        />
      </AgentI18nProvider>,
    );

    expect(screen.getByTestId("assistant-thread-viewport")).toBeInTheDocument();
  });

  it("shows memory writeback errors under the related assistant message", () => {
    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <ChatPanel
          turns={[
            createTurn({
              turnId: "turn-writeback",
              userInput: "记住这个偏好",
              assistantOutput: "好的。",
              errors: [
                {
                  code: "memory_writeback_incomplete",
                  message: "memory request timed out after 10000ms",
                  reason: "runtime_timeout",
                },
              ],
            }),
          ]}
          connection="open"
          degraded={false}
          activeTaskLabel={null}
          skills={[]}
          onSend={vi.fn()}
          onAbort={vi.fn()}
          onOpenPrompt={vi.fn()}
        />
      </AgentI18nProvider>,
    );

    expect(screen.getByText("记忆保存未完成")).toBeInTheDocument();
    expect(screen.getByText("记忆运行时响应超时，本轮回复不受影响。")).toBeInTheDocument();
    expect(screen.getByTestId("turn-inline-error")).toHaveClass("text-[12px]");
    expect(screen.queryByText(/memory request timed out/)).not.toBeInTheDocument();
  });

  it("keeps only the injection status badge inside the chat message", () => {
    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <ChatPanel
          turns={[
            createTurn({
              turnId: "turn-injection",
              userInput: "帮我回忆上下文",
              assistantOutput: "我已经结合记忆继续回答。",
              injection: {
                phase: "before_response",
                injection_reason: "history reference",
                memory_summary: "这里是一段注入摘要，不应该在中间聊天区重复渲染。",
                memory_records: [],
              },
            }),
          ]}
          connection="open"
          degraded={false}
          activeTaskLabel={null}
          skills={[]}
          onSend={vi.fn()}
          onAbort={vi.fn()}
          onOpenPrompt={vi.fn()}
        />
      </AgentI18nProvider>,
    );

    expect(screen.getByTestId("assistant-message-turn-injection")).toHaveTextContent(
      "我已经结合记忆继续回答。",
    );
    expect(screen.getByText("注入已就绪")).toBeInTheDocument();
    expect(screen.queryByTestId("injection-summary-turn-injection")).not.toBeInTheDocument();
    expect(screen.queryByText("Injection Banner")).not.toBeInTheDocument();
  });

  it("shows the selected provider model beside the Axis Agent title", () => {
    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <ChatPanel
          turns={[]}
          connection="open"
          degraded={false}
          activeTaskLabel={null}
          providerLabel="openai · gpt-5.4"
          skills={[]}
          onSend={vi.fn()}
          onAbort={vi.fn()}
          onOpenPrompt={vi.fn()}
        />
      </AgentI18nProvider>,
    );

    expect(screen.getByText("Axis Agent")).toBeInTheDocument();
    expect(screen.getByTestId("chat-provider-model")).toHaveTextContent("openai · gpt-5.4");
  });

  it("shows slash commands including imported skills when typing slash", async () => {
    const user = userEvent.setup();

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <ChatPanel
          turns={[]}
          connection="open"
          degraded={false}
          activeTaskLabel={null}
          skills={[
            {
              id: "codex-skill-smoke-check",
              name: "Smoke Check",
              description: "A minimal visible skill for verifying MNA slash-command activation.",
              slash_name: "smoke-check",
              source_kind: "codex-skill",
              root_dir: "C:/repo/.mna/skills/smoke-check",
              entry_file: "C:/repo/.mna/skills/smoke-check/SKILL.md",
              imported_path: "C:/repo/.mna/skills/smoke-check",
              user_invocable: true,
              model_invocable: true,
              preapproved_tools: []
            }
          ]}
          onSend={vi.fn()}
          onAbort={vi.fn()}
          onOpenPrompt={vi.fn()}
        />
      </AgentI18nProvider>,
    );

    await user.type(screen.getByTestId("agent-input"), "/");

    expect(screen.getByTestId("slash-command-menu")).toBeInTheDocument();
    expect(screen.getByTestId("slash-command-option-skill")).toHaveTextContent("/skill");
    expect(screen.getByTestId("slash-command-option-smoke-check")).toHaveTextContent("/smoke-check");
  });

  it("applies the selected slash command into the input on Enter", async () => {
    const user = userEvent.setup();

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <ChatPanel
          turns={[]}
          connection="open"
          degraded={false}
          activeTaskLabel={null}
          skills={[
            {
              id: "codex-skill-smoke-check",
              name: "Smoke Check",
              description: "A minimal visible skill for verifying MNA slash-command activation.",
              slash_name: "smoke-check",
              source_kind: "codex-skill",
              root_dir: "C:/repo/.mna/skills/smoke-check",
              entry_file: "C:/repo/.mna/skills/smoke-check/SKILL.md",
              imported_path: "C:/repo/.mna/skills/smoke-check",
              user_invocable: true,
              model_invocable: true,
              preapproved_tools: []
            }
          ]}
          onSend={vi.fn()}
          onAbort={vi.fn()}
          onOpenPrompt={vi.fn()}
        />
      </AgentI18nProvider>,
    );

    const input = screen.getByTestId("agent-input");
    await user.type(input, "/s");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(input).toHaveValue("/smoke-check ");
    expect(screen.queryByTestId("slash-command-menu")).not.toBeInTheDocument();
  });

  it("does not show the slash command menu for normal input", async () => {
    const user = userEvent.setup();

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <ChatPanel
          turns={[]}
          connection="open"
          degraded={false}
          activeTaskLabel={null}
          skills={[
            {
              id: "codex-skill-smoke-check",
              name: "Smoke Check",
              description: "A minimal visible skill for verifying MNA slash-command activation.",
              slash_name: "smoke-check",
              source_kind: "codex-skill",
              root_dir: "C:/repo/.mna/skills/smoke-check",
              entry_file: "C:/repo/.mna/skills/smoke-check/SKILL.md",
              imported_path: "C:/repo/.mna/skills/smoke-check",
              user_invocable: true,
              model_invocable: true,
              preapproved_tools: []
            }
          ]}
          onSend={vi.fn()}
          onAbort={vi.fn()}
          onOpenPrompt={vi.fn()}
        />
      </AgentI18nProvider>,
    );

    await user.type(screen.getByTestId("agent-input"), "hello");

    expect(screen.queryByTestId("slash-command-menu")).not.toBeInTheDocument();
  });

  it("renders degraded skip phase badges for skipped memory recall", () => {
    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <ChatPanel
          turns={[
            createTurn({
              turnId: "turn-degraded-skip",
              userInput: "继续刚才那个方案",
              assistantOutput: "当前先按现有上下文继续。",
              phases: [
                {
                  phase: "before_response",
                  traceId: "trace-before-response",
                  degraded: true,
                  degradedSkipReason: "trigger_dependencies_unavailable"
                }
              ]
            }),
          ]}
          connection="open"
          degraded={true}
          activeTaskLabel={null}
          skills={[]}
          onSend={vi.fn()}
          onAbort={vi.fn()}
          onOpenPrompt={vi.fn()}
        />
      </AgentI18nProvider>,
    );

    expect(screen.getByText("回复前 已降级跳过")).toBeInTheDocument();
  });

  it("renders model dependency badges and checks model status from the header", async () => {
    const user = userEvent.setup();
    const onCheckModels = vi.fn(async () => undefined);

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <ChatPanel
          turns={[]}
          connection="open"
          degraded={false}
          activeTaskLabel={null}
          providerLabel="openai · gpt-5.4"
          dependencyStatus={{
            runtime: {
              embeddings: {
                status: "not_configured"
              },
              memory_llm: {
                status: "misconfigured"
              }
            },
            provider: {
              id: "openai-compatible",
              model: "gpt-5.4",
              status: "configured"
            },
            mcp: [],
            provider_key: "openai-compatible:gpt-5.4"
          }}
          skills={[]}
          onSend={vi.fn()}
          onAbort={vi.fn()}
          onOpenPrompt={vi.fn()}
          onCheckModels={onCheckModels}
        />
      </AgentI18nProvider>
    );

    expect(screen.getByTestId("agent-embedding-badge")).toHaveAttribute("data-state", "not_configured");
    expect(screen.getByTestId("axis-memory-llm-badge")).toHaveAttribute("data-state", "misconfigured");
    await user.click(screen.getByTestId("check-model-status"));
    expect(onCheckModels).toHaveBeenCalledTimes(1);
  });
});
