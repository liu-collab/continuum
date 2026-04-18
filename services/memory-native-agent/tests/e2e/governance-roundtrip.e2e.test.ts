import { afterEach, describe, expect, it } from "vitest";

import { createE2eStack, createSession, runTurn } from "./setup.js";

describe("memory-native-agent e2e governance roundtrip", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).reverse().map((cleanup) => cleanup()));
  });

  it("stops injecting a memory after the record is invalidated", async () => {
    const stack = await createE2eStack();
    cleanups.push(() => stack.close());

    const seedSession = await createSession(stack);
    await runTurn(seedSession.ws_url, {
      turnId: "turn-governance-seed",
      text: "请记住，我偏好使用 TypeScript。",
      settleMs: 150,
    });
    await stack.workerDrain();

    const seededRecords = await stack.storageService?.listRecords({
      workspace_id: stack.ids.workspace,
      user_id: stack.ids.user,
      page: 1,
      page_size: 50,
    });
    const targetRecord = seededRecords?.items.find((record) => String(record.summary).toLowerCase().includes("typescript"));
    expect(targetRecord).toBeTruthy();

    await stack.invalidateRecord(String(targetRecord?.id), {
      actor_type: "operator",
      actor_id: "e2e-governance",
      reason: "e2e invalidate incorrect preference",
    });
    await stack.storageService?.processWriteJobs();

    const recallSession = await createSession(stack);
    const events = await runTurn(recallSession.ws_url, {
      turnId: "turn-governance-recall",
      text: "我偏好什么语言？",
      settleMs: 150,
    });

    const banner = events.find((event) => event.kind === "injection_banner");
    const assistantText = events
      .filter((event) => event.kind === "assistant_delta")
      .map((event) => String(event.text ?? ""))
      .join("");

    expect(String((banner as { injection?: { memory_summary?: string } } | undefined)?.injection?.memory_summary ?? "")).not.toContain(
      "TypeScript",
    );
    expect(assistantText).toContain("当前没有恢复到相关偏好");

    const updatedRecords = await stack.storageService?.listRecords({
      workspace_id: stack.ids.workspace,
      user_id: stack.ids.user,
      page: 1,
      page_size: 50,
    });
    const invalidated = updatedRecords?.items.find((record) => String(record.id) === String(targetRecord?.id));
    expect(invalidated?.status).toBe("archived");
  }, 20_000);
});
