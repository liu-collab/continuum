"use client";

import type { Route } from "next";
import React, { useCallback, useEffect, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { HealthModalButton } from "@/components/health-modal";
import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import { TrendCard } from "@/components/trend-card";
import type { DashboardDiagnosisCard, DashboardResponse, ServiceHealthResponse, SourceStatus } from "@/lib/contracts";
import { dashboardSeverityTone, formatTimestamp } from "@/lib/format";
import { createTranslator, joinLocalizedList, type AppLocale } from "@/lib/i18n/messages";

type DashboardWorkspaceProps = {
  initialResponse: DashboardResponse;
  health: ServiceHealthResponse;
  initialWindow: string;
  locale: AppLocale;
};

type TFunction = (key: string, variables?: Record<string, string | number>) => string;

const windows = [
  { label: "15m", value: "15m" },
  { label: "30m", value: "30m" },
  { label: "1h", value: "1h" },
  { label: "6h", value: "6h" },
  { label: "24h", value: "24h" }
];

function dashboardPath(window: string) {
  return `/dashboard?window=${encodeURIComponent(window)}`;
}

function readDashboardWindow() {
  const value = new URLSearchParams(window.location.search).get("window");
  return value && windows.some((item) => item.value === value) ? value : "30m";
}

function sourceSummary(source: SourceStatus, fallback: string) {
  if (source.detail) return source.detail;
  if (source.lastError) return source.lastError;
  return fallback;
}

export function DashboardWorkspace({
  initialResponse,
  health,
  initialWindow,
  locale
}: DashboardWorkspaceProps) {
  const t = createTranslator(locale);
  const [response, setResponse] = useState(initialResponse);
  const [activeWindow, setActiveWindow] = useState(initialWindow);
  const [loadingWindow, setLoadingWindow] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const partial = response.sourceStatus.filter((source) => source.status === "partial");
  const unavailable = response.sourceStatus.filter((source) =>
    ["unavailable", "timeout", "misconfigured"].includes(source.status)
  );

  const loadWindow = useCallback(async (nextWindow: string, historyMode: "push" | "replace" | "none") => {
    setLoadingWindow(nextWindow);
    setErrorMessage(null);
    try {
      const nextResponse = await fetchDashboard(nextWindow);
      setResponse(nextResponse);
      setActiveWindow(nextWindow);
      if (historyMode === "push") {
        window.history.pushState(null, "", dashboardPath(nextWindow));
      } else if (historyMode === "replace") {
        window.history.replaceState(null, "", dashboardPath(nextWindow));
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingWindow(null);
    }
  }, []);

  useEffect(() => {
    setResponse(initialResponse);
    setActiveWindow(initialWindow);
    setLoadingWindow(null);
    setErrorMessage(null);
  }, [initialResponse, initialWindow]);

  useEffect(() => {
    function handlePopState() {
      const nextWindow = readDashboardWindow();
      if (nextWindow === activeWindow) {
        return;
      }

      void loadWindow(nextWindow, "none");
    }

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [activeWindow, loadWindow]);

  async function selectWindow(nextWindow: string) {
    if (nextWindow === activeWindow) {
      window.history.replaceState(null, "", dashboardPath(nextWindow));
      return;
    }

    await loadWindow(nextWindow, "push");
  }

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
              <div className="grid gap-2">
                <div className="segment-control" aria-label={t("dashboard.timeWindow")}>
                  {windows.map((item) => (
                    <a
                      key={item.value}
                      href={dashboardPath(item.value) as Route}
                      aria-busy={loadingWindow === item.value}
                      data-testid={`dashboard-window-${item.value}`}
                      onClick={(event) => {
                        event.preventDefault();
                        void selectWindow(item.value);
                      }}
                      className={`segment-item ${item.value === activeWindow ? "segment-item-active" : ""}`}
                    >
                      {item.label}
                    </a>
                  ))}
                </div>
                <div className="min-h-[20px]">
                  {loadingWindow ? (
                    <div
                      className="flex items-center justify-end gap-2 whitespace-nowrap text-[14px] leading-[1.43] text-[var(--primary)]"
                      role="status"
                      data-testid="dashboard-window-pending"
                    >
                      {t("dashboard.loadingWindow")}
                    </div>
                  ) : null}
                </div>
              </div>
              <HealthModalButton health={health} />
            </div>
          </div>

          {errorMessage ? (
            <div className="notice notice-danger mt-5" role="alert" data-testid="dashboard-window-error">
              {errorMessage}
            </div>
          ) : null}

          <div className="detail-grid">
            <div className="panel p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="headline-display text-[21px] font-semibold leading-[1.19] text-text">
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
                  <h2 id="dashboard-source-heading" className="headline-display text-[21px] font-semibold leading-[1.19] text-text">
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
                <MetricCard key={metric.key} metric={metric} locale={locale} />
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
                <MetricCard key={metric.key} metric={metric} locale={locale} />
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
                <TrendCard key={trend.key} trend={trend} locale={locale} />
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

async function fetchDashboard(window: string) {
  const response = await fetch(`/api/dashboard?window=${encodeURIComponent(window)}`, {
    headers: {
      accept: "application/json",
    },
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(readErrorMessage(payload, `Request failed with status ${response.status}`));
  }

  return payload as DashboardResponse;
}

function readErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: { message?: unknown } }).error;
    if (error && typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
  }

  return fallback;
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
          <h3 className="headline-display text-[21px] font-semibold leading-[1.19] text-text">{card.title}</h3>
          <p className="mt-1 text-[14px] leading-[1.43] text-muted">{card.source}</p>
        </div>
        <StatusBadge tone={dashboardSeverityTone(card.severity)}>{t(`enums.severity.${card.severity}`)}</StatusBadge>
      </div>
      <p className="mt-4 text-[17px] leading-[1.47] text-muted">{card.summary}</p>
    </div>
  );
}
