import type { ExecutionPlan } from "./types.js";

export function markPlanRunning(plan: ExecutionPlan): ExecutionPlan {
  const next = structuredClone(plan);
  next.status = "running";
  next.updated_at = new Date().toISOString();

  const current = next.steps.find((step) => step.status === "in_progress");
  if (current) {
    return next;
  }

  const pending = next.steps.find((step) => step.status === "pending");
  if (pending) {
    pending.status = "in_progress";
  }

  return next;
}

export function advancePlanAfterTool(plan: ExecutionPlan, ok: boolean, note?: string): ExecutionPlan {
  const next = structuredClone(plan);
  next.updated_at = new Date().toISOString();

  const current = next.steps.find((step) => step.status === "in_progress");
  if (!current) {
    return next;
  }

  current.status = ok ? "completed" : "failed";
  if (note) {
    current.notes = note;
  }

  const nextPending = next.steps.find((step) => step.status === "pending");
  if (nextPending) {
    nextPending.status = "in_progress";
    next.status = "running";
    return next;
  }

  next.status = ok ? "completed" : "revised";
  return next;
}
