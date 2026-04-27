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
    <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
      {sources.map((source) => (
        <div key={source.name} className="panel p-4">
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" }}>
            <div>
              <div className="text-[13px] font-[var(--font-mono)] font-medium text-text">{source.label}</div>
              <div className="mt-0.5 text-[11px] font-[var(--font-mono)] text-muted">{source.name}</div>
            </div>
            <StatusBadge tone={statusTone(source.status)}>{source.status}</StatusBadge>
          </div>
          <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.375rem", fontSize: "0.75rem", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
              <span>Last check</span>
              <span style={{ color: "var(--text-secondary)" }}>{formatTimestamp(source.lastCheckedAt || source.checkedAt)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
              <span>Last ok</span>
              <span style={{ color: "var(--text-secondary)" }}>{formatLastSuccess(source.lastOkAt)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
              <span>Latency</span>
              <span style={{ color: "var(--text-secondary)" }}>{source.responseTimeMs === null ? "—" : `${source.responseTimeMs} ms`}</span>
            </div>
            {source.connectionLimit !== null ? (
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                <span>Pool</span>
                <span style={{ color: "var(--text-secondary)" }}>{source.activeConnections ?? 0} / {source.connectionLimit}</span>
              </div>
            ) : null}
            {source.lastError ? (
              <div style={{ marginTop: "0.25rem" }}>
                <div>Last error</div>
                <div style={{ marginTop: "0.125rem", color: "var(--rose)" }}>{source.lastError}</div>
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
      <div style={{ display: "grid", gap: "1rem" }}>
        <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          <div className="panel p-4">
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" }}>
              <div>
                <div className="text-[13px] font-[var(--font-mono)] font-medium text-text">Liveness</div>
                <div className="mt-0.5 text-[11px] font-[var(--font-mono)] text-muted">{h.service.name}</div>
              </div>
              <StatusBadge tone="success">{h.liveness.status}</StatusBadge>
            </div>
            <div className="mt-3 text-[11px] font-[var(--font-mono)] text-muted">{formatTimestamp(h.liveness.checkedAt)}</div>
          </div>
          <div className="panel p-4">
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" }}>
              <div>
                <div className="text-[13px] font-[var(--font-mono)] font-medium text-text">Readiness</div>
                <div className="mt-0.5 text-[11px] font-[var(--font-mono)] text-muted line-clamp-1">{h.readiness.summary}</div>
              </div>
              <StatusBadge tone={statusTone(h.readiness.status)}>{h.readiness.status}</StatusBadge>
            </div>
            <div className="mt-3 text-[11px] font-[var(--font-mono)] text-muted">{formatTimestamp(h.readiness.checkedAt)}</div>
          </div>
        </div>
        <div>
          <div className="mb-2 text-[10px] font-[var(--font-mono)] uppercase tracking-[0.16em] text-muted-foreground">Dependencies</div>
          <DependencyCards sources={h.dependencies} />
        </div>
      </div>
    );
  }
  return <DependencyCards sources={props.sources} />;
}
