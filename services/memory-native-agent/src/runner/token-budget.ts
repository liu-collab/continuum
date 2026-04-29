import type { ProviderConfig } from "../config/index.js";
import type { ChatMessage, ToolSchema } from "../providers/types.js";

const CHARS_PER_TOKEN = 4;
const MESSAGE_OVERHEAD_TOKENS = 6;
const TOOL_CALL_OVERHEAD_TOKENS = 12;
const MIN_TRUNCATED_MESSAGE_TOKENS = 48;

export interface TokenBudgetSettings {
  maxTokens: number | null;
  reserveTokens: number;
  compactionStrategy: "truncate" | "summarize";
  toolTokenEstimate?: number;
}

export function resolveContextMaxTokens(provider: ProviderConfig): number {
  switch (provider.kind) {
    case "anthropic":
      return 200_000;
    case "openai-compatible":
      if (/gpt-4\.1|gpt-4o|o3|o4/i.test(provider.model)) {
        return 128_000;
      }
      if (/deepseek/i.test(provider.model)) {
        return 64_000;
      }
      return 32_000;
    case "record-replay":
      return 32_000;
    case "ollama":
      if (/32b|70b|72b|qwen3|llama-3\.3/i.test(provider.model)) {
        return 32_000;
      }
      return 16_000;
    default:
      return 8_192;
  }
}

export function estimateMessageTokens(message: ChatMessage): number {
  let total = MESSAGE_OVERHEAD_TOKENS + estimateTextTokens(message.content);

  if (message.tool_calls && message.tool_calls.length > 0) {
    total += message.tool_calls.reduce((sum, call) => (
      sum
      + TOOL_CALL_OVERHEAD_TOKENS
      + estimateTextTokens(call.id)
      + estimateTextTokens(call.name)
      + estimateTextTokens(JSON.stringify(call.args))
    ), 0);
  }

  if (message.tool_call_id) {
    total += estimateTextTokens(message.tool_call_id);
  }

  return total;
}

export function estimateToolTokens(tools: ToolSchema[]): number {
  return tools.reduce((sum, tool) => (
    sum
    + MESSAGE_OVERHEAD_TOKENS
    + estimateTextTokens(tool.name)
    + estimateTextTokens(tool.description)
    + estimateTextTokens(JSON.stringify(tool.parameters))
  ), 0);
}

export function compactMessages(
  fixedMessages: ChatMessage[],
  historyMessages: ChatMessage[],
  settings: TokenBudgetSettings,
): ChatMessage[] {
  if (settings.maxTokens === null) {
    return [...fixedMessages, ...historyMessages];
  }

  const promptBudget = Math.max(
    settings.maxTokens - settings.reserveTokens - (settings.toolTokenEstimate ?? 0),
    MIN_TRUNCATED_MESSAGE_TOKENS,
  );
  const fixedTokens = fixedMessages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
  let remaining = promptBudget - fixedTokens;

  if (remaining <= 0) {
    return fixedMessages;
  }

  const kept: ChatMessage[] = [];
  const dropped: ChatMessage[] = [];

  for (let index = historyMessages.length - 1; index >= 0; index -= 1) {
    const message = historyMessages[index];
    if (!message) {
      continue;
    }

    const cost = estimateMessageTokens(message);
    if (cost <= remaining) {
      kept.push(message);
      remaining -= cost;
      continue;
    }

    if (kept.length === 0) {
      const truncated = truncateMessageToBudget(message, remaining);
      if (truncated) {
        kept.push(truncated);
        remaining -= estimateMessageTokens(truncated);
      }
    }

    dropped.push(message);
  }

  const orderedKept = kept.reverse();
  if (dropped.length > 0 && settings.compactionStrategy === "summarize") {
    const summary = buildDroppedSummary(dropped.reverse());
    const summaryCost = estimateMessageTokens(summary);

    while (orderedKept.length > 0 && summaryCost > remaining) {
      const removed = orderedKept.shift();
      if (!removed) {
        break;
      }
      remaining += estimateMessageTokens(removed);
    }

    if (summaryCost <= remaining) {
      orderedKept.unshift(summary);
    }
  }

  return [...fixedMessages, ...orderedKept];
}

function estimateTextTokens(content: string): number {
  return Math.ceil(content.length / CHARS_PER_TOKEN);
}

export function truncateMessageToBudget(message: ChatMessage, tokenBudget: number): ChatMessage | null {
  if (tokenBudget < MIN_TRUNCATED_MESSAGE_TOKENS) {
    return null;
  }

  const contentBudget = Math.max((tokenBudget - MESSAGE_OVERHEAD_TOKENS) * CHARS_PER_TOKEN, 32);
  if (message.content.length <= contentBudget) {
    return message;
  }

  const marker = "[truncated earlier content]\n";
  const availableChars = Math.max(contentBudget - marker.length, 16);

  return {
    ...message,
    content: `${marker}${message.content.slice(-availableChars)}`,
  };
}

function buildDroppedSummary(messages: ChatMessage[]): ChatMessage {
  const lines = messages
    .slice(-6)
    .map((message) => {
      const content = message.content.replace(/\s+/g, " ").trim();
      const preview = content.length > 160 ? `${content.slice(0, 157)}...` : content;
      return `- ${message.role}: ${preview || "(empty)"}`;
    });

  return {
    role: "system",
    content: [
      "Earlier conversation was compacted to stay within the context budget.",
      "Recent dropped summary:",
      ...lines,
    ].join("\n"),
  };
}
