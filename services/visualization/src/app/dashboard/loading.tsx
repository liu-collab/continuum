import React from "react";

const windows = ["15m", "30m", "1h", "6h", "24h"];

export default function DashboardLoading() {
  return (
    <div className="app-page" data-testid="dashboard-loading-state" aria-busy="true">
      <section className="tile tile-light">
        <div className="tile-inner">
          <div className="tile-head tile-head-row">
            <div>
              <div className="section-kicker">诊断</div>
              <h1 className="tile-title">运行时指标</h1>
              <p className="tile-subtitle">正在读取运行时与存储指标。</p>
            </div>
            <div className="segment-control">
              {windows.map((item) => (
                <span key={item} className="segment-item">
                  {item}
                </span>
              ))}
            </div>
          </div>
          <SkeletonBlock className="h-32" />
        </div>
      </section>

      <DashboardSkeletonSection title="retrieval-runtime" count={4} />
      <DashboardSkeletonSection title="storage" count={4} />
      <DashboardSkeletonSection title="趋势" count={2} />
    </div>
  );
}

function DashboardSkeletonSection({
  title,
  count,
  columns = "md:grid-cols-2 xl:grid-cols-4"
}: {
  title: string;
  count: number;
  columns?: string;
}) {
  return (
    <section className="tile tile-parchment">
      <div className="tile-inner">
        <div className="section-kicker mb-4">{title}</div>
        <div className={`grid gap-3 ${columns}`}>
          {Array.from({ length: count }, (_, index) => (
            <SkeletonBlock key={`${title}-${index}`} className="h-36" />
          ))}
        </div>
      </div>
    </section>
  );
}

function SkeletonBlock({ className }: { className: string }) {
  return (
    <div className={`panel animate-pulse p-4 ${className}`}>
      <div className="h-3 w-24 rounded bg-surface-muted" />
      <div className="mt-4 h-7 w-28 rounded bg-surface-muted" />
      <div className="mt-3 h-3 w-full max-w-xs rounded bg-surface-muted" />
      <div className="mt-2 h-3 w-2/3 rounded bg-surface-muted" />
    </div>
  );
}
