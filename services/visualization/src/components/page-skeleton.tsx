import React from "react";

export function PageSkeleton({
  kicker,
  title,
  subtitle,
  sections = [
    { title: "content", count: 3 }
  ],
  testId = "page-loading-state"
}: {
  kicker?: string;
  title: string;
  subtitle?: string;
  sections?: Array<{
    title: string;
    count: number;
    columns?: string;
  }>;
  testId?: string;
}) {
  return (
    <div className="app-page" data-testid={testId} aria-busy="true">
      <section className="tile tile-light">
        <div className="tile-inner">
          <div className="tile-head">
            {kicker ? <div className="section-kicker">{kicker}</div> : null}
            <h1 className="tile-title">{title}</h1>
            {subtitle ? <p className="tile-subtitle">{subtitle}</p> : null}
          </div>
          <SkeletonBlock className="h-24" />
        </div>
      </section>

      {sections.map((section) => (
        <section key={section.title} className="tile tile-parchment">
          <div className="tile-inner">
            <div className="section-kicker mb-4">{section.title}</div>
            <div className={`grid gap-3 ${section.columns ?? "md:grid-cols-2 xl:grid-cols-3"}`}>
              {Array.from({ length: section.count }, (_, index) => (
                <SkeletonBlock key={`${section.title}-${index}`} className="h-32" />
              ))}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

export function SkeletonBlock({ className }: { className: string }) {
  return (
    <div className={`panel animate-pulse p-4 ${className}`}>
      <div className="h-3 w-24 rounded bg-surface-muted" />
      <div className="mt-4 h-7 w-28 rounded bg-surface-muted" />
      <div className="mt-3 h-3 w-full max-w-xs rounded bg-surface-muted" />
      <div className="mt-2 h-3 w-2/3 rounded bg-surface-muted" />
    </div>
  );
}
