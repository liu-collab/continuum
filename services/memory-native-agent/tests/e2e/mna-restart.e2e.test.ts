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
});
