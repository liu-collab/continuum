import type { ChatMessage } from "../providers/types.js";
import type { TaskState } from "./task-state.js";
import { jaccardSimilarity, normalizeTaskLabel } from "./task-state.js";

export interface ConversationLike {
  messages: ChatMessage[];
}

export interface DetectedTriggers {
  taskStart?: { label: string };
  taskSwitch?: { newLabel?: string };
  beforePlan?: boolean;
}

const TASK_START_PATTERNS = [
  /^(帮我|help me|let's|let me|我要|我想|请帮)/i,
  /(新任务[:：]|new task[:：]|start (a |new )?task)/i,
];

const TASK_SWITCH_PATTERNS = [
  /换个话题|换成|switch to|instead|actually.*(do|try)|换一下/i,
];

const BEFORE_PLAN_PATTERNS = [
  /规划|设计方案|怎么做|如何设计|plan|design|approach|strategy|step[- ]by[- ]step/i,
];

function looksLikeFirstMeaningfulInput(conversation: ConversationLike): boolean {
  const meaningfulUserMessages = conversation.messages.filter((message) => message.role === "user" && message.content.trim().length >= 4);
  return meaningfulUserMessages.length === 0;
}

function deriveTaskLabel(userInput: string): string {
  return normalizeTaskLabel(userInput.slice(0, 40));
}

export function detectTriggers(
  userInput: string,
  conversation: ConversationLike,
  currentTask: TaskState | null,
): DetectedTriggers {
  const normalizedInput = userInput.trim();
  const triggers: DetectedTriggers = {};

  const hitsTaskStart = TASK_START_PATTERNS.some((pattern) => pattern.test(normalizedInput))
    || (currentTask === null && looksLikeFirstMeaningfulInput(conversation) && normalizedInput.length >= 4);
  const hitsTaskSwitch = currentTask !== null && (
    TASK_SWITCH_PATTERNS.some((pattern) => pattern.test(normalizedInput))
    || jaccardSimilarity(currentTask.label, normalizedInput) < 0.15
  );
  const hitsBeforePlan = BEFORE_PLAN_PATTERNS.some((pattern) => pattern.test(normalizedInput))
    || (normalizedInput.includes("先") && normalizedInput.includes("再"));

  if (hitsTaskSwitch) {
    triggers.taskSwitch = {
      newLabel: hitsTaskStart ? deriveTaskLabel(normalizedInput) : undefined,
    };
  }

  if (hitsTaskStart) {
    triggers.taskStart = {
      label: deriveTaskLabel(normalizedInput),
    };
  }

  if (hitsBeforePlan) {
    triggers.beforePlan = true;
  }

  return triggers;
}
