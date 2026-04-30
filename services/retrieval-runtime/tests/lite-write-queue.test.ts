import { describe, expect, it } from "vitest";

import { LiteWriteQueue } from "../src/lite/write-queue.js";

describe("LiteWriteQueue", () => {
  it("serializes concurrent writes in enqueue order", async () => {
    const queue = new LiteWriteQueue();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;

    const first = queue.enqueue(async () => {
      events.push("start-1");
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      events.push("end-1");
      return "first";
    });
    const second = queue.enqueue(async () => {
      events.push("start-2");
      return "second";
    });

    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(events).toEqual(["start-1"]);
    expect(queue.stats().pending).toBe(2);

    releaseFirst?.();
    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
    expect(events).toEqual(["start-1", "end-1", "start-2"]);
    expect(queue.stats().pending).toBe(0);
  });

  it("keeps processing later writes after one operation fails", async () => {
    const queue = new LiteWriteQueue();
    const failed = queue.enqueue(async () => {
      throw new Error("write failed");
    });
    const succeeded = queue.enqueue(async () => "ok");

    await expect(failed).rejects.toThrow("write failed");
    await expect(succeeded).resolves.toBe("ok");
    expect(queue.stats()).toMatchObject({ pending: 0 });
  });
});
