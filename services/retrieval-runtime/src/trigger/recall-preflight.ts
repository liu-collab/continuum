import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import type { DependencyGuard } from "../dependency/dependency-guard.js";
import type { QueryEngine } from "../query/query-engine.js";
import { SmallCache } from "../shared/small-cache.js";
import type {
  DependencyStatus,
  MemoryMode,
  MemoryType,
  ReadModelAvailability,
  ReadModelAvailabilityQuery,
  ScopeType,
  TriggerContext,
} from "../shared/types.js";
import { matchesContextDependentShortReference, matchesHistoryReference, normalizeText } from "../shared/utils.js";
import { buildPhaseMemoryPlan } from "./phase-plan.js";

export type RecallPreflightSkipReason =
  | "short_or_command_input"
  | "memory_suppressed_by_user"
  | "no_visible_candidates"
  | "no_matching_memory_types";

export interface RecallPreflightSkip {
  should_continue: false;
  reason: RecallPreflightSkipReason;
  trigger_reason: string;
  requested_scopes: ScopeType[];
  requested_memory_types: MemoryType[];
  scope_reason: string;
  importance_threshold: number;
}

export interface RecallPreflightContinue {
  should_continue: true;
  requested_scopes: ScopeType[];
  requested_memory_types: MemoryType[];
  scope_reason: string;
  importance_threshold: number;
  available_candidate_count?: number;
  type_distribution?: Partial<Record<MemoryType, number>>;
  degraded?: boolean;
  degradation_reason?: string;
  dependency_status?: DependencyStatus;
}

export type RecallPreflightResult = RecallPreflightSkip | RecallPreflightContinue;

const COMMAND_OR_SHORT_SKIP_PATTERNS = [
  /^\/[\w-]+(?:\s|$)/,
  /^(?:ok|yes|no|好|是|否|嗯|不用|不用了)$/i,
  /^(?:ls|pwd|cd|cat|head|tail)(?:\s|$)/i,
  /^.{0,3}$/,
];

const SUPPRESS_RECALL_PATTERNS = [
  /不用.*(?:之前|记忆|历史|上下文)/,
  /从头.*(?:来|开始|做)/,
  /重新开始/,
  /ignore.*(?:previous|past|memory|context)/i,
  /start.*(?:fresh|over|from scratch)/i,
  /forget.*(?:everything|all|it)/i,
];
const ALL_MEMORY_TYPES: MemoryType[] = ["fact", "preference", "task_state", "episodic"];
const AVAILABILITY_CACHE_TTL_MS = 30_000;
const AVAILABILITY_CACHE_MAX_ENTRIES = 500;

function shouldApplyInputGate(phase: TriggerContext["phase"]) {
  return phase !== "session_start" && phase !== "after_response";
}

function resolveMemoryMode(memoryMode?: MemoryMode): MemoryMode {
  return memoryMode ?? "workspace_plus_global";
}

