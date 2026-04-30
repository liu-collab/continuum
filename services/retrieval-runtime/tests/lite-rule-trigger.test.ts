import { describe, expect, it } from "vitest";

import { decideLiteRuleTrigger, type LiteRuleTriggerContext } from "../src/lite/rule-trigger.js";

const baseContext: LiteRuleTriggerContext = {
  phase: "before_response",
  current_input: "",
  workspace_id: "550e8400-e29b-41d4-a716-446655440000",
  user_id: "550e8400-e29b-41d4-a716-446655440001",
  session_id: "550e8400-e29b-41d4-a716-446655440002",
};

describe("lite rule trigger", () => {
  it("always searches high-importance workspace and user memory on session start", () => {
    const decision = decideLiteRuleTrigger({
      ...baseContext,
      phase: "session_start",
      current_input: "session start",
    });

    expect(decision.hit).toBe(true);
    expect(decision.trigger_type).toBe("phase");
    expect(decision.requested_scopes).toEqual(["workspace", "user"]);
    expect(decision.requested_memory_types).toEqual(["fact", "preference", "task_state"]);
    expect(decision.importance_threshold).toBe(4);
  });

  it("searches task state and workspace convention on task start when task id exists", () => {
    const decision = decideLiteRuleTrigger({
      ...baseContext,
      phase: "task_start",
      task_id: "550e8400-e29b-41d4-a716-446655440003",
      current_input: "继续实现 lite runtime",
    });

    expect(decision.hit).toBe(true);
    expect(decision.requested_scopes).toEqual(["task", "workspace"]);
    expect(decision.requested_memory_types).toEqual(["task_state", "fact", "preference"]);
    expect(decision.query).toContain("lite runtime");
  });

  it("detects before_response history references", () => {
    const decision = decideLiteRuleTrigger({
      ...baseContext,
      phase: "before_response",
      task_id: "550e8400-e29b-41d4-a716-446655440003",
      current_input: "按上次约定继续",
    });

    expect(decision.hit).toBe(true);
    expect(decision.trigger_type).toBe("history_reference");
    expect(decision.requested_scopes).toEqual(["workspace", "task", "session", "user"]);
    expect(decision.requested_memory_types).toEqual(["fact", "preference", "task_state", "episodic"]);
  });

  it("skips ordinary before_response turns without history cues", () => {
    const decision = decideLiteRuleTrigger({
      ...baseContext,
      phase: "before_response",
      current_input: "帮我写一个单元测试",
    });

    expect(decision.hit).toBe(false);
    expect(decision.trigger_type).toBe("no_trigger");
    expect(decision.requested_scopes).toEqual([]);
  });

  it("drops user scope in workspace-only mode", () => {
    const decision = decideLiteRuleTrigger({
      ...baseContext,
      phase: "session_start",
      memory_mode: "workspace_only",
    });

    expect(decision.hit).toBe(true);
    expect(decision.requested_scopes).toEqual(["workspace"]);
  });
});
