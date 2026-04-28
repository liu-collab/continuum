"use client";

import React from "react";
import { useEffect, useState } from "react";

import { useAgentI18n } from "@/lib/i18n/agent/provider";

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
    <div className="flex min-h-11 flex-wrap items-center gap-3 rounded-[var(--radius-pill)] border border-[var(--hairline)] bg-[var(--canvas)] px-4 py-2 text-[14px] leading-[1.43] text-[var(--ink-muted-80)]">
      <span className="font-semibold text-[var(--ink)]">{t("providerSwitch.label")}</span>
      <span data-testid="provider-label" className="text-[var(--ink-muted-80)]">
        {providerLabel}
      </span>
      <input
        data-testid="provider-model-input"
        value={draftModel}
        onChange={(event) => setDraftModel(event.target.value)}
        className="field !h-9 !min-h-9 min-w-44 !px-3 !py-1 !text-[14px]"
        placeholder={t("providerSwitch.modelPlaceholder")}
      />
      <button
        type="button"
        onClick={() => onApply(draftModel)}
        data-testid="provider-apply"
        className="button-pearl-capsule min-h-9 px-3 py-1"
      >
        {t("providerSwitch.apply")}
      </button>
      <button
        type="button"
        onClick={onRefresh}
        data-testid="provider-refresh"
        className="button-pearl-capsule min-h-9 px-3 py-1"
      >
        {t("providerSwitch.refresh")}
      </button>
    </div>
  );
}
