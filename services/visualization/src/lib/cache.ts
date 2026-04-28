type CacheEntry<T> = {
  expiresAt: number;
  value: Promise<T>;
};

const MAX_CACHE_ENTRIES = 200;

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
    store.delete(key);
    store.set(key, existing);
    return existing.value as Promise<T>;
  }

  if (existing) {
    store.delete(key);
  }

  const value = loader().catch((error) => {
    if (store.get(key)?.value === value) {
      store.delete(key);
    }
    throw error;
  });

  store.set(key, {
    expiresAt: now + ttlMs,
    value
  });

  evictCacheEntries(store);

  return value;
}

function evictCacheEntries(store: Map<string, CacheEntry<unknown>>) {
  if (store.size <= MAX_CACHE_ENTRIES) {
    return;
  }

  for (const key of store.keys()) {
    store.delete(key);

    if (store.size <= MAX_CACHE_ENTRIES) {
      return;
    }
  }
}
