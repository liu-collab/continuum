import { createTranslator } from "@/lib/i18n/messages";

import type { AgentConnectionState, AgentLocale, AgentMemoryMode, AgentToolTrustLevel, MnaMcpServerStatus } from "@/app/agent/_lib/openapi-types";

export function translateMessage(locale: AgentLocale, key: string, variables?: Record<string, string | number>) {
  return createTranslator(locale, "agent")(key, variables);
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

export function formatAgentError(locale: AgentLocale, code: string, fallbackMessage?: string | null, reason?: string) {
  const title = translateMessage(locale, `errors.${code}.title`);
  const reasonDescription = reason ? translateMessage(locale, `errors.${code}.reasons.${reason}`) : null;
  const description =
    reasonDescription && reasonDescription !== `errors.${code}.reasons.${reason}`
      ? reasonDescription
      : translateMessage(locale, `errors.${code}.description`);
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
