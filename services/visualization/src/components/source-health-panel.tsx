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
    <div className="grid gap-4 md:grid-cols-3">
      {sources.map((source) => (
        <div key={source.name} className="rounded-xl border bg-white/80 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">{source.label}</div>
              <div className="mt-1 text-xs text-slate-500">{source.name}</div>
            </div>
            <StatusBadge tone={toneFor(source.status)}>{source.status}</StatusBadge>
          </div>
          <dl className="mt-4 space-y-2 text-sm text-slate-600">
            <div>
              <dt className="font-medium text-slate-900">Checked</dt>
              <dd>{formatTimestamp(source.lastCheckedAt || source.checkedAt)}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-900">Last success</dt>
              <dd>{formatLastSuccess(source.lastOkAt)}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-900">Response time</dt>
              <dd>{source.responseTimeMs === null ? "Unavailable" : `${source.responseTimeMs} ms`}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-900">Last error</dt>
              <dd>{source.lastError ?? "None"}</dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  );
}

export function SourceHealthPanel(props: SourceHealthPanelProps) {
  const title = props.title ?? "Health";

  if ("health" in props && props.health) {
    const health = props.health;

    return (
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Health</p>
            <h2 className="font-[var(--font-serif)] text-2xl text-slate-900">{title}</h2>
          </div>
        </div>
        <div className="panel-body space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border bg-white/80 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Service liveness</div>
                  <div className="mt-1 text-xs text-slate-500">{health.service.name}</div>
                </div>
                <StatusBadge tone="success">{health.liveness.status}</StatusBadge>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-600">
                Process health only. Upstream failures must never flip liveness.
              </p>
              <div className="mt-3 text-sm text-slate-500">
                Checked {formatTimestamp(health.liveness.checkedAt)}
              </div>
            </div>
            <div className="rounded-xl border bg-white/80 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Service readiness</div>
                  <div className="mt-1 text-xs text-slate-500">Can the service still respond?</div>
                </div>
                <StatusBadge tone={toneFor(health.readiness.status)}>
                  {health.readiness.status}
                </StatusBadge>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-600">
                {health.readiness.summary}
              </p>
              <div className="mt-3 text-sm text-slate-500">
                Checked {formatTimestamp(health.readiness.checkedAt)}
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-slate-50/80 p-4 text-sm leading-6 text-slate-700">
            {health.service.summary}
          </div>

          <div>
            <div className="mb-4 text-sm font-semibold text-slate-900">External dependencies</div>
            <DependencyCards sources={health.dependencies} />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Health</p>
          <h2 className="font-[var(--font-serif)] text-2xl text-slate-900">{title}</h2>
        </div>
      </div>
      <div className="panel-body">
        <DependencyCards sources={props.sources} />
      </div>
    </section>
  );
}
