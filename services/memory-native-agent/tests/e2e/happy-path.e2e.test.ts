import { afterEach, describe, expect, it } from "vitest";

import { createE2eStack, createSession, runTurn } from "./setup.js";

describe("memory-native-agent e2e happy path", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).reverse().map((cleanup) => cleanup()));
  });

  it("writes preference memory through runtime+storage and restores it on the next session", async () => {
    const stack = await createE2eStack();
    cleanups.push(() => stack.close());

    const firstSession = await createSession(stack);
    const firstTurn = await runTurn(firstSession.ws_url, {
      turnId: "turn-remember",
      text: "请记住，我偏好使用 TypeScript。",
    });

    await stack.workerDrain();

    const secondSession = await createSession(stack);
    const secondTurn = await runTurn(secondSession.ws_url, {
      turnId: "turn-recall",
      text: "我偏好什么语言？",
    });

    const injectedBanner = secondTurn.find((event) => event.kind === "injection_banner");
    expect(firstTurn.some((event) => event.kind === "turn_end")).toBe(true);
    expect(secondTurn.some((event) => event.kind === "turn_end")).toBe(true);
    expect(injectedBanner).toBeTruthy();
    expect(
      String((injectedBanner as { injection?: { memory_summary?: string } }).injection?.memory_summary ?? "").toLowerCase(),
    ).toContain("typescript");

    const records = await stack.storageService?.listRecords({
      workspace_id: stack.ids.workspace,
      user_id: stack.ids.user,
      page: 1,
      page_size: 50,
    });
    expect(records?.items.some((record) => String(record.summary).toLowerCase().includes("typescript"))).toBe(true);

    const phaseResults = secondTurn.filter((event) => event.kind === "phase_result");
    const traceId = String(phaseResults.find((event) => event.phase === "before_response")?.trace_id ?? "");
    expect(traceId).not.toBe("");

    const runs = await stack.runtimeRepository?.getRuns({ page: 1, page_size: 50 });
    const writebackSubmissions = (runs?.writeback_submissions as Array<Record<string, unknown>> | undefined) ?? [];
    expect(
      writebackSubmissions.some(
        (entry) =>
          entry.phase === "after_response" &&
          Number(entry.submitted_count ?? 0) > 0,
      ),
    ).toBe(true);
  }, 20_000);
});
