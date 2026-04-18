import { afterEach, describe, expect, it } from "vitest";

import { createE2eStack, createSession, fetchDependencyStatus, runTurn } from "./setup.js";

describe("memory-native-agent e2e runtime degrade", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).reverse().map((cleanup) => cleanup()));
  });

  it("keeps the session available when retrieval-runtime is down", async () => {
    const stack = await createE2eStack({
      withRuntime: false,
      withStorage: false,
    });
    cleanups.push(() => stack.close());

    const session = await createSession(stack);
    const events = await runTurn(session.ws_url, {
      turnId: "turn-runtime-down",
      text: "继续回答这个问题。",
    });

    const dependency = await fetchDependencyStatus(stack);
    const banner = events.find((event) => event.kind === "injection_banner" && event.turn_id === "turn-runtime-down");
    const turnEnd = events.find((event) => event.kind === "turn_end");

    expect(turnEnd).toBeTruthy();
    expect(banner).toBeTruthy();
    expect((banner as { degraded?: boolean }).degraded).toBe(true);
    expect((dependency.runtime as { status?: string } | undefined)?.status).toBe("unavailable");
    expect(events.some((event) => event.kind === "assistant_delta")).toBe(true);
  }, 20_000);
});
