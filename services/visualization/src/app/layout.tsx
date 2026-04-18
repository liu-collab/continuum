import type { Metadata } from "next";
import type { Route } from "next";
import { Manrope, Newsreader } from "next/font/google";
import Link from "next/link";
import { Activity, BookText, Bot, ChartSpline, HeartPulse } from "lucide-react";

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
  { href: "/" as Route, label: "概览", icon: Activity },
  { href: "/agent" as Route, label: "内置 Agent", icon: Bot },
  { href: "/memories" as Route, label: "记忆目录", icon: BookText },
  { href: "/runs" as Route, label: "运行轨迹", icon: HeartPulse },
  { href: "/dashboard" as Route, label: "指标看板", icon: ChartSpline }
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
      <body className={cn(sans.variable, serif.variable, "font-[var(--font-sans)] antialiased")}>
        <Providers>
          <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
            <header className="panel mb-6 overflow-hidden">
              <div className="border-b border-white/40 bg-page-glow px-6 py-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div className="max-w-2xl">
                    <p className="eyebrow">Agent Memory Observatory</p>
                    <h1 className="mt-2 font-[var(--font-serif)] text-4xl tracking-tight text-slate-900">
                      在一个控制台里查看结构化记忆、运行轨迹和故障信号。
                    </h1>
                    <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">
                      即使上游依赖异常，可视化服务也应继续在线。每个数据源独立探测，每个页面都尽量解释发生了什么，而不是直接抛出原始 JSON。
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/60 bg-white/70 px-4 py-3 text-sm text-slate-600">
                    <div className="font-semibold text-slate-900">独立服务边界</div>
                    <div className="mt-1 max-w-sm">
                      这里只读取 `storage` 和 `retrieval-runtime` 已发布的共享读模型与观测接口。
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
