import { describe, expect, it } from "vitest";

import { SmallCache } from "../src/shared/small-cache.js";

describe("SmallCache", () => {
  it("returns stored values until they expire", () => {
    let now = 1_000;
    const cache = new SmallCache<string, number>({
      ttlMs: 50,
      maxEntries: 10,
      now: () => now,
    });

    cache.set("a", 1);

    expect(cache.ttlMs()).toBe(50);
    expect(cache.maxEntries()).toBe(10);
    expect(cache.get("a")).toBe(1);

    now += 50;

    expect(cache.get("a")).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it("evicts the least recently used entry when full", () => {
    const cache = new SmallCache<string, number>({
      ttlMs: 1_000,
      maxEntries: 2,
    });

    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);

    cache.set("c", 3);

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
  });

  it("replaces existing values without growing", () => {
    const cache = new SmallCache<string, number>({
      ttlMs: 1_000,
      maxEntries: 2,
    });

    cache.set("a", 1);
    cache.set("a", 2);

    expect(cache.size()).toBe(1);
    expect(cache.get("a")).toBe(2);
  });

  it("supports delete and clear", () => {
    const cache = new SmallCache<string, number>({
      ttlMs: 1_000,
      maxEntries: 2,
    });

    cache.set("a", 1);
    cache.set("b", 2);

    expect(cache.delete("a")).toBe(true);
    expect(cache.delete("a")).toBe(false);
    expect(cache.get("a")).toBeUndefined();

    cache.clear();

    expect(cache.size()).toBe(0);
    expect(cache.get("b")).toBeUndefined();
  });

  it("treats expired entries as missing when deleted", () => {
    let now = 1_000;
    const cache = new SmallCache<string, number>({
      ttlMs: 50,
      maxEntries: 2,
      now: () => now,
    });

    cache.set("a", 1);
    now += 50;

    expect(cache.delete("a")).toBe(false);
    expect(cache.size()).toBe(0);
  });

  it("prunes expired entries before enforcing the max size", () => {
    let now = 1_000;
    const cache = new SmallCache<string, number>({
      ttlMs: 50,
      maxEntries: 1,
      now: () => now,
    });

    cache.set("expired", 1);
    now += 50;
    cache.set("fresh", 2);

    expect(cache.size()).toBe(1);
    expect(cache.get("expired")).toBeUndefined();
    expect(cache.get("fresh")).toBe(2);
  });

  it("rejects invalid limits", () => {
    expect(() => new SmallCache({ ttlMs: 0, maxEntries: 1 })).toThrow("ttlMs");
    expect(() => new SmallCache({ ttlMs: 1, maxEntries: 0 })).toThrow("maxEntries");
    expect(() => new SmallCache({ ttlMs: 1, maxEntries: 1.5 })).toThrow("maxEntries");
  });
});
