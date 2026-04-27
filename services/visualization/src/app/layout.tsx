import type { Metadata } from "next";
import type { Route } from "next";
import { JetBrains_Mono, DM_Sans } from "next/font/google";
import Link from "next/link";
import { Activity, BookText, Bot, ChartSpline, FileText, HeartPulse, ShieldCheck, Sun, Moon } from "lucide-react";

import { Providers } from "@/app/providers";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

import "./globals.css";

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"]
});

const sans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin"]
});

const navigation = [
  { href: "/" as Route, label: "概览", icon: Activity },
  { href: "/agent" as Route, label: "Agent", icon: Bot },
  { href: "/memories" as Route, label: "记忆", icon: BookText },
  { href: "/governance" as Route, label: "治理", icon: ShieldCheck },
  { href: "/runs" as Route, label: "运行", icon: HeartPulse },
  { href: "/dashboard" as Route, label: "看板", icon: ChartSpline },
  { href: "/docs" as Route, label: "文档", icon: FileText }
];

export const metadata: Metadata = {
  title: "Continuum · Observatory",
  description: "Agent memory runtime observability dashboard."
};

function Brand() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="shrink-0">
      <rect x="2" y="2" width="20" height="20" rx="4" stroke="var(--amber)" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="2" fill="var(--amber)" opacity="0.7" />
      <circle cx="16" cy="8" r="2" fill="var(--cyan)" opacity="0.7" />
      <circle cx="12" cy="16" r="2" fill="var(--amber)" opacity="0.9" />
      <line x1="8" y1="10" x2="12" y2="14" stroke="var(--amber-dim)" strokeWidth="1" />
      <line x1="16" y1="10" x2="12" y2="14" stroke="var(--cyan-dim)" strokeWidth="1" />
    </svg>
  );
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{if(localStorage.theme==='light')document.documentElement.classList.add('light')}catch(e){}` }} />
      </head>
      <body className={cn(sans.variable, mono.variable, "font-[var(--font-sans)] antialiased")}>
        <Providers>
          <div className="flex h-screen overflow-hidden bg-background">
            <aside className="hidden w-52 shrink-0 border-r border-border bg-surface md:flex md:flex-col">
              <Link
                href={"/" as Route}
                className="flex h-12 items-center gap-2.5 border-b border-border px-4"
              >
                <Brand />
                <span className="truncate text-[13px] font-medium tracking-tight font-[var(--font-mono)] text-text">
                  continuum
                </span>
              </Link>
              <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
                {navigation.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-[var(--font-mono)] text-muted transition-all duration-75 hover:bg-surface-hover hover:text-text"
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 opacity-60" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
              <div className="border-t border-border px-4 py-2.5 flex items-center justify-between gap-2">
                <span className="text-[10px] font-[var(--font-mono)] tracking-[0.12em] text-muted-foreground">
                  OBSERVE
                </span>
                <ThemeToggle />
              </div>
            </aside>
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <header className="shrink-0 border-b border-border bg-surface md:hidden">
                <div className="flex h-12 items-center gap-2.5 px-4">
                  <Link href={"/" as Route} className="flex min-w-0 items-center gap-2.5">
                    <Brand />
                    <span className="truncate text-[13px] font-medium tracking-tight font-[var(--font-mono)] text-text">
                      continuum
                    </span>
                  </Link>
                </div>
                <nav className="flex gap-0.5 overflow-x-auto border-t border-border px-3 py-1.5">
                  {navigation.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-[var(--font-mono)] text-muted transition hover:bg-surface-hover hover:text-text"
                      >
                        <Icon className="h-3 w-3 opacity-60" />
                        {item.label}
                      </Link>
                    );
                  })}
                </nav>
              </header>
              <main className="min-h-0 w-full flex-1 overflow-auto p-4 lg:p-6">
                {children}
              </main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
