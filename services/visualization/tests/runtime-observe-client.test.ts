import { describe, expect, it } from "vitest";

import { normalizeRuntimeRunsPayload } from "@/lib/server/runtime-observe-client";

describe("runtime observe contract parsing", () => {
  it("parses the official runtime observe runs shape", () => {
    const snapshot = normalizeRuntimeRunsPayload({
      data: {
        turns: [
          {
            trace_id: "trace-1",
            turn_id: "turn-1",
            workspace_id: "ws-1",
            user_id: "user-1",
            session_id: "session-1",
            phase: "before_response",
            current_input: "之前那个偏好继续保留",
            assistant_output: "好的",
            created_at: "2026-04-15T12:00:00.000Z"
          }
        ],
        trigger_runs: [
          {
            trace_id: "trace-1",
            phase: "before_response",
            trigger_hit: true,
            trigger_type: "history_reference",
            trigger_reason: "current input explicitly references prior context or preferences",
            requested_memory_types: ["fact_preference"],
            scope_limit: ["user"],
            importance_threshold: 3,
            cooldown_applied: false,
            duration_ms: 8,
            created_at: "2026-04-15T12:00:00.000Z"
          }
        ],
        recall_runs: [
          {
            trace_id: "trace-1",
            phase: "before_response",
            trigger_hit: true,
            trigger_type: "history_reference",
            trigger_reason: "reason",
            matched_scopes: ["user"],
            scope_hit_counts: {
              user: 1
            },
            query_scope: "scope=user",
            requested_memory_types: ["fact_preference"],
            candidate_count: 2,
            selected_count: 1,
            result_state: "matched",
            degraded: false,
            duration_ms: 12,
            created_at: "2026-04-15T12:00:01.000Z"
          }
        ],
        injection_runs: [
          {
            trace_id: "trace-1",
            phase: "before_response",
            injected: true,
            injected_count: 1,
            token_estimate: 90,
            trimmed_record_ids: ["memory-2"],
            trim_reasons: ["token budget"],
            result_state: "injected",
            duration_ms: 5,
            created_at: "2026-04-15T12:00:02.000Z"
          }
        ],
        writeback_submissions: [
          {
            trace_id: "trace-1",
            phase: "after_response",
            candidate_count: 1,
            submitted_count: 1,
            filtered_count: 0,
            filtered_reasons: [],
            result_state: "submitted",
            degraded: false,
            duration_ms: 7,
            created_at: "2026-04-15T12:00:03.000Z"
          }
        ],
        dependency_status: {
          read_model: {
            status: "healthy",
            detail: "ok",
            last_checked_at: "2026-04-15T12:00:00.000Z"
          }
        }
      }
    });

    expect(snapshot.turns[0]?.turnId).toBe("turn-1");
    expect(snapshot.triggerRuns[0]?.requestedTypes).toEqual(["fact_preference"]);
    expect(snapshot.recallRuns[0]?.selectedCount).toBe(1);
    expect(snapshot.recallRuns[0]?.selectedScopes).toEqual(["user"]);
    expect(snapshot.recallRuns[0]?.scopeHitCounts).toEqual([{ scope: "user", count: 1 }]);
    expect(snapshot.injectionRuns[0]?.trimmedRecordIds).toEqual(["memory-2"]);
    expect(snapshot.writeBackRuns[0]?.resultState).toBe("submitted");
    expect(snapshot.dependencyStatus[0]?.name).toBe("read_model");
  });

  it("maps the full postgres runtime repository response shape", () => {
    const mockRuntimeResponse = {
      turns: [
        {
          trace_id: "t1",
          host: "claude_code_plugin",
          workspace_id: "ws1",
          user_id: "u1",
          session_id: "s1",
          phase: "before_response",
          task_id: null,
          thread_id: null,
          turn_id: "turn-1",
          current_input: "hello",
          assistant_output: null,
          created_at: "2026-04-16T00:00:00Z"
        }
      ],
      trigger_runs: [
        {
          trace_id: "t1",
          phase: "before_response",
          trigger_hit: true,
          trigger_type: "phase",
          trigger_reason: "before_response is mandatory",
          requested_memory_types: ["fact_preference"],
          scope_limit: ["user"],
          importance_threshold: 3,
          cooldown_applied: false,
          semantic_score: null,
          degraded: null,
          degradation_reason: null,
          duration_ms: 12,
          created_at: "2026-04-16T00:00:00Z"
        }
      ],
      recall_runs: [
        {
          trace_id: "t1",
          phase: "before_response",
          trigger_hit: true,
          trigger_type: "phase",
          trigger_reason: "before_response is mandatory",
          matched_scopes: ["user", "workspace"],
          scope_hit_counts: { user: 1, workspace: 1 },
          query_scope: "user",
          requested_memory_types: ["fact_preference"],
          candidate_count: 5,
          selected_count: 2,
          result_state: "matched",
          degraded: false,
          degradation_reason: null,
          duration_ms: 45,
          created_at: "2026-04-16T00:00:00Z"
        }
      ],
      injection_runs: [
        {
          trace_id: "t1",
          phase: "before_response",
          injected: true,
          injected_count: 2,
          token_estimate: 120,
          trimmed_record_ids: [],
          trim_reasons: [],
          result_state: "injected",
          duration_ms: 3,
          created_at: "2026-04-16T00:00:00Z"
        }
      ],
      writeback_submissions: [
        {
          trace_id: "t1",
          phase: "after_response",
          candidate_count: 1,
          submitted_count: 1,
          filtered_count: 0,
          filtered_reasons: [],
          result_state: "submitted",
          degraded: false,
          degradation_reason: null,
          duration_ms: 80,
          created_at: "2026-04-16T00:00:00Z"
        }
      ],
      dependency_status: {
        read_model: {
          name: "read_model",
          status: "healthy",
          detail: "ok",
          last_checked_at: "2026-04-16T00:00:00Z"
        },
        embeddings: {
          name: "embeddings",
          status: "healthy",
          detail: "ok",
          last_checked_at: "2026-04-16T00:00:00Z"
        },
        storage_writeback: {
          name: "storage_writeback",
          status: "healthy",
          detail: "ok",
          last_checked_at: "2026-04-16T00:00:00Z"
        },
        writeback_llm: {
          name: "writeback_llm",
          status: "healthy",
          detail: "ok",
          last_checked_at: "2026-04-16T00:00:00Z"
        }
      }
    };

    const snapshot = normalizeRuntimeRunsPayload(mockRuntimeResponse);

    expect(snapshot.turns).toHaveLength(1);
    expect(snapshot.turns[0]).toMatchObject({
      traceId: "t1",
      turnId: "turn-1",
      workspaceId: "ws1",
      sessionId: "s1"
    });
    expect(snapshot.triggerRuns).toHaveLength(1);
    expect(snapshot.triggerRuns[0]).toMatchObject({
      traceId: "t1",
      triggerHit: true,
      triggerType: "phase",
      triggerReason: "before_response is mandatory",
      requestedTypes: ["fact_preference"],
      scopeLimit: ["user"],
      importanceThreshold: 3
    });
    expect(snapshot.recallRuns[0]).toMatchObject({
      selectedCount: 2,
      candidateCount: 5,
      queryScope: "user",
      selectedScopes: ["user", "workspace"]
    });
    expect(snapshot.injectionRuns[0]).toMatchObject({
      injected: true,
      injectedCount: 2,
      tokenEstimate: 120
    });
    expect(snapshot.writeBackRuns[0]).toMatchObject({
      submittedCount: 1,
      resultState: "submitted"
    });
    expect(snapshot.dependencyStatus).toHaveLength(4);
    expect(snapshot.dependencyStatus.map((item) => item.name)).toEqual([
      "read_model",
      "embeddings",
      "storage_writeback",
      "writeback_llm"
    ]);
  });
});
