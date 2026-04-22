import { describe, expect, it } from "vitest";

import { GovernanceExecutionEngine } from "../src/domain/governance-execution-engine.js";
import { normalizeCandidate } from "../src/domain/normalizer.js";
import { buildRecordFromNormalized } from "../src/db/repositories.js";
import { createMemoryRepositories, buildCandidate } from "./memory-repositories.js";

function buildSeed(summary: string) {
  const normalized = normalizeCandidate(
    buildCandidate({
      summary,
      details: {
        subject: "user",
        predicate: summary,
      },
    }),
  );
  return {
    ...buildRecordFromNormalized({ normalized }),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    version: 1,
  };
}

describe("governance execution engine", () => {
  it("archives a target record through execution batch", async () => {
    const seed = buildSeed("User prefers concise answers");
    const repositories = createMemoryRepositories({
      records: [seed],
    });
    const engine = new GovernanceExecutionEngine(repositories);

    const result = await engine.executeBatch({
      workspace_id: seed.workspace_id,
      source_service: "retrieval-runtime",
      items: [
        {
          proposal_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          proposal_type: "archive",
          targets: { record_ids: [seed.id] },
          suggested_changes: { status: "archived" },
          reason_code: "duplicate_preference",
          reason_text: "archive duplicate preference",
          evidence: { seed_record_ids: [seed.id] },
          planner: { model: "writeback_llm", confidence: 0.9 },
          verifier: { required: false },
          policy_version: "memory-governance-v1",
          idempotency_key: "archive-batch-one",
        },
      ],
    });

    expect(result[0]?.execution.execution_status).toBe("executed");
    expect((await repositories.records.findById(seed.id))?.status).toBe("archived");
  });

  it("soft deletes a target record and records delete_reason", async () => {
    const seed = buildSeed("Obsolete temporary state");
    const repositories = createMemoryRepositories({
      records: [seed],
    });
    const engine = new GovernanceExecutionEngine(repositories);

    const result = await engine.executeBatch({
      workspace_id: seed.workspace_id,
      source_service: "retrieval-runtime",
      items: [
        {
          proposal_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          proposal_type: "delete",
          targets: { record_ids: [seed.id] },
          suggested_changes: { delete_mode: "soft" },
          reason_code: "obsolete_task_state",
          reason_text: "delete obsolete task state",
          evidence: { delete_reason: "replaced by newer task state" },
          planner: { model: "writeback_llm", confidence: 0.95 },
          verifier: {
            required: true,
            model: "writeback_llm",
            decision: "approve",
            confidence: 0.92,
          },
          policy_version: "memory-governance-v1",
          idempotency_key: "delete-batch-one",
        },
      ],
    });

    expect(result[0]?.execution.execution_status).toBe("executed");
    expect((await repositories.records.findById(seed.id))?.status).toBe("deleted");
    const actions = await repositories.governance.listActions(seed.id);
    expect(actions.some((action) => action.action_payload["delete_reason"] === "replaced by newer task state")).toBe(true);
  });

  it("merges multiple records by keeping first and archiving the rest", async () => {
    const first = buildSeed("Use pnpm in this repository");
    const second = buildSeed("Repository uses pnpm");
    const repositories = createMemoryRepositories({
      records: [first, second],
    });
    const engine = new GovernanceExecutionEngine(repositories);

    const result = await engine.executeBatch({
      workspace_id: first.workspace_id,
      source_service: "retrieval-runtime",
      items: [
        {
          proposal_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          proposal_type: "merge",
          targets: { record_ids: [first.id, second.id] },
          suggested_changes: {
            summary: "Repository default is pnpm",
            importance: 4,
          },
          reason_code: "duplicate_preference",
          reason_text: "merge duplicate repository preference",
          evidence: { seed_record_ids: [first.id], related_record_ids: [second.id] },
          planner: { model: "writeback_llm", confidence: 0.94 },
          verifier: {
            required: true,
            model: "writeback_llm",
            decision: "approve",
            confidence: 0.91,
          },
          policy_version: "memory-governance-v1",
          idempotency_key: "merge-batch-one",
        },
      ],
    });

    expect(result[0]?.execution.execution_status).toBe("executed");
    expect((await repositories.records.findById(first.id))?.summary).toBe("Repository default is pnpm");
    expect((await repositories.records.findById(second.id))?.status).toBe("archived");
  });

  it("cancels execution when target record status changed before apply", async () => {
    const seed = {
      ...buildSeed("Old task state"),
      status: "archived" as const,
    };
    const repositories = createMemoryRepositories({
      records: [seed],
    });
    const engine = new GovernanceExecutionEngine(repositories);

    const result = await engine.executeBatch({
      workspace_id: seed.workspace_id,
      source_service: "retrieval-runtime",
      items: [
        {
          proposal_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          proposal_type: "archive",
          targets: { record_ids: [seed.id] },
          suggested_changes: { status: "archived" },
          reason_code: "superseded_record",
          reason_text: "archive outdated task state",
          evidence: { seed_record_ids: [seed.id] },
          planner: { model: "writeback_llm", confidence: 0.9 },
          verifier: { required: false },
          policy_version: "memory-governance-v1",
          idempotency_key: "archive-cancelled-one",
        },
      ],
    });

    expect(result[0]?.execution.execution_status).toBe("cancelled");
    expect(result[0]?.execution.error_message).toContain("status changed before execution");
  });
});
