import type { ChatMessage } from "../providers/types.js";
import type { ToolTrustLevel } from "../tools/index.js";
import { compactMessages, type TokenBudgetSettings } from "./token-budget.js";

const MAX_RECENT_MESSAGES = 48;
const TARGET_RECENT_MESSAGES = 32;
const ARCHIVED_SUMMARY_MAX_CHARS = 2_000;
const ARCHIVED_SUMMARY_PREVIEW_COUNT = 10;

export interface BuildMessagesInput {
  systemPrompt: string;
  tools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  tokenBudget?: TokenBudgetSettings;
  injections: Array<{
    phase: string;
    injection_reason: string;
    memory_summary: string;
    memory_records: Array<{
      id: string;
      memory_type: string;
      scope: string;
      summary: string;
      importance: number;
      confidence: number;
    }>;
  }>;
}

export class Conversation {
  private recentMessages: ChatMessage[] = [];
  private archivedSummary: string | null = null;

  get messages(): ChatMessage[] {
    return [...this.recentMessages];
  }

  seed(messages: ChatMessage[]) {
    this.recentMessages.push(...messages);
    this.compactIfNeeded();
  }

  addMessage(message: ChatMessage) {
    this.recentMessages.push(message);
    this.compactIfNeeded();
  }

  buildMessages(input: BuildMessagesInput): ChatMessage[] {
    const fixedMessages: ChatMessage[] = [
      {
        role: "system",
        content: input.systemPrompt,
      },
    ];

    for (const injection of input.injections) {
      fixedMessages.push({
        role: "system",
        content: buildInjectionBlock(injection),
      });
    }

    const archivedSummaryMessage = this.buildArchivedSummaryMessage();
    if (archivedSummaryMessage) {
      fixedMessages.push(archivedSummaryMessage);
    }

    return compactMessages(
      fixedMessages,
      this.recentMessages,
      {
        maxTokens: input.tokenBudget?.maxTokens ?? null,
        reserveTokens: input.tokenBudget?.reserveTokens ?? 4_096,
        compactionStrategy: input.tokenBudget?.compactionStrategy ?? "truncate",
        toolTokenEstimate: input.tokenBudget?.toolTokenEstimate,
      },
    );
  }

  shortSummary(): string {
    const recentUserMessages = this.recentMessages
      .filter((message) => message.role === "user")
      .slice(-4)
      .map((message) => message.content.trim())
      .filter(Boolean)
      .join("\n");

    return recentUserMessages.slice(0, 500);
  }

  wrapToolOutput(toolName: string, callId: string, trustLevel: ToolTrustLevel, rawOutput: string): string {
    return `<tool_output tool="${toolName}" call_id="${callId}" trust="${trustLevel}">\n${escapeToolOutput(rawOutput)}\n</tool_output>`;
  }

  private compactIfNeeded() {
    while (this.recentMessages.length > MAX_RECENT_MESSAGES) {
      const archiveCount = Math.max(this.recentMessages.length - TARGET_RECENT_MESSAGES, 1);
      const archivedBatch = this.recentMessages.slice(0, archiveCount);
      this.recentMessages = this.recentMessages.slice(archiveCount);
      this.archivedSummary = mergeArchivedSummary(this.archivedSummary, archivedBatch);
    }
  }

  private buildArchivedSummaryMessage(): ChatMessage | null {
    if (!this.archivedSummary) {
      return null;
    }

    return {
      role: "system",
      content: [
        "<conversation_history_summary>",
        "Earlier messages were compacted to keep the live conversation window bounded.",
        this.archivedSummary,
        "</conversation_history_summary>",
      ].join("\n"),
    };
  }
}

function buildInjectionBlock(injection: BuildMessagesInput["injections"][number]): string {
  const records = injection.memory_records
    .map((record) =>
      `- [${record.memory_type}/${record.scope}] ${record.summary} (importance=${record.importance}, confidence=${record.confidence})`,
    )
    .join("\n");

  return [
    `<memory_injection phase="${injection.phase}">`,
    `injection_reason: ${injection.injection_reason}`,
    `memory_summary: ${injection.memory_summary}`,
    `memory_records:`,
    records || "- none",
    "</memory_injection>",
  ].join("\n");
}

function escapeToolOutput(value: string): string {
  return value.replaceAll("</tool_output>", "&lt;/tool_output&gt;");
}

function mergeArchivedSummary(existingSummary: string | null, messages: ChatMessage[]): string {
  const nextLines = messages
    .slice(-ARCHIVED_SUMMARY_PREVIEW_COUNT)
    .map((message) => summarizeArchivedMessage(message));

  const parts = [
    existingSummary?.trim(),
    nextLines.length > 0 ? "Recent archived snippets:" : null,
    nextLines.join("\n"),
  ].filter((value): value is string => Boolean(value && value.trim()));

  const merged = parts.join("\n");
  if (merged.length <= ARCHIVED_SUMMARY_MAX_CHARS) {
    return merged;
  }

  return [
    "(older archived summary trimmed)",
    merged.slice(-(ARCHIVED_SUMMARY_MAX_CHARS - "(older archived summary trimmed)\n".length)),
  ].join("\n");
}

function summarizeArchivedMessage(message: ChatMessage): string {
  const content = message.content.replace(/\s+/g, " ").trim();
  const preview = content.length > 180 ? `${content.slice(0, 177)}...` : content || "(empty)";

  if (message.tool_calls && message.tool_calls.length > 0) {
    const toolNames = message.tool_calls.map((call) => call.name).join(", ");
    return `- ${message.role}: ${preview} [tool_calls=${toolNames}]`;
  }

  if (message.tool_call_id) {
    return `- ${message.role}: ${preview} [tool_call_id=${message.tool_call_id}]`;
  }

  return `- ${message.role}: ${preview}`;
}
