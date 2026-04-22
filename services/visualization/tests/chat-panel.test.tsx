import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChatPanel } from "@/app/agent/_components/chat-panel";
import { AgentI18nProvider } from "@/app/agent/_i18n/provider";
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

  it("shows the selected provider model beside the Continuum Agent title", () => {
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

    expect(screen.getByText("Continuum Agent")).toBeInTheDocument();
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
});
