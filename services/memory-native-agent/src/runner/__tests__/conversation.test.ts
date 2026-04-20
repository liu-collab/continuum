import { describe, expect, it } from "vitest";

import { Conversation } from "../conversation.js";

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
});
