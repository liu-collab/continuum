import React from "react";

import { StatusBadge } from "@/components/status-badge";
import { DashboardTrend } from "@/lib/contracts";
import { dashboardSeverityLabel, dashboardSeverityTone, formatMetricValue } from "@/lib/format";
import { cn } from "@/lib/utils";

type TrendCardProps = {
  trend: DashboardTrend;
};

export function TrendCard({ trend }: TrendCardProps) {
  const numericPoints = trend.points
    .map((point) => point.value)
    .filter((value): value is number => value !== null);
  const max = Math.max(...numericPoints, 1);

  return (
    <div
      className={cn(
        "rounded-lg border bg-surface p-4",
        trend.severity === "warning" && "border-amber-200",
        trend.severity === "danger" && "border-rose-200"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">{trend.title}</div>
          <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {trend.source}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge tone={dashboardSeverityTone(trend.severity)}>
            {dashboardSeverityLabel(trend.severity)}
          </StatusBadge>
          <div className="text-sm font-semibold text-foreground">{trend.deltaFormatted}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">当前</div>
          <div className="mt-0.5 text-xl font-semibold text-foreground">{trend.currentFormatted}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">上一窗口</div>
          <div className="mt-0.5 text-xl font-semibold text-muted-foreground">{trend.previousFormatted}</div>
        </div>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground line-clamp-2">{trend.summary}</p>
      <div className="mt-4 grid grid-cols-4 items-end gap-2">
        {trend.points.map((point, index) => (
          <div key={`${trend.key}-${point.label}-${index}`} className="space-y-1.5">
            <div className="flex h-16 items-end">
              {point.value === null ? (
                <div
                  aria-label={`${point.label}: 不可用`}
                  className="h-3 w-full rounded border border-dashed border-border-strong bg-transparent"
                />
              ) : (
                <div
                  aria-label={`${point.label}: ${formatMetricValue(point.value, trend.unit)}`}
                  className="w-full rounded-t bg-foreground/80"
                  style={{
                    height: `${Math.max((point.value / max) * 100, 12)}%`
                  }}
                />
              )}
            </div>
            <div className="text-center text-[10px] text-muted-foreground">{point.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
