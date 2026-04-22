import { MemoryCache } from "./memory-cache.js";

const DEFAULT_EMBEDDING_CACHE_TTL_MS = 30 * 60 * 1000;

export class EmbeddingCache {
  private readonly store = new MemoryCache<unknown>({ maxEntries: 512 });

  get<T>(key: string): T | null {
    return (this.store.get(key) as T | null) ?? null;
  }

  set(key: string, value: unknown, ttlMs = DEFAULT_EMBEDDING_CACHE_TTL_MS) {
    this.store.set(key, value, ttlMs);
  }

  stats() {
    return this.store.stats();
  }
}
