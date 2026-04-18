import { createHash } from "node:crypto";

import type { NormalizedMemory, WriteBackCandidate } from "../contracts.js";
import { computeDefaultConfidence, computeDefaultImportance } from "./scoring.js";

export function normalizeCandidate(candidate: WriteBackCandidate): NormalizedMemory {
  const normalizedSummary = normalizeText(candidate.summary);
  const normalizedDetails = normalizeDetails(candidate.details);
  const normalizedScope = classifyCandidateScope(candidate, normalizedDetails);
  const dedupeKey = buildDedupeKey(candidate, normalizedDetails, normalizedScope);

  return {
    ...candidate,
    user_id: candidate.user_id ?? null,
    task_id: candidate.task_id ?? null,
    session_id: candidate.session_id ?? null,
    scope: normalizedScope,
    source: {
      ...candidate.source,
      origin_workspace_id: candidate.source.origin_workspace_id ?? candidate.workspace_id,
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
      scope: normalizedScope,
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
  scope: WriteBackCandidate["scope"],
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
    return `episodic:${scope}:${normalizeText(eventKind)}:${normalizeText(timeBucket)}:${createContentHash(details).slice(0, 12)}`;
  }

  const subject = stringOrFallback(details.subject, candidate.summary);
  const predicate = stringOrFallback(details.predicate, candidate.write_reason);

  return `fact_preference:${scope}:${normalizeText(subject)}:${normalizeSemanticPredicate(predicate)}`;
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

export function classifyCandidateScope(
  candidate: WriteBackCandidate,
  details: Record<string, unknown>,
): WriteBackCandidate["scope"] {
  const explicitTaskSignals = hasAnyKey(details, [
    "state_key",
    "state_value",
    "next_step",
    "blocked_by",
  ]);
  const explicitSessionSignals = hasAnyKey(details, ["topic", "expires_hint"]);
  const explicitWorkspaceSignals = hasAnyKey(details, [
    "rule_kind",
    "rule_value",
    "repo_path",
  ]);
  const longTermSignals =
    stringOrFallback(details.stability, "").toLowerCase() === "long_term" ||
    hasAnyKey(details, ["subject", "predicate", "evidence"]);
  const signalText = normalizeText(
    [
      candidate.summary,
      candidate.write_reason,
      stringOrFallback(details.subject, ""),
      stringOrFallback(details.predicate, ""),
      stringOrFallback(details.rule_kind, ""),
      stringOrFallback(details.rule_value, ""),
      stringOrFallback(details.repo_path, ""),
      stringOrFallback(details.topic, ""),
    ]
      .filter(Boolean)
      .join(" "),
  );

  if (candidate.candidate_type === "task_state" || explicitTaskSignals) {
    return candidate.task_id ? "task" : "workspace";
  }

  if (
    explicitWorkspaceSignals ||
    containsAny(signalText, [
      "repo",
      "repository",
      "project",
      "workspace",
      "toolchain",
      "directory",
      "constraint",
      "rule",
    ])
  ) {
    return "workspace";
  }

  if (
    explicitSessionSignals ||
    containsAny(signalText, ["temporary", "session", "current turn", "expires"])
  ) {
    return candidate.session_id ? "session" : "workspace";
  }

  if (
    longTermSignals &&
    containsAny(signalText, [
      "prefer",
      "preference",
      "style",
      "habit",
      "long term",
      "constraint",
      "response",
      "user",
    ])
  ) {
    return "user";
  }

  if (candidate.scope === "task" && candidate.task_id) {
    return "task";
  }

  if (candidate.scope === "session" && candidate.session_id) {
    return "session";
  }

  if (candidate.scope === "workspace") {
    return "workspace";
  }

  if (candidate.scope === "user" && containsAny(signalText, ["repo", "project", "workspace"])) {
    return "workspace";
  }

  return candidate.scope === "user" ? "user" : "workspace";
}

function containsAny(input: string, patterns: string[]) {
  return patterns.some((pattern) => input.includes(pattern));
}

function hasAnyKey(details: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => details[key] !== undefined);
}
