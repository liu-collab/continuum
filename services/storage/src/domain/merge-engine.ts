import type { MemoryRecord, NormalizedMemory } from "../contracts.js";

export type MergeDecisionType =
  | "insert_new"
  | "update_existing"
  | "merge_existing"
  | "ignore_duplicate"
  | "open_conflict";

export interface MergeDecision {
  decision: MergeDecisionType;
  existing_record?: MemoryRecord;
  reason: string;
  merged_details?: Record<string, unknown>;
}

export function decideMerge(
  normalized: NormalizedMemory,
  candidates: MemoryRecord[],
): MergeDecision {
  const existing = candidates.find((record) => record.status !== "deleted");

  if (!existing) {
    return {
      decision: "insert_new",
      reason: "no existing record matched the dedupe key",
    };
  }

  if (normalized.memory_type === "task_state") {
    if (isSameState(existing, normalized)) {
      return {
        decision: "ignore_duplicate",
        existing_record: existing,
        reason: "same task state already active",
      };
    }

    return {
      decision: "update_existing",
      existing_record: existing,
      reason: "task state key matched and needs overwrite",
    };
  }

  if (normalized.memory_type === "episodic") {
    if (existing.summary === normalized.summary) {
      return {
        decision: "ignore_duplicate",
        existing_record: existing,
        reason: "same episodic summary already stored",
      };
    }

    return {
      decision: "merge_existing",
      existing_record: existing,
      reason: "episodic event falls into same time bucket and should merge",
      merged_details: {
        ...existing.details_json,
        ...normalized.details,
      },
    };
  }

  if (existing.summary === normalized.summary) {
    return {
      decision: "ignore_duplicate",
      existing_record: existing,
      reason: "same fact or preference already active",
    };
  }

  if (isOppositeFact(existing, normalized)) {
    return {
      decision: "open_conflict",
      existing_record: existing,
      reason: "new fact or preference conflicts with existing record",
    };
  }

  return {
    decision: "update_existing",
    existing_record: existing,
    reason: "fact or preference is stronger and should update existing record",
  };
}

function isSameState(existing: MemoryRecord, normalized: NormalizedMemory): boolean {
  const existingState = String(existing.details_json.state_value ?? existing.summary);
  const nextState = String(normalized.details.state_value ?? normalized.summary);
  return existingState === nextState;
}

function isOppositeFact(existing: MemoryRecord, normalized: NormalizedMemory): boolean {
  const existingPolarity = polarity(existing.summary);
  const nextPolarity = polarity(normalized.summary);

  return (
    existingPolarity !== "neutral" &&
    nextPolarity !== "neutral" &&
    existingPolarity !== nextPolarity
  );
}

function polarity(value: string): "positive" | "negative" | "neutral" {
  const normalized = value.toLowerCase();

  if (
    normalized.includes("not ") ||
    normalized.includes("don't ") ||
    normalized.includes("do not ") ||
    normalized.includes("dislike") ||
    normalized.includes("avoid")
  ) {
    return "negative";
  }

  if (
    normalized.includes("prefer") ||
    normalized.includes("like") ||
    normalized.includes("love") ||
    normalized.includes("want")
  ) {
    return "positive";
  }

  return "neutral";
}
