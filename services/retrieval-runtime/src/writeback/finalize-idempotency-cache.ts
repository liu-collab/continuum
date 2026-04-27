import type { AppConfig } from "../config.js";
import { SmallCache } from "../shared/small-cache.js";
import type { FinalizeIdempotencyCacheStats, FinalizeTurnResponse } from "../shared/types.js";

export class FinalizeIdempotencyCache {
  private readonly cache: SmallCache<string, FinalizeTurnResponse>;
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly config: AppConfig,
  ) {
    this.cache = new SmallCache({
      ttlMs: config.FINALIZE_IDEMPOTENCY_TTL_MS,
      maxEntries: config.FINALIZE_IDEMPOTENCY_MAX_ENTRIES,
    });
  }

  async get(key: string): Promise<FinalizeTurnResponse | null> {
    const cached = this.cache.get(key);
    if (cached) {
      this.hits += 1;
      return cached;
    }

    this.misses += 1;
    return null;
  }

  async set(key: string, response: FinalizeTurnResponse): Promise<void> {
    this.cache.set(key, response);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  stats(): FinalizeIdempotencyCacheStats {
    const total = this.hits + this.misses;
    return {
      enabled: true,
      entries: this.cache.size(),
      max_entries: this.config.FINALIZE_IDEMPOTENCY_MAX_ENTRIES,
      ttl_ms: this.config.FINALIZE_IDEMPOTENCY_TTL_MS,
      hits: this.hits,
      misses: this.misses,
      hit_rate: total === 0 ? 0 : this.hits / total,
    };
  }

  ttlMs(): number {
    return this.config.FINALIZE_IDEMPOTENCY_TTL_MS;
  }
}
