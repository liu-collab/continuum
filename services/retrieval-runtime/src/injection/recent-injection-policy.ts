import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import type { RuntimeRepository } from "../observability/runtime-repository.js";
import type {
  CandidateMemory,
  MemoryType,
  RecentInjectionStateRecord,
  TriggerContext,
} from "../shared/types.js";
import { matchesHistoryReference, nowIso } from "../shared/utils.js";

export type RecentInjectionRuntimeConfig = Pick<
  AppConfig,
  | "INJECTION_DEDUP_ENABLED"
  | "INJECTION_HARD_WINDOW_TURNS_FACT"
  | "INJECTION_HARD_WINDOW_TURNS_PREFERENCE"
  | "INJECTION_HARD_WINDOW_TURNS_TASK_STATE"
  | "INJECTION_HARD_WINDOW_TURNS_EPISODIC"
  | "INJECTION_HARD_WINDOW_MS_FACT"
  | "INJECTION_HARD_WINDOW_MS_PREFERENCE"
  | "INJECTION_HARD_WINDOW_MS_TASK_STATE"
  | "INJECTION_HARD_WINDOW_MS_EPISODIC"
  | "INJECTION_SOFT_WINDOW_MS_TASK_STATE"
  | "INJECTION_SOFT_WINDOW_MS_EPISODIC"
  | "INJECTION_RECENT_STATE_TTL_MS"
  | "INJECTION_RECENT_STATE_MAX_SESSIONS"
>;

export const DEFAULT_RECENT_INJECTION_CONFIG: RecentInjectionRuntimeConfig = {
  INJECTION_DEDUP_ENABLED: true,
  INJECTION_HARD_WINDOW_TURNS_FACT: 5,
  INJECTION_HARD_WINDOW_TURNS_PREFERENCE: 5,
  INJECTION_HARD_WINDOW_TURNS_TASK_STATE: 3,
  INJECTION_HARD_WINDOW_TURNS_EPISODIC: 2,
  INJECTION_HARD_WINDOW_MS_FACT: 30 * 60 * 1000,
  INJECTION_HARD_WINDOW_MS_PREFERENCE: 30 * 60 * 1000,
  INJECTION_HARD_WINDOW_MS_TASK_STATE: 10 * 60 * 1000,
  INJECTION_HARD_WINDOW_MS_EPISODIC: 5 * 60 * 1000,
  INJECTION_SOFT_WINDOW_MS_TASK_STATE: 30 * 60 * 1000,
  INJECTION_SOFT_WINDOW_MS_EPISODIC: 15 * 60 * 1000,
  INJECTION_RECENT_STATE_TTL_MS: 60 * 60 * 1000,
  INJECTION_RECENT_STATE_MAX_SESSIONS: 500,
};

type RecentInjectionRecord = {
  record_id: string;
  memory_type: MemoryType;
  record_updated_at?: string;
  injected_at: number;
  turn_index: number;
  trace_id?: string;
  source_phase: TriggerContext["phase"];
};

export type RecentInjectionDecision = {
  hardFiltered: CandidateMemory[];
  softMarked: CandidateMemory[];
  remaining: CandidateMemory[];
  replayEscapeReason?: string;
};

type RecentInjectionPolicyOptions = {
  config: RecentInjectionRuntimeConfig;
  repository: Pick<
    RuntimeRepository,
    | "deleteExpiredRecentInjectionStates"
    | "findLatestTurnIndexBySession"
    | "listRecentInjectionStates"
    | "upsertRecentInjectionStates"
  >;
  logger: Logger;
};

export class RecentInjectionPolicy {
  private readonly recentInjections = new Map<string, Map<string, RecentInjectionRecord>>();
  private readonly recentInjectionSessionsLoaded = new Set<string>();
  private readonly sessionTurnCounters = new Map<string, number>();

  constructor(private readonly options: RecentInjectionPolicyOptions) {}

  async cleanupExpired() {
    const currentNowIso = nowIso();
    await this.options.repository.deleteExpiredRecentInjectionStates(currentNowIso);
    const now = Date.parse(currentNowIso);
    for (const [sessionId, records] of this.recentInjections.entries()) {
      for (const [recordId, record] of records.entries()) {
        if (now - record.injected_at > this.options.config.INJECTION_RECENT_STATE_TTL_MS) {
          records.delete(recordId);
        }
      }
      if (records.size === 0) {
        this.recentInjections.delete(sessionId);
      }
    }
  }

