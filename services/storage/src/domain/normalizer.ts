import { createHash } from "node:crypto";

import type { NormalizedMemory, WriteBackCandidate } from "../contracts.js";
import { computeDefaultConfidence, computeDefaultImportance } from "./scoring.js";

export function normalizeCandidate(candidate: WriteBackCandidate): NormalizedMemory {
  const normalizedSummary = normalizeText(candidate.summary);
  const normalizedDetails = normalizeDetails(candidate.details);
  const dedupeKey = buildDedupeKey(candidate, normalizedDetails);

  return {
    ...candidate,
    user_id: candidate.user_id ?? null,
    task_id: candidate.task_id ?? null,
    session_id: candidate.session_id ?? null,
    source: {
      ...candidate.source,
      confirmed_by_user: candidate.source.confirmed_by_user ?? false,
    },
    summary: normalizedSummary,
    details: normalizedDetails,
    memory_type: candidate.candidate_type,
    importance: candidate.importance ?? computeDefaultImportance(candidate),
    confidence: candidate.confidence ?? computeDefaultConfidence(candidate),
    dedupe_key: dedupeKey,
    source_type: candidate.source.source_type,
    source_ref: candidate.source.source_ref,
    source_service: candidate.source.service_name,
    candidate_hash: createContentHash({
      candidate_type: candidate.candidate_type,
      scope: candidate.scope,
      summary: normalizedSummary,
      details: normalizedDetails,
      source_ref: candidate.source.source_ref,
      write_reason: candidate.write_reason,
    }),
  };
}

function buildDedupeKey(
  candidate: WriteBackCandidate,
  details: Record<string, unknown>,
): string {
  if (candidate.candidate_type === "task_state") {
    const stateKey = stringOrFallback(details.state_key, candidate.summary);
    return `task_state:${candidate.task_id ?? "no-task"}:${normalizeText(stateKey)}`;
  }

  if (candidate.candidate_type === "episodic") {
    const eventKind = stringOrFallback(details.event_kind, "event");
    const timeBucket = stringOrFallback(
      details.time_bucket,
      new Date().toISOString().slice(0, 13),
    );
    return `episodic:${candidate.scope}:${normalizeText(eventKind)}:${normalizeText(timeBucket)}:${createContentHash(details).slice(0, 12)}`;
  }

  const subject = stringOrFallback(details.subject, candidate.summary);
  const predicate = stringOrFallback(details.predicate, candidate.write_reason);

  return `fact_preference:${candidate.scope}:${normalizeText(subject)}:${normalizeSemanticPredicate(predicate)}`;
}

function normalizeDetails(details: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => {
      if (typeof value === "string") {
        return [key, normalizeText(value)];
      }

      return [key, value];
    }),
  );
}

function normalizeText(input: string): string {
  return input.trim().replace(/\s+/g, " ").toLowerCase();
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function createContentHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeSemanticPredicate(input: string): string {
  return normalizeText(input)
    .replace(/\b(do not|don't|not|dislike|avoid|hate)\b/g, "")
    .replace(/\b(prefers|prefer|likes|like|love|loves|wants|want)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
