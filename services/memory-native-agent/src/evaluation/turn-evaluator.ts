import type { ToolResult } from "../tools/types.js";

export interface EvaluationDecision {
  status: "pass" | "retry" | "revise" | "ask_user" | "stop";
  reason: string;
  retry_strategy?: "same_tool" | "alternative_tool" | "replan" | "narrow_scope";
}

export function evaluateToolResult(input: {
  toolName: string;
  toolResult: ToolResult;
  repeatedFailure: boolean;
}): EvaluationDecision {
  if (input.toolResult.ok) {
    return {
      status: "pass",
      reason: "tool_ok",
    };
  }

  if (input.repeatedFailure) {
    return {
      status: "revise",
      reason: "repeated_tool_failure",
      retry_strategy: "replan",
    };
  }

  if (input.toolResult.error?.code === "tool_denied" || input.toolResult.error?.code === "tool_confirm_timeout") {
    return {
      status: "ask_user",
      reason: input.toolResult.error.code,
    };
  }

  if (input.toolResult.error?.code === "tool_not_found") {
    return {
      status: "revise",
      reason: "tool_not_found",
      retry_strategy: "alternative_tool",
    };
  }

  return {
    status: "retry",
    reason: input.toolResult.error?.code ?? "tool_failed",
    retry_strategy: "same_tool",
  };
}

export function evaluateAssistantOutput(output: string, toolResults: ToolResult[]): EvaluationDecision {
  if (output.trim().length > 0) {
    return {
      status: "pass",
      reason: "assistant_output_present",
    };
  }

  if (toolResults.some((result) => !result.ok)) {
    return {
      status: "stop",
      reason: "empty_output_after_tool_error",
    };
  }

  return {
    status: "revise",
    reason: "empty_output",
    retry_strategy: "replan",
  };
}
