import { clamp } from "../shared/utils.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceIntegerInRange(value: unknown, min: number, max: number): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clamp(Math.round(value), min, max);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return clamp(Math.round(parsed), min, max);
    }
  }

  return undefined;
}

function withNormalizedIntegerField(
  payload: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
): Record<string, unknown> {
  const next = { ...payload };
  const normalized = coerceIntegerInRange(next[field], min, max);
  if (normalized === undefined) {
    delete next[field];
    return next;
  }

  next[field] = normalized;
  return next;
}

export function normalizeRecallSearchResponse(payload: unknown): unknown {
  if (!isPlainObject(payload)) {
    return payload;
  }

  return withNormalizedIntegerField(
    withNormalizedIntegerField(payload, "importance_threshold", 1, 5),
    "candidate_limit",
    1,
    50,
  );
}

export function normalizeRecallInjectionResponse(payload: unknown): unknown {
  if (!isPlainObject(payload)) {
    return payload;
  }

  return withNormalizedIntegerField(payload, "importance_threshold", 1, 5);
}

export function normalizeEvolutionPlanResponse(payload: unknown): unknown {
  if (!isPlainObject(payload)) {
    return payload;
  }

  const next = { ...payload };

  if (Array.isArray(next.source_records)) {
    next.source_records = next.source_records.filter((item) => typeof item === "string" && item.trim().length > 0);
  }

  if (isPlainObject(next.extracted_knowledge)) {
    const extractedKnowledge = { ...next.extracted_knowledge };
    const suggestedImportance = coerceIntegerInRange(extractedKnowledge.suggested_importance, 1, 5);
    if (suggestedImportance !== undefined) {
      extractedKnowledge.suggested_importance = suggestedImportance;
    }
    const evidenceCount = coerceIntegerInRange(extractedKnowledge.evidence_count, 1, Number.MAX_SAFE_INTEGER);
    if (evidenceCount !== undefined) {
      extractedKnowledge.evidence_count = evidenceCount;
    }
    next.extracted_knowledge = extractedKnowledge;
  }

  if (isPlainObject(next.consolidation_plan)) {
    const consolidationPlan = { ...next.consolidation_plan };
    const archiveIds = Array.isArray(consolidationPlan.records_to_archive)
      ? consolidationPlan.records_to_archive.filter((item) => typeof item === "string" && item.trim().length > 0)
      : [];

    if (typeof consolidationPlan.new_summary !== "string" || consolidationPlan.new_summary.trim().length === 0 || archiveIds.length === 0) {
      delete next.consolidation_plan;
      return next;
    }

    consolidationPlan.records_to_archive = archiveIds;
    next.consolidation_plan = consolidationPlan;
  }

  return next;
}
