import { DashboardMetric } from "@/lib/contracts";
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
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-foreground">{metric.label}</div>
        <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {metric.source}
        </div>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
        {metric.formattedValue}
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground line-clamp-2">{metric.description}</p>
    </div>
  );
}
