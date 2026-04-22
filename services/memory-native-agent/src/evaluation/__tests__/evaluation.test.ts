import { describe, expect, it } from "vitest";

import {
  createRetryPolicyState,
  evaluateRetryAllowance,
  registerToolAttempt,
} from "../retry-policy.js";
import { evaluateAssistantOutput, evaluateToolResult } from "../turn-evaluator.js";

describe("evaluation helpers", () => {
  it("stops retrying once the same tool attempt limit is reached", () => {
    const state = createRetryPolicyState();

    registerToolAttempt(state, "fs_read:README");
    registerToolAttempt(state, "fs_read:README");

    expect(
      evaluateRetryAllowance(state, "fs_read:README", {
        ok: false,
        error: { code: "tool_execution_failed", message: "boom" },
      }),
    ).toEqual({
      allowed: false,
      reason: "same_tool_attempt_limit",
      strategy: "replan",
    });
  });

  it("maps permission failures to ask_user", () => {
    expect(
      evaluateToolResult({
        toolName: "shell_exec",
        repeatedFailure: false,
        toolResult: {
          ok: false,
          error: { code: "tool_denied", message: "blocked" },
        },
      }),
    ).toEqual({
      status: "ask_user",
      reason: "tool_denied",
    });
  });

  it("requests a replan when assistant output is empty after a clean run", () => {
    expect(
      evaluateAssistantOutput("", [
        {
          ok: true,
          content: [{ type: "text", text: "ok" }],
        },
      ]),
    ).toEqual({
      status: "revise",
      reason: "empty_output",
      retry_strategy: "replan",
    });
  });
});
