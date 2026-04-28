import "server-only";

import { cookies, headers } from "next/headers";

import { getAppConfig } from "@/lib/env";

import {
  APP_LOCALE_COOKIE,
  createTranslator,
  resolveAppLocale,
  type AppLocale
} from "./messages";

export async function getRequestLocale(): Promise<AppLocale> {
  try {
    const cookieStore = await cookies();
    const cookieLocale = cookieStore.get(APP_LOCALE_COOKIE)?.value;
    if (cookieLocale) {
      return resolveAppLocale(cookieLocale);
    }
  } catch {
    // Unit tests and non-Next callers do not always have request async storage.
  }

  try {
    const headerStore = await headers();
    const headerLocale = headerStore.get("accept-language");
    if (headerLocale) {
      return resolveAppLocale(headerLocale);
    }
  } catch {
    // Fall through to configured default locale.
  }

  return resolveAppLocale(getAppConfig().values.NEXT_PUBLIC_MNA_DEFAULT_LOCALE);
}

export async function getServerTranslator() {
  const locale = await getRequestLocale();

  return {
    locale,
    t: createTranslator(locale)
  };
}
