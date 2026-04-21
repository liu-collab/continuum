import { describe, expect, it } from "vitest";

import { tierMemoryInjection } from "../memory-tiering.js";

describe("tierMemoryInjection", () => {
  it("splits records into high, medium, and summary buckets", () => {
    const result = tierMemoryInjection({
      phase: "before_response",
      injection_reason: "history reference",
      memory_summary: "用户长期偏好与当前任务上下文",
      memory_records: [
        {
          id: "pref-1",
          memory_type: "fact_preference",
          scope: "user",
          summary: "默认用中文回答",
          importance: 0.92,
          confidence: 0.98,
        },
        {
          id: "task-1",
          memory_type: "task_state",
          scope: "workspace",
          summary: "当前正在修复登录接口",
          importance: 0.7,
          confidence: 0.8,
        },
        {
          id: "epi-1",
          memory_type: "other",
          scope: "workspace",
          summary: "昨天排查过相同告警",
          importance: 0.4,
          confidence: 0.5,
        },
      ],
    });

    expect(result.high.map((record) => record.id)).toEqual(["pref-1"]);
    expect(result.medium.map((record) => record.id)).toEqual(["task-1"]);
    expect(result.summary_records.map((record) => record.id)).toEqual(["epi-1"]);
    expect(result.summary).toContain("用户长期偏好与当前任务上下文");
    expect(result.summary).toContain("昨天排查过相同告警");
  });

  it("deduplicates semantically identical records and keeps the stronger one", () => {
    const result = tierMemoryInjection({
      phase: "before_response",
      injection_reason: "history reference",
      memory_summary: "偏好",
      memory_records: [
        {
          id: "pref-low",
          memory_type: "fact_preference",
          scope: "user",
          summary: "默认用中文回答",
          importance: 0.7,
          confidence: 0.8,
        },
        {
          id: "pref-high",
          memory_type: "fact_preference",
          scope: "user",
          summary: "默认用中文回答",
          importance: 0.95,
          confidence: 0.96,
        },
      ],
    });

    expect(result.high.map((record) => record.id)).toEqual(["pref-high"]);
    expect(result.dropped).toContainEqual({
      id: "pref-low",
      reason: "duplicate",
    });
  });
});
