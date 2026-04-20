import { createTaskId } from "./ids.js";

export interface TaskState {
  id: string;
  label: string;
  created_at: string;
  last_active_at: string;
}

export interface TaskChangeEvent {
  change: "start" | "switch" | "resume";
  task_id: string;
  label: string;
  previous_task_id?: string;
}

export interface TaskStateSnapshot {
  currentTask: TaskState | null;
  recentTasks: TaskState[];
}

const MAX_RECENT_TASKS = 10;

export function createTaskState(label: string, timestamp = new Date().toISOString()): TaskState {
  return {
    id: createTaskId(),
    label: normalizeTaskLabel(label),
    created_at: timestamp,
    last_active_at: timestamp,
  };
}

export function normalizeTaskLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").slice(0, 40) || "untitled task";
}

export function touchTask(task: TaskState, timestamp = new Date().toISOString()): TaskState {
  return {
    ...task,
    last_active_at: timestamp,
  };
}

export function upsertRecentTask(recentTasks: TaskState[], task: TaskState): TaskState[] {
  return [task, ...recentTasks.filter((item) => item.id !== task.id)].slice(0, MAX_RECENT_TASKS);
}

export function tokenizeForSimilarity(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .flatMap((part) => tokenizeSegment(part.trim()))
    .filter((part) => part.length >= 2);
}

export function jaccardSimilarity(left: string, right: string): number {
  const leftTokens = new Set(tokenizeForSimilarity(left));
  const rightTokens = new Set(tokenizeForSimilarity(right));

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }

  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

export function findClosestTask(recentTasks: TaskState[], input: string, threshold = 0.4): TaskState | null {
  let best: { task: TaskState; score: number } | null = null;

  for (const task of recentTasks) {
    const score = jaccardSimilarity(task.label, input);
    if (!best || score > best.score) {
      best = { task, score };
    }
  }

  if (!best || best.score < threshold) {
    return null;
  }

  return best.task;
}

function tokenizeSegment(input: string): string[] {
  if (!input) {
    return [];
  }

  if (!/[\u3400-\u9fff]/u.test(input)) {
    return [input];
  }

  const chars = [...input];
  if (chars.length < 2) {
    return chars;
  }

  const grams: string[] = [];
  for (let index = 0; index < chars.length - 1; index += 1) {
    const current = chars[index];
    const next = chars[index + 1];
    if (!current || !next) {
      continue;
    }
    grams.push(`${current}${next}`);
  }
  return grams;
}
