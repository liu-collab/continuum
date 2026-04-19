"use client";

import React from "react";

import { useAgentI18n } from "../_i18n/provider";

export function LocaleSwitch() {
  const { locale, setLocale, t } = useAgentI18n();

  return (
    <label className="flex items-center gap-3 rounded-full border bg-white/85 px-4 py-2 text-sm text-slate-700">
      <span className="font-semibold text-slate-900">{t("localeSwitch.label")}</span>
      <select
        data-testid="agent-locale-select"
        value={locale}
        onChange={(event) => setLocale(event.target.value as "zh-CN" | "en-US")}
        className="bg-transparent text-sm outline-none"
      >
        <option value="zh-CN">{t("localeSwitch.options.zh-CN")}</option>
        <option value="en-US">{t("localeSwitch.options.en-US")}</option>
      </select>
    </label>
  );
}