function isCommandOrShortInput(input: string) {
  const normalized = normalizeText(input);
  if (!normalized || matchesHistoryReference(normalized)) {
    return false;
  }
  if (matchesContextDependentShortReference(normalized)) {
    return false;
  }
  return COMMAND_OR_SHORT_SKIP_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isMemorySuppressed(input: string) {
  const normalized = normalizeText(input);
  return SUPPRESS_RECALL_PATTERNS.some((pattern) => pattern.test(normalized));
}

function stableArray<T extends string>(values: T[]): T[] {
  return [...values].sort();
}

function availabilityCacheKey(query: ReadModelAvailabilityQuery) {
  return JSON.stringify({
    workspace_id: query.workspace_id,
    user_id: query.user_id,
    session_id: query.session_id,
    task_id: query.task_id ?? null,
    memory_mode: query.memory_mode,
    scope_filter: stableArray(query.scope_filter),
    memory_type_filter: stableArray(query.memory_type_filter),
    status_filter: stableArray(query.status_filter),
    importance_threshold: query.importance_threshold,
  });
}

export class RecallPreflight {
  private readonly availabilityCache = new SmallCache<string, ReadModelAvailability>({
    ttlMs: AVAILABILITY_CACHE_TTL_MS,
    maxEntries: AVAILABILITY_CACHE_MAX_ENTRIES,
  });

  constructor(
    private readonly config: AppConfig,
    private readonly queryEngine: QueryEngine,
    private readonly dependencyGuard: DependencyGuard,
    private readonly logger: Logger,
  ) {}

  async evaluate(context: TriggerContext & { memory_mode?: MemoryMode }): Promise<RecallPreflightResult> {
    const memoryMode = resolveMemoryMode(context.memory_mode);
    const phasePlan = buildPhaseMemoryPlan(context, memoryMode, this.config);

    if (context.phase === "after_response") {
      return {
        should_continue: true,
        requested_scopes: phasePlan.requested_scopes,
        requested_memory_types: phasePlan.requested_memory_types,
        scope_reason: phasePlan.scope_reason,
        importance_threshold: phasePlan.importance_threshold,
      };
    }

    if (shouldApplyInputGate(context.phase) && isMemorySuppressed(context.current_input)) {
      return {
        should_continue: false,
        reason: "memory_suppressed_by_user",
        trigger_reason: "recall_preflight_skipped:memory_suppressed_by_user",
        requested_scopes: phasePlan.requested_scopes,
        requested_memory_types: phasePlan.requested_memory_types,
        scope_reason: phasePlan.scope_reason,
        importance_threshold: phasePlan.importance_threshold,
      };
    }

    if (shouldApplyInputGate(context.phase) && isCommandOrShortInput(context.current_input)) {
      return {
        should_continue: false,
        reason: "short_or_command_input",
        trigger_reason: "recall_preflight_skipped:short_or_command_input",
        requested_scopes: phasePlan.requested_scopes,
        requested_memory_types: phasePlan.requested_memory_types,
        scope_reason: phasePlan.scope_reason,
        importance_threshold: phasePlan.importance_threshold,
      };
    }

    if (phasePlan.requested_scopes.length === 0 || phasePlan.requested_memory_types.length === 0) {
      return {
        should_continue: true,
        requested_scopes: phasePlan.requested_scopes,
        requested_memory_types: phasePlan.requested_memory_types,
        scope_reason: phasePlan.scope_reason,
        importance_threshold: phasePlan.importance_threshold,
      };
    }

    const availabilityQuery: ReadModelAvailabilityQuery = {
      workspace_id: context.workspace_id,
      user_id: context.user_id,
      session_id: context.session_id,
      task_id: context.task_id,
      memory_mode: memoryMode,
      scope_filter: phasePlan.requested_scopes,
      memory_type_filter: ALL_MEMORY_TYPES,
      status_filter: ["active"],
      importance_threshold: phasePlan.importance_threshold,
    };
    const cacheKey = availabilityCacheKey(availabilityQuery);
    const cachedAvailability = this.availabilityCache.get(cacheKey);
    let availability = cachedAvailability;
    if (!availability) {
      const availabilityResult = await this.dependencyGuard.run(
        "read_model",
        this.config.QUERY_TIMEOUT_MS,
        (signal) => this.queryEngine.estimateAvailability(availabilityQuery, signal),
      );

      if (!availabilityResult.ok || !availabilityResult.value) {
        this.logger.warn(
          {
            phase: context.phase,
            reason: availabilityResult.error?.message,
          },
          "recall preflight availability estimate degraded, continuing with normal recall",
        );
        return {
          should_continue: true,
          requested_scopes: phasePlan.requested_scopes,
          requested_memory_types: phasePlan.requested_memory_types,
          scope_reason: phasePlan.scope_reason,
          importance_threshold: phasePlan.importance_threshold,
          degraded: true,
          degradation_reason: availabilityResult.error?.code ?? "read_model_unavailable",
          dependency_status: availabilityResult.status,
        };
      }

      availability = availabilityResult.value;
      this.availabilityCache.set(cacheKey, availability);
    }

    if (availability.total_count === 0) {
      return {
        should_continue: false,
        reason: "no_visible_candidates",
        trigger_reason: "recall_preflight_skipped:no_visible_candidates",
        requested_scopes: phasePlan.requested_scopes,
        requested_memory_types: phasePlan.requested_memory_types,
        scope_reason: phasePlan.scope_reason,
        importance_threshold: phasePlan.importance_threshold,
      };
    }

    const effectiveTypes = phasePlan.requested_memory_types.filter(
      (type) => (availability.type_distribution[type] ?? 0) > 0,
    );
    if (effectiveTypes.length === 0) {
      return {
        should_continue: false,
        reason: "no_matching_memory_types",
        trigger_reason: "recall_preflight_skipped:no_matching_memory_types",
        requested_scopes: phasePlan.requested_scopes,
        requested_memory_types: phasePlan.requested_memory_types,
        scope_reason: phasePlan.scope_reason,
        importance_threshold: phasePlan.importance_threshold,
      };
    }

    return {
      should_continue: true,
      requested_scopes: phasePlan.requested_scopes,
      requested_memory_types: effectiveTypes,
      scope_reason: phasePlan.scope_reason,
      importance_threshold: phasePlan.importance_threshold,
      available_candidate_count: availability.total_count,
      type_distribution: availability.type_distribution,
    };
  }
}
