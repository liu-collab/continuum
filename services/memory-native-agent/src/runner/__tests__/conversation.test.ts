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
});
