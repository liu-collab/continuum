import type { Route } from "next";
import Link from "next/link";
import { ArrowRight, BookText, ChartSpline, HeartPulse, ShieldCheck } from "lucide-react";

const cards = [
  {
    href: "/memories" as Route,
    title: "Memory catalog",
    description:
      "Inspect structured memory records with filters for workspace, user, task, memory type, scope, status, and update window.",
    icon: BookText
  },
  {
    href: "/runs" as Route,
    title: "Run trace",
    description:
      "Follow one turn across trigger, recall, injection, and write-back to understand why a memory was used, trimmed, or skipped.",
    icon: HeartPulse
  },
  {
    href: "/dashboard" as Route,
    title: "Metrics dashboard",
    description:
      "Combine retrieval-runtime and storage metrics to separate policy drift, data quality issues, and dependency failures.",
    icon: ChartSpline
  }
];

export default function HomePage() {
  return (
    <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">What this service answers</p>
            <h2 className="font-[var(--font-serif)] text-3xl text-slate-900">
              One place to see what the memory system knows and did.
            </h2>
          </div>
        </div>
        <div className="panel-body grid gap-4 md:grid-cols-3">
          {cards.map((card) => {
            const Icon = card.icon;

            return (
              <Link
                key={card.href}
                href={card.href}
                className="group rounded-xl border bg-white/80 p-5 transition hover:-translate-y-0.5 hover:border-accent hover:shadow-soft"
              >
                <Icon className="h-5 w-5 text-accent" />
                <h3 className="mt-4 text-lg font-semibold text-slate-900">{card.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{card.description}</p>
                <div className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-accent">
                  Open view
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Failure model</p>
            <h2 className="font-[var(--font-serif)] text-3xl text-slate-900">
              Local health stays separate from dependency health.
            </h2>
          </div>
        </div>
        <div className="panel-body space-y-4 text-sm leading-6 text-slate-700">
          <div className="rounded-xl border bg-white/80 p-4">
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
              <ShieldCheck className="h-4 w-4 text-success" />
              `liveness` only reflects this process.
            </div>
            <p className="mt-2">
              Upstream failures must never take the visualization process down or flip its liveness
              state.
            </p>
          </div>
          <div className="rounded-xl border bg-white/80 p-4">
            <div className="text-sm font-semibold text-slate-900">
              `readiness` stays available while degraded responses still work.
            </div>
            <p className="mt-2">
              Each widget can fail independently. A missing source shows an explicit source error
              instead of a blank screen.
            </p>
          </div>
          <div className="rounded-xl border bg-white/80 p-4">
            <div className="text-sm font-semibold text-slate-900">
              Dependencies are isolated and cached briefly.
            </div>
            <p className="mt-2">
              Health checks, dashboard refresh, and read model queries each use their own timeout
              budget and failure handling.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
