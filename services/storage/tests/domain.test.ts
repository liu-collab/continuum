import { describe, expect, it } from "vitest";

import { evaluateConflict } from "../src/domain/conflict-engine.js";
import { decideMerge } from "../src/domain/merge-engine.js";
import { normalizeCandidate } from "../src/domain/normalizer.js";
import { buildCandidate } from "./memory-repositories.js";

describe("storage domain rules", () => {
  it("generates dedupe key and default scores during normalization", () => {
    const normalized = normalizeCandidate(
      buildCandidate({
        importance: undefined,
        confidence: undefined,
        details: {
          subject: "user",
          predicate: "prefers concise answers",
        },
      }),
    );

    expect(normalized.dedupe_key).toContain("fact_preference:user:user");
    expect(normalized.importance).toBe(5);
    expect(normalized.confidence).toBe(0.9);
  });

  it("ignores duplicate fact preference", () => {
    const normalized = normalizeCandidate(buildCandidate());
    const existing = {
      id: "record-1",
      workspace_id: normalized.workspace_id,
      user_id: normalized.user_id ?? null,
      task_id: null,
      session_id: null,
      memory_type: "fact_preference" as const,
      scope: "user" as const,
      status: "active" as const,
      summary: normalized.summary,
      details_json: normalized.details,
      importance: 5,
      confidence: 0.9,
      dedupe_key: normalized.dedupe_key,
      source_type: normalized.source_type,
      source_ref: normalized.source_ref,
      created_by_service: normalized.source_service,
      last_confirmed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      archived_at: null,
      deleted_at: null,
      version: 1,
    };

    const decision = decideMerge(normalized, [existing]);
    expect(decision.decision).toBe("ignore_duplicate");
  });

  it("opens conflict for opposite fact preference", () => {
    const existing = {
      id: "record-1",
      workspace_id: "11111111-1111-1111-1111-111111111111",
      user_id: "22222222-2222-2222-2222-222222222222",
      task_id: null,
      session_id: null,
      memory_type: "fact_preference" as const,
      scope: "user" as const,
      status: "active" as const,
      summary: "User likes concise answers",
      details_json: { subject: "user", predicate: "likes concise answers" },
      importance: 5,
      confidence: 0.7,
      dedupe_key: "fact_preference:user:user:likes concise answers",
      source_type: "user_input",
      source_ref: "turn-1",
      created_by_service: "retrieval-runtime",
      last_confirmed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      archived_at: null,
      deleted_at: null,
      version: 1,
    };

    const normalized = normalizeCandidate(
      buildCandidate({
        summary: "User does not like concise answers",
        details: {
          subject: "user",
          predicate: "does not like concise answers",
        },
        confidence: 0.6,
        source: {
          source_type: "user_input",
          source_ref: "turn-2",
          service_name: "retrieval-runtime",
          confirmed_by_user: false,
        },
      }),
    );
    const decision = decideMerge(normalized, [existing]);
    const conflict = evaluateConflict(existing, normalized);

    expect(decision.decision).toBe("open_conflict");
    expect(conflict.should_mark_pending_confirmation).toBe(true);
  });
});
