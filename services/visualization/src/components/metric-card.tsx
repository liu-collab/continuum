import React from "react";
import { StatusBadge } from "@/components/status-badge";
import { DashboardMetric } from "@/lib/contracts";
import { dashboardSeverityTone } from "@/lib/format";
import { createTranslator, DEFAULT_APP_LOCALE, type AppLocale } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

type MetricCardProps = {
  metric: DashboardMetric;
  locale?: AppLocale;
  severityLabel?: string;
};

export function MetricCard({ metric, locale = DEFAULT_APP_LOCALE, severityLabel }: MetricCardProps) {
  const label = severityLabel ?? createTranslator(locale)(`enums.severity.${metric.severity}`);

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
          {label}
        </StatusBadge>
      </div>
      <div
        className={cn(
        "headline-display mt-6 text-[40px] font-semibold leading-[1.1] text-text",
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
