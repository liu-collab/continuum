import zhCommon from "./zh-CN/common.json";
import enCommon from "./en-US/common.json";

import type { AgentConnectionState, AgentLocale, AgentMemoryMode, AgentToolTrustLevel, MnaMcpServerStatus } from "../_lib/openapi-types";

const dictionaries = {
  "zh-CN": zhCommon,
  "en-US": enCommon
} as const;

export function translateMessage(locale: AgentLocale, key: string, variables?: Record<string, string | number>) {
  const dictionary = dictionaries[locale] ?? dictionaries["zh-CN"];
  const resolved = key.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current === "string" || typeof current !== "object") {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, dictionary);

  if (typeof resolved !== "string") {
    return key;
  }

  return resolved.replace(/\{(\w+)\}/g, (_match, token) => {
    const value = variables?.[token];
    return value === undefined ? `{${token}}` : String(value);
  });
}

export function formatConnectionState(locale: AgentLocale, connection: AgentConnectionState) {
  return translateMessage(locale, `connectionStates.${connection}`);
}

export function formatMemoryMode(locale: AgentLocale, memoryMode: AgentMemoryMode) {
  return translateMessage(locale, `modeSwitch.options.${memoryMode}`);
}

export function formatMcpState(locale: AgentLocale, state: MnaMcpServerStatus["state"]) {
  return translateMessage(locale, `mcpStates.${state}`);
}

export function formatTrustLevel(locale: AgentLocale, trustLevel: AgentToolTrustLevel) {
  if (trustLevel.startsWith("mcp:")) {
    return translateMessage(locale, "untrusted.mcp", {
      name: trustLevel.slice(4)
    });
  }

  return translateMessage(locale, `untrusted.${trustLevel}`);
}

export function formatDefaultSessionTitle(locale: AgentLocale, id: string) {
  return translateMessage(locale, "sessionList.defaultTitle", {
    id
  });
}

export function formatPhase(locale: AgentLocale, phase: string) {
  return translateMessage(locale, `phases.${phase}`);
}

export function formatFinishReason(locale: AgentLocale, finishReason: string) {
  return translateMessage(locale, `finishReasons.${finishReason}`);
}

export function formatAgentError(locale: AgentLocale, code: string, fallbackMessage?: string | null) {
  const title = translateMessage(locale, `errors.${code}.title`);
  const description = translateMessage(locale, `errors.${code}.description`);
  const fallbackTitle = fallbackMessage === null ? translateMessage(locale, "errors.unknown.title") : (fallbackMessage ?? code);
  const fallbackDescription = fallbackMessage === null
    ? translateMessage(locale, "errors.unknown.description")
    : (fallbackMessage ?? code);

  return {
    title: title === `errors.${code}.title` ? fallbackTitle : title,
    description:
      description === `errors.${code}.description`
        ? fallbackDescription
        : description
  };
}
