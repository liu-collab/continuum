"use client";

import { useAgentI18n } from "../_i18n/provider";
import type { MnaMetricsResponse } from "../_lib/openapi-types";

type CostBarProps = {
  metrics: MnaMetricsResponse | null;
  turnCount: number;
};

export function CostBar({ metrics, turnCount }: CostBarProps) {
  const { t } = useAgentI18n();
  const totalProviderCalls = metrics
    ? Object.values(metrics.provider_calls_total).reduce((sum, value) => sum + value, 0)
    : 0;
  const totalProviderErrors = metrics
    ? Object.values(metrics.provider_errors_total).reduce((sum, value) => sum + value, 0)
    : 0;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-3xl border bg-white/85 px-5 py-3 shadow-soft">
      <Metric label={t("costBar.turns")} value={String(metrics?.turns_total ?? turnCount)} />
      <Metric label={t("costBar.providerCalls")} value={String(totalProviderCalls)} />
      <Metric label={t("costBar.providerErrors")} value={String(totalProviderErrors)} />
      <Metric label={t("costBar.uptime")} value={metrics ? `${metrics.uptime_s}s` : "..."} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-full bg-slate-50 px-3 py-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="ml-2 font-semibold text-slate-900">{value}</span>
    </div>
  );
}
