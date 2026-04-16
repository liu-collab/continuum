type CacheEntry<T> = {
  expiresAt: number;
  value: Promise<T>;
};

declare global {
  var __AGENT_MEMORY_VIZ_CACHE__: Map<string, CacheEntry<unknown>> | undefined;
}

function getStore() {
  if (!globalThis.__AGENT_MEMORY_VIZ_CACHE__) {
    globalThis.__AGENT_MEMORY_VIZ_CACHE__ = new Map();
  }

  return globalThis.__AGENT_MEMORY_VIZ_CACHE__;
}

export function getCachedValue<T>(key: string, ttlMs: number, loader: () => Promise<T>) {
  const store = getStore();
  const now = Date.now();
  const existing = store.get(key);

  if (existing && existing.expiresAt > now) {
    return existing.value as Promise<T>;
  }

  const value = loader().catch((error) => {
    store.delete(key);
    throw error;
  });

  store.set(key, {
    expiresAt: now + ttlMs,
    value
  });

  return value;
}
