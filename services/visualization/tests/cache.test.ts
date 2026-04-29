import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCachedValue } from "@/lib/cache";

describe("in-memory cache", () => {
  beforeEach(() => {
    globalThis.__AXIS_VIZ_CACHE__ = undefined;
    vi.spyOn(Date, "now").mockReturnValue(1_000);
  });

  afterEach(() => {
    globalThis.__AXIS_VIZ_CACHE__ = undefined;
    vi.restoreAllMocks();
  });

  it("reuses a cached promise until it expires", async () => {
    const loader = vi.fn(async () => "cached");
    const nextLoader = vi.fn(async () => "next");

    await expect(getCachedValue("status", 1_000, loader)).resolves.toBe("cached");
    await expect(getCachedValue("status", 1_000, nextLoader)).resolves.toBe("cached");

    expect(loader).toHaveBeenCalledTimes(1);
    expect(nextLoader).not.toHaveBeenCalled();
  });

  it("reloads expired entries", async () => {
    const nowSpy = vi.mocked(Date.now);
    const loader = vi.fn(async () => "first");
    const nextLoader = vi.fn(async () => "second");

    await expect(getCachedValue("status", 1_000, loader)).resolves.toBe("first");
    nowSpy.mockReturnValue(2_001);
    await expect(getCachedValue("status", 1_000, nextLoader)).resolves.toBe("second");

    expect(loader).toHaveBeenCalledTimes(1);
    expect(nextLoader).toHaveBeenCalledTimes(1);
  });

  it("evicts the least recently used entry when capacity is exceeded", async () => {
    for (let index = 0; index < 200; index += 1) {
      await getCachedValue(`key-${index}`, 10_000, async () => index);
    }

    const hotLoader = vi.fn(async () => 999);
    await expect(getCachedValue("key-0", 10_000, hotLoader)).resolves.toBe(0);

    await getCachedValue("key-200", 10_000, async () => 200);

    const evictedLoader = vi.fn(async () => 1_001);
    const stillCachedLoader = vi.fn(async () => 1_000);

    await expect(getCachedValue("key-1", 10_000, evictedLoader)).resolves.toBe(1_001);
    await expect(getCachedValue("key-0", 10_000, stillCachedLoader)).resolves.toBe(0);

    expect(hotLoader).not.toHaveBeenCalled();
    expect(evictedLoader).toHaveBeenCalledTimes(1);
    expect(stillCachedLoader).not.toHaveBeenCalled();
  });

  it("removes failed entries so the next request can retry", async () => {
    const error = new Error("probe failed");
    const loader = vi.fn(async () => {
      throw error;
    });
    const retryLoader = vi.fn(async () => "recovered");

    await expect(getCachedValue("status", 1_000, loader)).rejects.toThrow("probe failed");
    await expect(getCachedValue("status", 1_000, retryLoader)).resolves.toBe("recovered");

    expect(loader).toHaveBeenCalledTimes(1);
    expect(retryLoader).toHaveBeenCalledTimes(1);
  });
});
