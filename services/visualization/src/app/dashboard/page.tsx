import { MetricCard } from "@/components/metric-card";
import { HealthModalButton } from "@/components/health-modal";
import { StatusBadge } from "@/components/status-badge";
import { TrendCard } from "@/components/trend-card";
import { getDashboard } from "@/features/dashboard/service";
import { getSourceHealth } from "@/features/source-health/service";
import { parseDashboardWindow } from "@/lib/query-params";

const windows = [
  { label: "15m", value: "15m" },
  { label: "30m", value: "30m" },
  { label: "1h", value: "1h" },
  { label: "6h", value: "6h" },
  { label: "24h", value: "24h" }
];

function severityTone(severity: string) {
  if (severity === "danger") return "danger";
  if (severity === "warning") return "warning";
  return "success";
}

export default async function DashboardPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const window = parseDashboardWindow(params);
  const [response, health] = await Promise.all([getDashboard(window), getSourceHealth()]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">看板</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            运行时与存储指标，按时间窗聚合。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-md border bg-surface p-0.5">
            {windows.map((item) => (
              <a
                key={item.value}
                href={`/dashboard?window=${item.value}`}
                className={`rounded px-3 py-1 text-xs font-medium transition ${
                  item.value === window
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.label}
              </a>
            ))}
          </div>
          <HealthModalButton health={health} />
        </div>
      </div>

      <div className="rounded-lg border bg-surface px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">{response.diagnosis.title}</div>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{response.diagnosis.summary}</p>
          </div>
          <StatusBadge tone={severityTone(response.diagnosis.severity)}>
            {response.trendWindow}
          </StatusBadge>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            retrieval-runtime
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {response.retrievalMetrics.map((metric) => (
            <MetricCard key={metric.key} metric={metric} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            storage
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {response.storageMetrics.map((metric) => (
            <MetricCard key={metric.key} metric={metric} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            趋势
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {response.trends.map((trend) => (
            <TrendCard key={trend.key} trend={trend} />
          ))}
        </div>
      </section>
    </div>
  );
}
