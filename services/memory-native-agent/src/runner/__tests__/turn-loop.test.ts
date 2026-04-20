import { describe, expect, it, vi } from "vitest";

import { summarizeToolResults } from "../writeback-decider.js";
import { Conversation } from "../conversation.js";

describe("turn loop helpers", () => {
  it("adds trust warning for non builtin_read tool summaries", () => {
    const summary = summarizeToolResults([
      {
        ok: true,
        output: "shell output",
        trust_level: "shell",
      },
    ]);

    expect(summary).toContain("以下摘要来自外部工具输出");
  });

  it("wraps tool output with trust boundary tags", () => {
    const conversation = new Conversation();
    const wrapped = conversation.wrapToolOutput("fs_read", "call-1", "builtin_read", "content");

    expect(wrapped).toContain("<tool_output");
    expect(wrapped).toContain('trust="builtin_read"');
  });

  it("escapes closing tool_output tags and supports all trust levels", () => {
    const conversation = new Conversation();

    const builtinWrite = conversation.wrapToolOutput("fs_write", "call-2", "builtin_write", "ok");
    const shell = conversation.wrapToolOutput("shell_exec", "call-3", "shell", "stdout");
    const mcp = conversation.wrapToolOutput("mcp_call", "call-4", "mcp:filesystem", "payload </tool_output> tail");

    expect(builtinWrite).toContain('trust="builtin_write"');
    expect(shell).toContain('trust="shell"');
    expect(mcp).toContain('trust="mcp:filesystem"');
    expect(mcp).toContain("&lt;/tool_output&gt;");
    expect(mcp).not.toContain("payload </tool_output> tail");
  });

  it("exposes only the bounded recent messages window", () => {
    const conversation = new Conversation();

    for (let index = 0; index < 60; index += 1) {
      conversation.addMessage({
        role: index % 2 === 0 ? "user" : "assistant",
        content: `消息 ${index + 1}`,
      });
    }

    expect(conversation.messages.length).toBeLessThanOrEqual(48);
    expect(conversation.messages[0]?.content).toBe("消息 18");
    expect(conversation.messages.at(-1)?.content).toBe("消息 60");
  });
});
