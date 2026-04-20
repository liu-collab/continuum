import { describe, expect, it } from "vitest";

import { Conversation } from "../conversation.js";
import { estimateToolTokens } from "../token-budget.js";

describe("Conversation.shortSummary", () => {
  it("keeps only recent user messages in chronological order", () => {
    const conversation = new Conversation();

    conversation.seed([
      { role: "user", content: "第一条用户消息" },
      { role: "assistant", content: "第一条助手回复" },
      { role: "tool", content: "工具输出" },
      { role: "user", content: "第二条用户消息" },
      { role: "assistant", content: "第二条助手回复" },
      { role: "user", content: "第三条用户消息" },
      { role: "user", content: "第四条用户消息" },
      { role: "user", content: "第五条用户消息" },
    ]);

    expect(conversation.shortSummary()).toBe(
      ["第二条用户消息", "第三条用户消息", "第四条用户消息", "第五条用户消息"].join("\n"),
    );
  });

  it("caps the summary length at 500 characters", () => {
    const conversation = new Conversation();
    const longInput = "a".repeat(400);

    conversation.seed([
      { role: "user", content: longInput },
      { role: "user", content: longInput },
      { role: "user", content: longInput },
      { role: "user", content: longInput },
    ]);

    expect(conversation.shortSummary().length).toBe(500);
  });

  it("builds provider messages without duplicating the latest user message", () => {
    const conversation = new Conversation();

    conversation.seed([
      { role: "user", content: "前一轮输入" },
      { role: "assistant", content: "前一轮回复" },
      { role: "user", content: "当前轮输入" },
    ]);

    const built = conversation.buildMessages({
      systemPrompt: "system prompt",
      injections: [],
    });

    expect(built).toEqual([
      { role: "system", content: "system prompt" },
      { role: "user", content: "前一轮输入" },
      { role: "assistant", content: "前一轮回复" },
      { role: "user", content: "当前轮输入" },
    ]);
  });

  it("drops older history when a token budget is configured", () => {
    const conversation = new Conversation();

    conversation.seed([
      { role: "user", content: "第一轮内容 ".repeat(40) },
      { role: "assistant", content: "第一轮回复 ".repeat(40) },
      { role: "user", content: "第二轮内容 ".repeat(40) },
      { role: "assistant", content: "第二轮回复 ".repeat(40) },
      { role: "user", content: "第三轮内容 ".repeat(40) },
    ]);

    const tools = [
      {
        name: "fs_read",
        description: "Read a file",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
          },
        },
      },
    ];

    const built = conversation.buildMessages({
      systemPrompt: "system prompt",
      injections: [],
      tools,
      tokenBudget: {
        maxTokens: 180,
        reserveTokens: 64,
        compactionStrategy: "truncate",
        toolTokenEstimate: estimateToolTokens(tools),
      },
    });

    expect(built[0]).toEqual({ role: "system", content: "system prompt" });
    expect(built.some((message) => message.content.includes("第一轮内容"))).toBe(false);
    expect(built.some((message) => message.content.includes("第三轮内容"))).toBe(true);
  });
});
