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
              <dt className="font-medium text-slate-900">最近检查</dt>
              <dd>{formatTimestamp(source.lastCheckedAt || source.checkedAt)}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-900">最近成功</dt>
              <dd>{formatLastSuccess(source.lastOkAt)}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-900">响应时间</dt>
              <dd>{source.responseTimeMs === null ? "不可用" : `${source.responseTimeMs} ms`}</dd>
            </div>
            {source.connectionLimit !== null ? (
              <div>
                <dt className="font-medium text-slate-900">连接池</dt>
                <dd>
                  {source.activeConnections ?? 0} / {source.connectionLimit}
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="font-medium text-slate-900">最近错误</dt>
              <dd>{source.lastError ?? "无"}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-900">说明</dt>
              <dd>{source.detail ?? "无"}</dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  );
}

export function SourceHealthPanel(props: SourceHealthPanelProps) {
  const title = props.title ?? "健康状态";

  if ("health" in props && props.health) {
    const health = props.health;

    return (
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">健康状态</p>
            <h2 className="font-[var(--font-serif)] text-2xl text-slate-900">{title}</h2>
          </div>
        </div>
        <div className="panel-body space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border bg-white/80 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">服务存活</div>
                  <div className="mt-1 text-xs text-slate-500">{health.service.name}</div>
                </div>
                <StatusBadge tone="success">{health.liveness.status}</StatusBadge>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-600">
                这里只反映当前进程是否存活。上游依赖异常不应该影响 `liveness`。
              </p>
              <div className="mt-3 text-sm text-slate-500">
                检查时间：{formatTimestamp(health.liveness.checkedAt)}
              </div>
            </div>
            <div className="rounded-xl border bg-white/80 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">服务就绪</div>
                  <div className="mt-1 text-xs text-slate-500">当前服务是否还能继续响应</div>
                </div>
                <StatusBadge tone={toneFor(health.readiness.status)}>
                  {health.readiness.status}
                </StatusBadge>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-600">
                {health.readiness.summary}
              </p>
              <div className="mt-3 text-sm text-slate-500">
                检查时间：{formatTimestamp(health.readiness.checkedAt)}
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-slate-50/80 p-4 text-sm leading-6 text-slate-700">
            {health.service.summary}
          </div>

          <div>
            <div className="mb-4 text-sm font-semibold text-slate-900">外部依赖</div>
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
          <p className="eyebrow">健康状态</p>
          <h2 className="font-[var(--font-serif)] text-2xl text-slate-900">{title}</h2>
        </div>
      </div>
      <div className="panel-body">
        <DependencyCards sources={props.sources} />
      </div>
    </section>
  );
}
