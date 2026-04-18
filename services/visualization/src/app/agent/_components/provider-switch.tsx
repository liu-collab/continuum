"use client";

import { useEffect, useState } from "react";

type ProviderSwitchProps = {
  providerId: string;
  providerLabel: string;
  model: string;
  onApply(model: string): void;
  onRefresh(): void;
};

export function ProviderSwitch({ providerId, providerLabel, model, onApply, onRefresh }: ProviderSwitchProps) {
  const [draftModel, setDraftModel] = useState(model);

  useEffect(() => {
    setDraftModel(model);
  }, [model]);

  return (
    <div className="flex items-center gap-3 rounded-full border bg-white/85 px-4 py-2 text-sm text-slate-700">
      <span className="font-semibold text-slate-900">provider</span>
      <span>{providerLabel}</span>
      <input
        value={draftModel}
        onChange={(event) => setDraftModel(event.target.value)}
        className="min-w-44 rounded-full border bg-white px-3 py-1 text-xs text-slate-700 outline-none"
        placeholder="model"
      />
      <button
        type="button"
        onClick={() => onApply(draftModel)}
        className="rounded-full border px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
      >
        应用模型
      </button>
      <button
        type="button"
        onClick={onRefresh}
        className="rounded-full border px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
      >
        刷新状态
      </button>
    </div>
  );
}
