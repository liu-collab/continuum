import type { ConflictType, MemoryRecord, NormalizedMemory } from "../contracts.js";

export interface ConflictDecision {
  conflict_type: ConflictType;
  summary: string;
  should_mark_pending_confirmation: boolean;
  can_auto_supersede: boolean;
}

export function evaluateConflict(
  existing: MemoryRecord,
  normalized: NormalizedMemory,
): ConflictDecision {
  if (normalized.confidence > existing.confidence && normalized.source.confirmed_by_user) {
    return {
      conflict_type: deriveConflictType(existing, normalized),
      summary: `newer confirmed memory supersedes existing record ${existing.id}`,
      should_mark_pending_confirmation: false,
      can_auto_supersede: true,
    };
  }

  return {
    conflict_type: deriveConflictType(existing, normalized),
    summary: `memory ${existing.id} conflicts with incoming candidate ${normalized.dedupe_key}`,
    should_mark_pending_confirmation: true,
    can_auto_supersede: false,
  };
}

function deriveConflictType(
  existing: MemoryRecord,
  normalized: NormalizedMemory,
): ConflictType {
  if (existing.scope !== normalized.scope) {
    return "scope_conflict";
  }

  if (normalized.memory_type === "preference") {
    return "preference_conflict";
  }

  return "fact_conflict";
}
