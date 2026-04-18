import type { SessionStore } from "../session-store/index.js";
import {
  ToolExecutionError,
  ToolPatternBlockedError,
  ToolTimeoutError,
} from "./errors.js";
import { hashArgs, previewArgs } from "./helpers.js";
import { PermissionGate } from "./permission-gate.js";
import { ToolRegistry } from "./registry.js";
import type {
  ToolAuditSink,
  ToolContext,
  ToolCallEnvelope,
  ToolLogger,
  ToolResult,
} from "./types.js";

export interface ToolDispatcherOptions {
  registry: ToolRegistry;
  gate?: PermissionGate;
  sessionStore?: SessionStore;
  logger?: ToolLogger;
  artifactsRoot?: string;
}

export class ToolDispatcher {
  private readonly registry: ToolRegistry;
  private readonly gate: PermissionGate;
  private readonly auditSink: ToolAuditSink | null;
  private readonly logger: ToolLogger;
  private readonly artifactsRoot: string | null;

  constructor(options: ToolDispatcherOptions) {
    this.registry = options.registry;
    this.gate = options.gate ?? new PermissionGate();
    this.auditSink = options.sessionStore
      ? {
          record: (input) => {
            options.sessionStore?.recordToolInvocation({
              ...input,
              exit_code: input.exit_code ?? null,
              error_code: input.error_code ?? null,
              artifact_ref: input.artifact_ref ?? null,
            });
          },
        }
      : null;
    this.logger = options.logger ?? {};
    this.artifactsRoot = options.artifactsRoot ?? null;
  }

  listTools() {
    return this.registry.listTools();
  }

  getArtifactsRoot(): string | null {
    return this.artifactsRoot;
  }

  async invoke(call: ToolCallEnvelope, context: ToolContext): Promise<ToolResult> {
    const tool = this.registry.get(call.name);
    if (!tool) {
      return {
        ok: false,
        output: `Unknown tool: ${call.name}`,
        trust_level: "builtin_read",
        error: {
          code: "tool_not_found",
          message: `Unknown tool: ${call.name}`,
        },
        permission_decision: "denied",
      };
    }

    const argsPreview = previewArgs(call.args);
    const argsHash = hashArgs(call.args);
    const startedAt = Date.now();
    let permissionDecision: ToolResult["permission_decision"] = "auto";
    let result: ToolResult;

    try {
      const permission = await this.gate.authorize(tool, call, context);
      permissionDecision = permission.decision;
      if (!permission.allowed) {
        result = {
          ok: false,
          output: permission.decision === "timeout" ? "Tool confirmation timed out." : "Tool execution was denied.",
          trust_level: tool.trustLevel(call.args),
          error: {
            code: permission.decision === "timeout" ? "tool_confirm_timeout" : "tool_denied",
            message: permission.decision === "timeout"
              ? "Tool confirmation timed out."
              : "Tool execution was denied.",
          },
          permission_decision: permission.decision,
        };
      } else {
        result = await tool.invoke(call.args, context);
        result.permission_decision = permissionDecision;
      }
    } catch (error) {
      if (error instanceof ToolPatternBlockedError) {
        permissionDecision = "blocked_pattern";
      } else if (error instanceof ToolTimeoutError) {
        permissionDecision = "timeout";
      }

      result = toToolErrorResult(tool.trustLevel(call.args), error, permissionDecision);
    }

    const durationMs = Date.now() - startedAt;
    this.recordAudit(call, context, result, argsHash, argsPreview, durationMs, permissionDecision);
    return result;
  }

  private recordAudit(
    call: ToolCallEnvelope,
    context: ToolContext,
    result: ToolResult,
    argsHash: string,
    argsPreview: string,
    durationMs: number,
    permissionDecision: ToolResult["permission_decision"],
  ) {
    if (!this.auditSink) {
      return;
    }

    try {
      this.auditSink.record({
        call_id: call.id,
        session_id: context.sessionId,
        turn_id: context.turnId,
        tool_name: call.name,
        args_hash: argsHash,
        args_preview: argsPreview,
        permission_decision: permissionDecision ?? "auto",
        exit_code: result.exit_code ?? null,
        ok: result.ok,
        error_code: result.error?.code ?? null,
        artifact_ref: result.artifact_ref ?? null,
        duration_ms: durationMs,
      });
    } catch (error) {
      this.logger.warn?.(
        {
          call_id: call.id,
          tool_name: call.name,
          error_message: error instanceof Error ? error.message : String(error),
        },
        "tool audit record failed",
      );
    }
  }
}

function toToolErrorResult(
  trustLevel: ToolResult["trust_level"],
  error: unknown,
  permissionDecision?: ToolResult["permission_decision"],
): ToolResult {
  if (error instanceof ToolExecutionError) {
    return {
      ok: false,
      output: error.message,
      trust_level: trustLevel,
      error: {
        code: error.code,
        message: error.message,
      },
      exit_code: error.exitCode,
      permission_decision: permissionDecision,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    output: message,
    trust_level: trustLevel,
    error: {
      code: "tool_execution_failed",
      message,
    },
    permission_decision: permissionDecision,
  };
}
