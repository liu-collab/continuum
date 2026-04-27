#!/usr/bin/env node

import process from "node:process";
import { pathToFileURL } from "node:url";

const runtimeBaseUrl =
  process.env.MEMORY_RUNTIME_BASE_URL ?? "http://127.0.0.1:3002";

function write(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

async function callRuntime(path, init) {
  const response = await fetch(new URL(path, runtimeBaseUrl), init);
  if (!response.ok) {
    throw new Error(`runtime request failed with ${response.status}`);
  }
  return response.json();
}

function resolveIdentityField(input, key, envKey, label) {
  const value = input?.[key];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  const envValue = process.env[envKey];
  if (typeof envValue === "string" && envValue.trim()) {
    return envValue.trim();
  }

  throw new Error(
    `missing required identity field: ${label}. Set ${envKey} or provide ${key}.`,
  );
}

export function createTools(baseUrl = runtimeBaseUrl) {
  const runtimeCall = async (path, init) => {
    const response = await fetch(new URL(path, baseUrl), init);
    if (!response.ok) {
      throw new Error(`runtime request failed with ${response.status}`);
    }
    return response.json();
  };

  return {
    memory_dependency_status: {
      description:
        "Read retrieval-runtime dependency status for Codex debugging.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      run: async () => runtimeCall("/v1/runtime/health/dependencies"),
    },
    memory_trace_turn: {
      description:
        "Read retrieval-runtime observability data for a trace or turn.",
      inputSchema: {
        type: "object",
        properties: {
          trace_id: { type: "string" },
          turn_id: { type: "string" },
          session_id: { type: "string" },
        },
        additionalProperties: false,
      },
      run: async (input) => {
        const params = new URLSearchParams();
        if (input?.trace_id) {
          params.set("trace_id", input.trace_id);
        }
        if (input?.turn_id) {
          params.set("turn_id", input.turn_id);
        }
        if (input?.session_id) {
          params.set("session_id", input.session_id);
        }
        const suffix = params.toString() ? `?${params}` : "";
        return runtimeCall(`/v1/runtime/observe/runs${suffix}`);
      },
    },
    memory_search: {
      description:
        "Search runtime memory through retrieval-runtime prepare-context.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query text" },
          workspace_id: { type: "string" },
          user_id: { type: "string" },
          session_id: { type: "string" },
          memory_mode: {
            type: "string",
            enum: ["workspace_only", "workspace_plus_global"],
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      run: async (input) => {
        const result = await runtimeCall("/v1/runtime/prepare-context", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            host: "codex_app_server",
            workspace_id: resolveIdentityField(
              input,
              "workspace_id",
              "MEMORY_WORKSPACE_ID",
              "workspace_id",
            ),
            user_id: resolveIdentityField(
              input,
              "user_id",
              "MEMORY_USER_ID",
              "user_id",
            ),
            session_id: resolveIdentityField(
              input,
              "session_id",
              "MEMORY_SESSION_ID",
              "session_id",
            ),
            phase: "before_response",
            current_input: input.query,
            memory_mode: input.memory_mode ?? process.env.MEMORY_MODE,
          }),
        });

        return {
          trace_id: result.trace_id,
          trigger: result.trigger,
          trigger_reason: result.trigger_reason,
          memory_packet: result.trigger ? result.memory_packet : null,
          injection_block: result.trigger ? result.injection_block : null,
          degraded: result.degraded,
        };
      },
    },
    memory_explain_hit: {
      description:
        "Explain why a specific trace produced its recall and injection result.",
      inputSchema: {
        type: "object",
        properties: {
          trace_id: { type: "string", description: "The trace_id to explain" },
        },
        required: ["trace_id"],
        additionalProperties: false,
      },
      run: async (input) => {
        const params = new URLSearchParams({ trace_id: input.trace_id });
        const runs = await runtimeCall(
          `/v1/runtime/observe/runs?${params.toString()}`,
        );
        const trigger = runs.trigger_runs?.[0];
        const recall = runs.recall_runs?.[0];
        const injection = runs.injection_runs?.[0];

        return {
          trace_id: input.trace_id,
          trigger: trigger
            ? {
                hit: trigger.trigger_hit,
                type: trigger.trigger_type,
                reason: trigger.trigger_reason,
                memory_mode: trigger.memory_mode,
                requested_scopes: trigger.requested_scopes,
              }
            : "no trigger record",
          recall: recall
            ? {
                state: recall.result_state,
                candidate_count: recall.candidate_count,
                selected_count: recall.selected_count,
                degraded: recall.degraded,
                matched_scopes: recall.matched_scopes,
                scope_hit_counts: recall.scope_hit_counts,
              }
            : "no recall record",
          injection: injection
            ? {
                injected: injection.injected,
                count: injection.injected_count,
                trimmed: injection.trimmed_record_ids?.length ?? 0,
                state: injection.result_state,
                selected_scopes: injection.selected_scopes,
              }
            : "no injection record",
        };
      },
    },
  };
}

const tools = createTools();

export async function handleLine(line) {
  if (!line.trim()) {
    return;
  }

  let message;
  try {
    message = JSON.parse(line);
  } catch {
    // Silently ignore non-JSON lines to avoid polluting stdout
    return;
  }

  const { id, method, params } = message;

  // Notifications (no id) that we don't need to respond to
  if (id === undefined || id === null) {
    // All notifications are silently accepted — never write a response
    // for messages without an id per JSON-RPC 2.0 spec.
    return;
  }

  try {
    if (method === "initialize") {
      // Echo back the client's protocol version to match expectations
      const clientVersion = params?.protocolVersion ?? "2024-11-05";
      write({
        id,
        result: {
          protocolVersion: clientVersion,
          serverInfo: {
            name: "memory-codex-bridge",
            version: "0.1.0",
          },
          capabilities: {
            tools: {},
          },
        },
      });
      return;
    }

    if (method === "tools/list") {
      write({
        id,
        result: {
          tools: Object.entries(tools).map(([name, tool]) => ({
            name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        },
      });
      return;
    }

    if (method === "tools/call") {
      const tool = tools[params?.name];
      if (!tool) {
        write({
          id,
          error: {
            code: -32601,
            message: `unknown tool: ${params?.name ?? "undefined"}`,
          },
        });
        return;
      }

      const payload = await tool.run(params?.arguments ?? {});
      write({
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(payload, null, 2),
            },
          ],
        },
      });
      return;
    }

    // Unknown method with id — respond with method-not-found
    write({
      id,
      error: {
        code: -32601,
        message: `unsupported method: ${method}`,
      },
    });
  } catch (error) {
    write({
      id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;

if (entryUrl && import.meta.url === entryUrl) {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      void handleLine(line);
    }
  });
  process.stdin.on("end", () => {
    if (buffer.trim()) {
      void handleLine(buffer);
    }
  });
}
