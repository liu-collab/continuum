import { describe, expect, it } from "vitest";

import {
  memoryTypeSchema,
  writeBackCandidateSchema,
} from "../src/contracts.js";
import { buildCandidate } from "./memory-repositories.js";

describe("storage contracts", () => {
  it("accepts split memory types", () => {
    expect(memoryTypeSchema.options).toEqual([
      "fact",
      "preference",
      "task_state",
      "episodic",
    ]);

    expect(writeBackCandidateSchema.parse(buildCandidate()).candidate_type).toBe("preference");
    expect(writeBackCandidateSchema.parse(buildCandidate({
      candidate_type: "fact",
      scope: "workspace",
      user_id: null,
      summary: "This project uses PostgreSQL 16",
      details: {
        subject: "project",
        predicate: "uses PostgreSQL 16",
      },
    })).candidate_type).toBe("fact");
  });

  it("rejects the removed combined fact_preference type", () => {
    const parsed = writeBackCandidateSchema.safeParse({
      ...buildCandidate(),
      candidate_type: "fact_preference",
    });

    expect(parsed.success).toBe(false);
  });
});
