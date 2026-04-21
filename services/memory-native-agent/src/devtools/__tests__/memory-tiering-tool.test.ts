import { describe, expect, it } from "vitest";

import {
  aggregatePromptSegments,
  DEFAULT_MEMORY_TIERING_SCENARIO,
  evaluateTurnExpectations,
} from "../memory-tiering-tool.js";

describe("memory tiering tool", () => {
  it("aggregates memory segment counts and phases", () => {
    const result = aggregatePromptSegments([
      {
        kind: "core_system",
        priority: "fixed",
        preview: "system",
      },
      {
        kind: "memory_high",
        priority: "high",
        preview: "pref",
        phase: "before_plan",
        record_count: 2,
      },
      {
        kind: "memory_summary",
        priority: "low",
        preview: "summary",
        phase: "before_response",
        record_count: 1,
      },
    ]);

    expect(result.kinds).toEqual(["core_system", "memory_high", "memory_summary"]);
    expect(result.phases).toEqual(["before_plan", "before_response"]);
    expect(result.highSegmentCount).toBe(1);
    expect(result.summarySegmentCount).toBe(1);
    expect(result.highRecordCount).toBe(2);
    expect(result.summaryRecordCount).toBe(1);
  });

  it("reports missing and forbidden kinds through expectations", () => {
    const result = evaluateTurnExpectations(
      [
        {
          kind: "core_system",
          priority: "fixed",
          preview: "system",
        },
        {
          kind: "memory_high",
          priority: "high",
          preview: "pref",
          phase: "before_response",
          record_count: 1,
        },
      ],
      {
        requireKinds: ["memory_high", "memory_summary"],
        forbidKinds: ["memory_medium"],
        requirePhases: ["before_response", "before_plan"],
        minHighRecordCount: 2,
        minSummarySegmentCount: 1,
      },
    );

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual([
      "缺少必需的 prompt segment: memory_summary",
      "缺少必需的注入阶段: before_plan",
      "memory_high record_count=1，低于期望值 2",
      "memory_summary segment_count=0，低于期望值 1",
    ]);
  });

  it("ships a default multi-turn scenario with assertions", () => {
    expect(DEFAULT_MEMORY_TIERING_SCENARIO.id).toBe("stable-preferences-multi-turn");
    expect(DEFAULT_MEMORY_TIERING_SCENARIO.turns).toHaveLength(5);
    expect(DEFAULT_MEMORY_TIERING_SCENARIO.turns.some((turn) => turn.expectation?.requireKinds?.includes("memory_high"))).toBe(true);
    expect(DEFAULT_MEMORY_TIERING_SCENARIO.turns.some((turn) => turn.expectation?.forbidKinds?.includes("memory_high"))).toBe(true);
  });
});
