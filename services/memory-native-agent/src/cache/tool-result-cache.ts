import type { ToolResult } from "../tools/types.js";
import { MemoryCache } from "./memory-cache.js";

const DEFAULT_TOOL_CACHE_TTL_MS = 15_000;

export interface ToolResultCacheEntry {
  result: ToolResult;
}

export class ToolResultCache {
  private readonly store = new MemoryCache<ToolResultCacheEntry>({ maxEntries: 256 });

  get(key: string): ToolResult | null {
    return this.store.get(key)?.result ?? null;
  }

  set(key: string, result: ToolResult, ttlMs = DEFAULT_TOOL_CACHE_TTL_MS) {
    this.store.set(key, { result }, ttlMs);
  }

  delete(key: string) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }

  stats() {
    return this.store.stats();
  }
}
