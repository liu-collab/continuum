import { randomUUID } from "node:crypto";

import type { ExecutionPlan, PlanStep } from "./types.js";

const SPLIT_PATTERNS = /(?:，|,|然后|并且|并|再|之后|最后|and then|then|after that)/i;

export function shouldGeneratePlan(userInput: string): boolean {
  if (/规划|方案|一步一步|step[- ]by[- ]step|plan|approach|设计/i.test(userInput)) {
    return true;
  }

  return userInput.split(SPLIT_PATTERNS).filter((part) => part.trim().length > 0).length >= 3;
}

export function generateExecutionPlan(input: {
  sessionId: string;
  turnId: string;
  goal: string;
  existingPlan?: ExecutionPlan | null;
  revisionReason?: string;
}): ExecutionPlan {
  const createdAt = input.existingPlan?.created_at ?? new Date().toISOString();
  const steps = deriveSteps(input.goal, input.existingPlan?.steps ?? []);

  return {
    id: input.existingPlan?.id ?? randomUUID(),
    session_id: input.sessionId,
    turn_id: input.turnId,
    goal: input.goal.trim(),
    status: input.existingPlan ? "revised" : "draft",
    steps,
    created_at: createdAt,
    updated_at: new Date().toISOString(),
    revision_reason: input.revisionReason,
  };
}

function deriveSteps(goal: string, existingSteps: PlanStep[]): PlanStep[] {
  const rawSteps = goal
    .split(SPLIT_PATTERNS)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .slice(0, 6);

  if (rawSteps.length === 0) {
    return [{
      id: randomUUID(),
      title: goal.trim().slice(0, 80) || "处理当前任务",
      status: "pending",
    }];
  }

  return rawSteps.map((title, index) => {
    const existing = existingSteps[index];
    if (existing && (existing.status === "completed" || existing.status === "failed")) {
      return existing;
    }

    return {
      id: existing?.id ?? randomUUID(),
      title: normalizeStepTitle(title),
      status: existing?.status ?? "pending",
    };
  });
}

function normalizeStepTitle(value: string) {
  return value.replace(/^[:：,\-\s]+/, "").slice(0, 80) || "处理子任务";
}
