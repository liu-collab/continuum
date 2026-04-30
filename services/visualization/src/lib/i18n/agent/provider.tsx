"use client";

import React from "react";
import { useEffect, useMemo, type ReactNode } from "react";

import { AppI18nProvider, useAppI18n, useOptionalAppI18n } from "@/lib/i18n/client";
import { APP_LOCALE_STORAGE_KEY } from "@/lib/i18n/messages";

import type { AgentLocale } from "@/app/agent/_lib/openapi-types";
import { resolveBrowserLocale } from "@/app/agent/_lib/config";
import {
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

const AGENT_LOCALE_STORAGE_KEY = "axis.agent.locale";

export function AgentI18nProvider({
  children,
  defaultLocale
}: {
  children: ReactNode;
  defaultLocale?: string;
}) {
  const appI18n = useOptionalAppI18n();

  if (!appI18n) {
    return (
      <AppI18nProvider defaultLocale={defaultLocale}>
        <AgentLocalePersistence>{children}</AgentLocalePersistence>
      </AppI18nProvider>
    );
  }

  return <AgentLocalePersistence>{children}</AgentLocalePersistence>;
}

function AgentLocalePersistence({ children }: { children: ReactNode }) {
  const appI18n = useAppI18n();
  const setAppLocale = appI18n.setLocale;

  useEffect(() => {
    const appStored = window.localStorage.getItem(APP_LOCALE_STORAGE_KEY);
    const stored = window.localStorage.getItem(AGENT_LOCALE_STORAGE_KEY);
    if (!appStored && (stored === "zh-CN" || stored === "en-US")) {
      setAppLocale(stored);
    }
  }, [setAppLocale]);

  return <>{children}</>;
}

export function useAgentI18n() {
  const appI18n = useAppI18n();
  const locale = resolveBrowserLocale(appI18n.locale);

  const value: AgentI18nValue = useMemo(() => ({
    locale,
    setLocale(nextLocale) {
      window.localStorage.setItem(AGENT_LOCALE_STORAGE_KEY, nextLocale);
      appI18n.setLocale(nextLocale);
    },
    t(key, variables) {
      return translateMessage(locale, key, variables);
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
  }), [appI18n, locale]);

  return value;
}
