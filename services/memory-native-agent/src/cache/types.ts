export interface CacheEntry<T> {
  value: T;
  expiresAt: number | null;
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  evictions: number;
}

export interface CacheStore<T> {
  get(key: string): T | null;
  set(key: string, value: T, ttlMs?: number): void;
  delete(key: string): void;
  clear(): void;
  stats(): CacheStats;
}
