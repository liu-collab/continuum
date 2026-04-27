import React from "react";
import { ServiceHealthResponse, SourceStatus } from "@/lib/contracts";
import { formatLastSuccess, formatTimestamp } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";

type SourceHealthPanelProps =
  | { title?: string; sources: SourceStatus[]; health?: never }
  | { title?: string; sources?: never; health: ServiceHealthResponse };

function statusTone(s: string): "success" | "warning" | "danger" {
  if (["ready","ok","healthy"].includes(s)) return "success";
  if (["degraded","partial"].includes(s)) return "warning";
  return "danger";
}

function DependencyCards({ sources }: { sources: SourceStatus[] }) {
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
              <span className="kv-label">Last check</span>
              <span className="kv-value">{formatTimestamp(source.lastCheckedAt || source.checkedAt)}</span>
            </div>
            <div className="kv-row">
              <span className="kv-label">Last ok</span>
              <span className="kv-value">{formatLastSuccess(source.lastOkAt)}</span>
            </div>
            <div className="kv-row">
              <span className="kv-label">Latency</span>
              <span className="kv-value">{source.responseTimeMs === null ? "—" : `${source.responseTimeMs} ms`}</span>
            </div>
            {source.connectionLimit !== null ? (
              <div className="kv-row">
                <span className="kv-label">Pool</span>
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
  if (props.health) {
    const h = props.health;
    return (
      <div className="grid gap-6">
        <div className="utility-grid">
          <div className="panel p-4">
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" }}>
              <div>
                <div className="text-[17px] font-semibold leading-[1.24] text-text">服务存活</div>
                <div className="mt-1 text-[14px] leading-[1.43] text-muted">{h.service.name}</div>
              </div>
              <StatusBadge tone="success">{h.liveness.status}</StatusBadge>
            </div>
            <div className="mt-3 text-[14px] leading-[1.43] text-muted">{formatTimestamp(h.liveness.checkedAt)}</div>
          </div>
          <div className="panel p-4">
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" }}>
              <div>
                <div className="text-[17px] font-semibold leading-[1.24] text-text">服务就绪</div>
                <div className="mt-1 text-[14px] leading-[1.43] text-muted line-clamp-1">{h.readiness.summary}</div>
              </div>
              <StatusBadge tone={statusTone(h.readiness.status)}>{h.readiness.status}</StatusBadge>
            </div>
            <div className="mt-3 text-[14px] leading-[1.43] text-muted">{formatTimestamp(h.readiness.checkedAt)}</div>
          </div>
        </div>
        <div>
          <div className="section-kicker mb-3">外部依赖</div>
          <DependencyCards sources={h.dependencies} />
        </div>
      </div>
    );
  }
  return <DependencyCards sources={props.sources} />;
}
