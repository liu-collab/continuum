import { afterEach, describe, expect, it } from "vitest";

import { createE2eStack, createSession, runTurn } from "./setup.js";

describe("memory-native-agent record-replay provider e2e", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).reverse().map((cleanup) => cleanup()));
  });

  it("replays a deterministic fs_read tool turn without the stub provider server", async () => {
    const stack = await createE2eStack({
      providerMode: "record-replay",
    });
    cleanups.push(() => stack.close());

    const session = await createSession(stack);
    const events = await runTurn(session.ws_url, {
      turnId: "turn-record-replay-ui",
      text: "请读取 README.md",
    });

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "tool_call_start", name: "fs_read" }),
        expect.objectContaining({ kind: "tool_call_result", ok: true }),
        expect.objectContaining({ kind: "turn_end", finish_reason: "stop" }),
      ]),
    );
    expect(
      events.some(
        (event) =>
          event.kind === "assistant_delta"
          && String(event.text ?? "").includes("README.md"),
      ),
    ).toBe(true);
  }, 20_000);
});
