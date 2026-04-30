import type { MemoryRecord, NormalizedMemory } from "../contracts.js";
import {
  canonicalizePreference,
  isConflictingPreference,
  isSamePreference,
} from "./preference.js";

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

  if (normalized.memory_type === "preference") {
    if (isSamePreferenceRecord(existing, normalized)) {
      return {
        decision: "ignore_duplicate",
        existing_record: existing,
        reason: "same preference already active",
      };
    }

    if (isOppositePreference(existing, normalized)) {
      return {
        decision: "open_conflict",
        existing_record: existing,
        reason: "new preference conflicts with existing record",
      };
    }

    return {
      decision: "update_existing",
      existing_record: existing,
      reason: "preference is stronger and should update existing record",
    };
  }

  if (isSameFact(existing, normalized)) {
    return {
      decision: "ignore_duplicate",
      existing_record: existing,
      reason: "same fact already active",
    };
  }

  if (isOppositeFact(existing, normalized)) {
    return {
      decision: "open_conflict",
      existing_record: existing,
      reason: "new fact conflicts with existing record",
    };
  }

  return {
    decision: "update_existing",
    existing_record: existing,
    reason: "fact is stronger and should update existing record",
  };
}

function isSameState(existing: MemoryRecord, normalized: NormalizedMemory): boolean {
  const existingState = String(existing.details_json.state_value ?? existing.summary);
  const nextState = String(normalized.details.state_value ?? normalized.summary);
  return existingState === nextState;
}

function isOppositePreference(existing: MemoryRecord, normalized: NormalizedMemory): boolean {
  const existingPreference = canonicalizePreference({
    summary: existing.summary,
    details: existing.details_json,
  });
  const nextPreference = canonicalizePreference({
    summary: normalized.summary,
    details: normalized.details,
  });

  return isConflictingPreference(existingPreference, nextPreference);
}

function isSamePreferenceRecord(existing: MemoryRecord, normalized: NormalizedMemory): boolean {
  const existingPreference = canonicalizePreference({
    summary: existing.summary,
    details: existing.details_json,
  });
  const nextPreference = canonicalizePreference({
    summary: normalized.summary,
    details: normalized.details,
  });

  return isSamePreference(existingPreference, nextPreference);
}

function isOppositeFact(existing: MemoryRecord, normalized: NormalizedMemory): boolean {
  const existingPredicate = String(existing.details_json.predicate ?? existing.summary);
  const nextPredicate = String(normalized.details.predicate ?? normalized.summary);
  return normalizeFactPredicate(existingPredicate) === normalizeFactPredicate(nextPredicate) &&
    inferFactPolarity(existingPredicate) !== inferFactPolarity(nextPredicate);
}

function isSameFact(existing: MemoryRecord, normalized: NormalizedMemory): boolean {
  const existingPredicate = String(existing.details_json.predicate ?? existing.summary);
  const nextPredicate = String(normalized.details.predicate ?? normalized.summary);
  return existingPredicate === nextPredicate;
}

function normalizeFactPredicate(input: string): string {
  return input
    .toLowerCase()
    .replace(/\b(do not|don't|not|false|disabled|disable|no)\b/g, "")
    .replace(/不|未|没有|禁用|关闭/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferFactPolarity(input: string): "positive" | "negative" {
  const normalized = input.toLowerCase();
  return /\b(do not|don't|not|false|disabled|disable|no)\b/.test(normalized) ||
    /不|未|没有|禁用|关闭/.test(input)
    ? "negative"
    : "positive";
}
