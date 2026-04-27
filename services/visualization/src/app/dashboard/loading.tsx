import React from "react";

const windows = ["15m", "30m", "1h", "6h", "24h"];

export default function DashboardLoading() {
  return (
    <div className="space-y-6" data-testid="dashboard-loading-state" aria-busy="true">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">看板</h1>
          <p className="mt-1 text-sm text-muted-foreground">正在读取运行时与存储指标。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-md border bg-surface p-0.5">
            {windows.map((item) => (
              <span key={item} className="rounded px-3 py-1 text-xs font-medium text-muted-foreground">
                {item}
              </span>
            ))}
          </div>
          <span className="rounded-md border bg-surface px-3 py-1 text-xs text-muted-foreground">健康</span>
        </div>
      </div>

      <SkeletonBlock className="h-24" />

      <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <SkeletonBlock key={`diagnosis-${index}`} className="h-32" />
          ))}
        </div>
        <SkeletonBlock className="h-80" />
      </section>

      <DashboardSkeletonSection title="retrieval-runtime" count={4} />
      <DashboardSkeletonSection title="storage" count={4} />
      <DashboardSkeletonSection title="趋势" count={2} columns="md:grid-cols-2" />
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
    <section className="space-y-3">
      <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{title}</div>
      <div className={`grid gap-3 ${columns}`}>
        {Array.from({ length: count }, (_, index) => (
          <SkeletonBlock key={`${title}-${index}`} className="h-36" />
        ))}
      </div>
    </section>
  );
}

function SkeletonBlock({ className }: { className: string }) {
  return (
    <div className={`animate-pulse rounded-lg border bg-surface p-4 ${className}`}>
      <div className="h-3 w-24 rounded bg-surface-muted" />
      <div className="mt-4 h-7 w-28 rounded bg-surface-muted" />
      <div className="mt-3 h-3 w-full max-w-xs rounded bg-surface-muted" />
      <div className="mt-2 h-3 w-2/3 rounded bg-surface-muted" />
    </div>
  );
}
