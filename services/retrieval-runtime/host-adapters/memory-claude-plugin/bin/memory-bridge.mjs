#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

const mode = process.argv[2];
const runtimeBaseUrl =
  process.env.MEMORY_RUNTIME_BASE_URL ?? "http://127.0.0.1:3002";
const runtimeApiMode = process.env.MEMORY_RUNTIME_API_MODE ?? "lite";
const runtimeStartCommand = process.env.MEMORY_RUNTIME_START_COMMAND ?? "axis-runtime";
const runtimeHealthPath = process.env.MEMORY_RUNTIME_HEALTH_PATH ?? "/v1/lite/healthz";
const runtimeRecoveryTimeoutMs = Number.parseInt(
  process.env.MEMORY_RUNTIME_RECOVERY_TIMEOUT_MS ?? "5000",
  10,
);

const runtimeRoutes =
  runtimeApiMode === "full"
    ? {
        sessionStart: "/v1/runtime/session-start-context",
        prepareContext: "/v1/runtime/prepare-context",
        finalizeTurn: "/v1/runtime/finalize-turn",
      }
    : {
        sessionStart: "/v1/lite/prepare-context",
        prepareContext: "/v1/lite/prepare-context",
        finalizeTurn: "/v1/lite/after-response",
      };

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

function shouldRun(command) {
  return Boolean(command) && command !== "off" && command !== "false";
}

function startDetached(command) {
  const child = spawn(command, {
    shell: true,
    stdio: "ignore",
    detached: true,
    windowsHide: true,
  });
  child.unref();
}

