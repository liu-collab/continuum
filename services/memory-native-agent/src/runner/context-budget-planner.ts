import type { ChatMessage } from "../providers/types.js";
import type { PromptSegment, PromptSegmentPriority } from "./prompt-segments.js";
import {
  estimateMessageTokens,
  type TokenBudgetSettings,
  truncateMessageToBudget,
} from "./token-budget.js";

type DroppedSource = "history" | "memory" | "tool_output";
type DroppedReason = "budget" | "priority" | "duplicate" | "oversize";

export interface ContextBudgetPlan {
  budget: {
    total: number | null;
    reserve: number;
    available_for_prompt: number | null;
  };
  allocation: {
    fixed: number;
    memory: number;
    tools: number;
    history: number;
    current_turn: number;
  };
  keptMessages: ChatMessage[];
  keptSegments: PromptSegment[];
  dropped: Array<{
    source: DroppedSource;
    reason: DroppedReason;
    preview: string;
  }>;
}

export function planContextBudget(input: {
  segments: PromptSegment[];
  historyMessages: ChatMessage[];
  tokenBudget: TokenBudgetSettings;
}): ContextBudgetPlan {
  const availableForPrompt = input.tokenBudget.maxTokens === null
    ? null
    : Math.max(
        input.tokenBudget.maxTokens - input.tokenBudget.reserveTokens - (input.tokenBudget.toolTokenEstimate ?? 0),
        64,
      );

  const keptSegments: PromptSegment[] = [];
  const dropped: ContextBudgetPlan["dropped"] = [];
  let remaining = availableForPrompt;

  for (const segment of orderSegments(input.segments)) {
    const message: ChatMessage = {
      role: "system",
      content: segment.content,
    };
    const cost = estimateMessageTokens(message);
    if (remaining !== null && cost > remaining && segment.priority !== "fixed") {
      dropped.push({
        source: segment.kind.startsWith("memory") ? "memory" : "history",
        reason: "budget",
        preview: previewText(segment.content),
      });
      continue;
    }
    keptSegments.push(segment);
    if (remaining !== null) {
      remaining -= cost;
    }
  }

  const fixedMessages = keptSegments.map((segment) => ({
    role: "system" as const,
    content: segment.content,
  }));

  const keptHistory: ChatMessage[] = [];
  for (let index = input.historyMessages.length - 1; index >= 0; index -= 1) {
    const message = input.historyMessages[index];
    if (!message) {
      continue;
    }
    const cost = estimateMessageTokens(message);
    if (remaining === null || cost <= remaining) {
      keptHistory.push(message);
      if (remaining !== null) {
        remaining -= cost;
      }
      continue;
    }

    const truncated = remaining !== null ? truncateMessageToBudget(message, remaining) : null;
    if (truncated) {
      keptHistory.push(truncated);
      if (remaining !== null) {
        remaining -= estimateMessageTokens(truncated);
      }
      dropped.push({
        source: message.role === "tool" ? "tool_output" : "history",
        reason: "oversize",
        preview: previewText(message.content),
      });
      continue;
    }

    dropped.push({
      source: message.role === "tool" ? "tool_output" : "history",
      reason: "budget",
      preview: previewText(message.content),
    });
  }

  const orderedHistory = keptHistory.reverse();
  return {
    budget: {
      total: input.tokenBudget.maxTokens,
      reserve: input.tokenBudget.reserveTokens,
      available_for_prompt: availableForPrompt,
    },
    allocation: {
      fixed: sumTokens(fixedMessages.filter((_message, index) => keptSegments[index]?.priority === "fixed")),
      memory: sumTokens(fixedMessages.filter((_message, index) => keptSegments[index]?.kind.startsWith("memory"))),
      tools: sumTokens(orderedHistory.filter((message) => message.role === "tool")),
      history: sumTokens(orderedHistory.filter((message) => message.role !== "tool" && message.role !== "user")),
      current_turn: sumTokens(orderedHistory.filter((message) => message.role === "user").slice(-1)),
    },
    keptMessages: [...fixedMessages, ...orderedHistory],
    keptSegments,
    dropped,
  };
}

function orderSegments(segments: PromptSegment[]) {
  return [...segments].sort((left, right) => segmentPriorityWeight(left.priority) - segmentPriorityWeight(right.priority));
}

function segmentPriorityWeight(priority: PromptSegmentPriority) {
  switch (priority) {
    case "fixed":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    case "low":
    default:
      return 3;
  }
}

function previewText(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= 120 ? normalized : `${normalized.slice(0, 117)}...`;
}

function sumTokens(messages: ChatMessage[]) {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}
