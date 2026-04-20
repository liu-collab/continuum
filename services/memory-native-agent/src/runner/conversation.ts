import type { ChatMessage } from "../providers/types.js";
import type { ToolTrustLevel } from "../tools/index.js";

export interface BuildMessagesInput {
  systemPrompt: string;
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
  readonly messages: ChatMessage[] = [];

  seed(messages: ChatMessage[]) {
    this.messages.push(...messages);
  }

  addMessage(message: ChatMessage) {
    this.messages.push(message);
  }

  buildMessages(input: BuildMessagesInput): ChatMessage[] {
    const built: ChatMessage[] = [
      {
        role: "system",
        content: input.systemPrompt,
      },
    ];

    for (const injection of input.injections) {
      built.push({
        role: "system",
        content: buildInjectionBlock(injection),
      });
    }

    built.push(...this.messages);
    return built;
  }

  shortSummary(): string {
    const recentUserMessages = this.messages
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
