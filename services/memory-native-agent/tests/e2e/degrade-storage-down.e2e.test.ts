import { afterEach, describe, expect, it } from "vitest";

import { createE2eStack, createSession, runTurn } from "./setup.js";

describe("memory-native-agent e2e storage degrade", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).reverse().map((cleanup) => cleanup()));
  });

  it("degrades when storage is down and recovers after storage restarts", async () => {
    const stack = await createE2eStack();
    cleanups.push(() => stack.close());

    const seedSession = await createSession(stack);
    await runTurn(seedSession.ws_url, {
      turnId: "turn-seed-storage",
      text: "请记住，我偏好使用 TypeScript。",
      settleMs: 150,
    });
    await stack.workerDrain();

    await stack.stopStorage();

    const degradedSession = await createSession(stack);
    const degradedEvents = await runTurn(degradedSession.ws_url, {
      turnId: "turn-storage-down",
      text: "请记住，我偏好使用 TypeScript。",
      settleMs: 250,
    });

    const degradedBanner = degradedEvents.find(
      (event) => event.kind === "injection_banner" && event.turn_id === "turn-storage-down",
    );
    expect(degradedEvents.some((event) => event.kind === "turn_end")).toBe(true);
    expect((degradedBanner as { degraded?: boolean } | undefined)?.degraded).toBe(true);

    const degradedRuns = await stack.runtimeRepository?.getRuns({ page: 1, page_size: 50 });
    const failedWriteback = (degradedRuns?.writeback_submissions as Array<Record<string, unknown>> | undefined) ?? [];
    expect(
      failedWriteback.some(
        (entry) =>
          entry.phase === "after_response" &&
          entry.result_state === "failed" &&
          entry.degradation_reason === "dependency_unavailable",
      ),
    ).toBe(true);

    await stack.restartStorage();

    const recoveredSession = await createSession(stack);
    const recoveredEvents = await runTurn(recoveredSession.ws_url, {
      turnId: "turn-storage-restored",
      text: "我偏好什么语言？",
      settleMs: 150,
    });

    const recoveredBanner = recoveredEvents.find(
      (event) => event.kind === "injection_banner" && event.turn_id === "turn-storage-restored",
    );
    expect((recoveredBanner as { degraded?: boolean } | undefined)?.degraded).toBe(false);
    expect(
      String((recoveredBanner as { injection?: { memory_summary?: string } } | undefined)?.injection?.memory_summary ?? "").toLowerCase(),
    ).toContain("typescript");
  }, 20_000);
});
