import "server-only";

import { getAppConfig } from "@/lib/env";
import {
  asRecord,
  pickArray,
  pickBoolean,
  pickNullableString,
  pickNumber,
  pickString,
  pickStringArray
} from "@/lib/records";
import { fetchJsonFromSource } from "@/lib/server/http-client";

export type RuntimeMetricsSnapshot = {
  triggerRate: number | null;
  recallHitRate: number | null;
  emptyRecallRate: number | null;
  injectionRate: number | null;
  trimRate: number | null;
  recallP95Ms: number | null;
  injectionP95Ms: number | null;
  writeBackSubmitRate: number | null;
};

export type RuntimeObserveRunsSnapshot = {
  turns: RuntimeTurnRecord[];
  triggerRuns: RuntimeTriggerRecord[];
  recallRuns: RuntimeRecallRecord[];
  injectionRuns: RuntimeInjectionRecord[];
  writeBackRuns: RuntimeWritebackRecord[];
  dependencyStatus: RuntimeDependencyRecord[];
};

export type RuntimeTurnRecord = {
  traceId: string;
  turnId: string | null;
  workspaceId: string | null;
  userId: string | null;
  taskId: string | null;
  sessionId: string | null;
  threadId: string | null;
  host: string | null;
  phase: string | null;
  currentInput: string | null;
  assistantOutput: string | null;
  createdAt: string | null;
};

export type RuntimeTriggerRecord = {
  traceId: string;
  triggerHit: boolean;
  triggerType: string | null;
  triggerReason: string | null;
  memoryMode: "workspace_only" | "workspace_plus_global" | null;
  requestedTypes: Array<"fact_preference" | "task_state" | "episodic">;
  requestedScopes: Array<"session" | "task" | "user" | "workspace">;
  selectedScopes: Array<"session" | "task" | "user" | "workspace">;
  scopeDecision: string | null;
  scopeLimit: string[];
  importanceThreshold: number | null;
  cooldownApplied: boolean;
  semanticScore: number | null;
  durationMs: number | null;
  createdAt: string | null;
};

export type RuntimeRecallRecord = {
  traceId: string;
  triggerHit: boolean;
  triggerType: string | null;
  triggerReason: string | null;
  memoryMode: "workspace_only" | "workspace_plus_global" | null;
  requestedTypes: Array<"fact_preference" | "task_state" | "episodic">;
  requestedScopes: Array<"session" | "task" | "user" | "workspace">;
  selectedScopes: Array<"session" | "task" | "user" | "workspace">;
  scopeHitCounts: Array<{
    scope: "session" | "task" | "user" | "workspace";
    count: number;
  }>;
  selectedRecordIds: string[];
  queryScope: string | null;
  candidateCount: number;
  selectedCount: number;
  resultState: string;
  emptyReason: string | null;
  degraded: boolean;
  degradationReason: string | null;
  durationMs: number | null;
  createdAt: string | null;
};

export type RuntimeInjectionRecord = {
  traceId: string;
  injected: boolean;
  injectedCount: number;
  memoryMode: "workspace_only" | "workspace_plus_global" | null;
  requestedScopes: Array<"session" | "task" | "user" | "workspace">;
  selectedScopes: Array<"session" | "task" | "user" | "workspace">;
  keptRecordIds: string[];
  injectionReason: string | null;
  memorySummary: string | null;
  tokenEstimate: number | null;
  trimmedRecordIds: string[];
  trimReasons: string[];
  resultState: string;
  durationMs: number | null;
  createdAt: string | null;
};

export type RuntimeWritebackRecord = {
  traceId: string;
  memoryMode: "workspace_only" | "workspace_plus_global" | null;
  candidateCount: number;
  submittedCount: number;
  submittedJobIds: string[];
  candidateSummaries: string[];
  scopeDecisions: Array<{
    scope: "session" | "task" | "user" | "workspace";
    count: number;
    reason: string;
  }>;
  filteredCount: number;
  filteredReasons: string[];
  resultState: string;
  degraded: boolean;
  degradationReason: string | null;
  durationMs: number | null;
  createdAt: string | null;
};

export type RuntimeDependencyRecord = {
  name: string;
  status: string;
  detail: string;
  checkedAt: string;
};

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function readMetric(raw: Record<string, unknown>, keys: string[]) {
  return pickNumber(raw, ...keys) ?? null;
}

function unwrapData(value: unknown) {
  const record = asRecord(value);

  if (record && "data" in record) {
    return record.data;
  }

  return value;
}

