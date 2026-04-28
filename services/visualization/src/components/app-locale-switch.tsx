"use client";

import { useAppI18n } from "@/lib/i18n/client";

export function AppLocaleSwitch() {
  const { locale, setLocale, t } = useAppI18n();

  return (
    <div className="segment-control !p-0.5" data-testid="app-locale-select">
      {(["zh-CN", "en-US"] as const).map((nextLocale) => (
        <button
          key={nextLocale}
          type="button"
          onClick={() => setLocale(nextLocale)}
          className={`segment-item !min-h-8 !px-3 !py-1 !text-[12px] ${
            locale === nextLocale ? "segment-item-active" : ""
          }`}
          aria-label={t(`localeSwitch.options.${nextLocale}`)}
        >
          {t(`localeSwitch.options.${nextLocale}`)}
        </button>
      ))}
    </div>
  );
}
