import { DashboardMetric } from "@/lib/contracts";
import { cn } from "@/lib/utils";

type MetricCardProps = {
  metric: DashboardMetric;
};

export function MetricCard({ metric }: MetricCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-white/80 p-5",
        metric.severity === "warning" && "border-amber-200",
        metric.severity === "danger" && "border-rose-200"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-slate-900">{metric.label}</div>
        <div className="text-xs uppercase tracking-[0.2em] text-slate-400">{metric.source}</div>
      </div>
      <div className="mt-4 text-3xl font-semibold text-slate-900">{metric.formattedValue}</div>
      <p className="mt-3 text-sm leading-6 text-slate-600">{metric.description}</p>
    </div>
  );
}
