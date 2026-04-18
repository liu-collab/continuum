import type { ToolCall, ToolSchema } from "../providers/types.js";

export type PermissionMode = "auto" | "confirm";
export type PermissionDecision =
  | "auto"
  | "allowed_once"
  | "allowed_session"
  | "denied"
  | "timeout"
  | "blocked_pattern";
export type RiskHint = "write" | "shell" | "mcp";
export type ToolArtifactKind = "file_diff" | "file_content" | "stdout";
export type ToolTrustLevel = "builtin_read" | "builtin_write" | "shell" | `mcp:${string}`;

export interface ToolErrorPayload {
  code: string;
  message: string;
}

export interface ToolArtifact {
  kind: ToolArtifactKind;
  ref: string;
}

export interface ToolResult {
  ok: boolean;
  output: string;
  trust_level: ToolTrustLevel;
  artifact?: ToolArtifact;
  artifact_ref?: string;
  error?: ToolErrorPayload;
  exit_code?: number;
  permission_decision?: PermissionDecision;
}

export interface ConfirmPayload {
  tool: string;
  params_preview: string;
  risk_hint?: RiskHint;
}

export interface ToolContext {
  callId: string;
  sessionId: string;
  turnId: string;
  cwd: string;
  workspaceRoot: string;
  artifactsRoot: string;
  abort: AbortSignal;
  confirm(payload: ConfirmPayload): Promise<"allow" | "deny" | "allow_session">;
}

export interface Tool<TArgs = unknown> {
  name: string;
  description: string;
  parameters: ToolSchema["parameters"];
  permission: PermissionMode;
  trustLevel(args: TArgs): ToolTrustLevel;
  buildConfirmPayload?(args: TArgs): ConfirmPayload | null;
  sessionPermissionKey?(args: TArgs): string;
  invoke(args: TArgs, context: ToolContext): Promise<ToolResult>;
}

export interface ToolCallEnvelope extends ToolCall {}

export interface ToolAuditSink {
  record(input: {
    call_id: string;
    session_id: string;
    turn_id: string;
    tool_name: string;
    args_hash: string;
    args_preview: string;
    permission_decision: PermissionDecision;
    exit_code?: number | null;
    ok: boolean;
    error_code?: string | null;
    artifact_ref?: string | null;
    duration_ms: number;
  }): void;
}

export interface ToolLogger {
  warn?(payload: Record<string, unknown>, message?: string): void;
}

export type ListedToolSchema = ToolSchema;
