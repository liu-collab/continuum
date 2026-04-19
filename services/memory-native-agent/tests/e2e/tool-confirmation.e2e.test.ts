import { afterEach, describe, expect, it } from "vitest";

import { createE2eStack, createSession } from "./setup.js";

describe("memory-native-agent e2e tool confirmation", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).reverse().map((cleanup) => cleanup()));
  });

  it("emits confirmation events for fs_write and mcp_call", async () => {
    const stack = await createE2eStack({
      withMcp: true,
    });
    cleanups.push(() => stack.close());

    const session = await createSession(stack);
    const ws = new WebSocket(session.ws_url);
    const events: Array<Record<string, unknown>> = [];

    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("websocket open failed")), { once: true });
    });

    ws.addEventListener("message", (event) => {
      events.push(JSON.parse(String(event.data)) as Record<string, unknown>);
    });

    const writeTurnId = "turn-write-confirm";
    ws.send(JSON.stringify({
      kind: "user_input",
      turn_id: writeTurnId,
      text: "请创建文件",
    }));

    await waitForEvent(events, (event) => event.kind === "tool_confirm_needed" && event.tool === "fs_write");
    const writeConfirm = events.find((event) => event.kind === "tool_confirm_needed" && event.tool === "fs_write");
    expect(writeConfirm).toBeTruthy();
    ws.send(JSON.stringify({
      kind: "tool_confirm",
      confirm_id: writeConfirm?.confirm_id,
      decision: "deny",
    }));
    await waitForEvent(events, (event) => event.kind === "tool_call_result" && String(event.call_id) === String(writeConfirm?.call_id));

    const mcpTurnId = "turn-mcp-confirm";
    ws.send(JSON.stringify({
      kind: "user_input",
      turn_id: mcpTurnId,
      text: "请调用 MCP echo",
    }));

    await waitForEvent(events, (event) => event.kind === "tool_confirm_needed" && event.tool === "mcp_call");
    const mcpConfirm = events.find((event) => event.kind === "tool_confirm_needed" && event.tool === "mcp_call");
    expect(mcpConfirm).toBeTruthy();
    ws.send(JSON.stringify({
      kind: "tool_confirm",
      confirm_id: mcpConfirm?.confirm_id,
      decision: "allow",
    }));
    await waitForEvent(events, (event) => event.kind === "tool_call_result" && String(event.call_id) === String(mcpConfirm?.call_id));

    ws.close();
  }, 20_000);
});

async function waitForEvent(
  events: Array<Record<string, unknown>>,
  matcher: (event: Record<string, unknown>) => boolean,
  timeoutMs = 8_000,
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (events.some(matcher)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`timed out waiting for expected event. events=${JSON.stringify(events)}`);
}
