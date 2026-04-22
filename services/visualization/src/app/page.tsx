import type { Route } from "next";
import Link from "next/link";
import { ArrowUpRight, BookText, Bot, ChartSpline, HeartPulse, ShieldCheck } from "lucide-react";

const cards = [
  {
    href: "/agent" as Route,
    title: "Agent",
    description: "对话与工具调用",
    icon: Bot,
  },
  {
    href: "/memories" as Route,
    title: "记忆",
    description: "结构化记录目录",
    icon: BookText,
  },
  {
    href: "/governance" as Route,
    title: "治理",
    description: "自动治理历史与详情",
    icon: ShieldCheck,
  },
  {
    href: "/runs" as Route,
    title: "运行",
    description: "触发 / 召回 / 注入 / 写回",
    icon: HeartPulse,
  },
  {
    href: "/dashboard" as Route,
    title: "看板",
    description: "运行时与存储指标",
    icon: ChartSpline,
  }
];

export default function HomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">概览</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          记忆系统的目录、轨迹与指标。
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.href}
              href={card.href}
              className="group flex flex-col gap-3 rounded-lg border bg-surface p-4 transition hover:border-border-strong hover:shadow-soft"
            >
              <div className="flex items-center justify-between">
                <Icon className="h-5 w-5 text-foreground" />
                <ArrowUpRight className="h-4 w-4 text-muted-foreground transition group-hover:text-foreground" />
              </div>
              <div>
                <div className="text-base font-semibold text-foreground">{card.title}</div>
                <div className="mt-0.5 text-sm text-muted-foreground">{card.description}</div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
