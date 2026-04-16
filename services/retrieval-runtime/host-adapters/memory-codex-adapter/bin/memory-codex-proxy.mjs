#!/usr/bin/env node

import process from "node:process";

const runtimeBaseUrl = process.env.MEMORY_RUNTIME_BASE_URL ?? "http://127.0.0.1:3002";
const appServerUrl = process.env.CODEX_APP_SERVER_URL ?? "ws://127.0.0.1:3777";

function requireField(event, keys, label) {
  for (const key of keys) {
    const value = event?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  throw new Error(`missing required identity field: ${label}`);
}

function extractUserPrompt(turnStartEvent) {
  const inputs = turnStartEvent?.params?.input;
  if (!Array.isArray(inputs)) {
    return "";
  }

  const userEntry = inputs.find((entry) => entry?.role === "user" || entry?.type === "user_message");
  return userEntry?.content ?? userEntry?.text ?? "";
}

async function prepareContext(event) {
  const payload = {
    host: "codex_app_server",
    workspace_id: requireField(event, ["workspaceId", "workspace_id"], "workspace_id"),
    user_id: requireField(event, ["userId", "user_id"], "user_id"),
    task_id: event.taskId,
    session_id: requireField(event, ["sessionId", "session_id"], "session_id"),
    thread_id: event.threadId,
    turn_id: event.turnId,
    phase: "before_response",
    current_input: extractUserPrompt(event),
    recent_context_summary: event.recentContextSummary
  };

  const response = await fetch(new URL("/v1/runtime/prepare-context", runtimeBaseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`prepare-context failed with ${response.status}`);
  }

  return response.json();
}

async function finalizeTurn(event) {
  const payload = {
    host: "codex_app_server",
    workspace_id: requireField(event, ["workspaceId", "workspace_id"], "workspace_id"),
    user_id: requireField(event, ["userId", "user_id"], "user_id"),
    task_id: event.taskId,
    session_id: requireField(event, ["sessionId", "session_id"], "session_id"),
    thread_id: event.threadId,
    turn_id: event.turnId,
    current_input: event.userPrompt ?? "",
    assistant_output: event.assistantFinal ?? "",
    tool_results_summary: event.toolTraceSummary
  };

  await fetch(new URL("/v1/runtime/finalize-turn", runtimeBaseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function main() {
  const mode = process.argv[2];
  const stdin = await new Promise((resolve, reject) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => resolve(buffer));
    process.stdin.on("error", reject);
  });
  const event = stdin ? JSON.parse(stdin) : {};

  if (mode === "turn-start") {
    try {
      const prepared = await prepareContext(event);
      process.stdout.write(
        JSON.stringify({
          appServerUrl,
          injectionBlock: prepared.injection_block,
          traceId: prepared.trace_id
        }),
      );
    } catch (error) {
      process.stdout.write(
        JSON.stringify({
          appServerUrl,
          injectionBlock: null,
          degraded: true,
          reason: error instanceof Error ? error.message : String(error)
        }),
      );
    }
    return;
  }

  if (mode === "turn-completed") {
    try {
      await finalizeTurn(event);
      process.stdout.write(JSON.stringify({ forwarded: true }));
    } catch (error) {
      process.stdout.write(
        JSON.stringify({
          forwarded: true,
          degraded: true,
          reason: error instanceof Error ? error.message : String(error)
        }),
      );
    }
    return;
  }

  throw new Error(`unsupported proxy mode: ${mode}`);
}

void main();
