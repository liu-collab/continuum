"use client";

import React from "react";
import { ServiceHealthResponse, SourceStatus } from "@/lib/contracts";
import { formatLastSuccess, formatTimestamp } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { useAppI18n } from "@/lib/i18n/client";

type SourceHealthPanelProps =
  | { title?: string; sources: SourceStatus[]; health?: never }
  | { title?: string; sources?: never; health: ServiceHealthResponse };

function statusTone(s: string): "success" | "warning" | "danger" {
  if (["ready","ok","healthy"].includes(s)) return "success";
  if (["degraded","partial"].includes(s)) return "warning";
  return "danger";
}

function DependencyCards({ sources }: { sources: SourceStatus[] }) {
  const { locale, t } = useAppI18n();

  return (
    <div className="utility-grid">
      {sources.map((source) => (
        <div key={source.name} className="panel p-4">
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" }}>
            <div>
              <div className="text-[17px] font-semibold leading-[1.24] text-text">{source.label}</div>
              <div className="mt-1 text-[14px] leading-[1.43] text-muted">{source.name}</div>
            </div>
            <StatusBadge tone={statusTone(source.status)}>{source.status}</StatusBadge>
          </div>
          <div className="kv-grid mt-3">
            <div className="kv-row">
              <span className="kv-label">{t("health.lastCheck")}</span>
              <span className="kv-value">{formatTimestamp(source.lastCheckedAt || source.checkedAt, locale)}</span>
            </div>
            <div className="kv-row">
              <span className="kv-label">{t("health.lastOk")}</span>
              <span className="kv-value">{formatLastSuccess(source.lastOkAt, locale)}</span>
            </div>
            <div className="kv-row">
              <span className="kv-label">{t("health.latency")}</span>
              <span className="kv-value">{source.responseTimeMs === null ? "—" : `${source.responseTimeMs} ms`}</span>
            </div>
            {source.connectionLimit !== null ? (
              <div className="kv-row">
                <span className="kv-label">{t("health.pool")}</span>
                <span className="kv-value">{source.activeConnections ?? 0} / {source.connectionLimit}</span>
              </div>
            ) : null}
            {source.lastError ? (
              <div className="notice notice-danger mt-2">
                {source.lastError}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SourceHealthPanel(props: SourceHealthPanelProps) {
  const { locale, t } = useAppI18n();

  if (props.health) {
    const h = props.health;
    return (
      <div className="grid gap-6">
        <div className="utility-grid">
          <div className="panel p-4">
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" }}>
              <div>
                <div className="text-[17px] font-semibold leading-[1.24] text-text">{t("health.liveness")}</div>
                <div className="mt-1 text-[14px] leading-[1.43] text-muted">{h.service.name}</div>
              </div>
              <StatusBadge tone="success">{h.liveness.status}</StatusBadge>
            </div>
            <div className="mt-3 text-[14px] leading-[1.43] text-muted">{formatTimestamp(h.liveness.checkedAt, locale)}</div>
          </div>
          <div className="panel p-4">
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" }}>
              <div>
                <div className="text-[17px] font-semibold leading-[1.24] text-text">{t("health.readiness")}</div>
                <div className="mt-1 text-[14px] leading-[1.43] text-muted line-clamp-1">{h.readiness.summary}</div>
              </div>
              <StatusBadge tone={statusTone(h.readiness.status)}>{h.readiness.status}</StatusBadge>
            </div>
            <div className="mt-3 text-[14px] leading-[1.43] text-muted">{formatTimestamp(h.readiness.checkedAt, locale)}</div>
          </div>
        </div>
        <div>
          <div className="section-kicker mb-3">{t("health.dependencies")}</div>
          <DependencyCards sources={h.dependencies} />
        </div>
      </div>
    );
  }
  return <DependencyCards sources={props.sources} />;
}
