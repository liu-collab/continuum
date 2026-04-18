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
});
