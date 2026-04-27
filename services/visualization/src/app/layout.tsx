import type { Metadata } from "next";
import type { Route } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import { Activity, BookText, Bot, ChartSpline, FileText, HeartPulse, ShieldCheck } from "lucide-react";

import { Providers } from "@/app/providers";
import { BrandMark } from "@/components/brand-mark";
import { cn } from "@/lib/utils";

import "./globals.css";

const sans = Inter({
  variable: "--font-sans",
  subsets: ["latin"]
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
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
  title: "Agent Memory Observatory",
  description: "结构化记忆目录、运行轨迹与可观测看板。"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className={cn(sans.variable, mono.variable, "font-[var(--font-sans)] antialiased")}>
        <Providers>
          <div className="flex h-screen overflow-hidden bg-background">
            <aside className="hidden w-56 shrink-0 border-r bg-surface md:flex md:flex-col">
              <Link href={"/" as Route} className="flex h-12 items-center gap-2 border-b px-3">
                <BrandMark className="h-6 w-6 shrink-0" />
                <span className="truncate text-sm font-semibold tracking-tight">Memory Observatory</span>
              </Link>
              <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
                {navigation.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
              <div className="border-t px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                runtime / storage / agent
              </div>
            </aside>
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <header className="shrink-0 border-b bg-surface md:hidden">
                <div className="flex h-12 items-center gap-2 px-3">
                  <Link href={"/" as Route} className="flex min-w-0 items-center gap-2">
                    <BrandMark className="h-6 w-6 shrink-0" />
                    <span className="truncate text-sm font-semibold tracking-tight">Memory Observatory</span>
                  </Link>
                </div>
                <nav className="flex gap-1 overflow-x-auto border-t px-3 py-1.5">
                  {navigation.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {item.label}
                      </Link>
                    );
                  })}
                </nav>
              </header>
              <main className="min-h-0 w-full flex-1 overflow-auto p-4 lg:p-5">
                {children}
              </main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