export function normalizeRuntimeRunsPayload(value: unknown): RuntimeObserveRunsSnapshot {
  const root = asRecord(unwrapData(value));

  if (!root) {
    return {
      turns: [],
      triggerRuns: [],
      recallRuns: [],
      injectionRuns: [],
      writeBackRuns: [],
      dependencyStatus: []
    };
  }

  return {
    turns: pickArray(root, "turns").map(mapTurn).filter(isDefined),
    triggerRuns: pickArray(root, "trigger_runs", "triggerRuns").map(mapTriggerRun).filter(isDefined),
    recallRuns: pickArray(root, "recall_runs", "recallRuns").map(mapRecallRun).filter(isDefined),
    injectionRuns: pickArray(root, "injection_runs", "injectionRuns")
      .map(mapInjectionRun)
      .filter(isDefined),
    writeBackRuns: pickArray(root, "writeback_submissions", "writeBackRuns", "write_back_runs")
      .map(mapWriteBackRun)
      .filter(isDefined),
    dependencyStatus: mapDependencyStatus(root.dependency_status)
  };
}

function toRequestedTypes(values: string[]) {
  return values.filter(
    (item): item is "fact_preference" | "task_state" | "episodic" =>
      ["fact_preference", "task_state", "episodic"].includes(item)
  );
}

function toScopes(values: string[]) {
  return values.filter(
    (item): item is "session" | "task" | "user" | "workspace" =>
      ["session", "task", "user", "workspace"].includes(item)
  );
}

function toMemoryMode(
  value: string | null
): "workspace_only" | "workspace_plus_global" | null {
  if (value === "workspace_only" || value === "workspace_plus_global") {
    return value;
  }

  return null;
}

function mapTurn(value: unknown): RuntimeTurnRecord | null {
  const record = asRecord(value);

  if (!record) {
    return null;
  }

  return {
    traceId: pickString(record, "trace_id", "traceId") ?? "unknown-trace",
    turnId: pickNullableString(record, "turn_id", "turnId"),
    workspaceId: pickNullableString(record, "workspace_id", "workspaceId"),
    userId: pickNullableString(record, "user_id", "userId"),
    taskId: pickNullableString(record, "task_id", "taskId"),
    sessionId: pickNullableString(record, "session_id", "sessionId"),
    threadId: pickNullableString(record, "thread_id", "threadId"),
    host: pickNullableString(record, "host"),
    phase: pickNullableString(record, "phase"),
    currentInput: pickNullableString(record, "current_input", "currentInput"),
    assistantOutput: pickNullableString(record, "assistant_output", "assistantOutput"),
    createdAt: pickNullableString(record, "created_at", "createdAt")
  };
}

function mapTriggerRun(value: unknown): RuntimeTriggerRecord | null {
  const record = asRecord(value);

  if (!record) {
    return null;
  }

  return {
    traceId: pickString(record, "trace_id", "traceId") ?? "unknown-trace",
    triggerHit: pickBoolean(record, "trigger_hit", "triggerHit") ?? false,
    triggerType: pickNullableString(record, "trigger_type", "triggerType"),
    triggerReason: pickNullableString(record, "trigger_reason", "triggerReason"),
    memoryMode: toMemoryMode(pickNullableString(record, "memory_mode", "memoryMode")),
    requestedTypes: toRequestedTypes(
      pickStringArray(record, "requested_memory_types", "requestedTypes")
    ),
    requestedScopes: toScopes(
      pickStringArray(record, "requested_scopes", "requestedScopes", "scope_limit", "scopeLimit")
    ),
    selectedScopes: toScopes(pickStringArray(record, "selected_scopes", "selectedScopes")),
    scopeDecision: pickNullableString(record, "scope_decision", "scopeDecision"),
    scopeLimit: pickStringArray(record, "scope_limit", "scopeLimit"),
    importanceThreshold:
      pickNumber(record, "importance_threshold", "importanceThreshold") ?? null,
    cooldownApplied: pickBoolean(record, "cooldown_applied", "cooldownApplied") ?? false,
    semanticScore: pickNumber(record, "semantic_score", "semanticScore") ?? null,
    durationMs: pickNumber(record, "duration_ms", "durationMs") ?? null,
    createdAt: pickNullableString(record, "created_at", "createdAt")
  };
}

