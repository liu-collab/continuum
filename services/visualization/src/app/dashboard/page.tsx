import { MetricCard } from "@/components/metric-card";
import { SourceHealthPanel } from "@/components/source-health-panel";
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
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Diagnosis</p>
            <h2 className="font-[var(--font-serif)] text-2xl text-slate-900">
              {response.diagnosis.title}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              {response.diagnosis.summary}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {windows.map((item) => (
              <a
                key={item.value}
                href={`/dashboard?window=${item.value}`}
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  item.value === window
                    ? "bg-accent text-white"
                    : "border bg-white text-slate-700"
                }`}
              >
                {item.label}
              </a>
            ))}
            <StatusBadge
              tone={
                response.diagnosis.severity === "danger"
                  ? "danger"
                  : response.diagnosis.severity === "warning"
                    ? "warning"
                    : "success"
              }
            >
              {response.trendWindow}
            </StatusBadge>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">retrieval-runtime</p>
            <h2 className="font-[var(--font-serif)] text-2xl text-slate-900">Runtime metrics</h2>
          </div>
        </div>
        <div className="panel-body grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {response.retrievalMetrics.map((metric) => (
            <MetricCard key={metric.key} metric={metric} />
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">storage</p>
            <h2 className="font-[var(--font-serif)] text-2xl text-slate-900">Storage metrics</h2>
          </div>
        </div>
        <div className="panel-body grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {response.storageMetrics.map((metric) => (
            <MetricCard key={metric.key} metric={metric} />
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Recent change</p>
            <h2 className="font-[var(--font-serif)] text-2xl text-slate-900">
              Trend and window comparison
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              These cards compare the current window with the previous half-window so you can tell
              whether empties, backlog, conflicts, or latency changed recently.
            </p>
          </div>
        </div>
        <div className="panel-body grid gap-4 md:grid-cols-2">
          {response.trends.map((trend) => (
            <TrendCard key={trend.key} trend={trend} />
          ))}
        </div>
      </section>

      <SourceHealthPanel title="Service and dependency health" health={health} />
    </div>
  );
}
