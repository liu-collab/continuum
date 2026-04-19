import type { AppConfig } from "../config.js";
import type { FinalizeTurnResponse } from "../shared/types.js";

interface CacheEntry {
  response: FinalizeTurnResponse;
  expires_at: number;
}

export class FinalizeIdempotencyCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly config: AppConfig,
  ) {}

  async get(key: string): Promise<FinalizeTurnResponse | null> {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expires_at <= Date.now()) {
      this.entries.delete(key);
      return null;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.response;
  }

  async set(key: string, response: FinalizeTurnResponse): Promise<void> {
    this.pruneExpired();
    this.entries.delete(key);
    this.entries.set(key, {
      response,
      expires_at: Date.now() + this.config.FINALIZE_IDEMPOTENCY_TTL_MS,
    });
    this.enforceMaxEntries();
  }

  private pruneExpired() {
    const now = Date.now();
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expires_at <= now) {
        this.entries.delete(key);
      }
    }
  }

  private enforceMaxEntries() {
    while (this.entries.size > this.config.FINALIZE_IDEMPOTENCY_MAX_ENTRIES) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) {
        return;
      }
      this.entries.delete(oldestKey);
    }
  }
}
