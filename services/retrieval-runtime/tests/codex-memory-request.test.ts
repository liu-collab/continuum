import { describe, expect, it } from "vitest";

import {
  buildCodexForcedMemoryRequest,
  buildCodexMemoryAwareRequest,
  CODEX_FORCED_MEMORY_INSTRUCTIONS,
} from "./e2e/codex-memory-request.mjs";

describe("codex memory request", () => {
  it("builds a forced-memory request with prepared context and user input", () => {
    const request = buildCodexForcedMemoryRequest(
      "帮我继续昨天那个重构任务。",
      "【长期记忆】任务进度：昨天已经完成接口拆分。",
      ["  ", "回答保持简短。", ""],
    );

    for (const instruction of CODEX_FORCED_MEMORY_INSTRUCTIONS) {
      expect(request).toContain(instruction);
    }

    expect(request).toContain("回答保持简短。");
    expect(request).toContain("【长期记忆】任务进度：昨天已经完成接口拆分。");
    expect(request).toContain("用户问题：\n\n帮我继续昨天那个重构任务。");
    expect(request).not.toContain("才调用 memory_search");
  });

  it("keeps the legacy helper as a no-memory forced injection request", () => {
    const request = buildCodexMemoryAwareRequest("帮我写个函数。");

    expect(request).toContain("【长期记忆】无相关历史记忆，请直接回答。");
    expect(request).toContain("用户问题：\n\n帮我写个函数。");
    expect(request).toContain("最终只保留对用户有用的答案内容。");
    expect(request.endsWith("帮我写个函数。")).toBe(true);
  });
});