async function isRuntimeHealthy() {
  try {
    const response = await fetch(new URL(runtimeHealthPath, runtimeBaseUrl));
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForRuntimeHealthy() {
  const deadline = Date.now() + Math.max(500, runtimeRecoveryTimeoutMs);
  while (Date.now() < deadline) {
    if (await isRuntimeHealthy()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function recoverRuntime() {
  if (await isRuntimeHealthy()) {
    return true;
  }
  if (shouldRun(runtimeStartCommand)) {
    startDetached(runtimeStartCommand);
  }
  return waitForRuntimeHealthy();
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

  throw new Error(
    `missing required identity field: ${label}. Set ${envKey} in environment or provide it in the hook event.`,
  );
}

function buildSessionStartPayload(event) {
  return {
    host: "claude_code_plugin",
    session_id: resolveField(
      event,
      ["session_id", "sessionId"],
      "MEMORY_SESSION_ID",
      "session_id",
    ),
    cwd: event.cwd,
    source: event.source ?? "claude_hook",
    user_id: resolveField(
      event,
      ["user_id", "userId"],
      "MEMORY_USER_ID",
      "user_id",
    ),
    workspace_id: resolveField(
      event,
      ["workspace_id", "workspaceId"],
      "MEMORY_WORKSPACE_ID",
      "workspace_id",
    ),
    task_id: event.task_id ?? event.taskId,
    recent_context_summary:
      event.recent_context_summary ?? event.recentContextSummary,
    memory_mode:
      event.memory_mode ?? event.memoryMode ?? process.env.MEMORY_MODE,
  };
}

function buildPreparePayload(event) {
  return {
    host: "claude_code_plugin",
    workspace_id: resolveField(
      event,
      ["workspace_id", "workspaceId"],
      "MEMORY_WORKSPACE_ID",
      "workspace_id",
    ),
    user_id: resolveField(
      event,
      ["user_id", "userId"],
      "MEMORY_USER_ID",
      "user_id",
    ),
    task_id: event.task_id ?? event.taskId,
    session_id: resolveField(
      event,
      ["session_id", "sessionId"],
      "MEMORY_SESSION_ID",
      "session_id",
    ),
    thread_id: event.thread_id ?? event.threadId,
    turn_id: event.turn_id ?? event.turnId,
    phase: event.phase ?? "before_response",
    current_input: event.user_prompt ?? event.prompt ?? "",
    recent_context_summary:
      event.recent_context_summary ?? event.recentContextSummary,
    cwd: event.cwd,
    source: event.source ?? "claude_hook",
    memory_mode:
      event.memory_mode ?? event.memoryMode ?? process.env.MEMORY_MODE,
  };
}

function buildFinalizePayload(event) {
  return {
    host: "claude_code_plugin",
    workspace_id: resolveField(
      event,
      ["workspace_id", "workspaceId"],
      "MEMORY_WORKSPACE_ID",
      "workspace_id",
    ),
    user_id: resolveField(
      event,
      ["user_id", "userId"],
      "MEMORY_USER_ID",
      "user_id",
    ),
    task_id: event.task_id ?? event.taskId,
    session_id: resolveField(
      event,
      ["session_id", "sessionId"],
      "MEMORY_SESSION_ID",
      "session_id",
    ),
    thread_id: event.thread_id ?? event.threadId,
    turn_id: event.turn_id ?? event.turnId,
    current_input: event.user_prompt ?? event.prompt ?? "",
    assistant_output: event.assistant_final ?? event.assistantFinal ?? "",
    tool_results_summary: event.tool_trace_summary ?? event.toolTraceSummary,
    memory_mode:
      event.memory_mode ?? event.memoryMode ?? process.env.MEMORY_MODE,
  };
}

async function postJsonOnce(path, payload) {
  const response = await fetch(new URL(path, runtimeBaseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.text();
      detail = ` – ${body}`;
    } catch {
      // ignore read errors
    }
    const error = new Error(`runtime request failed: ${response.status}${detail}`);
    error.runtimeHttpError = true;
    throw error;
  }

  return response.json();
}

async function postJson(path, payload) {
  try {
    return await postJsonOnce(path, payload);
  } catch (error) {
    if (error?.runtimeHttpError === true) {
      throw error;
    }
    if (!(await recoverRuntime())) {
      throw error;
    }
    return postJsonOnce(path, payload);
  }
}

async function main() {
  const event = safeJsonParse(await readStdin());

  try {
    if (mode === "session-start" || mode === "session-start-context") {
      const response = await postJson(
        runtimeRoutes.sessionStart,
        runtimeApiMode === "full"
          ? buildSessionStartPayload(event)
          : {
              ...buildSessionStartPayload(event),
              phase: "session_start",
              current_input: event.recent_context_summary ?? event.recentContextSummary ?? "session start",
            },
      );
      const additionalContext =
        typeof response.additional_context === "string"
          ? response.additional_context
          : response.injection_block?.memory_summary ?? "";
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext,
          },
          traceId: response.trace_id,
          dependencyStatus: response.dependency_status,
          memoryModelStatus: response.memory_model_status,
        }),
      );
      return;
    }

    if (mode === "prepare-context") {
      const response = await postJson(
        runtimeRoutes.prepareContext,
        buildPreparePayload(event),
      );
      const additionalContext = response.injection_block
        ? [
            "以下是已检索到的高相关长期记忆，请优先按这些信息组织回答。",
            "如果这些记忆和你默认的回答习惯冲突，以这些记忆为准。",
            "请自然体现在最终回答里，不要机械复述“我读取了记忆”或“根据记忆”。",
            "",
            `触发原因：${response.injection_block.injection_reason}`,
            response.injection_block.memory_summary,
          ]
            .filter(
              (item) => typeof item === "string" && item.trim().length > 0,
            )
            .join("\n")
        : "";
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext,
          },
          traceId: response.trace_id,
          memoryPacketIds: response.memory_packet_ids ?? [],
          memoryModelStatus: response.memory_model_status,
        }),
      );
      return;
    }

    if (mode === "finalize-turn") {
      const response = await postJson(
        runtimeRoutes.finalizeTurn,
        {
          ...buildFinalizePayload(event),
          trace_id: event.trace_id ?? event.traceId,
          candidates: event.memory_candidates ?? event.memoryCandidates,
        },
      );
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "Stop",
          },
          traceId: response.trace_id,
          writebackSubmitted: response.writeback_submitted ?? response.writeback_status === "accepted",
          candidateCount: response.candidate_count ?? response.accepted_count ?? 0,
        }),
      );
      return;
    }

    throw new Error(`unsupported bridge mode: ${mode}`);
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput:
          mode === "session-start" || mode === "session-start-context"
            ? {
                hookEventName: "SessionStart",
                additionalContext: "",
              }
            : mode === "prepare-context"
              ? {
                  hookEventName: "UserPromptSubmit",
                  additionalContext: "",
                }
              : mode === "finalize-turn"
                ? {
                    hookEventName: "Stop",
                  }
                : undefined,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;

if (entryUrl && import.meta.url === entryUrl) {
  void main();
}
