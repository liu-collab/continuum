import React from "react";
import { EmptyState } from "@/components/empty-state";
import { MetricCard } from "@/components/metric-card";
import { HealthModalButton } from "@/components/health-modal";
import { StatusBadge } from "@/components/status-badge";
import { TrendCard } from "@/components/trend-card";
import { getDashboard } from "@/features/dashboard/service";
import { getSourceHealth } from "@/features/source-health/service";
import type { DashboardDiagnosisCard, SourceStatus } from "@/lib/contracts";
import {
  dashboardSeverityLabel,
  dashboardSeverityTone,
  formatTimestamp,
  sourceStatusLabel
} from "@/lib/format";
import { parseDashboardWindow } from "@/lib/query-params";

const windows = [
  { label: "15m", value: "15m" },
  { label: "30m", value: "30m" },
  { label: "1h", value: "1h" },
  { label: "6h", value: "6h" },
  { label: "24h", value: "24h" }
];

function sourceSummary(source: SourceStatus) {
  if (source.detail) return source.detail;
  if (source.lastError) return source.lastError;
  return "Last check passed.";
}

export default async function DashboardPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const window = parseDashboardWindow(params);
  const [response, health] = await Promise.all([getDashboard(window), getSourceHealth()]);
  const degraded = response.sourceStatus.filter((s) => s.status !== "healthy");
  const partial = degraded.filter((s) => s.status === "partial");
  const unavailable = degraded.filter((s) => s.status !== "partial");

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div>
            <h1 style={{ fontSize: "1.375rem", fontWeight: 500, fontFamily: "var(--font-mono)", color: "var(--text)", letterSpacing: "-0.01em" }}>
              Dashboard
            </h1>
            <p style={{ marginTop: "0.25rem", fontSize: "0.8125rem", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
              Runtime & storage metrics · window: {window}
            </p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" }}>
            <div style={{
              display: "inline-flex",
              alignItems: "center",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)",
              background: "var(--surface)",
              padding: "0.125rem"
            }}>
              {windows.map((w) => (
                <a
                  key={w.value}
                  href={`/dashboard?window=${w.value}`}
                  style={{
                    borderRadius: "var(--radius-sm)",
                    padding: "0.25rem 0.625rem",
                    fontSize: "0.75rem",
                    fontFamily: "var(--font-mono)",
                    fontWeight: 500,
                    color: w.value === window ? "var(--bg)" : "var(--text-muted)",
                    background: w.value === window ? "var(--amber)" : "transparent",
                    transition: "all 80ms ease"
                  }}
                >
                  {w.label}
                </a>
              ))}
            </div>
            <HealthModalButton health={health} />
          </div>
        </div>
      </div>

      <div className="panel p-4" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div className="text-[13px] font-[var(--font-mono)] font-medium text-text">{response.diagnosis.title}</div>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">{response.diagnosis.summary}</p>
        </div>
        <StatusBadge tone={dashboardSeverityTone(response.diagnosis.severity)}>
          {dashboardSeverityLabel(response.diagnosis.severity)} · {response.trendWindow}
        </StatusBadge>
      </div>

      {unavailable.length > 0 ? (
        <div style={{ border: "1px solid rgba(248,113,113,0.3)", borderRadius: "var(--radius-lg)", background: "var(--rose-bg)", padding: "0.625rem 0.875rem", fontSize: "0.8125rem", fontFamily: "var(--font-mono)", color: "var(--rose)" }}>
          {unavailable.length} source(s) unavailable: {unavailable.map((s) => s.label).join(", ")}
        </div>
      ) : null}
      {partial.length > 0 ? (
        <div style={{ border: "1px solid rgba(240,168,76,0.3)", borderRadius: "var(--radius-lg)", background: "var(--amber-bg)", padding: "0.625rem 0.875rem", fontSize: "0.8125rem", fontFamily: "var(--font-mono)", color: "var(--amber)" }}>
          {partial.length} source(s) degraded: {partial.map((s) => s.label).join(", ")}
        </div>
      ) : null}

      <section style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "minmax(0,1fr) 22rem" }}>
        <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          {response.diagnosisCards.length > 0 ? (
            response.diagnosisCards.map((card) => <DiagnosisCard key={card.key} card={card} />)
          ) : (
            <EmptyState title="No diagnosis" description="Insufficient data for the selected window." style={{ gridColumn: "1 / -1" }} />
          )}
        </div>
        <div className="panel p-4">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}>
            <div className="text-[13px] font-[var(--font-mono)] font-medium text-text">Sources</div>
            <HealthModalButton sources={response.sourceStatus} label="Details" />
          </div>
          <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.5rem" }}>
            {response.sourceStatus.length > 0 ? (
              response.sourceStatus.map((source) => (
                <div key={source.name} style={{ borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--surface-hover)", padding: "0.625rem 0.75rem" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem" }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="text-[12px] font-[var(--font-mono)] font-medium text-text truncate">{source.label}</div>
                      <div className="mt-0.5 text-[10px] font-[var(--font-mono)] text-muted truncate">{source.name}</div>
                    </div>
                    <StatusBadge tone={source.status === "healthy" ? "success" : source.status === "partial" ? "warning" : "danger"}>
                      {sourceStatusLabel(source.status)}
                    </StatusBadge>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-muted line-clamp-2">{sourceSummary(source)}</p>
                  <div className="mt-1.5 flex gap-x-3 text-[10px] font-[var(--font-mono)] text-muted-foreground">
                    <span>Checked {formatTimestamp(source.lastCheckedAt || source.checkedAt)}</span>
                    <span>Lat {source.responseTimeMs === null ? "—" : `${source.responseTimeMs}ms`}</span>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState title="No sources" description="No health data returned." />
            )}
          </div>
        </div>
      </section>

      {([
        { label: "Retrieval Runtime", metrics: response.retrievalMetrics },
        { label: "Storage", metrics: response.storageMetrics }
      ] as const).map(({ label, metrics }) => (
        <section key={label} style={{ display: "grid", gap: "0.5rem" }}>
          <div className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
          <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {metrics.length > 0 ? (
              metrics.map((m) => <MetricCard key={m.key} metric={m} />)
            ) : (
              <EmptyState title={`No ${label.toLowerCase()} metrics`} description="No data for the selected window." style={{ gridColumn: "1 / -1" }} />
            )}
          </div>
        </section>
      ))}

      <section style={{ display: "grid", gap: "0.5rem" }}>
        <div className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.16em] text-muted-foreground">Trends</div>
        <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
          {response.trends.length > 0 ? (
            response.trends.map((t) => <TrendCard key={t.key} trend={t} />)
          ) : (
            <EmptyState title="No trends" description="Not enough data points for trend calculation." style={{ gridColumn: "1 / -1" }} />
          )}
        </div>
      </section>
    </div>
  );
}

function DiagnosisCard({ card }: { card: DashboardDiagnosisCard }) {
  return (
    <div className="panel p-4">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem" }}>
        <div style={{ minWidth: 0 }}>
          <div className="text-[13px] font-[var(--font-mono)] font-medium text-text">{card.title}</div>
          <div className="mt-0.5 text-[10px] font-[var(--font-mono)] tracking-[0.12em] uppercase text-muted-foreground">{card.source}</div>
        </div>
        <StatusBadge tone={dashboardSeverityTone(card.severity)}>{dashboardSeverityLabel(card.severity)}</StatusBadge>
      </div>
      <p className="mt-2.5 text-[12px] leading-relaxed text-muted">{card.summary}</p>
    </div>
  );
}