function mapRecallRun(value: unknown): RuntimeRecallRecord | null {
  const record = asRecord(value);

  if (!record) {
    return null;
  }

  return {
    traceId: pickString(record, "trace_id", "traceId") ?? "unknown-trace",
    triggerHit: pickBoolean(record, "trigger_hit", "triggerHit") ?? false,
    triggerType: pickNullableString(record, "trigger_type", "triggerType"),
    triggerReason: pickNullableString(record, "trigger_reason", "triggerReason"),
    memoryMode: toMemoryMode(pickNullableString(record, "memory_mode", "memoryMode")),
    requestedTypes: toRequestedTypes(
      pickStringArray(record, "requested_memory_types", "requestedTypes")
    ),
    requestedScopes: toScopes(pickStringArray(record, "requested_scopes", "requestedScopes")),
    selectedScopes: toScopes(pickStringArray(record, "selected_scopes", "selectedScopes")),
    scopeHitCounts: pickArray(record, "scope_hit_counts", "scopeHitCounts")
      .map((item) => {
        const scopeRecord = asRecord(item);

        if (!scopeRecord) {
          return null;
        }

        const scope = toScopes([
          pickString(scopeRecord, "scope") ?? ""
        ])[0];

        if (!scope) {
          return null;
        }

        return {
          scope,
          count: pickNumber(scopeRecord, "count") ?? 0
        };
      })
      .filter((item): item is { scope: "session" | "task" | "user" | "workspace"; count: number } => Boolean(item)),
    selectedRecordIds: pickStringArray(record, "selected_record_ids", "selectedRecordIds"),
    queryScope: pickNullableString(record, "query_scope", "queryScope"),
    candidateCount: pickNumber(record, "candidate_count", "candidateCount") ?? 0,
    selectedCount: pickNumber(record, "selected_count", "selectedCount") ?? 0,
    resultState: pickString(record, "result_state", "resultState") ?? "unknown",
    emptyReason: pickNullableString(record, "empty_reason", "emptyReason"),
    degraded: pickBoolean(record, "degraded") ?? false,
    degradationReason: pickNullableString(record, "degradation_reason", "degradationReason"),
    durationMs: pickNumber(record, "duration_ms", "durationMs") ?? null,
    createdAt: pickNullableString(record, "created_at", "createdAt")
  };
}

function mapInjectionRun(value: unknown): RuntimeInjectionRecord | null {
  const record = asRecord(value);

  if (!record) {
    return null;
  }

  return {
    traceId: pickString(record, "trace_id", "traceId") ?? "unknown-trace",
    injected: pickBoolean(record, "injected") ?? false,
    injectedCount: pickNumber(record, "injected_count", "injectedCount") ?? 0,
    memoryMode: toMemoryMode(pickNullableString(record, "memory_mode", "memoryMode")),
    requestedScopes: toScopes(pickStringArray(record, "requested_scopes", "requestedScopes")),
    selectedScopes: toScopes(pickStringArray(record, "selected_scopes", "selectedScopes")),
    keptRecordIds: pickStringArray(record, "kept_record_ids", "keptRecordIds", "selected_record_ids", "selectedRecordIds"),
    injectionReason: pickNullableString(record, "injection_reason", "injectionReason"),
    memorySummary: pickNullableString(record, "memory_summary", "memorySummary"),
    tokenEstimate: pickNumber(record, "token_estimate", "tokenEstimate") ?? null,
    trimmedRecordIds: pickStringArray(record, "trimmed_record_ids", "trimmedRecordIds"),
    trimReasons: pickStringArray(record, "trim_reasons", "trimReasons"),
    resultState: pickString(record, "result_state", "resultState") ?? "unknown",
    durationMs: pickNumber(record, "duration_ms", "durationMs") ?? null,
    createdAt: pickNullableString(record, "created_at", "createdAt")
  };
}

function mapWriteBackRun(value: unknown): RuntimeWritebackRecord | null {
  const record = asRecord(value);

  if (!record) {
    return null;
  }

  return {
    traceId: pickString(record, "trace_id", "traceId") ?? "unknown-trace",
    memoryMode: toMemoryMode(pickNullableString(record, "memory_mode", "memoryMode")),
    candidateCount: pickNumber(record, "candidate_count", "candidateCount") ?? 0,
    submittedCount: pickNumber(record, "submitted_count", "submittedCount") ?? 0,
    submittedJobIds: pickStringArray(record, "submitted_job_ids", "submittedJobIds"),
    candidateSummaries: pickStringArray(record, "candidate_summaries", "candidateSummaries"),
    scopeDecisions: pickArray(record, "scope_decisions", "scopeDecisions")
      .map((item) => {
        const scopeRecord = asRecord(item);

        if (!scopeRecord) {
          return null;
        }

        const scope = toScopes([pickString(scopeRecord, "scope") ?? ""])[0];

        if (!scope) {
          return null;
        }

        return {
          scope,
          count: pickNumber(scopeRecord, "count") ?? 0,
          reason: pickString(scopeRecord, "reason") ?? "No scope decision reason recorded."
        };
      })
      .filter((item): item is { scope: "session" | "task" | "user" | "workspace"; count: number; reason: string } => Boolean(item)),
    filteredCount: pickNumber(record, "filtered_count", "filteredCount") ?? 0,
    filteredReasons: pickStringArray(record, "filtered_reasons", "filteredReasons"),
    resultState: pickString(record, "result_state", "resultState") ?? "unknown",
    degraded: pickBoolean(record, "degraded") ?? false,
    degradationReason: pickNullableString(record, "degradation_reason", "degradationReason"),
    durationMs: pickNumber(record, "duration_ms", "durationMs") ?? null,
    createdAt: pickNullableString(record, "created_at", "createdAt")
  };
}

