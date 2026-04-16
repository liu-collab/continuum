#!/usr/bin/env node

import process from "node:process";

const runtimeBaseUrl = process.env.MEMORY_RUNTIME_BASE_URL ?? "http://127.0.0.1:3002";

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function callRuntime(path, init) {
  const response = await fetch(new URL(path, runtimeBaseUrl), init);
  if (!response.ok) {
    throw new Error(`runtime request failed with ${response.status}`);
  }
  return response.json();
}

function resolveIdentityField(input, key, envKey, fallback) {
  const value = input?.[key];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  const envValue = process.env[envKey];
  if (typeof envValue === "string" && envValue.trim()) {
    return envValue.trim();
  }

  return fallback;
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
      description: "Read retrieval-runtime dependency status for Codex debugging.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      run: async () => runtimeCall("/v1/runtime/health/dependencies"),
    },
    memory_trace_turn: {
      description: "Read retrieval-runtime observability data for a trace or turn.",
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
      description: "Search runtime memory through retrieval-runtime prepare-context.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query text" },
          workspace_id: { type: "string" },
          user_id: { type: "string" },
          session_id: { type: "string" },
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
            workspace_id: resolveIdentityField(input, "workspace_id", "MEMORY_WORKSPACE_ID", "00000000-0000-0000-0000-000000000000"),
            user_id: resolveIdentityField(input, "user_id", "MEMORY_USER_ID", "00000000-0000-0000-0000-000000000000"),
            session_id: resolveIdentityField(input, "session_id", "MEMORY_SESSION_ID", "00000000-0000-0000-0000-000000000000"),
            phase: "before_response",
            current_input: input.query,
          }),
        });

        return {
          trigger: result.trigger,
          trigger_reason: result.trigger_reason,
          memory_packet: result.memory_packet,
          injection_block: result.injection_block,
          degraded: result.degraded,
        };
      },
    },
    memory_explain_hit: {
      description: "Explain why a specific trace produced its recall and injection result.",
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
        const runs = await runtimeCall(`/v1/runtime/observe/runs?${params.toString()}`);
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
              }
            : "no trigger record",
          recall: recall
            ? {
                state: recall.result_state,
                candidate_count: recall.candidate_count,
                selected_count: recall.selected_count,
                degraded: recall.degraded,
              }
            : "no recall record",
          injection: injection
            ? {
                injected: injection.injected,
                count: injection.injected_count,
                trimmed: injection.trimmed_record_ids?.length ?? 0,
                state: injection.result_state,
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

  const message = JSON.parse(line);
  const { id, method, params } = message;

  try {
    if (method === "initialize") {
      write({
        id,
        result: {
          protocolVersion: "2024-11-05",
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
        throw new Error(`unknown tool: ${params?.name ?? "undefined"}`);
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

    if (method === "notifications/initialized") {
      return;
    }

    throw new Error(`unsupported method: ${method}`);
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

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
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
