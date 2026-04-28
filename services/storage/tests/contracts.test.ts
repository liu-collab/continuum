import { describe, expect, it } from "vitest";

import {
  mapRuntimeCandidateType,
  runtimeCompatibleWriteBackCandidateSchema,
} from "../src/contracts.js";
import { AppError } from "../src/errors.js";

describe("storage contracts", () => {
  it("maps runtime candidate types explicitly", () => {
    expect(mapRuntimeCandidateType("fact_preference")).toBe("fact_preference");
    expect(mapRuntimeCandidateType("task_state")).toBe("task_state");
    expect(mapRuntimeCandidateType("episodic")).toBe("episodic");
    expect(mapRuntimeCandidateType("commitment")).toBe("episodic");
    expect(mapRuntimeCandidateType("preference")).toBe("fact_preference");
    expect(mapRuntimeCandidateType("important_event")).toBe("episodic");
  });

  it("rejects unknown runtime candidate types explicitly", () => {
    expect(() => mapRuntimeCandidateType("future_type")).toThrow(AppError);

    try {
      mapRuntimeCandidateType("future_type");
    } catch (error) {
      expect(error).toMatchObject({
        code: "unknown_candidate_type",
        status_code: 400,
        details: {
          runtimeType: "future_type",
        },
      });
    }
  });

  it("keeps the compatibility schema aligned with the runtime mapping", () => {
    const parsed = runtimeCompatibleWriteBackCandidateSchema.parse({
      candidate_type: "preference",
      scope: "user",
      summary: "User prefers concise answers",
      details: {
        subject: "user",
      },
      importance: 4,
      confidence: 0.9,
      write_reason: "user stated a stable preference",
      source: {
        host: "codex_app_server",
        session_id: "33333333-3333-4333-8333-333333333333",
      },
      dedupe_key: "preference:concise",
    });

    expect(mapRuntimeCandidateType(parsed.candidate_type)).toBe("fact_preference");
  });
});
