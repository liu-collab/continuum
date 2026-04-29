"use client";

import { Languages } from "lucide-react";

import { useAppI18n } from "@/lib/i18n/client";

export function AppLocaleSwitch() {
  const { locale, setLocale, t } = useAppI18n();
  const nextLocale = locale === "zh-CN" ? "en-US" : "zh-CN";
  const currentLabel = locale === "zh-CN" ? "ZH" : "EN";

  return (
    <button
      type="button"
      className="global-nav-utility-button"
      onClick={() => setLocale(nextLocale)}
      aria-label={t("localeSwitch.switchTo", { locale: t(`localeSwitch.options.${nextLocale}`) })}
      title={t("localeSwitch.switchTo", { locale: t(`localeSwitch.options.${nextLocale}`) })}
      data-testid="app-locale-select"
    >
      <Languages size={14} strokeWidth={1.8} aria-hidden="true" />
      <span>{currentLabel}</span>
    </button>
  );
}