  async ensureLoaded(sessionId: string) {
    if (this.recentInjectionSessionsLoaded.has(sessionId)) {
      return;
    }

    const records = await this.options.repository.listRecentInjectionStates(sessionId, nowIso());
    if (records.length > 0) {
      const sessionState = new Map<string, RecentInjectionRecord>();
      let latestTurnIndex = 0;
      for (const record of records) {
        sessionState.set(record.record_id, {
          record_id: record.record_id,
          memory_type: record.memory_type,
          record_updated_at: record.record_updated_at,
          injected_at: Date.parse(record.injected_at),
          turn_index: record.turn_index,
          trace_id: record.trace_id,
          source_phase: record.source_phase,
        });
        latestTurnIndex = Math.max(latestTurnIndex, record.turn_index);
      }
      this.recentInjections.set(sessionId, sessionState);
      this.sessionTurnCounters.set(
        sessionId,
        Math.max(this.sessionTurnCounters.get(sessionId) ?? 0, latestTurnIndex),
      );
    } else if (!this.sessionTurnCounters.has(sessionId)) {
      const latestTurnIndex = await this.options.repository.findLatestTurnIndexBySession(sessionId);
      if (latestTurnIndex > 0) {
        this.sessionTurnCounters.set(sessionId, latestTurnIndex);
      }
    }

    this.recentInjectionSessionsLoaded.add(sessionId);
  }

  nextTurnIndex(sessionId: string) {
    const next = (this.sessionTurnCounters.get(sessionId) ?? 0) + 1;
    this.sessionTurnCounters.set(sessionId, next);
    return next;
  }

  peekTurnIndex(sessionId: string) {
    return this.sessionTurnCounters.get(sessionId) ?? 0;
  }

  apply(input: {
    context: TriggerContext;
    turnIndex: number;
    candidates: CandidateMemory[];
  }): RecentInjectionDecision {
    if (
      !this.options.config.INJECTION_DEDUP_ENABLED
      || input.candidates.length === 0
      || input.context.phase !== "before_response"
    ) {
      return {
        hardFiltered: [],
        softMarked: [],
        remaining: input.candidates,
      };
    }

    const replayEscapeReason = this.resolveReplayEscapeReason(input.context, input.candidates);
    if (replayEscapeReason) {
      return {
        hardFiltered: [],
        softMarked: [],
        remaining: input.candidates,
        replayEscapeReason,
      };
    }

    const sessionState = this.recentInjections.get(input.context.session_id);
    if (!sessionState || sessionState.size === 0) {
      return {
        hardFiltered: [],
        softMarked: [],
        remaining: input.candidates,
      };
    }

    const now = Date.now();
    const hardFiltered: CandidateMemory[] = [];
    const softMarked: CandidateMemory[] = [];
    const remaining: CandidateMemory[] = [];

    for (const candidate of input.candidates) {
      const recent = sessionState.get(candidate.id);
      if (!recent) {
        remaining.push(candidate);
        continue;
      }

      const elapsedMs = Math.max(0, now - recent.injected_at);
      const turnsSince = Math.max(0, input.turnIndex - recent.turn_index);
      const hardWindowTurns = this.getHardWindowTurns(candidate.memory_type);
      const hardWindowMs = this.getHardWindowMs(candidate.memory_type);
      const softWindowMs = this.getSoftWindowMs(candidate.memory_type);

      if (
        (hardWindowTurns > 0 && turnsSince <= hardWindowTurns)
        || (hardWindowMs > 0 && elapsedMs <= hardWindowMs)
      ) {
        hardFiltered.push(candidate);
        continue;
      }

      if (softWindowMs > 0 && elapsedMs <= softWindowMs) {
        const marked: CandidateMemory = {
          ...candidate,
          recent_injection_hint: {
            recently_injected: true,
            injected_at: new Date(recent.injected_at).toISOString(),
            turns_since_last_injection: turnsSince,
          },
        };
        softMarked.push(marked);
        remaining.push(marked);
        continue;
      }

      remaining.push(candidate);
    }

    return {
      hardFiltered,
      softMarked,
      remaining,
    };
  }

  remember(input: {
    sessionId: string;
    turnId?: string;
    traceId: string;
    turnIndex: number;
    sourcePhase: TriggerContext["phase"];
    records: Array<{ id: string; memory_type: MemoryType; updated_at?: string }>;
  }) {
    if (input.records.length === 0) {
      return;
    }

    if (
      this.recentInjections.size >= this.options.config.INJECTION_RECENT_STATE_MAX_SESSIONS
      && !this.recentInjections.has(input.sessionId)
    ) {
      const oldestKey = this.recentInjections.keys().next().value;
      if (oldestKey) {
        this.recentInjections.delete(oldestKey);
      }
    }

    const sessionState = this.recentInjections.get(input.sessionId) ?? new Map<string, RecentInjectionRecord>();
    const now = Date.now();
    const persisted: RecentInjectionStateRecord[] = [];
    for (const record of input.records) {
      const recentRecord: RecentInjectionRecord = {
        record_id: record.id,
        memory_type: record.memory_type,
        record_updated_at: record.updated_at,
        injected_at: now,
        turn_index: input.turnIndex,
        trace_id: input.traceId,
        source_phase: input.sourcePhase,
      };
      sessionState.set(record.id, recentRecord);
      persisted.push({
        session_id: input.sessionId,
        record_id: recentRecord.record_id,
        memory_type: recentRecord.memory_type,
        record_updated_at: recentRecord.record_updated_at,
        injected_at: new Date(recentRecord.injected_at).toISOString(),
        turn_index: recentRecord.turn_index,
        trace_id: recentRecord.trace_id,
        source_phase: recentRecord.source_phase,
        expires_at: new Date(
          recentRecord.injected_at + this.options.config.INJECTION_RECENT_STATE_TTL_MS,
        ).toISOString(),
      });
    }
    this.recentInjections.set(input.sessionId, sessionState);
    this.recentInjectionSessionsLoaded.add(input.sessionId);
    void this.options.repository.upsertRecentInjectionStates(persisted).catch((error) => {
      this.options.logger.warn(
        {
          session_id: input.sessionId,
          turn_id: input.turnId,
          trace_id: input.traceId,
          error: error instanceof Error ? error.message : String(error),
        },
        "failed to persist recent injection state",
      );
    });
  }

