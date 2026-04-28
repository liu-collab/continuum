import React from "react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { DashboardTrend } from "@/lib/contracts";
import { dashboardSeverityTone, formatMetricValue } from "@/lib/format";
import { createTranslator, DEFAULT_APP_LOCALE, type AppLocale } from "@/lib/i18n/messages";

type TrendCardProps = {
  trend: DashboardTrend;
  locale?: AppLocale;
  severityLabel?: string;
  currentValueLabel?: string;
  previousValueLabel?: string;
  unavailableLabel?: string;
};

export function TrendCard({
  trend,
  locale = DEFAULT_APP_LOCALE,
  severityLabel,
  currentValueLabel,
  previousValueLabel,
  unavailableLabel
}: TrendCardProps) {
  const t = createTranslator(locale);
  const statusLabel = severityLabel ?? t(`enums.severity.${trend.severity}`);
  const currentLabel = currentValueLabel ?? t("dashboard.currentValue");
  const previousLabel = previousValueLabel ?? t("dashboard.previousValue");
  const emptyLabel = unavailableLabel ?? t("common.unavailable");
  const numericPoints = trend.points
    .map((p) => p.value)
    .filter((v): v is number => v !== null);
  const max = Math.max(...numericPoints, 1);

  return (
    <div className="panel p-6 transition hover:border-border-hover">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[17px] font-semibold leading-[1.24] text-text">
            {trend.title}
          </div>
          <div className="mt-1 text-[14px] leading-[1.43] text-muted-foreground">
            {trend.source}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge tone={dashboardSeverityTone(trend.severity)}>
            {statusLabel}
          </StatusBadge>
          <span className="text-[17px] font-semibold leading-[1.24] text-text">
            {trend.deltaFormatted}
          </span>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-6">
        <div>
          <div className="text-[14px] font-semibold leading-[1.29] text-muted-foreground">{currentLabel}</div>
          <div className="mt-1 text-[28px] font-normal leading-[1.14] text-text">{trend.currentFormatted}</div>
        </div>
        <div>
          <div className="text-[14px] font-semibold leading-[1.29] text-muted-foreground">{previousLabel}</div>
          <div className="mt-1 text-[28px] font-normal leading-[1.14] text-muted">{trend.previousFormatted}</div>
        </div>
      </div>
      <p className="mt-4 text-[14px] leading-[1.43] text-muted line-clamp-2">{trend.summary}</p>
      <div className="mt-6 grid grid-cols-4 items-end gap-3">
        {trend.points.map((point, i) => (
          <div key={`${trend.key}-${i}`} className="space-y-1.5">
            <div className="flex h-12 items-end">
              {point.value === null ? (
                <div
                  aria-label={`${point.label}: ${emptyLabel}`}
                  className="h-3 w-full border border-dashed border-border bg-transparent"
                />
              ) : (
                <div
                  aria-label={`${point.label}: ${formatMetricValue(point.value, trend.unit, locale)}`}
                  className="w-full rounded-t-[5px] bg-foreground/80"
                  style={{
                    height: `${Math.max((point.value / max) * 100, 10)}%`,
                  }}
                />
              )}
            </div>
            <div className="text-center text-[12px] leading-none text-muted-foreground">{point.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
