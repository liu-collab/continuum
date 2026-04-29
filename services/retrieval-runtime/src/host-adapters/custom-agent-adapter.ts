import type { FinalizeTurnInput, TriggerContext } from "../shared/types.js";
import type { FinalizeHostAdapter, FinalizeTurnRequest, HostAdapter, PrepareContextInput, SessionStartRequest } from "./types.js";

export class CustomAgentAdapter
  implements HostAdapter<PrepareContextInput | SessionStartRequest>, FinalizeHostAdapter<FinalizeTurnRequest>
{
  toTriggerContext(input: PrepareContextInput | SessionStartRequest): TriggerContext {
    if ("phase" in input) {
      return {
        host: "custom_agent",
        workspace_id: input.workspace_id,
        user_id: input.user_id,
        task_id: input.task_id,
        session_id: input.session_id,
        thread_id: input.thread_id,
        turn_id: input.turn_id,
        phase: input.phase,
        current_input: input.current_input,
        recent_context_summary: input.recent_context_summary,
        cwd: input.cwd,
        source: input.source,
        memory_mode: input.memory_mode,
        injection_token_budget: input.injection_token_budget,
      };
    }

    return {
      host: "custom_agent",
      workspace_id: input.workspace_id,
      user_id: input.user_id,
      task_id: input.task_id,
      session_id: input.session_id,
      phase: "session_start",
      current_input: input.recent_context_summary ?? "session start",
      recent_context_summary: input.recent_context_summary,
      cwd: input.cwd,
      source: input.source,
      memory_mode: input.memory_mode,
      injection_token_budget: input.injection_token_budget,
    };
  }

  toFinalizeInput(input: FinalizeTurnRequest): FinalizeTurnInput {
    return {
      host: "custom_agent",
      workspace_id: input.workspace_id,
      user_id: input.user_id,
      task_id: input.task_id,
      session_id: input.session_id,
      thread_id: input.thread_id,
      turn_id: input.turn_id,
      current_input: input.current_input,
      assistant_output: input.assistant_output,
      tool_results_summary: input.tool_results_summary,
      memory_mode: input.memory_mode,
    };
  }
}
