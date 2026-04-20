"use client";

import { useEffect, useState } from "react";

import { useAgentI18n } from "../_i18n/provider";

type ProviderSwitchProps = {
  providerId: string;
  providerLabel: string;
  model: string;
  onApply(model: string): void;
  onRefresh(): void;
};

export function ProviderSwitch({ providerId, providerLabel, model, onApply, onRefresh }: ProviderSwitchProps) {
  const [draftModel, setDraftModel] = useState(model);
  const { t } = useAgentI18n();

  useEffect(() => {
    setDraftModel(model);
  }, [model]);

  return (
    <div className="flex items-center gap-3 rounded-full border bg-white/85 px-4 py-2 text-sm text-slate-700">
      <span className="font-semibold text-slate-900">{t("providerSwitch.label")}</span>
      <span data-testid="provider-label">{providerLabel}</span>
      <input
        data-testid="provider-model-input"
        value={draftModel}
        onChange={(event) => setDraftModel(event.target.value)}
        className="min-w-44 rounded-full border bg-white px-3 py-1 text-xs text-slate-700 outline-none"
        placeholder={t("providerSwitch.modelPlaceholder")}
      />
      <button
        type="button"
        onClick={() => onApply(draftModel)}
        data-testid="provider-apply"
        className="rounded-full border px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
      >
        {t("providerSwitch.apply")}
      </button>
      <button
        type="button"
        onClick={onRefresh}
        data-testid="provider-refresh"
        className="rounded-full border px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
      >
        {t("providerSwitch.refresh")}
      </button>
    </div>
  );
}
