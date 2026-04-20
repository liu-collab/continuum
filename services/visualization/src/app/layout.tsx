import type { Metadata } from "next";
import type { Route } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import { Activity, BookText, Bot, ChartSpline, HeartPulse } from "lucide-react";

import { Providers } from "@/app/providers";
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
  { href: "/runs" as Route, label: "运行", icon: HeartPulse },
  { href: "/dashboard" as Route, label: "看板", icon: ChartSpline }
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
          <div className="flex min-h-screen flex-col">
            <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
              <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-3 sm:px-6 lg:px-8">
                <Link href={"/" as Route} className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-accent-foreground">
                    <Activity className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-sm font-semibold tracking-tight">Memory Observatory</span>
                </Link>
                <nav className="flex items-center gap-1">
                  {navigation.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {item.label}
                      </Link>
                    );
                  })}
                </nav>
              </div>
            </header>
            <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
