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
  dashboardSeverityTone,
  formatTimestamp
} from "@/lib/format";
import { joinLocalizedList, type AppLocale } from "@/lib/i18n/messages";
import { getServerTranslator } from "@/lib/i18n/server";
import { parseDashboardWindow } from "@/lib/query-params";

type TFunction = (key: string, variables?: Record<string, string | number>) => string;

const windows = [
  { label: "15m", value: "15m" },
  { label: "30m", value: "30m" },
  { label: "1h", value: "1h" },
  { label: "6h", value: "6h" },
  { label: "24h", value: "24h" }
];

function sourceSummary(source: SourceStatus, fallback: string) {
  if (source.detail) return source.detail;
  if (source.lastError) return source.lastError;
  return fallback;
}

export default async function DashboardPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { locale, t } = await getServerTranslator();
  const window = parseDashboardWindow(params);
  const [response, health] = await Promise.all([getDashboard(window), getSourceHealth()]);
  const partial = response.sourceStatus.filter((source) => source.status === "partial");
  const unavailable = response.sourceStatus.filter((source) =>
    ["unavailable", "timeout", "misconfigured"].includes(source.status)
  );

  return (
    <div className="app-page">
      <section className="tile tile-light">
        <div className="tile-inner">
          <div className="tile-head tile-head-row">
            <div>
              <div className="section-kicker">{t("dashboard.kicker")}</div>
              <h1 className="tile-title">{t("dashboard.title")}</h1>
              <p className="tile-subtitle">{t("dashboard.subtitle")}</p>
            </div>
            <div className="tile-actions">
              <div className="segment-control" aria-label={t("dashboard.timeWindow")}>
                {windows.map((item) => (
                  <a
                    key={item.value}
                    href={`/dashboard?window=${item.value}`}
                    className={`segment-item ${item.value === window ? "segment-item-active" : ""}`}
                  >
                    {item.label}
                  </a>
                ))}
              </div>
              <HealthModalButton health={health} />
            </div>
          </div>

          <div className="detail-grid">
            <div className="panel p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-[21px] font-semibold leading-[1.19] text-text">
                    {response.diagnosis.title}
                  </h2>
                  <p className="mt-3 text-[17px] leading-[1.47] text-muted">
                    {response.diagnosis.summary}
                  </p>
                </div>
                <StatusBadge tone={dashboardSeverityTone(response.diagnosis.severity)}>
                  {t(`enums.severity.${response.diagnosis.severity}`)} · {response.trendWindow}
                </StatusBadge>
              </div>
            </div>

            <section className="panel p-6" aria-labelledby="dashboard-source-heading">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 id="dashboard-source-heading" className="text-[21px] font-semibold leading-[1.19] text-text">
                    {t("dashboard.sourceTitle")}
                  </h2>
                  <p className="mt-2 text-[14px] leading-[1.43] text-muted">
                    {t("dashboard.sourceDescription")}
                  </p>
                </div>
                <HealthModalButton sources={response.sourceStatus} label={t("dashboard.sourceDetail")} />
              </div>

              {response.sourceStatus.length > 0 ? (
                <div className="record-list mt-5">
                  {response.sourceStatus.map((source) => (
                    <SourceCard key={source.name} source={source} locale={locale} t={t} />
                  ))}
                </div>
              ) : (
                <EmptyState
                  title={t("dashboard.sourceEmptyTitle")}
                  description={t("dashboard.sourceEmptyDescription")}
                  testId="dashboard-source-empty"
                  className="mt-5"
                />
              )}
            </section>
          </div>

          {unavailable.length > 0 ? (
            <div className="notice notice-danger mt-6">
              {t("dashboard.unavailableNotice", {
                count: unavailable.length,
                sources: joinLocalizedList(locale, unavailable.map((source) => source.label))
              })}
            </div>
          ) : null}
          {partial.length > 0 ? (
            <div className="notice notice-warning mt-3">
              {t("dashboard.partialNotice", {
                count: partial.length,
                sources: joinLocalizedList(locale, partial.map((source) => source.label))
              })}
            </div>
          ) : null}
        </div>
      </section>

      <section className="tile tile-dark">
        <div className="tile-inner">
          <div className="tile-head">
            <div className="section-kicker">{t("dashboard.diagnosisKicker")}</div>
            <h2 className="tile-title">{t("dashboard.diagnosisTitle")}</h2>
          </div>
          {response.diagnosisCards.length > 0 ? (
            <div className="utility-grid">
              {response.diagnosisCards.map((card) => (
                <DiagnosisCard key={card.key} card={card} t={t} />
              ))}
            </div>
          ) : (
            <EmptyState
              title={t("dashboard.diagnosisEmptyTitle")}
              description={t("dashboard.diagnosisEmptyDescription")}
              testId="dashboard-diagnosis-empty"
            />
          )}
        </div>
      </section>

      <section className="tile tile-parchment">
        <div className="tile-inner">
          <div className="tile-head">
            <div className="section-kicker">{t("dashboard.runtimeKicker")}</div>
            <h2 className="tile-title">{t("dashboard.retrievalTitle")}</h2>
          </div>
          {response.retrievalMetrics.length > 0 ? (
            <div className="stat-grid">
              {response.retrievalMetrics.map((metric) => (
                <MetricCard key={metric.key} metric={metric} />
              ))}
            </div>
          ) : (
            <EmptyState
              title={t("dashboard.retrievalEmptyTitle")}
              description={t("dashboard.retrievalEmptyDescription")}
              testId="dashboard-runtime-empty"
            />
          )}
        </div>
      </section>

      <section className="tile tile-light">
        <div className="tile-inner">
          <div className="tile-head">
            <div className="section-kicker">{t("dashboard.storageKicker")}</div>
            <h2 className="tile-title">{t("dashboard.storageTitle")}</h2>
          </div>
          {response.storageMetrics.length > 0 ? (
            <div className="stat-grid">
              {response.storageMetrics.map((metric) => (
                <MetricCard key={metric.key} metric={metric} />
              ))}
            </div>
          ) : (
            <EmptyState
              title={t("dashboard.storageEmptyTitle")}
              description={t("dashboard.storageEmptyDescription")}
              testId="dashboard-storage-empty"
            />
          )}
        </div>
      </section>

      <section className="tile tile-parchment">
        <div className="tile-inner">
          <div className="tile-head">
            <div className="section-kicker">{t("dashboard.trendsKicker")}</div>
            <h2 className="tile-title">{t("dashboard.trendsTitle")}</h2>
          </div>
          {response.trends.length > 0 ? (
            <div className="utility-grid">
              {response.trends.map((trend) => (
                <TrendCard key={trend.key} trend={trend} />
              ))}
            </div>
          ) : (
            <EmptyState
              title={t("dashboard.trendsEmptyTitle")}
              description={t("dashboard.trendsEmptyDescription")}
              testId="dashboard-trends-empty"
            />
          )}
        </div>
      </section>
    </div>
  );
}

