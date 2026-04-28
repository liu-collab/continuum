import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchGovernanceExecutionDetail,
  fetchGovernanceExecutions,
} from "@/lib/server/storage-governance-executions-client";

vi.mock("@/lib/env", () => ({
  getAppConfig: () => ({
    values: {
      STORAGE_API_BASE_URL: "http://storage.test",
      STORAGE_API_TIMEOUT_MS: 1000,
    },
  }),
}));

describe("storage governance executions client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps governance execution list rows", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            proposal: {
              id: "proposal-1",
              workspace_id: "ws-1",
              proposal_type: "delete",
              reason_code: "obsolete_task_state",
              reason_text: "delete obsolete task state",
              evidence_json: {
                delete_reason: "replaced by newer state",
              },
              planner_model: "memory_llm",
              planner_confidence: 0.95,
              verifier_required: true,
              verifier_decision: "approve",
              verifier_confidence: 0.91,
            },
            execution: {
              id: "execution-1",
              workspace_id: "ws-1",
              proposal_id: "proposal-1",
              proposal_type: "delete",
              execution_status: "executed",
              result_summary: "delete executed",
              error_message: null,
              source_service: "retrieval-runtime",
              started_at: "2026-04-22T00:00:00Z",
              finished_at: "2026-04-22T00:01:00Z",
            },
            targets: [
              {
                record_id: "memory-1",
                conflict_id: null,
                role: "target",
              },
            ],
          },
        ],
      }),
    } as Response);

    const result = await fetchGovernanceExecutions({
      workspaceId: "ws-1",
      proposalType: undefined,
      executionStatus: undefined,
      limit: 20,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.proposalTypeLabel).toBe("软删除");
    expect(result.items[0]?.executionStatusLabel).toBe("执行成功");
    expect(result.items[0]?.deleteReason).toBe("replaced by newer state");
    expect(result.items[0]?.targetRecordIds).toEqual(["memory-1"]);
  });

  it("maps governance execution detail payload", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          proposal: {
            id: "proposal-1",
            workspace_id: "ws-1",
            proposal_type: "merge",
            reason_code: "duplicate_preference",
            reason_text: "merge duplicate preference",
            suggested_changes_json: { summary: "merged summary" },
            evidence_json: { merged_from: ["memory-1", "memory-2"] },
            planner_model: "memory_llm",
            planner_confidence: 0.93,
            verifier_required: true,
            verifier_model: "memory_llm",
            verifier_decision: "approve",
            verifier_confidence: 0.9,
            verifier_notes: "clear duplicate",
            policy_version: "memory-governance-v1",
          },
          execution: {
            id: "execution-1",
            workspace_id: "ws-1",
            proposal_id: "proposal-1",
            proposal_type: "merge",
            execution_status: "executed",
            result_summary: "merge executed",
            error_message: null,
            source_service: "retrieval-runtime",
            started_at: "2026-04-22T00:00:00Z",
            finished_at: "2026-04-22T00:01:00Z",
          },
          targets: [
            { record_id: "memory-1", conflict_id: null, role: "target" },
            { record_id: "memory-2", conflict_id: null, role: "winner" },
          ],
        },
      }),
    } as Response);

    const result = await fetchGovernanceExecutionDetail("execution-1");

    expect(result.detail).not.toBeNull();
    expect(result.detail?.suggestedChanges.summary).toBe("merged summary");
    expect(result.detail?.targets).toHaveLength(2);
    expect(result.detail?.verifierNotes).toBe("clear duplicate");
  });

  it("marks governance executions blocked by verifier", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            proposal: {
              id: "proposal-blocked",
              workspace_id: "ws-1",
              proposal_type: "delete",
              reason_code: "obsolete_task_state",
              reason_text: "delete obsolete task state",
              evidence_json: {
                delete_reason: "replaced by newer state",
              },
              planner_model: "memory_llm",
              planner_confidence: 0.95,
              verifier_required: true,
              verifier_decision: "reject",
              verifier_confidence: 0,
              verifier_notes: "verifier_unavailable",
            },
            execution: {
              id: "execution-blocked",
              workspace_id: "ws-1",
              proposal_id: "proposal-blocked",
              proposal_type: "delete",
              execution_status: "rejected_by_guard",
              result_summary: null,
              error_message: "verifier_unavailable",
              source_service: "retrieval-runtime",
              started_at: "2026-04-22T00:00:00Z",
              finished_at: "2026-04-22T00:01:00Z",
            },
            targets: [
              {
                record_id: "memory-1",
                conflict_id: null,
                role: "target",
              },
            ],
          },
        ],
      }),
    } as Response);

    const result = await fetchGovernanceExecutions({
      workspaceId: "ws-1",
      proposalType: undefined,
      executionStatus: undefined,
      limit: 20,
    });

    expect(result.items[0]?.verificationBlocked).toBe(true);
    expect(result.items[0]?.verificationBlockedReason).toBe("verifier_unavailable");
  });
});

