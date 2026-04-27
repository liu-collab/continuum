import type { AppConfig } from "../config.js";
import {
  hasCompleteRuntimeEmbeddingConfig,
  resolveRuntimeEmbeddingConfig,
} from "../embedding-config.js";
import { fetchWithTimeout } from "../shared/fetch.js";
import { SmallCache } from "../shared/small-cache.js";
import type { EmbeddingCacheStats } from "../shared/types.js";
import { normalizeText } from "../shared/utils.js";

export interface EmbeddingsClient {
  embedText(text: string, signal?: AbortSignal): Promise<number[]>;
}

export interface EmbeddingCacheProvider {
  stats(): EmbeddingCacheStats;
  clear(): void;
}

export class HttpEmbeddingsClient implements EmbeddingsClient {
  constructor(private readonly config: AppConfig) {}

  isConfigured() {
    return hasCompleteRuntimeEmbeddingConfig(this.config);
  }

  async embedText(text: string, signal?: AbortSignal): Promise<number[]> {
    const activeConfig = resolveRuntimeEmbeddingConfig(this.config);
    if (!activeConfig.baseUrl || !activeConfig.model) {
      throw new Error("embedding config is not complete");
    }

    const response = await fetchWithTimeout(this.buildEmbeddingsUrl(activeConfig.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(activeConfig.apiKey ? { authorization: `Bearer ${activeConfig.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: activeConfig.model,
        input: text,
      }),
      signal,
      timeoutMs: this.config.EMBEDDING_TIMEOUT_MS,
      timeoutReason: "embeddings_timeout",
    });

    if (!response.ok) {
      throw new Error(`embeddings request failed with ${response.status}`);
    }

    const payload = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
    const embedding = payload.data?.[0]?.embedding;

    if (!embedding || !Array.isArray(embedding)) {
      throw new Error("embeddings response did not include an embedding vector");
    }

    return embedding;
  }

  private buildEmbeddingsUrl(baseUrl: string) {
    return new URL("./embeddings", `${baseUrl.replace(/\/+$/, "")}/`);
  }
}

export class CachedEmbeddingsClient implements EmbeddingsClient, EmbeddingCacheProvider {
  private readonly cache?: SmallCache<string, number[]>;
  private readonly inflight = new Map<string, Promise<number[]>>();
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly inner: EmbeddingsClient,
    private readonly config: Pick<AppConfig,
      | "EMBEDDING_BASE_URL"
      | "EMBEDDING_MODEL"
      | "CONTINUUM_EMBEDDING_CONFIG_PATH"
      | "EMBEDDING_CACHE_TTL_MS"
      | "EMBEDDING_CACHE_MAX_ENTRIES"
    >,
  ) {
    if (config.EMBEDDING_CACHE_TTL_MS > 0 && config.EMBEDDING_CACHE_MAX_ENTRIES > 0) {
      this.cache = new SmallCache<string, number[]>({
        ttlMs: config.EMBEDDING_CACHE_TTL_MS,
        maxEntries: config.EMBEDDING_CACHE_MAX_ENTRIES,
      });
    }
  }

  async embedText(text: string, signal?: AbortSignal): Promise<number[]> {
    if (!this.cache) {
      this.misses += 1;
      return this.inner.embedText(text, signal);
    }

    const key = this.buildCacheKey(text);
    const cached = this.cache.get(key);
    if (cached) {
      this.hits += 1;
      return [...cached];
    }

    const existing = this.inflight.get(key);
    if (existing) {
      this.hits += 1;
      return [...await existing];
    }

    this.misses += 1;
    const request = this.inner.embedText(text, signal)
      .then((embedding) => {
        this.cache?.set(key, [...embedding]);
        return embedding;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, request);
    return [...await request];
  }

  stats(): EmbeddingCacheStats {
    const total = this.hits + this.misses;
    return {
      enabled: Boolean(this.cache),
      entries: this.cache?.size() ?? 0,
      max_entries: this.cache?.maxEntries() ?? 0,
      ttl_ms: this.cache?.ttlMs() ?? 0,
      hits: this.hits,
      misses: this.misses,
      hit_rate: total === 0 ? 0 : this.hits / total,
    };
  }

  clear(): void {
    this.cache?.clear();
    this.inflight.clear();
    this.hits = 0;
    this.misses = 0;
  }

  private buildCacheKey(text: string): string {
    const activeConfig = resolveRuntimeEmbeddingConfig(this.config);
    return JSON.stringify({
      base_url: activeConfig.baseUrl ?? this.config.EMBEDDING_BASE_URL ?? null,
      model: activeConfig.model ?? this.config.EMBEDDING_MODEL,
      input: normalizeText(text),
    });
  }
}
