"use client";

import React from "react";

import { useAgentI18n } from "@/lib/i18n/agent/provider";

export function LocaleSwitch() {
  const { locale, setLocale, t } = useAgentI18n();

  return (
    <div className="flex min-h-11 items-center gap-3 rounded-[var(--radius-pill)] border border-[var(--hairline)] bg-[var(--canvas)] px-4 py-2 text-[14px] leading-[1.43] text-[var(--ink-muted-80)]">
      <span className="font-semibold text-[var(--ink)]">{t("localeSwitch.label")}</span>
      <div className="segment-control !p-0.5" data-testid="agent-locale-select">
        {(["zh-CN", "en-US"] as const).map((nextLocale) => (
          <button
            key={nextLocale}
            type="button"
            onClick={() => setLocale(nextLocale)}
            className={`segment-item !min-h-8 !px-3 !py-1 !text-[12px] ${
              locale === nextLocale ? "segment-item-active" : ""
            }`}
          >
            {t(`localeSwitch.options.${nextLocale}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
