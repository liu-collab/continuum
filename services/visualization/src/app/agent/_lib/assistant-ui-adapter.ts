"use client";

import type {
  AppendMessage,
  ExternalStoreAdapter,
  MessageStatus,
  ThreadAssistantMessage,
  ThreadAssistantMessagePart,
  ThreadMessage
} from "@assistant-ui/react";
import type { ReadonlyJSONObject, ReadonlyJSONValue } from "assistant-stream/utils";

import type { AgentTurnState, AgentToolCallState } from "./event-reducer";

export type AxisToolCallArtifact = {
  status: AgentToolCallState["status"];
  argsPreview: string;
  outputPreview: string;
  trustLevel: AgentToolCallState["trustLevel"];
  artifactRef: string | null;
};

export type AxisAssistantCustomMeta = {
  kind: "axis";
  role: "user" | "assistant";
  turnId: string;
  finishReason: AgentTurnState["finishReason"];
  promptAvailable: boolean;
  injection: AgentTurnState["injection"];
  phases: AgentTurnState["phases"];
  errors: AgentTurnState["errors"];
  taskLabel: AgentTurnState["taskLabel"];
  plan: AgentTurnState["plan"];
  evaluations: AgentTurnState["evaluations"];
  traceSpans: AgentTurnState["traceSpans"];
};

type CreateAxisThreadStoreInput = {
  turns: AgentTurnState[];
  isRunning: boolean;
  onSend(text: string): void;
  onAbort(): void;
};

export function createAxisThreadStore({
  turns,
  isRunning,
  onSend,
  onAbort
}: CreateAxisThreadStoreInput): ExternalStoreAdapter<ThreadMessage> {
  return {
    messages: turns.flatMap((turn, index) => createTurnMessages(turn, index)),
    isRunning,
    onNew: async (message) => {
      const text = extractAppendMessageText(message);
      if (!text) {
        return;
      }
      onSend(text);
    },
    onCancel: async () => {
      onAbort();
    }
  };
}

function createTurnMessages(turn: AgentTurnState, index: number): ThreadMessage[] {
  const createdAt = new Date(index * 1000);
  const commonMeta = {
    kind: "axis" as const,
    turnId: turn.turnId,
    finishReason: turn.finishReason,
    promptAvailable: turn.promptAvailable,
    injection: turn.injection,
    phases: turn.phases,
    errors: turn.errors,
    taskLabel: turn.taskLabel,
    plan: turn.plan,
    evaluations: turn.evaluations,
    traceSpans: turn.traceSpans
  };

  return [
    {
      id: `${turn.turnId}:user`,
      role: "user",
      createdAt,
      content: [{ type: "text", text: turn.userInput }],
      attachments: [],
      metadata: {
        custom: {
          axis: {
            ...commonMeta,
            role: "user"
          } satisfies AxisAssistantCustomMeta
        }
      }
    },
    {
      id: `${turn.turnId}:assistant`,
      role: "assistant",
      createdAt,
      content: createAssistantContent(turn),
      status: createAssistantStatus(turn),
      metadata: {
        unstable_state: null,
        unstable_annotations: [],
        unstable_data: [],
        steps: [],
        custom: {
          axis: {
            ...commonMeta,
            role: "assistant"
          } satisfies AxisAssistantCustomMeta
        }
      }
    }
  ];
}

function createAssistantContent(turn: AgentTurnState): ThreadAssistantMessage["content"] {
  const content: ThreadAssistantMessagePart[] = [];

  if (turn.assistantOutput) {
    content.push({
      type: "text",
      text: turn.assistantOutput
    });
  }

  for (const call of turn.toolCalls) {
    content.push({
      type: "tool-call",
      toolCallId: call.callId,
      toolName: call.name,
      args: parseToolArgs(call.argsPreview),
      argsText: call.argsPreview,
      result:
        call.status === "pending"
          ? undefined
          : {
              ok: call.status === "ok",
              outputPreview: call.outputPreview
            },
      isError: call.status === "error",
      artifact: {
        status: call.status,
        argsPreview: call.argsPreview,
        outputPreview: call.outputPreview,
        trustLevel: call.trustLevel,
        artifactRef: call.artifactRef
      } satisfies AxisToolCallArtifact
    });
  }

  return content;
}

function createAssistantStatus(turn: AgentTurnState): MessageStatus {
  if (turn.status === "streaming") {
    return {
      type: "running"
    };
  }

  if (turn.status === "error" || turn.finishReason === "error" || turn.finishReason === "crashed") {
    return {
      type: "incomplete",
      reason: "error",
      error: turn.errors.at(-1)?.message ?? "unknown error"
    };
  }

  if (turn.finishReason === "abort") {
    return {
      type: "incomplete",
      reason: "cancelled"
    };
  }

  if (turn.finishReason === "length") {
    return {
      type: "incomplete",
      reason: "length"
    };
  }

  if (turn.finishReason === "tool_use" && turn.toolCalls.some((call) => call.status === "pending")) {
    return {
      type: "requires-action",
      reason: "tool-calls"
    };
  }

  return {
    type: "complete",
    reason: "stop"
  };
}

function extractAppendMessageText(message: AppendMessage) {
  return message.content
    .filter((part): part is Extract<AppendMessage["content"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
}

function parseToolArgs(value: string): ReadonlyJSONObject {
  try {
    const parsed = JSON.parse(value);
    if (isReadonlyJsonObject(parsed)) {
      return parsed;
    }
  } catch {
    // Keep a readable fallback when argsPreview is not valid JSON.
  }

  return {
    raw: value
  };
}

function isReadonlyJsonValue(value: unknown): value is ReadonlyJSONValue {
  if (value === null) {
    return true;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every((item) => isReadonlyJsonValue(item));
  }

  if (typeof value === "object") {
    return Object.values(value).every((item) => isReadonlyJsonValue(item));
  }

  return false;
}

function isReadonlyJsonObject(value: unknown): value is ReadonlyJSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && isReadonlyJsonValue(value);
}

export function readAxisMeta(message: ThreadMessage): AxisAssistantCustomMeta | null {
  const candidate = message.metadata.custom["axis"];
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const value = candidate as Partial<AxisAssistantCustomMeta>;
  if (value.kind !== "axis" || !value.turnId || !value.role) {
    return null;
  }

  return value as AxisAssistantCustomMeta;
}
