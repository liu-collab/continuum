import { DashboardTrend } from "@/lib/contracts";
import { cn } from "@/lib/utils";

type TrendCardProps = {
  trend: DashboardTrend;
};

export function TrendCard({ trend }: TrendCardProps) {
  const numericPoints = trend.points.map((point) => point.value ?? 0);
  const max = Math.max(...numericPoints, 1);

  return (
    <div
      className={cn(
        "rounded-xl border bg-white/80 p-5",
        trend.severity === "warning" && "border-amber-200",
        trend.severity === "danger" && "border-rose-200"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">{trend.title}</div>
          <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">{trend.source}</div>
        </div>
        <div className="text-sm font-semibold text-slate-700">{trend.deltaFormatted}</div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.16em] text-slate-400">当前</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{trend.currentFormatted}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.16em] text-slate-400">上一窗口</div>
          <div className="mt-1 text-2xl font-semibold text-slate-700">{trend.previousFormatted}</div>
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-600">{trend.summary}</p>
      <div className="mt-5 grid grid-cols-4 items-end gap-3">
        {trend.points.map((point, index) => (
          <div key={`${trend.key}-${point.label}-${index}`} className="space-y-2">
            <div className="flex h-24 items-end">
              <div
                className="w-full rounded-t-lg bg-accent/75"
                style={{
                  height: `${point.value === null ? 12 : Math.max((point.value / max) * 100, 12)}%`
                }}
              />
            </div>
            <div className="text-center text-[11px] text-slate-500">{point.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
