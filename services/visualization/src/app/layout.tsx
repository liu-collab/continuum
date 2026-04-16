import type { Metadata } from "next";
import type { Route } from "next";
import { Manrope, Newsreader } from "next/font/google";
import Link from "next/link";
import { Activity, BookText, ChartSpline, HeartPulse } from "lucide-react";

import { Providers } from "@/app/providers";
import { cn } from "@/lib/utils";

import "./globals.css";

const sans = Manrope({
  variable: "--font-sans",
  subsets: ["latin"]
});

const serif = Newsreader({
  variable: "--font-serif",
  subsets: ["latin"]
});

const navigation = [
  { href: "/" as Route, label: "Overview", icon: Activity },
  { href: "/memories" as Route, label: "Memories", icon: BookText },
  { href: "/runs" as Route, label: "Runs", icon: HeartPulse },
  { href: "/dashboard" as Route, label: "Dashboard", icon: ChartSpline }
];

export const metadata: Metadata = {
  title: "Agent Memory Observatory",
  description: "Structured memory catalog, run trace, and observability dashboard."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={cn(sans.variable, serif.variable, "font-[var(--font-sans)] antialiased")}>
        <Providers>
          <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
            <header className="panel mb-6 overflow-hidden">
              <div className="border-b border-white/40 bg-page-glow px-6 py-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div className="max-w-2xl">
                    <p className="eyebrow">Agent Memory Observatory</p>
                    <h1 className="mt-2 font-[var(--font-serif)] text-4xl tracking-tight text-slate-900">
                      Structured memory, run traces, and failure signals in one console.
                    </h1>
                    <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">
                      Visualization stays online even when upstream sources fail. Each source is
                      queried independently, and each page explains what happened instead of dumping
                      raw JSON.
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/60 bg-white/70 px-4 py-3 text-sm text-slate-600">
                    <div className="font-semibold text-slate-900">Independent service boundary</div>
                    <div className="mt-1 max-w-sm">
                      Reads only the published read model and observe APIs from `storage` and
                      `retrieval-runtime`.
                    </div>
                  </div>
                </div>
              </div>
              <nav className="flex flex-wrap gap-2 px-4 py-4">
                {navigation.map((item) => {
                  const Icon = item.icon;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="inline-flex items-center gap-2 rounded-full border bg-white/80 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-accent hover:text-accent"
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </header>
            <main className="flex-1">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
