import { describe, expect, it } from "vitest";

import { buildLiteUpgradeSuggestion } from "../src/lite/upgrade-suggestion.js";

describe("lite upgrade suggestion", () => {
  it("suggests full mode when record count exceeds lite threshold", () => {
    expect(buildLiteUpgradeSuggestion({ recordCount: 5001 })).toEqual({
      should_upgrade: true,
      reason_code: "record_count_exceeded",
      message: "精简模式已有 5001 条记忆，建议切换到完整平台以获得向量检索和治理能力。",
      record_count: 5001,
      threshold: 5000,
      command: "axis start --full",
    });
  });

  it("does not suggest full mode below threshold", () => {
    expect(buildLiteUpgradeSuggestion({ recordCount: 100 })).toEqual({
      should_upgrade: false,
      record_count: 100,
      threshold: 5000,
      command: "axis start --full",
    });
  });

  it("can suggest full mode for slow local search", () => {
    expect(buildLiteUpgradeSuggestion({ recordCount: 100, searchLatencyMs: 250 })).toMatchObject({
      should_upgrade: true,
      reason_code: "search_latency_high",
      record_count: 100,
    });
  });
});
