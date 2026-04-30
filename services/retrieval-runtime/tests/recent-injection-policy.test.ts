import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_RECENT_INJECTION_CONFIG,
  RecentInjectionPolicy,
} from "../src/injection/recent-injection-policy.js";
import type {
  CandidateMemory,
  RecentInjectionStateRecord,
  TriggerContext,
} from "../src/shared/types.js";

function createRepository(records: RecentInjectionStateRecord[] = []) {
  const persisted: RecentInjectionStateRecord[] = [];
  return {
    persisted,
    repository: {
      deleteExpiredRecentInjectionStates: vi.fn(async () => undefined),
      findLatestTurnIndexBySession: vi.fn(async () => 0),
      listRecentInjectionStates: vi.fn(async () => records),
      upsertRecentInjectionStates: vi.fn(async (nextRecords: RecentInjectionStateRecord[]) => {
        persisted.push(...nextRecords);
      }),
    },
  };
}

function createContext(overrides: Partial<TriggerContext> = {}): TriggerContext {
  return {
    host: "custom_agent",
    workspace_id: "workspace-1",
    user_id: "user-1",
    session_id: "session-1",
    phase: "before_response",
    current_input: "continue",
    ...overrides,
  };
}

function createCandidate(overrides: Partial<CandidateMemory> = {}): CandidateMemory {
  return {
    id: "memory-1",
    workspace_id: "workspace-1",
    user_id: "user-1",
    session_id: null,
    task_id: null,
    memory_type: "fact",
    scope: "workspace",
    summary: "Remember the repo uses PostgreSQL.",
    importance: 4,
    confidence: 0.9,
    status: "active",
    updated_at: "2026-04-30T00:00:00.000Z",
    rerank_score: 0.9,
    ...overrides,
  };
}

describe("RecentInjectionPolicy", () => {
  it("hard-filters memories injected inside the hard turn window", async () => {
    const { repository } = createRepository();
    const policy = new RecentInjectionPolicy({
      config: DEFAULT_RECENT_INJECTION_CONFIG,
      repository,
      logger: pino({ enabled: false }),
    });
    const context = createContext();
    await policy.ensureLoaded(context.session_id);
    const firstTurn = policy.nextTurnIndex(context.session_id);
    policy.remember({
      sessionId: context.session_id,
      traceId: "trace-1",
      turnIndex: firstTurn,
      sourcePhase: "before_response",
      records: [createCandidate()],
    });

    const decision = policy.apply({
      context,
      turnIndex: policy.nextTurnIndex(context.session_id),
      candidates: [createCandidate()],
    });

    expect(decision.hardFiltered.map((candidate) => candidate.id)).toEqual(["memory-1"]);
    expect(decision.remaining).toEqual([]);
  });

  it("soft-marks task memories after the hard turn window but before the soft time window expires", async () => {
    const { repository } = createRepository();
    const policy = new RecentInjectionPolicy({
      config: {
        ...DEFAULT_RECENT_INJECTION_CONFIG,
        INJECTION_HARD_WINDOW_TURNS_TASK_STATE: 1,
        INJECTION_HARD_WINDOW_MS_TASK_STATE: 0,
        INJECTION_SOFT_WINDOW_MS_TASK_STATE: 60_000,
      },
      repository,
      logger: pino({ enabled: false }),
    });
    const context = createContext();
    const candidate = createCandidate({ memory_type: "task_state" });
    await policy.ensureLoaded(context.session_id);
    policy.remember({
      sessionId: context.session_id,
      traceId: "trace-1",
      turnIndex: policy.nextTurnIndex(context.session_id),
      sourcePhase: "before_response",
      records: [candidate],
    });
    const nextTurn = policy.nextTurnIndex(context.session_id);

    const decision = policy.apply({
      context,
      turnIndex: nextTurn + 1,
      candidates: [candidate],
    });

    expect(decision.hardFiltered).toEqual([]);
    expect(decision.softMarked.map((item) => item.id)).toEqual(["memory-1"]);
    expect(decision.remaining[0]?.recent_injection_hint).toMatchObject({
      recently_injected: true,
      turns_since_last_injection: 2,
    });
  });

  it("loads persisted recent injection state before applying the policy", async () => {
    const injectedAt = new Date().toISOString();
    const persistedRecord: RecentInjectionStateRecord = {
      session_id: "session-1",
      record_id: "memory-1",
      memory_type: "fact",
      record_updated_at: "2026-04-30T00:00:00.000Z",
      injected_at: injectedAt,
      turn_index: 8,
      trace_id: "trace-1",
      source_phase: "before_response",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    const { repository } = createRepository([persistedRecord]);
    const policy = new RecentInjectionPolicy({
      config: DEFAULT_RECENT_INJECTION_CONFIG,
      repository,
      logger: pino({ enabled: false }),
    });
    const context = createContext();

    await policy.ensureLoaded(context.session_id);
    const decision = policy.apply({
      context,
      turnIndex: policy.nextTurnIndex(context.session_id),
      candidates: [createCandidate()],
    });

    expect(repository.listRecentInjectionStates).toHaveBeenCalledWith("session-1", expect.any(String));
    expect(decision.hardFiltered.map((candidate) => candidate.id)).toEqual(["memory-1"]);
  });

  it("persists remembered injections with expiry metadata", async () => {
    const { repository, persisted } = createRepository();
    const policy = new RecentInjectionPolicy({
      config: DEFAULT_RECENT_INJECTION_CONFIG,
      repository,
      logger: pino({ enabled: false }),
    });

    policy.remember({
      sessionId: "session-1",
      turnId: "turn-1",
      traceId: "trace-1",
      turnIndex: 3,
      sourcePhase: "before_response",
      records: [createCandidate()],
    });
    await vi.waitFor(() => expect(repository.upsertRecentInjectionStates).toHaveBeenCalledTimes(1));

    expect(persisted[0]).toMatchObject({
      session_id: "session-1",
      record_id: "memory-1",
      memory_type: "fact",
      turn_index: 3,
      trace_id: "trace-1",
      source_phase: "before_response",
    });
    expect(Date.parse(persisted[0]!.expires_at)).toBeGreaterThan(Date.parse(persisted[0]!.injected_at));
  });
});
