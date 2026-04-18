import { previewArgs } from "./helpers.js";
import type { PermissionDecision, Tool, ToolContext, ToolCallEnvelope } from "./types.js";

const DEFAULT_CONFIRM_TIMEOUT_MS = 60_000;

export interface PermissionGateResult {
  allowed: boolean;
  decision: PermissionDecision;
}

export class PermissionGate {
  private readonly sessionPermissions = new Map<string, Set<string>>();
  private readonly confirmTimeoutMs: number;

  constructor(confirmTimeoutMs = DEFAULT_CONFIRM_TIMEOUT_MS) {
    this.confirmTimeoutMs = confirmTimeoutMs;
  }

  async authorize(tool: Tool, call: ToolCallEnvelope, context: ToolContext): Promise<PermissionGateResult> {
    if (tool.permission === "auto") {
      return {
        allowed: true,
        decision: "auto",
      };
    }

    const sessionKey = this.buildSessionKey(tool, call.args);
    const existing = this.sessionPermissions.get(context.sessionId);
    if (existing?.has(sessionKey)) {
      return {
        allowed: true,
        decision: "allowed_session",
      };
    }

    const customPayload = tool.buildConfirmPayload?.(call.args);
    const payload = {
      call_id: call.id,
      ...(customPayload ?? {
        tool: call.name,
        params_preview: previewArgs(call.args),
      }),
    };

    const timeoutPromise = new Promise<"__timeout__">((resolve) => {
      const timer = setTimeout(() => {
        clearTimeout(timer);
        resolve("__timeout__");
      }, this.confirmTimeoutMs);
    });

    const decision = await Promise.race([
      context.confirm(payload),
      timeoutPromise,
    ]);

    if (decision === "__timeout__") {
      return {
        allowed: false,
        decision: "timeout",
      };
    }

    if (decision === "allow_session") {
      const next = existing ?? new Set<string>();
      next.add(sessionKey);
      this.sessionPermissions.set(context.sessionId, next);
      return {
        allowed: true,
        decision: "allowed_session",
      };
    }

    if (decision === "allow") {
      return {
        allowed: true,
        decision: "allowed_once",
      };
    }

    return {
      allowed: false,
      decision: "denied",
    };
  }

  private buildSessionKey(tool: Tool, args: unknown): string {
    if (tool.sessionPermissionKey) {
      return tool.sessionPermissionKey(args);
    }

    return tool.name;
  }
}
