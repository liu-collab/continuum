import { afterEach, describe, expect, it } from "vitest";

import { createE2eStack, createSession, runTurn } from "./setup.js";

describe("memory-native-agent e2e provider mid-stream error", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).reverse().map((cleanup) => cleanup()));
  });

  it("emits error before turn_end when the provider stream crashes mid-response", async () => {
    const stack = await createE2eStack();
    cleanups.push(() => stack.close());

    const session = await createSession(stack);
    const events = await runTurn(session.ws_url, {
      turnId: "turn-mid-stream-error",
      text: "请模拟中途报错",
      settleMs: 50,
    });

    const errorIndex = events.findIndex((event) => event.kind === "error" && event.code === "provider_stream_error");
    const turnEndIndex = events.findIndex(
      (event) => event.kind === "turn_end" && event.turn_id === "turn-mid-stream-error" && event.finish_reason === "error",
    );
    const assistantChunks = events.filter((event) => event.kind === "assistant_delta").map((event) => String(event.text ?? ""));

    expect(errorIndex).toBeGreaterThanOrEqual(0);
    expect(turnEndIndex).toBeGreaterThan(errorIndex);
    expect(assistantChunks.join("")).toContain("先返回一段内容");
  }, 20_000);
});
