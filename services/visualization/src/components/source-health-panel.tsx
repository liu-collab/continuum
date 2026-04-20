import React from "react";
import { ServiceHealthResponse, SourceStatus } from "@/lib/contracts";
import { formatLastSuccess, formatTimestamp, sourceStatusTone } from "@/lib/format";

import { StatusBadge } from "@/components/status-badge";

type SourceHealthPanelProps =
  | {
      title?: string;
      sources: SourceStatus[];
      health?: never;
    }
  | {
      title?: string;
      sources?: never;
      health: ServiceHealthResponse;
    };

function toneFor(status: string) {
  const mapped = sourceStatusTone(
    status === "ready"
      ? "healthy"
      : status === "ok"
        ? "healthy"
        : status === "degraded"
          ? "partial"
          : "unavailable"
  );

  if (mapped === "success") {
    return "success";
  }

  if (mapped === "warning") {
    return "warning";
  }

  return "danger";
}

function DependencyCards({ sources }: { sources: SourceStatus[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {sources.map((source) => (
        <div key={source.name} className="rounded-lg border bg-surface p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-foreground">{source.label}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{source.name}</div>
            </div>
            <StatusBadge tone={toneFor(source.status)}>{source.status}</StatusBadge>
          </div>
          <dl className="mt-3 space-y-1.5 text-xs text-muted-foreground">
            <div className="flex justify-between gap-2">
              <dt>最近检查</dt>
              <dd className="text-foreground">{formatTimestamp(source.lastCheckedAt || source.checkedAt)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>最近成功</dt>
              <dd className="text-foreground">{formatLastSuccess(source.lastOkAt)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>响应</dt>
              <dd className="text-foreground">
                {source.responseTimeMs === null ? "—" : `${source.responseTimeMs} ms`}
              </dd>
            </div>
            {source.connectionLimit !== null ? (
              <div className="flex justify-between gap-2">
                <dt>连接池</dt>
                <dd className="text-foreground">
                  {source.activeConnections ?? 0} / {source.connectionLimit}
                </dd>
              </div>
            ) : null}
            {source.lastError ? (
              <div>
                <dt className="text-muted-foreground">最近错误</dt>
                <dd className="mt-0.5 text-rose-700">{source.lastError}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      ))}
    </div>
  );
}

export function SourceHealthPanel(props: SourceHealthPanelProps) {
  if ("health" in props && props.health) {
    const health = props.health;

    return (
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-foreground">服务存活</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{health.service.name}</div>
              </div>
              <StatusBadge tone="success">{health.liveness.status}</StatusBadge>
            </div>
            <div className="mt-3 text-xs text-muted-foreground">
              {formatTimestamp(health.liveness.checkedAt)}
            </div>
          </div>
          <div className="rounded-lg border bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-foreground">服务就绪</div>
                <div className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                  {health.readiness.summary}
                </div>
              </div>
              <StatusBadge tone={toneFor(health.readiness.status)}>
                {health.readiness.status}
              </StatusBadge>
            </div>
            <div className="mt-3 text-xs text-muted-foreground">
              {formatTimestamp(health.readiness.checkedAt)}
            </div>
          </div>
        </div>
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            外部依赖
          </div>
          <DependencyCards sources={health.dependencies} />
        </div>
      </div>
    );
  }

  return <DependencyCards sources={props.sources} />;
}
