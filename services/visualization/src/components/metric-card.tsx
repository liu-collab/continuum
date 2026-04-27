import React from "react";

import { StatusBadge } from "@/components/status-badge";
import { DashboardMetric } from "@/lib/contracts";
import { dashboardSeverityLabel, dashboardSeverityTone } from "@/lib/format";
import { cn } from "@/lib/utils";

type MetricCardProps = {
  metric: DashboardMetric;
};

export function MetricCard({ metric }: MetricCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-surface p-4 transition hover:border-border-strong",
        metric.severity === "warning" && "border-amber-200",
        metric.severity === "danger" && "border-rose-200"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">{metric.label}</div>
          <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {metric.source}
          </div>
        </div>
        <StatusBadge tone={dashboardSeverityTone(metric.severity)}>
          {dashboardSeverityLabel(metric.severity)}
        </StatusBadge>
      </div>
      <div
        className={cn(
          "mt-3 text-2xl font-semibold tracking-tight text-foreground",
          metric.severity === "unknown" && "text-muted-foreground"
        )}
      >
        {metric.formattedValue}
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground line-clamp-2">{metric.description}</p>
    </div>
  );
}
