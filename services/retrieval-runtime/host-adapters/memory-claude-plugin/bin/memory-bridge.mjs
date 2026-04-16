#!/usr/bin/env node

import process from "node:process";

const mode = process.argv[2];
const runtimeBaseUrl = process.env.MEMORY_RUNTIME_BASE_URL ?? "http://127.0.0.1:3002";

function readStdin() {
  return new Promise((resolve, reject) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => {
      resolve(buffer);
    });
    process.stdin.on("error", reject);
  });
}

function safeJsonParse(text) {
  if (!text || !text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export function resolveField(event, keys, envKey, label) {
  for (const key of keys) {
    const value = event?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  const envValue = process.env[envKey];
  if (typeof envValue === "string" && envValue.trim()) {
    return envValue.trim();
  }

  throw new Error(`missing required identity field: ${label}. Set ${envKey} in environment or provide it in the hook event.`);
}

function buildSessionStartPayload(event) {
  return {
    host: "claude_code_plugin",
    session_id: resolveField(event, ["session_id", "sessionId"], "MEMORY_SESSION_ID", "session_id"),
    cwd: event.cwd,
    source: event.source ?? "claude_hook",
    user_id: resolveField(event, ["user_id", "userId"], "MEMORY_USER_ID", "user_id"),
    workspace_id: resolveField(event, ["workspace_id", "workspaceId"], "MEMORY_WORKSPACE_ID", "workspace_id"),
    task_id: event.task_id ?? event.taskId,
    recent_context_summary: event.recent_context_summary ?? event.recentContextSummary,
  };
}

function buildPreparePayload(event) {
  return {
    host: "claude_code_plugin",
    workspace_id: resolveField(event, ["workspace_id", "workspaceId"], "MEMORY_WORKSPACE_ID", "workspace_id"),
    user_id: resolveField(event, ["user_id", "userId"], "MEMORY_USER_ID", "user_id"),
    task_id: event.task_id ?? event.taskId,
    session_id: resolveField(event, ["session_id", "sessionId"], "MEMORY_SESSION_ID", "session_id"),
    thread_id: event.thread_id ?? event.threadId,
    turn_id: event.turn_id ?? event.turnId,
    phase: event.phase ?? "before_response",
    current_input: event.user_prompt ?? event.prompt ?? "",
    recent_context_summary: event.recent_context_summary ?? event.recentContextSummary,
    cwd: event.cwd,
    source: event.source ?? "claude_hook"
  };
}

function buildFinalizePayload(event) {
  return {
    host: "claude_code_plugin",
    workspace_id: resolveField(event, ["workspace_id", "workspaceId"], "MEMORY_WORKSPACE_ID", "workspace_id"),
    user_id: resolveField(event, ["user_id", "userId"], "MEMORY_USER_ID", "user_id"),
    task_id: event.task_id ?? event.taskId,
    session_id: resolveField(event, ["session_id", "sessionId"], "MEMORY_SESSION_ID", "session_id"),
    thread_id: event.thread_id ?? event.threadId,
    turn_id: event.turn_id ?? event.turnId,
    current_input: event.user_prompt ?? event.prompt ?? "",
    assistant_output: event.assistant_final ?? event.assistantFinal ?? "",
    tool_results_summary: event.tool_trace_summary ?? event.toolTraceSummary
  };
}

async function postJson(path, payload) {
  const response = await fetch(new URL(path, runtimeBaseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`runtime request failed: ${response.status}`);
  }

  return response.json();
}

async function main() {
  const event = safeJsonParse(await readStdin());

  try {
    if (mode === "session-start") {
      const response = await postJson("/v1/runtime/session-start-context", buildSessionStartPayload(event));
      process.stdout.write(
        JSON.stringify({
          additionalContext: response.additional_context ?? "",
          traceId: response.trace_id,
          dependencyStatus: response.dependency_status
        }),
      );
      return;
    }

    if (mode === "prepare-context") {
      const response = await postJson("/v1/runtime/prepare-context", buildPreparePayload(event));
      process.stdout.write(
        JSON.stringify({
          additionalContext: response.injection_block
            ? `${response.injection_block.injection_reason}\n${response.injection_block.memory_summary}`
            : "",
          traceId: response.trace_id,
          memoryPacketIds: response.memory_packet_ids ?? []
        }),
      );
      return;
    }

    if (mode === "finalize-turn") {
      const response = await postJson("/v1/runtime/finalize-turn", buildFinalizePayload(event));
      process.stdout.write(
        JSON.stringify({
          traceId: response.trace_id,
          writebackSubmitted: response.writeback_submitted,
          candidateCount: response.candidate_count
        }),
      );
      return;
    }

    throw new Error(`unsupported bridge mode: ${mode}`);
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        additionalContext: "",
        error: error instanceof Error ? error.message : String(error)
      }),
    );
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  void main();
}