  private resolveReplayEscapeReason(context: TriggerContext, candidates: CandidateMemory[]): string | undefined {
    if (this.hasRecentTaskSwitch(context.session_id)) {
      return "task_switch_escape";
    }
    const sessionState = this.recentInjections.get(context.session_id);
    if (sessionState && candidates.some((candidate) => {
      const recent = sessionState.get(candidate.id);
      return Boolean(recent?.record_updated_at && recent.record_updated_at !== candidate.updated_at);
    })) {
      return "record_version_changed_escape";
    }
    if (context.phase === "task_switch") {
      return "task_switch_escape";
    }
    if (matchesHistoryReference(context.current_input)) {
      return "history_reference_escape";
    }
    return undefined;
  }

  private getHardWindowTurns(memoryType: MemoryType) {
    switch (memoryType) {
      case "fact":
        return this.options.config.INJECTION_HARD_WINDOW_TURNS_FACT;
      case "preference":
        return this.options.config.INJECTION_HARD_WINDOW_TURNS_PREFERENCE;
      case "task_state":
        return this.options.config.INJECTION_HARD_WINDOW_TURNS_TASK_STATE;
      case "episodic":
        return this.options.config.INJECTION_HARD_WINDOW_TURNS_EPISODIC;
    }
  }

  private getHardWindowMs(memoryType: MemoryType) {
    switch (memoryType) {
      case "fact":
        return this.options.config.INJECTION_HARD_WINDOW_MS_FACT;
      case "preference":
        return this.options.config.INJECTION_HARD_WINDOW_MS_PREFERENCE;
      case "task_state":
        return this.options.config.INJECTION_HARD_WINDOW_MS_TASK_STATE;
      case "episodic":
        return this.options.config.INJECTION_HARD_WINDOW_MS_EPISODIC;
    }
  }

  private getSoftWindowMs(memoryType: MemoryType) {
    switch (memoryType) {
      case "fact":
      case "preference":
        return 0;
      case "task_state":
        return this.options.config.INJECTION_SOFT_WINDOW_MS_TASK_STATE;
      case "episodic":
        return this.options.config.INJECTION_SOFT_WINDOW_MS_EPISODIC;
    }
  }

  private hasRecentTaskSwitch(sessionId: string) {
    const sessionState = this.recentInjections.get(sessionId);
    if (!sessionState) {
      return false;
    }
    for (const record of sessionState.values()) {
      if (record.source_phase === "task_switch" && record.turn_index >= this.peekTurnIndex(sessionId) - 1) {
        return true;
      }
    }
    return false;
  }
}

export function pickRecentInjectionConfig(config: AppConfig): RecentInjectionRuntimeConfig {
  return {
    INJECTION_DEDUP_ENABLED: config.INJECTION_DEDUP_ENABLED,
    INJECTION_HARD_WINDOW_TURNS_FACT: config.INJECTION_HARD_WINDOW_TURNS_FACT,
    INJECTION_HARD_WINDOW_TURNS_PREFERENCE: config.INJECTION_HARD_WINDOW_TURNS_PREFERENCE,
    INJECTION_HARD_WINDOW_TURNS_TASK_STATE: config.INJECTION_HARD_WINDOW_TURNS_TASK_STATE,
    INJECTION_HARD_WINDOW_TURNS_EPISODIC: config.INJECTION_HARD_WINDOW_TURNS_EPISODIC,
    INJECTION_HARD_WINDOW_MS_FACT: config.INJECTION_HARD_WINDOW_MS_FACT,
    INJECTION_HARD_WINDOW_MS_PREFERENCE: config.INJECTION_HARD_WINDOW_MS_PREFERENCE,
    INJECTION_HARD_WINDOW_MS_TASK_STATE: config.INJECTION_HARD_WINDOW_MS_TASK_STATE,
    INJECTION_HARD_WINDOW_MS_EPISODIC: config.INJECTION_HARD_WINDOW_MS_EPISODIC,
    INJECTION_SOFT_WINDOW_MS_TASK_STATE: config.INJECTION_SOFT_WINDOW_MS_TASK_STATE,
    INJECTION_SOFT_WINDOW_MS_EPISODIC: config.INJECTION_SOFT_WINDOW_MS_EPISODIC,
    INJECTION_RECENT_STATE_TTL_MS: config.INJECTION_RECENT_STATE_TTL_MS,
    INJECTION_RECENT_STATE_MAX_SESSIONS: config.INJECTION_RECENT_STATE_MAX_SESSIONS,
  };
}
