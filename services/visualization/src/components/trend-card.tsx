import React from "react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { DashboardTrend } from "@/lib/contracts";
import { dashboardSeverityLabel, dashboardSeverityTone } from "@/lib/format";

type TrendCardProps = { trend: DashboardTrend };

export function TrendCard({ trend }: TrendCardProps) {
  const numericPoints = trend.points
    .map((p) => p.value)
    .filter((v): v is number => v !== null);
  const max = Math.max(...numericPoints, 1);

  return (
    <div className="panel p-4 transition hover:border-border-hover">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-[var(--font-mono)] font-medium text-text">
            {trend.title}
          </div>
          <div className="mt-0.5 text-[10px] font-[var(--font-mono)] tracking-[0.12em] uppercase text-muted-foreground">
            {trend.source}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge tone={dashboardSeverityTone(trend.severity)}>
            {dashboardSeverityLabel(trend.severity)}
          </StatusBadge>
          <span className="text-[13px] font-[var(--font-mono)] font-medium text-text">
            {trend.deltaFormatted}
          </span>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4">
        <div>
          <div className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.12em] text-muted-foreground">当前</div>
          <div className="mt-0.5 text-[1.25rem] font-[var(--font-mono)] font-medium text-text">{trend.currentFormatted}</div>
        </div>
        <div>
          <div className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.12em] text-muted-foreground">上一窗口</div>
          <div className="mt-0.5 text-[1.25rem] font-[var(--font-mono)] font-medium text-muted">{trend.previousFormatted}</div>
        </div>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-muted line-clamp-2">{trend.summary}</p>
      <div className="mt-4 grid grid-cols-4 items-end gap-2">
        {trend.points.map((point, i) => (
          <div key={`${trend.key}-${i}`} className="space-y-1.5">
            <div className="flex h-12 items-end">
              {point.value === null ? (
                <div className="h-3 w-full border border-dashed border-border bg-transparent" />
              ) : (
                <div
                  className="w-full rounded-t"
                  style={{
                    height: `${Math.max((point.value / max) * 100, 10)}%`,
                    background: "linear-gradient(180deg, var(--amber) 0%, var(--amber-dim) 100%)"
                  }}
                />
              )}
            </div>
            <div className="text-center text-[10px] font-[var(--font-mono)] text-muted-foreground">{point.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
