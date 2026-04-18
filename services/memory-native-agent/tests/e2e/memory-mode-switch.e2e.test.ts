import { afterEach, describe, expect, it } from "vitest";

import { createE2eStack, createSession, runTurn, updateSessionMode } from "./setup.js";

describe("memory-native-agent e2e memory mode switch", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).reverse().map((cleanup) => cleanup()));
  });

  it("hides user-scope memory after switching to workspace_only", async () => {
    const stack = await createE2eStack();
    cleanups.push(() => stack.close());

    const seedSession = await createSession(stack);
    await runTurn(seedSession.ws_url, {
      turnId: "turn-seed-preference",
      text: "请记住，我偏好使用 TypeScript。",
    });
    await stack.workerDrain();

    const targetSession = await createSession(stack, {
      memory_mode: "workspace_plus_global",
    });
    await updateSessionMode(stack, targetSession.session_id, "workspace_only");

    const events = await runTurn(targetSession.ws_url, {
      turnId: "turn-workspace-only",
      text: "我偏好什么语言？",
    });

    const banner = events.find((event) => event.kind === "injection_banner");
    const assistantText = events
      .filter((event) => event.kind === "assistant_delta")
      .map((event) => String(event.text ?? ""))
      .join("");

    expect(banner).toBeTruthy();
    expect(String((banner as { injection?: { memory_summary?: string } }).injection?.memory_summary ?? "")).not.toContain(
      "TypeScript",
    );
    expect(assistantText).toContain("当前没有恢复到相关偏好");
  }, 20_000);
});
