import type { ToolResult } from "../tools/types.js";

export interface RetryPolicyState {
  turnRetryCount: number;
  toolAttempts: Map<string, number>;
}

export interface RetryDecision {
  allowed: boolean;
  reason: string;
  strategy?: "same_tool" | "alternative_tool" | "replan" | "narrow_scope";
}

const MAX_TURN_RETRIES = 3;
const MAX_TOOL_ATTEMPTS = 2;

export function createRetryPolicyState(): RetryPolicyState {
  return {
    turnRetryCount: 0,
    toolAttempts: new Map(),
  };
}

export function registerToolAttempt(state: RetryPolicyState, key: string): number {
  const next = (state.toolAttempts.get(key) ?? 0) + 1;
  state.toolAttempts.set(key, next);
  return next;
}

export function evaluateRetryAllowance(
  state: RetryPolicyState,
  key: string,
  result: ToolResult,
): RetryDecision {
  const toolAttempts = state.toolAttempts.get(key) ?? 0;
  if (toolAttempts >= MAX_TOOL_ATTEMPTS) {
    return {
      allowed: false,
      reason: "same_tool_attempt_limit",
      strategy: "replan",
    };
  }

  if (state.turnRetryCount >= MAX_TURN_RETRIES) {
    return {
      allowed: false,
      reason: "turn_retry_limit",
      strategy: "replan",
    } as RetryDecision;
  }

  if (result.error?.code === "tool_confirm_timeout" || result.error?.code === "tool_denied") {
    return {
      allowed: false,
      reason: "permission_denied",
      strategy: "alternative_tool",
    };
  }

  if (result.error?.code === "mcp_disconnected" || result.error?.code === "tool_not_found") {
    return {
      allowed: false,
      reason: "tool_unavailable",
      strategy: "alternative_tool",
    };
  }

  if (result.error?.code === "tool_execution_failed" || result.error?.code === "shell_exit_non_zero") {
    return {
      allowed: true,
      reason: "execution_failed",
      strategy: "narrow_scope",
    };
  }

  return {
    allowed: true,
    reason: "retry_allowed",
    strategy: "same_tool",
  };
}
