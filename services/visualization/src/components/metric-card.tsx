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
        "panel p-4 transition-colors duration-75 hover:border-border-hover",
        metric.severity === "warning" && "border-amber-900/30",
        metric.severity === "danger" && "border-rose-900/30"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-[var(--font-mono)] font-medium text-text">
            {metric.label}
          </div>
          <div className="mt-0.5 text-[10px] font-[var(--font-mono)] tracking-[0.12em] uppercase text-muted-foreground">
            {metric.source}
          </div>
        </div>
        <StatusBadge tone={dashboardSeverityTone(metric.severity)}>
          {dashboardSeverityLabel(metric.severity)}
        </StatusBadge>
      </div>
      <div
        className={cn(
          "mt-3 text-[1.5rem] font-[var(--font-mono)] font-medium tracking-tight text-text",
          metric.severity === "unknown" && "text-muted"
        )}
      >
        {metric.formattedValue}
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-muted line-clamp-2">
        {metric.description}
      </p>
    </div>
  );
}
