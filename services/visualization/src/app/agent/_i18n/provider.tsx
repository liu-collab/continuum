"use client";

import React from "react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import type { AgentLocale } from "../_lib/openapi-types";
import { DEFAULT_AGENT_LOCALE, resolveBrowserLocale } from "../_lib/config";
import {
  formatConnectionState,
  formatDefaultSessionTitle,
  formatFinishReason,
  formatAgentError,
  formatMcpState,
  formatMemoryMode,
  formatPhase,
  formatTrustLevel,
  translateMessage
} from "./messages";

type AgentI18nValue = {
  locale: AgentLocale;
  setLocale(nextLocale: AgentLocale): void;
  t(key: string, variables?: Record<string, string | number>): string;
  formatConnection(connection: "connecting" | "open" | "reconnecting" | "closed"): string;
  formatMemoryModeLabel(mode: "workspace_only" | "workspace_plus_global"): string;
  formatMcpStateLabel(state: "ok" | "unavailable" | "dead" | "disabled"): string;
  formatTrustLevelLabel(level: `${string}`): string;
  formatSessionTitle(id: string): string;
  formatPhaseLabel(phase: string): string;
  formatFinishReasonLabel(finishReason: string): string;
  formatAgentError(code: string, fallbackMessage?: string | null, reason?: string): {
    title: string;
    description: string;
  };
};

const AgentI18nContext = createContext<AgentI18nValue | null>(null);
const AGENT_LOCALE_STORAGE_KEY = "continuum.agent.locale";

export function AgentI18nProvider({
  children,
  defaultLocale
}: {
  children: ReactNode;
  defaultLocale?: string;
}) {
  const [locale, setLocaleState] = useState<AgentLocale>(resolveBrowserLocale(defaultLocale ?? DEFAULT_AGENT_LOCALE));

  useEffect(() => {
    const stored = window.localStorage.getItem(AGENT_LOCALE_STORAGE_KEY);
    if (stored === "zh-CN" || stored === "en-US") {
      setLocaleState(stored);
    }
  }, []);

  const value: AgentI18nValue = {
    locale,
    setLocale(nextLocale) {
      setLocaleState(nextLocale);
      window.localStorage.setItem(AGENT_LOCALE_STORAGE_KEY, nextLocale);
    },
    t(key, variables) {
      return translateMessage(locale, key, variables);
    },
    formatConnection(connection) {
      return formatConnectionState(locale, connection);
    },
    formatMemoryModeLabel(mode) {
      return formatMemoryMode(locale, mode);
    },
    formatMcpStateLabel(state) {
      return formatMcpState(locale, state);
    },
    formatTrustLevelLabel(level) {
      return formatTrustLevel(locale, level as never);
    },
    formatSessionTitle(id) {
      return formatDefaultSessionTitle(locale, id);
    },
    formatPhaseLabel(phase) {
      return formatPhase(locale, phase);
    },
    formatFinishReasonLabel(finishReason) {
      return formatFinishReason(locale, finishReason);
    },
    formatAgentError(code, fallbackMessage, reason) {
      return formatAgentError(locale, code, fallbackMessage, reason);
    }
  };

  return <AgentI18nContext.Provider value={value}>{children}</AgentI18nContext.Provider>;
}

export function useAgentI18n() {
  const context = useContext(AgentI18nContext);
  if (!context) {
    throw new Error("useAgentI18n must be used within AgentI18nProvider");
  }
  return context;
}
