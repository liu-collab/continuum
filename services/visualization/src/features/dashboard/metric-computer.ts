import { DashboardMetric } from "@/lib/contracts";
import { formatMetricValue } from "@/lib/format";
import { createTranslator, type AppLocale } from "@/lib/i18n/messages";

export type SeverityDirection = "higher_is_worse" | "lower_is_worse";

export function thresholdSeverity(
  value: number | null,
  warningAt: number | undefined,
  dangerAt: number | undefined,
  direction: SeverityDirection
): DashboardMetric["severity"] {
  if (value === null) {
    return "unknown";
  }

  if (direction === "lower_is_worse") {
    if (dangerAt !== undefined && value <= dangerAt) {
      return "danger";
    }
    if (warningAt !== undefined && value <= warningAt) {
      return "warning";
    }
    return "normal";
  }

  if (dangerAt !== undefined && value >= dangerAt) {
    return "danger";
  }
  if (warningAt !== undefined && value >= warningAt) {
    return "warning";
  }
  return "normal";
}

function metric(
  key: string,
  label: string,
  value: number | null,
  unit: DashboardMetric["unit"],
  source: DashboardMetric["source"],
  description: string,
  warningAt?: number,
  dangerAt?: number,
  direction: SeverityDirection = "higher_is_worse",
  locale: AppLocale = "zh-CN"
): DashboardMetric {
  const severity = thresholdSeverity(value, warningAt, dangerAt, direction);

  return {
    key,
    label,
    value,
    unit,
    source,
    description,
    severity,
    formattedValue: formatMetricValue(value, unit, locale)
  };
}

export function localizedMetric(
  key: string,
  value: number | null,
  unit: DashboardMetric["unit"],
  source: DashboardMetric["source"],
  warningAt?: number,
  dangerAt?: number,
  direction: SeverityDirection = "higher_is_worse",
  locale: AppLocale = "zh-CN"
) {
  const t = createTranslator(locale);

  return metric(
    key,
    t(`service.dashboard.metricLabels.${key}`),
    value,
    unit,
    source,
    t(`service.dashboard.metricDescriptions.${key}`),
    warningAt,
    dangerAt,
    direction,
    locale
  );
}
