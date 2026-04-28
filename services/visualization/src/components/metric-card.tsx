"use client";

import React from "react";
import { StatusBadge } from "@/components/status-badge";
import { DashboardMetric } from "@/lib/contracts";
import { dashboardSeverityTone } from "@/lib/format";
import { useAppI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

type MetricCardProps = {
  metric: DashboardMetric;
};

export function MetricCard({ metric }: MetricCardProps) {
  const { t } = useAppI18n();

  return (
    <div
      className={cn(
        "panel p-6 transition-colors duration-75 hover:border-border-hover",
        metric.severity === "warning" && "border-border",
        metric.severity === "danger" && "border-[var(--ink)]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[17px] font-semibold leading-[1.24] text-text">
            {metric.label}
          </div>
          <div className="mt-1 text-[14px] leading-[1.43] text-muted-foreground">
            {metric.source}
          </div>
        </div>
        <StatusBadge tone={dashboardSeverityTone(metric.severity)}>
          {t(`enums.severity.${metric.severity}`)}
        </StatusBadge>
      </div>
      <div
        className={cn(
        "mt-6 text-[40px] font-semibold leading-[1.1] text-text",
          metric.severity === "unknown" && "text-muted"
        )}
      >
        {metric.formattedValue}
      </div>
      <p className="mt-3 text-[14px] leading-[1.43] text-muted line-clamp-2">
        {metric.description}
      </p>
    </div>
  );
}
