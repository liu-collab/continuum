"use client";

import React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  APP_LOCALE_COOKIE,
  APP_LOCALE_STORAGE_KEY,
  DEFAULT_APP_LOCALE,
  createTranslator,
  resolveAppLocale,
  type AppLocale
} from "./messages";

type AppI18nValue = {
  locale: AppLocale;
  setLocale(nextLocale: AppLocale): void;
  t(key: string, variables?: Record<string, string | number>): string;
};

const AppI18nContext = createContext<AppI18nValue | null>(null);
const fallbackAppI18nValue: AppI18nValue = {
  locale: DEFAULT_APP_LOCALE,
  setLocale: () => undefined,
  t: createTranslator(DEFAULT_APP_LOCALE)
};

export function AppI18nProvider({
  children,
  defaultLocale
}: {
  children: ReactNode;
  defaultLocale?: string;
}) {
  const [locale, setLocaleState] = useState<AppLocale>(() =>
    resolveAppLocale(defaultLocale ?? (typeof navigator === "undefined" ? null : navigator.language))
  );
  const setLocale = useCallback((nextLocale: AppLocale) => {
    setLocaleState(nextLocale);
    window.localStorage.setItem(APP_LOCALE_STORAGE_KEY, nextLocale);
    document.cookie = `${APP_LOCALE_COOKIE}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(APP_LOCALE_STORAGE_KEY);
    if (stored) {
      setLocaleState(resolveAppLocale(stored));
    }
  }, []);

  const value = useMemo<AppI18nValue>(() => ({
    locale,
    setLocale,
    t: createTranslator(locale)
  }), [locale, setLocale]);

  return <AppI18nContext.Provider value={value}>{children}</AppI18nContext.Provider>;
}

export function useAppI18n() {
  const context = useContext(AppI18nContext);
  return context ?? fallbackAppI18nValue;
}

export function useOptionalAppI18n() {
  return useContext(AppI18nContext);
}
