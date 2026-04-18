import type { AgentLocale } from "./openapi-types";

export const DEFAULT_MNA_BASE_URL = "http://127.0.0.1:4193";
export const DEFAULT_AGENT_LOCALE: AgentLocale = "zh-CN";

export function resolveBrowserLocale(preferredLocale?: string | null): AgentLocale {
  const rawLocale = preferredLocale ?? (typeof navigator === "undefined" ? DEFAULT_AGENT_LOCALE : navigator.language);
  return rawLocale.toLowerCase().startsWith("en") ? "en-US" : "zh-CN";
}

export function toWebSocketUrl(baseUrl: string, sessionId: string, token: string, lastEventId?: number) {
  const normalized = new URL(baseUrl);
  normalized.protocol = normalized.protocol === "https:" ? "wss:" : "ws:";
  normalized.pathname = `/v1/agent/sessions/${sessionId}/ws`;
  normalized.searchParams.set("token", token);

  if (typeof lastEventId === "number" && Number.isFinite(lastEventId)) {
    normalized.searchParams.set("last_event_id", String(lastEventId));
  }

  return normalized.toString();
}
