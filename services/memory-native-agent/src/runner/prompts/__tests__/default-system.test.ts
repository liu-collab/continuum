import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "../default-system.js";

describe("buildSystemPrompt", () => {
  it("renders zh-CN prompt with runtime variables", () => {
    const prompt = buildSystemPrompt({
      workspaceRoot: "C:/repo/demo",
      platform: "win32",
      memoryMode: "workspace_plus_global",
      locale: "zh-CN",
    });

    expect(prompt).toContain("你是 memory-native-agent");
    expect(prompt).toContain("C:/repo/demo");
    expect(prompt).toContain("workspace_plus_global");
    expect(prompt).toContain("<tool_output>");
  });

  it("renders en-US prompt and appends user prompt", () => {
    const prompt = buildSystemPrompt({
      workspaceRoot: "/tmp/demo",
      platform: "linux",
      memoryMode: "workspace_only",
      locale: "en-US",
      appendedPrompt: "Always prefer concise replies.",
    });

    expect(prompt).toContain("You are memory-native-agent");
    expect(prompt).toContain("Always prefer concise replies.");
    expect(prompt).toContain("/tmp/demo");
  });
});
