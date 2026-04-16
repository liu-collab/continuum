import "server-only";

declare global {
  var __AGENT_MEMORY_VIZ_LAST_OK_BY_SOURCE__: Map<string, string> | undefined;
}

function getLastOkMap() {
  if (!globalThis.__AGENT_MEMORY_VIZ_LAST_OK_BY_SOURCE__) {
    globalThis.__AGENT_MEMORY_VIZ_LAST_OK_BY_SOURCE__ = new Map<string, string>();
  }

  return globalThis.__AGENT_MEMORY_VIZ_LAST_OK_BY_SOURCE__;
}

export function rememberSourceSuccess(sourceName: string, timestamp: string) {
  getLastOkMap().set(sourceName, timestamp);
}

export function readSourceLastOk(sourceName: string) {
  return getLastOkMap().get(sourceName) ?? null;
}
