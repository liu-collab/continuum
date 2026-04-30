import type { WriteBackCandidate } from "../contracts.js";

export function computeDefaultConfidence(candidate: WriteBackCandidate): number {
  if (candidate.source.confirmed_by_user) {
    return 0.9;
  }

  if (candidate.candidate_type === "task_state") {
    return 0.7;
  }

  if (candidate.candidate_type === "preference") {
    return 0.8;
  }

  if (candidate.candidate_type === "fact") {
    return 0.75;
  }

  return 0.5;
}

export function computeDefaultImportance(candidate: WriteBackCandidate): number {
  if (candidate.candidate_type === "preference") {
    return candidate.scope === "user" || candidate.scope === "workspace" ? 5 : 4;
  }

  if (candidate.candidate_type === "fact") {
    return candidate.scope === "workspace" ? 5 : 4;
  }

  if (candidate.candidate_type === "task_state") {
    return 3;
  }

  return 2;
}
