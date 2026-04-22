import type { CacheEntry, CacheStats, CacheStore } from "./types.js";

export interface MemoryCacheOptions {
  maxEntries?: number;
}

export class MemoryCache<T> implements CacheStore<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly maxEntries: number;
  private readonly counters: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    evictions: 0,
  };

  constructor(options: MemoryCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 256;
  }

  get(key: string): T | null {
    const entry = this.entries.get(key);
    if (!entry) {
      this.counters.misses += 1;
      return null;
    }

    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      this.counters.misses += 1;
      this.counters.evictions += 1;
      return null;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    this.counters.hits += 1;
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }

    this.entries.set(key, {
      value,
      expiresAt: typeof ttlMs === "number" ? Date.now() + ttlMs : null,
    });
    this.counters.sets += 1;

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) {
        break;
      }
      this.entries.delete(oldestKey);
      this.counters.evictions += 1;
    }
  }

  delete(key: string): void {
    if (this.entries.delete(key)) {
      this.counters.evictions += 1;
    }
  }

  clear(): void {
    this.entries.clear();
  }

  stats(): CacheStats {
    return { ...this.counters };
  }
}
