import { describe, expect, it } from "vitest";

import { detectTriggers } from "../trigger-detector.js";

describe("detectTriggers", () => {
  it("detects task start and plan on first meaningful input", () => {
    const result = detectTriggers(
      "帮我规划一下这次重构",
      { messages: [] },
      null,
    );

    expect(result.taskStart?.label).toContain("帮我规划一下这次重构");
    expect(result.beforePlan).toBe(true);
  });

  it("detects task switch when input diverges from current task", () => {
    const result = detectTriggers(
      "换成修复登录接口",
      {
        messages: [
          { role: "user", content: "继续做支付链路", },
        ],
      },
      {
        id: "task-1",
        label: "支付链路重构",
        created_at: "2026-04-18T00:00:00.000Z",
        last_active_at: "2026-04-18T00:00:00.000Z",
      },
    );

    expect(result.taskSwitch).toBeTruthy();
  });
});
