#!/usr/bin/env node

import { createHash } from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

const runtimeBaseUrl = process.env.MEMORY_RUNTIME_BASE_URL ?? "http://127.0.0.1:3002";
const appServerUrl = process.env.CODEX_APP_SERVER_URL ?? "ws://127.0.0.1:3777";
const proxyListenUrl = process.env.MEMORY_CODEX_PROXY_LISTEN_URL ?? "ws://127.0.0.1:3788";
const workspaceNamespaceUuid =
  process.env.MEMORY_WORKSPACE_NAMESPACE_UUID ?? "8b7ee9a4-2fa7-54c3-a941-8e1b8db4f4d9";
const defaultUserId =
  process.env.MEMORY_USER_ID ?? process.env.MNA_PLATFORM_USER_ID ?? "00000000-0000-4000-8000-000000000001";
const defaultMemoryMode = process.env.MEMORY_MODE ?? "workspace_plus_global";
const hookSource = "codex_app_server";

function uuidStringToBytes(value) {
  const hex = value.replace(/-/g, "");
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

function bytesToUuid(bytes) {
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function createUuidV5(namespace, name) {
  const namespaceBytes = uuidStringToBytes(namespace);
  const hash = createHash("sha1");
  hash.update(namespaceBytes);
  hash.update(name, "utf8");

  const bytes = Uint8Array.from(hash.digest().subarray(0, 16));
  const versionByte = bytes[6];
  const variantByte = bytes[8];
  if (versionByte === undefined || variantByte === undefined) {
    throw new Error("failed to derive uuid bytes");
  }

  bytes[6] = (versionByte & 0x0f) | 0x50;
  bytes[8] = (variantByte & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}

function normalizeDriveLetter(value) {
  return value.replace(/^[a-z]:/, (match) => match.toUpperCase());
}

function trimTrailingSlash(value) {
  if (value === "/") {
    return value;
  }

  if (/^[A-Z]:\/$/.test(value)) {
    return value;
  }

  return value.replace(/\/+$/, "");
}

function normalizeWorkspacePath(cwd) {
  const resolved = path.resolve(cwd);
  const slashed = normalizeDriveLetter(resolved.replace(/\\/g, "/"));
  return trimTrailingSlash(slashed);
}

function deriveWorkspaceId(cwd) {
  return createUuidV5(workspaceNamespaceUuid, normalizeWorkspacePath(cwd));
}

function deriveSessionId(threadId, cwd) {
  return createUuidV5(workspaceNamespaceUuid, `${normalizeWorkspacePath(cwd)}::${threadId}`);
}

function resolveCwd(params) {
  if (typeof params?.cwd === "string" && params.cwd.trim()) {
    return path.resolve(params.cwd.trim());
  }

  return process.cwd();
}

function resolveIdentity(params) {
  const cwd = resolveCwd(params);
  const workspaceId =
    process.env.MEMORY_WORKSPACE_ID && process.env.MEMORY_WORKSPACE_ID.trim()
      ? process.env.MEMORY_WORKSPACE_ID.trim()
      : deriveWorkspaceId(cwd);
  const userId = defaultUserId;
  const memoryMode = process.env.MEMORY_MODE?.trim() || defaultMemoryMode;
  return {
    cwd,
    workspaceId,
    userId,
    memoryMode,
  };
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function createJsonRpcError(id, code, message) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message,
    },
  };
}

function extractUserPrompt(inputs) {
  if (!Array.isArray(inputs)) {
    return "";
  }

  return inputs
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }
      if (item.type === "text" && typeof item.text === "string") {
        return item.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractAssistantTextFromItem(item) {
  if (!item || typeof item !== "object") {
    return "";
  }

  if (item.type === "agentMessage" && typeof item.text === "string") {
    return item.text;
  }

  return "";
}

function extractToolSummary(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  if (item.type === "commandExecution") {
    return JSON.stringify({
      type: item.type,
      command: item.command,
      status: item.status,
      exitCode: item.exitCode,
    });
  }

  if (item.type === "mcpToolCall") {
    return JSON.stringify({
      type: item.type,
      server: item.server,
      tool: item.tool,
      status: item.status,
      error: item.error,
    });
  }

  if (item.type === "dynamicToolCall") {
    return JSON.stringify({
      type: item.type,
      tool: item.tool,
      status: item.status,
      success: item.success,
    });
  }

  return null;
}

async function postJson(routePath, payload) {
  const response = await fetch(new URL(routePath, runtimeBaseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`runtime request failed: ${response.status}${body ? ` ${body}` : ""}`);
  }

  return response.json();
}

async function prepareContext(context) {
  return postJson("/v1/runtime/prepare-context", {
    host: hookSource,
    workspace_id: context.workspaceId,
    user_id: context.userId,
    session_id: context.sessionId,
    thread_id: context.threadId,
    turn_id: context.turnId,
    phase: "before_response",
    current_input: context.userPrompt,
    cwd: context.cwd,
    source: hookSource,
    memory_mode: context.memoryMode,
  });
}

async function sessionStartContext(context) {
  return postJson("/v1/runtime/session-start-context", {
    host: hookSource,
    workspace_id: context.workspaceId,
    user_id: context.userId,
    session_id: context.sessionId,
    task_id: context.taskId,
    cwd: context.cwd,
    source: hookSource,
    memory_mode: context.memoryMode,
  });
}

async function finalizeTurn(context) {
  return postJson("/v1/runtime/finalize-turn", {
    host: hookSource,
    workspace_id: context.workspaceId,
    user_id: context.userId,
    session_id: context.sessionId,
    thread_id: context.threadId,
    turn_id: context.turnId,
    current_input: context.userPrompt,
    assistant_output: context.assistantText,
    tool_results_summary: context.toolSummaries.join("\n"),
    memory_mode: context.memoryMode,
  });
}

function buildDeveloperInjectionItems(text) {
  if (typeof text !== "string" || !text.trim()) {
    return [];
  }

  return [
    {
      type: "message",
      role: "developer",
      content: [
        {
          type: "input_text",
          text: text.trim(),
        },
      ],
    },
  ];
}

function memoryRecordIdsFromResult(result) {
  const records = result?.injection_block?.memory_records;
  if (!Array.isArray(records)) {
    return [];
  }
  return records.map((record) => record?.id).filter((id) => typeof id === "string");
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}

function buildPreparedMemoryText(result) {
  if (!result || typeof result !== "object") {
    return "【长期记忆】无相关历史记忆，请直接回答。";
  }

  const injection = result.injection_block;
  if (
    injection &&
    Array.isArray(injection.memory_records) &&
    injection.memory_records.length > 0
  ) {
    const lines = [
      "【长期记忆】以下信息仅在与当前问题直接相关时使用，请优先转化为答案中的约束、默认值或步骤，不要逐条转述：",
    ];
    if (injection.injection_reason) {
      lines.push(`命中原因：${injection.injection_reason}`);
    }
    if (injection.memory_summary) {
      lines.push(`可直接采用的上下文：${injection.memory_summary}`);
    }
    lines.push("可用事实：");
    for (const record of injection.memory_records) {
      const scope = record.scope ?? "";
      const type = record.memory_type ?? record.type ?? "";
      const summary = record.summary ?? record.content ?? JSON.stringify(record);
      lines.push(`- 记忆[${type}${scope ? "/" + scope : ""}]：${summary}`);
    }
    lines.push(
      "使用要求：如果这些记忆能帮助回答，就直接体现在最终答案里；不要单独开一段复述记忆，也不要说你看到了记忆。",
    );
    return lines.join("\n");
  }

  if (!result.trigger) {
    return "【长期记忆】无相关历史记忆，请直接回答。";
  }

  const packet = result.memory_packet;
  const records = Array.isArray(packet?.records)
    ? packet.records
    : Array.isArray(packet?.memory_records)
      ? packet.memory_records
      : [];
  if (records.length > 0) {
    const lines = [
      "【长期记忆】以下信息仅在与当前问题直接相关时使用，请直接吸收到答案内容中：",
    ];
    for (const record of records) {
      const summary = record.summary ?? record.content ?? JSON.stringify(record);
      lines.push(`- 记忆：${summary}`);
    }
    lines.push("使用要求：只保留对当前回答必要的信息，不要复述这段上下文。");
    return lines.join("\n");
  }

  return "【长期记忆】无相关历史记忆，请直接回答。";
}

function buildMemoryDeliveryFact({ context, prepareResults, injectedText, injectItemsSent, error }) {
  const results = Array.isArray(prepareResults) ? prepareResults.filter(Boolean) : [];
  const primaryResult = [...results].reverse().find((result) => typeof result?.trace_id === "string") ?? null;
  const recordIds = uniqueStrings(results.flatMap((result) => memoryRecordIdsFromResult(result)));
  const memoryPacketIds = uniqueStrings(
    results.flatMap((result) =>
      Array.isArray(result?.memory_packet_ids) ? result.memory_packet_ids : [],
    ),
  );
  return {
    method: "platform_prepare_context_thread_inject_items",
    attempted: true,
    prepared: results.length > 0,
    host_context_delivered: Boolean(injectItemsSent && injectedText),
    memory_delivered: recordIds.length > 0,
    trace_id: typeof primaryResult?.trace_id === "string" ? primaryResult.trace_id : null,
    trigger: results.some((result) => Boolean(result?.trigger)),
    trigger_reason:
      typeof primaryResult?.trigger_reason === "string"
        ? primaryResult.trigger_reason
        : null,
    injected_count: recordIds.length,
    record_ids: recordIds,
    memory_packet_ids: memoryPacketIds,
    content_chars: typeof injectedText === "string" ? injectedText.length : 0,
    content_sha256:
      typeof injectedText === "string" && injectedText.length > 0
        ? createHash("sha256").update(injectedText).digest("hex")
        : null,
    session_id: context.sessionId,
    thread_id: context.threadId,
    turn_id: context.turnId,
    error: error ? String(error) : null,
  };
}

function logMemoryDelivery(fact) {
  process.stdout.write(`[memory-codex-proxy] memory_delivery ${JSON.stringify(fact)}\n`);
}

function createProxyState() {
  return {
    turnRequestById: new Map(),
    turnStateById: new Map(),
    injectRequestCounter: 0,
    initializedThreadIds: new Set(),
  };
}

function startServer() {
  const listenUrl = new URL(proxyListenUrl);
  const server = http.createServer((request, response) => {
    if (request.url === "/healthz" || request.url === "/readyz") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
      return;
    }

    response.writeHead(404);
    response.end();
  });
  const wss = new WebSocketServer({ server });

  wss.on("connection", (clientSocket) => {
    const upstreamSocket = new WebSocket(appServerUrl);
    const state = createProxyState();
    let upstreamReady = false;
    const bufferedMessages = [];

    function forwardToUpstream(message) {
      if (upstreamReady) {
        upstreamSocket.send(message);
        return;
      }

      bufferedMessages.push(message);
    }

    async function handleTurnStart(request) {
      const params = request.params ?? {};
      const identity = resolveIdentity(params);
      const threadId =
        typeof params.threadId === "string" && params.threadId.trim() ? params.threadId : null;

      if (!threadId) {
        forwardToUpstream(JSON.stringify(request));
        return;
      }

      const turnState = {
        requestId: request.id ?? null,
        threadId,
        turnId: null,
        sessionId: deriveSessionId(threadId, identity.cwd),
        workspaceId: identity.workspaceId,
        userId: identity.userId,
        taskId:
          typeof params.taskId === "string" && params.taskId.trim()
            ? params.taskId.trim()
            : typeof params.task_id === "string" && params.task_id.trim()
              ? params.task_id.trim()
              : undefined,
        memoryMode: identity.memoryMode,
        cwd: identity.cwd,
        userPrompt: extractUserPrompt(params.input),
        assistantText: "",
        toolSummaries: [],
      };

      state.turnRequestById.set(request.id ?? `turn-start-${Date.now()}`, turnState);

      const injectionTexts = [];
      const deliveryPrepareResults = [];
      if (!state.initializedThreadIds.has(threadId)) {
        try {
          const sessionStarted = await sessionStartContext(turnState);
          if (typeof sessionStarted?.additional_context === "string" && sessionStarted.additional_context.trim()) {
            injectionTexts.push(sessionStarted.additional_context.trim());
          }
          deliveryPrepareResults.push(sessionStarted);
          state.initializedThreadIds.add(threadId);
        } catch (error) {
          console.error(
            `[memory-codex-proxy] session-start degraded: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      let prepared = null;
      let prepareError = null;
      const prepareContextState = {
        ...turnState,
        turnId: String(request.id ?? `pending-${Date.now()}`),
      };
      try {
        prepared = await prepareContext({
          ...turnState,
          turnId: prepareContextState.turnId,
        });
        injectionTexts.push(buildPreparedMemoryText(prepared));
        deliveryPrepareResults.push(prepared);
      } catch (error) {
        prepareError = error instanceof Error ? error.message : String(error);
        injectionTexts.push("【长期记忆】记忆上下文准备失败，请按普通问题直接回答。");
        console.error(
          `[memory-codex-proxy] prepare-context degraded: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      const injectedText = [...new Set(injectionTexts)].join("\n\n");
      const injectionItems = buildDeveloperInjectionItems(injectedText);

      forwardToUpstream(JSON.stringify(request));

      let injectItemsSent = false;
      if (injectionItems.length > 0) {
        state.injectRequestCounter += 1;
        forwardToUpstream(
          JSON.stringify({
            jsonrpc: "2.0",
            id: `memory-inject-${state.injectRequestCounter}`,
            method: "thread/inject_items",
            params: {
              threadId,
              items: injectionItems,
            },
          }),
        );
        injectItemsSent = true;
      }

      logMemoryDelivery(
        buildMemoryDeliveryFact({
          context: prepareContextState,
          prepareResults: deliveryPrepareResults,
          injectedText,
          injectItemsSent,
          error: prepareError,
        }),
      );
    }

    function trackTurnStarted(message) {
      if (message?.method !== "turn/started") {
        return;
      }

      const params = message.params ?? {};
      const turn = params.turn ?? {};
      const threadId = typeof params.threadId === "string" ? params.threadId : null;
      const turnId = typeof turn.id === "string" ? turn.id : null;
      if (!threadId || !turnId) {
        return;
      }

      for (const turnState of state.turnRequestById.values()) {
        if (turnState.threadId === threadId && !turnState.turnId) {
          turnState.turnId = turnId;
          state.turnStateById.set(turnId, turnState);
          return;
        }
      }
    }

    function trackTurnStartResponse(message) {
      if (!message || typeof message !== "object" || !("id" in message)) {
        return;
      }

      const responseId = message.id;
      const turnState = state.turnRequestById.get(responseId);
      const turnId = message?.result?.turn?.id;
      if (!turnState || typeof turnId !== "string") {
        return;
      }

      turnState.turnId = turnId;
      state.turnStateById.set(turnId, turnState);
    }

    function trackAgentDelta(message) {
      if (message?.method !== "item/agentMessage/delta") {
        return;
      }

      const params = message.params ?? {};
      const turnId = typeof params.turnId === "string" ? params.turnId : null;
      const delta = typeof params.delta === "string" ? params.delta : "";
      if (!turnId || !delta) {
        return;
      }

      const turnState = state.turnStateById.get(turnId);
      if (turnState) {
        turnState.assistantText += delta;
      }
    }

    function trackItemCompleted(message) {
      if (message?.method !== "item/completed") {
        return;
      }

      const params = message.params ?? {};
      const turnId = typeof params.turnId === "string" ? params.turnId : null;
      const item = params.item;
      if (!turnId) {
        return;
      }

      const turnState = state.turnStateById.get(turnId);
      if (!turnState) {
        return;
      }

      const assistantText = extractAssistantTextFromItem(item);
      if (assistantText && !turnState.assistantText) {
        turnState.assistantText = assistantText;
      }

      const toolSummary = extractToolSummary(item);
      if (toolSummary) {
        turnState.toolSummaries.push(toolSummary);
      }
    }

    async function trackTurnCompleted(message) {
      if (message?.method !== "turn/completed") {
        return;
      }

      const params = message.params ?? {};
      const turnId = params?.turn?.id;
      if (typeof turnId !== "string") {
        return;
      }

      const turnState = state.turnStateById.get(turnId);
      if (!turnState) {
        return;
      }

      try {
        await finalizeTurn(turnState);
      } catch (error) {
        console.error(
          `[memory-codex-proxy] finalize-turn degraded: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      } finally {
        state.turnStateById.delete(turnId);
        if (turnState.requestId !== null) {
          state.turnRequestById.delete(turnState.requestId);
        }
      }
    }

    clientSocket.on("message", async (rawMessage, isBinary) => {
      const messageText = isBinary ? rawMessage.toString() : rawMessage.toString();
      const payload = safeJsonParse(messageText);
      if (!payload || typeof payload !== "object") {
        clientSocket.send(JSON.stringify(createJsonRpcError(null, -32700, "Parse error")));
        return;
      }

      if (payload.method === "turn/start") {
        await handleTurnStart(payload);
        return;
      }

      forwardToUpstream(messageText);
    });

    upstreamSocket.on("open", () => {
      upstreamReady = true;
      for (const message of bufferedMessages.splice(0)) {
        upstreamSocket.send(message);
      }
    });

    upstreamSocket.on("message", async (rawMessage, isBinary) => {
      const messageText = isBinary ? rawMessage.toString() : rawMessage.toString();
      const payload = safeJsonParse(messageText);
      if (payload) {
        trackTurnStartResponse(payload);
        trackTurnStarted(payload);
        trackAgentDelta(payload);
        trackItemCompleted(payload);
        await trackTurnCompleted(payload);
      }

      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(messageText);
      }
    });

    function closePeer(socket, code, reason) {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(code, reason);
      }
    }

    clientSocket.on("close", () => {
      closePeer(upstreamSocket, 1000, "client closed");
    });

    clientSocket.on("error", (error) => {
      console.error(`[memory-codex-proxy] client error: ${error instanceof Error ? error.message : String(error)}`);
      closePeer(upstreamSocket, 1011, "client error");
    });

    upstreamSocket.on("close", (code, reason) => {
      closePeer(clientSocket, code, reason.toString());
    });

    upstreamSocket.on("error", (error) => {
      console.error(
        `[memory-codex-proxy] upstream error: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(
          JSON.stringify(
            createJsonRpcError(null, -32000, error instanceof Error ? error.message : String(error)),
          ),
        );
      }
      closePeer(clientSocket, 1011, "upstream error");
    });
  });

  server.listen(Number(listenUrl.port), listenUrl.hostname, () => {
    process.stdout.write(`[memory-codex-proxy] listening on ${proxyListenUrl}\n`);
  });
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;

if (entryUrl && import.meta.url === entryUrl) {
  startServer();
}
