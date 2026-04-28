import enAgent from "@/lib/i18n/agent/en-US/common.json";
import zhAgent from "@/lib/i18n/agent/zh-CN/common.json";

import enCommon from "./messages/en-US/common";
import zhCommon from "./messages/zh-CN/common";

export type AppLocale = "zh-CN" | "en-US";

export const DEFAULT_APP_LOCALE: AppLocale = "zh-CN";
export const APP_LOCALE_COOKIE = "continuum.locale";
export const APP_LOCALE_STORAGE_KEY = "continuum.locale";

type Primitive = string | number;
type Variables = Record<string, Primitive>;

const dictionaries = {
  "zh-CN": {
    ...zhCommon,
    agent: zhAgent
  },
  "en-US": {
    ...enCommon,
    agent: enAgent
  }
} as const;

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  return value === "zh-CN" || value === "en-US";
}

export function resolveAppLocale(preferredLocale?: string | null): AppLocale {
  if (isAppLocale(preferredLocale)) {
    return preferredLocale;
  }
  return preferredLocale?.toLowerCase().startsWith("en") ? "en-US" : DEFAULT_APP_LOCALE;
}

export function translateMessage(locale: AppLocale, key: string, variables?: Variables) {
  const dictionary = dictionaries[locale] ?? dictionaries[DEFAULT_APP_LOCALE];
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

export function createTranslator(locale: AppLocale, namespace?: string) {
  return (key: string, variables?: Variables) => {
    if (!namespace) {
      return translateMessage(locale, key, variables);
    }

    const namespacedKey = `${namespace}.${key}`;
    const translated = translateMessage(locale, namespacedKey, variables);
    return translated === namespacedKey ? key : translated;
  };
}

export function joinLocalizedList(locale: AppLocale, parts: string[]) {
  return parts.join(locale === "zh-CN" ? "、" : ", ");
}
