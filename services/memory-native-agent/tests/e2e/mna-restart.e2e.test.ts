import { afterEach, describe, expect, it } from "vitest";

import { createE2eStack, createSession, runTurn } from "./setup.js";

describe("memory-native-agent e2e restart", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).reverse().map((cleanup) => cleanup()));
  });

  it("keeps other services available and can resume on a new session after mna restart", async () => {
    const stack = await createE2eStack({
      withMcp: true,
    });
    cleanups.push(() => stack.close());

    const firstSession = await createSession(stack);
    const firstTurn = await runTurn(firstSession.ws_url, {
      turnId: "turn-before-restart",
      text: "请记住，我偏好使用 TypeScript。",
    });
    await stack.workerDrain();

    expect(firstTurn.some((event) => event.kind === "turn_end")).toBe(true);

    await stack.stopMna();
    expect(stack.runtimeApp).toBeTruthy();
    expect(stack.storageApp).toBeTruthy();

    await stack.restartMna();

    const secondSession = await createSession(stack);
    const secondTurn = await runTurn(secondSession.ws_url, {
      turnId: "turn-after-restart",
      text: "我偏好什么语言？",
    });

    const banner = secondTurn.find((event) => event.kind === "injection_banner");
    const assistantText = secondTurn
      .filter((event) => event.kind === "assistant_delta")
      .map((event) => String(event.text ?? ""))
      .join("");

    expect(secondTurn.some((event) => event.kind === "session_started")).toBe(true);
    expect(secondTurn.some((event) => event.kind === "turn_end")).toBe(true);
    expect(String((banner as { injection?: { memory_summary?: string } } | undefined)?.injection?.memory_summary ?? "").toLowerCase()).toContain(
      "typescript",
    );
    expect(assistantText).toContain("TypeScript");
  }, 20_000);

  it("restores disabled mcp servers from config after mna process restart", async () => {
    const stack = await createE2eStack({
      withMcp: true,
    });
    cleanups.push(() => stack.close());

    const address = stack.mna.server.address();
    if (!address || typeof address === "string") {
      throw new Error("mna address unavailable");
    }

    const disableResponse = await fetch(`http://127.0.0.1:${address.port}/v1/agent/mcp/servers/echo-http/disable`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${stack.mna.mnaToken}`,
      },
    });
    expect(disableResponse.status).toBe(202);
    expect(stack.mna.runtimeState.mcpRegistry.getServerStatus("echo-http").state).toBe("disabled");

    await stack.restartMna();

    await waitForMcpState(stack, "echo-http", "ok");
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
      turn_id: "turn-mcp-after-restart",
      text: "请调用 MCP echo",
    }));

    await waitForEvent(events, (event) => event.kind === "tool_confirm_needed" && event.tool === "mcp_call");
    const confirm = events.find((event) => event.kind === "tool_confirm_needed" && event.tool === "mcp_call");
    ws.send(JSON.stringify({
      kind: "tool_confirm",
      confirm_id: confirm?.confirm_id,
      decision: "allow",
    }));

    await waitForEvent(
      events,
      (event) => event.kind === "tool_call_result" && String(event.call_id) === String(confirm?.call_id),
    );
    await waitForEvent(
      events,
      (event) => event.kind === "turn_end" && event.turn_id === "turn-mcp-after-restart",
    );

    const toolCallResult = events.find(
      (event) => event.kind === "tool_call_result" && String(event.call_id) === String(confirm?.call_id),
    );
    expect(toolCallResult).toMatchObject({
      kind: "tool_call_result",
      ok: true,
      trust_level: "mcp:echo-http",
    });
    ws.close();
  }, 20_000);
});

async function waitForMcpState(
  stack: Awaited<ReturnType<typeof createE2eStack>>,
  serverName: string,
  expectedState: "ok" | "unavailable" | "dead" | "disabled",
  timeoutMs = 5_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = stack.mna.runtimeState.mcpRegistry.getServerStatus(serverName).state;
    if (current === expectedState) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`timed out waiting for mcp server ${serverName} to become ${expectedState}`);
}

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
