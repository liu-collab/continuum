import { z } from "zod";

import type { FinalizeTurnInput, HostKind, TriggerContext } from "../shared/types.js";

const memoryModeSchema = z.enum(["workspace_only", "workspace_plus_global"]);

export const prepareContextInputSchema = z.object({
  host: z.enum(["claude_code_plugin", "codex_app_server", "custom_agent"]),
  workspace_id: z.string().uuid(),
  user_id: z.string().uuid(),
  task_id: z.string().uuid().optional(),
  session_id: z.string().min(1),
  thread_id: z.string().min(1).optional(),
  turn_id: z.string().min(1).optional(),
  phase: z.enum(["session_start", "task_start", "task_switch", "before_plan", "before_response", "after_response"]),
  current_input: z.string().min(1),
  recent_context_summary: z.string().optional(),
  cwd: z.string().optional(),
  source: z.string().optional(),
  memory_mode: memoryModeSchema.optional(),
});

export const finalizeTurnInputSchema = z.object({
  host: z.enum(["claude_code_plugin", "codex_app_server", "custom_agent"]),
  workspace_id: z.string().uuid(),
  user_id: z.string().uuid(),
  task_id: z.string().uuid().optional(),
  session_id: z.string().min(1),
  thread_id: z.string().min(1).optional(),
  turn_id: z.string().min(1).optional(),
  current_input: z.string().min(1),
  assistant_output: z.string().min(1),
  tool_results_summary: z.string().optional(),
  memory_mode: memoryModeSchema.optional(),
});

export type PrepareContextInput = z.infer<typeof prepareContextInputSchema>;
export type FinalizeTurnRequest = z.infer<typeof finalizeTurnInputSchema>;

export interface SessionStartRequest {
  host: HostKind;
  session_id: string;
  cwd?: string;
  source?: string;
  user_id: string;
  workspace_id: string;
  task_id?: string;
  recent_context_summary?: string;
  memory_mode?: "workspace_only" | "workspace_plus_global";
}

export interface HostAdapter<TInput> {
  toTriggerContext(input: TInput): TriggerContext;
}

export interface FinalizeHostAdapter<TInput> {
  toFinalizeInput(input: TInput): FinalizeTurnInput;
}
