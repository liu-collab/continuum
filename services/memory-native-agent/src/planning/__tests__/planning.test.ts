import { describe, expect, it } from "vitest";

import { generateExecutionPlan, shouldGeneratePlan } from "../plan-generator.js";
import { advancePlanAfterTool, markPlanRunning } from "../plan-state.js";

describe("planning helpers", () => {
  it("detects multi-step tasks for plan generation", () => {
    expect(shouldGeneratePlan("先读取代码，然后修改配置，最后补测试")).toBe(true);
    expect(shouldGeneratePlan("修这个 bug")).toBe(false);
  });

  it("preserves completed steps when revising a plan", () => {
    const plan = generateExecutionPlan({
      sessionId: "session-1",
      turnId: "turn-1",
      goal: "读取代码，然后修改配置，最后补测试",
    });

    plan.steps[0]!.status = "completed";

    const revised = generateExecutionPlan({
      sessionId: "session-1",
      turnId: "turn-1",
      goal: "读取代码，然后补文档，最后补测试",
      existingPlan: plan,
      revisionReason: "需求变更",
    });

    expect(revised.status).toBe("revised");
    expect(revised.steps[0]?.status).toBe("completed");
    expect(revised.revision_reason).toBe("需求变更");
  });

  it("advances running plan state after tool completion", () => {
    const draft = generateExecutionPlan({
      sessionId: "session-1",
      turnId: "turn-1",
      goal: "读取代码，然后修改配置",
    });
    const running = markPlanRunning(draft);
    const advanced = advancePlanAfterTool(running, true, "done");

    expect(running.status).toBe("running");
    expect(running.steps[0]?.status).toBe("in_progress");
    expect(advanced.steps[0]?.status).toBe("completed");
    expect(advanced.steps[0]?.notes).toBe("done");
    expect(advanced.steps[1]?.status).toBe("in_progress");
  });
});