function SourceCard({ source, locale, t }: { source: SourceStatus; locale: AppLocale; t: TFunction }) {
  return (
    <div className="record-card">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate text-[17px] font-semibold leading-[1.24] text-text">{source.label}</div>
          <p className="mt-1 line-clamp-2 text-[14px] leading-[1.43] text-muted">{sourceSummary(source, t("dashboard.sourcePassed"))}</p>
        </div>
        <StatusBadge tone={source.status === "healthy" ? "success" : source.status === "partial" ? "warning" : "danger"}>
          {t(`enums.sourceStatus.${source.status}`)}
        </StatusBadge>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[14px] leading-[1.43] text-muted-foreground">
        <span>{formatTimestamp(source.lastCheckedAt || source.checkedAt, locale)}</span>
        <span>{source.responseTimeMs === null ? t("common.latencyNotRecorded") : `${source.responseTimeMs} ms`}</span>
      </div>
    </div>
  );
}

function DiagnosisCard({ card, t }: { card: DashboardDiagnosisCard; t: TFunction }) {
  return (
    <div className="panel p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[21px] font-semibold leading-[1.19] text-text">{card.title}</h3>
          <p className="mt-1 text-[14px] leading-[1.43] text-muted">{card.source}</p>
        </div>
        <StatusBadge tone={dashboardSeverityTone(card.severity)}>{t(`enums.severity.${card.severity}`)}</StatusBadge>
      </div>
      <p className="mt-4 text-[17px] leading-[1.47] text-muted">{card.summary}</p>
    </div>
  );
}
