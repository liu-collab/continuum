import { afterEach, describe, expect, it } from "vitest";

import { createE2eStack, createSession } from "./setup.js";

describe("memory-native-agent e2e mcp call", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).reverse().map((cleanup) => cleanup()));
  });

  it("completes an mcp_call turn after confirmation", async () => {
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

    ws.send(JSON.stringify({
      kind: "user_input",
      turn_id: "turn-mcp-call",
      text: "请调用 MCP echo",
    }));

    await waitForEvent(events, (event) => event.kind === "tool_confirm_needed" && event.tool === "mcp_call");
    const confirm = events.find((event) => event.kind === "tool_confirm_needed" && event.tool === "mcp_call");
    expect(confirm).toBeTruthy();

    ws.send(JSON.stringify({
      kind: "tool_confirm",
      confirm_id: confirm?.confirm_id,
      decision: "allow",
    }));

    await waitForEvent(events, (event) => event.kind === "tool_call_result" && String(event.call_id) === String(confirm?.call_id));
    await waitForEvent(events, (event) => event.kind === "turn_end" && event.turn_id === "turn-mcp-call");

    const toolResult = events.find((event) => event.kind === "tool_call_result" && String(event.call_id) === String(confirm?.call_id));
    const assistantText = events
      .filter((event) => event.kind === "assistant_delta" && event.turn_id === "turn-mcp-call")
      .map((event) => String(event.text ?? ""))
      .join("");

    expect(toolResult).toMatchObject({
      kind: "tool_call_result",
      ok: true,
      trust_level: "mcp:echo-http",
    });
    expect(assistantText).toContain("MCP 调用已经完成");

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
