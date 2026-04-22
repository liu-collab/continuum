import { describe, expect, it, vi } from "vitest";

import { EmbeddingCache } from "../embedding-cache.js";
import { MemoryCache } from "../memory-cache.js";
import { ToolResultCache } from "../tool-result-cache.js";

describe("cache helpers", () => {
  it("expires memory cache entries and records stats", () => {
    vi.useFakeTimers();
    try {
      const cache = new MemoryCache<string>({ maxEntries: 2 });

      cache.set("a", "one", 100);
      expect(cache.get("a")).toBe("one");

      vi.advanceTimersByTime(101);

      expect(cache.get("a")).toBeNull();
      expect(cache.stats()).toMatchObject({
        hits: 1,
        misses: 1,
        sets: 1,
        evictions: 1,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("evicts the oldest memory cache entry when max entries is exceeded", () => {
    const cache = new MemoryCache<string>({ maxEntries: 2 });

    cache.set("a", "one");
    cache.set("b", "two");
    cache.set("c", "three");

    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBe("two");
    expect(cache.get("c")).toBe("three");
  });

  it("stores embedding cache values", () => {
    const cache = new EmbeddingCache();
    const value = { vector: [1, 2, 3] };

    cache.set("model:hash", value);

    expect(cache.get<typeof value>("model:hash")).toEqual(value);
    expect(cache.stats().hits).toBe(1);
  });

  it("stores tool results with a short ttl wrapper", () => {
    vi.useFakeTimers();
    try {
      const cache = new ToolResultCache();
      const result = {
        ok: true,
        content: [{ type: "text" as const, text: "done" }],
      };

      cache.set("tool-key", result, 50);
      expect(cache.get("tool-key")).toEqual(result);

      vi.advanceTimersByTime(60);

      expect(cache.get("tool-key")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
