"use client";

import React from "react";
import { useEffect, useState } from "react";
import { useAgentI18n } from "@/lib/i18n/agent/provider";
import type { MnaMetricsResponse } from "../_lib/openapi-types";

type CostBarProps = {
  metrics: MnaMetricsResponse | null;
  turnCount: number;
};

export function CostBar({ metrics, turnCount }: CostBarProps) {
  const { t } = useAgentI18n();
  const [uptimeSeconds, setUptimeSeconds] = useState<number | null>(metrics?.uptime_s ?? null);
  const totalProviderCalls = metrics
    ? Object.values(metrics.provider_calls_total).reduce((sum, value) => sum + value, 0)
    : 0;
  const totalProviderErrors = metrics
    ? Object.values(metrics.provider_errors_total).reduce((sum, value) => sum + value, 0)
    : 0;

  useEffect(() => {
    setUptimeSeconds(metrics?.uptime_s ?? null);
  }, [metrics?.uptime_s]);

  useEffect(() => {
    if (uptimeSeconds === null) {
      return;
    }

    const timer = window.setInterval(() => {
      setUptimeSeconds((current) => (current === null ? current : current + 1));
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [metrics?.uptime_s]);

  return (
    <div className="flex flex-wrap items-center gap-3 border bg-surface px-3 py-1.5 text-xs" style={{ borderRadius: "var(--radius-lg)" }}>
      <Metric label={t("costBar.turns")} value={String(metrics?.turns_total ?? turnCount)} />
      <Metric label={t("costBar.providerCalls")} value={String(totalProviderCalls)} />
      <Metric label={t("costBar.providerErrors")} value={String(totalProviderErrors)} />
      <Metric label={t("costBar.uptime")} value={uptimeSeconds !== null ? `${uptimeSeconds}s` : "…"} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