function mapDependencyStatus(value: unknown): RuntimeDependencyRecord[] {
  const record = asRecord(value);

  if (!record) {
    return [];
  }

  return Object.entries(record)
    .map(([name, payload]) => {
      const dependency = asRecord(payload);

      if (!dependency) {
        return null;
      }

      return {
        name,
        status: pickString(dependency, "status") ?? "unknown",
        detail: pickString(dependency, "detail") ?? "No detail available.",
        checkedAt:
          pickString(dependency, "last_checked_at", "lastCheckedAt") ?? new Date(0).toISOString()
      };
    })
    .filter(isDefined);
}

export async function fetchRuntimeMetrics() {
  const { values } = getAppConfig();
  const response = await fetchJsonFromSource<unknown>({
    sourceName: "runtime_api",
    sourceLabel: "Runtime observe API",
    url: values.RUNTIME_API_BASE_URL
      ? `${values.RUNTIME_API_BASE_URL}/v1/runtime/observe/metrics`
      : undefined,
    timeoutMs: values.RUNTIME_API_TIMEOUT_MS
  });

  if (!response.ok || !response.data) {
    return {
      status: response.status,
      metrics: null as RuntimeMetricsSnapshot | null
    };
  }

  const record = asRecord(unwrapData(response.data));

  if (!record) {
    return {
      status: {
        ...response.status,
        status: "partial" as const,
        lastError: "Upstream returned a non-object payload.",
        detail: "Upstream returned a non-object payload."
      },
      metrics: null
    };
  }

  return {
    status: response.status,
    metrics: {
      triggerRate: readMetric(record, ["trigger_rate", "triggerRate"]),
      recallHitRate: readMetric(record, ["recall_hit_rate", "recallHitRate"]),
      emptyRecallRate: readMetric(record, ["empty_recall_rate", "emptyRecallRate"]),
      injectionRate: readMetric(record, ["injection_rate", "actual_injection_rate", "injectionRate"]),
      trimRate: readMetric(record, ["injection_trim_rate", "trimRate"]),
      recallP95Ms: readMetric(record, ["query_p95_ms", "recallP95Ms"]),
      injectionP95Ms: readMetric(record, ["injection_p95_ms", "injectionP95Ms"]),
      writeBackSubmitRate: readMetric(record, [
        "writeback_submission_rate",
        "write_back_submit_rate",
        "writeBackSubmitRate"
      ])
    }
  };
}

export async function fetchRuntimeRuns(query: string) {
  const { values } = getAppConfig();
  const url = values.RUNTIME_API_BASE_URL
    ? `${values.RUNTIME_API_BASE_URL}/v1/runtime/observe/runs${query ? `?${query}` : ""}`
    : undefined;

  const response = await fetchJsonFromSource<unknown>({
    sourceName: "runtime_api",
    sourceLabel: "Runtime observe API",
    url,
    timeoutMs: values.RUNTIME_API_TIMEOUT_MS
  });

  if (!response.ok || !response.data) {
    return {
      status: response.status,
      data: {
        turns: [],
        triggerRuns: [],
        recallRuns: [],
        injectionRuns: [],
        writeBackRuns: [],
        dependencyStatus: []
      } satisfies RuntimeObserveRunsSnapshot
    };
  }

  const root = asRecord(unwrapData(response.data));

  if (!root) {
    return {
      status: {
        ...response.status,
        status: "partial" as const,
        lastError: "Upstream returned a non-object payload.",
        detail: "Upstream returned a non-object payload."
      },
      data: {
        turns: [],
        triggerRuns: [],
        recallRuns: [],
        injectionRuns: [],
        writeBackRuns: [],
        dependencyStatus: []
      } satisfies RuntimeObserveRunsSnapshot
    };
  }

  return {
    status: response.status,
    data: normalizeRuntimeRunsPayload(root)
  };
}
