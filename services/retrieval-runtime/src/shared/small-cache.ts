export interface SmallCacheOptions {
  ttlMs: number;
  maxEntries: number;
  now?: () => number;
}

interface SmallCacheEntry<Value> {
  value: Value;
  expiresAt: number;
}

export class SmallCache<Key, Value> {
  private readonly entries = new Map<Key, SmallCacheEntry<Value>>();
  private readonly ttlMsValue: number;
  private readonly maxEntriesValue: number;
  private readonly now: () => number;

  constructor(options: SmallCacheOptions) {
    if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) {
      throw new Error("SmallCache ttlMs must be a positive number");
    }
    if (!Number.isInteger(options.maxEntries) || options.maxEntries <= 0) {
      throw new Error("SmallCache maxEntries must be a positive integer");
    }

    this.ttlMsValue = options.ttlMs;
    this.maxEntriesValue = options.maxEntries;
    this.now = options.now ?? Date.now;
  }

  get(key: Key): Value | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }

    const now = this.now();
    if (this.isExpired(entry, now)) {
      this.entries.delete(key);
      return undefined;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: Key, value: Value): void {
    this.pruneExpired();
    this.entries.delete(key);
    this.entries.set(key, {
      value,
      expiresAt: this.now() + this.ttlMsValue,
    });
    this.enforceMaxEntries();
  }

  delete(key: Key): boolean {
    const entry = this.entries.get(key);
    if (!entry) {
      return false;
    }

    if (this.isExpired(entry, this.now())) {
      this.entries.delete(key);
      return false;
    }

    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    this.pruneExpired();
    return this.entries.size;
  }

  ttlMs(): number {
    return this.ttlMsValue;
  }

  maxEntries(): number {
    return this.maxEntriesValue;
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.entries.entries()) {
      if (this.isExpired(entry, now)) {
        this.entries.delete(key);
      }
    }
  }

  private enforceMaxEntries(): void {
    while (this.entries.size > this.maxEntriesValue) {
      const oldest = this.entries.keys().next();
      if (oldest.done) {
        return;
      }
      this.entries.delete(oldest.value);
    }
  }

  private isExpired(entry: SmallCacheEntry<Value>, now: number): boolean {
    return entry.expiresAt <= now;
  }
}
