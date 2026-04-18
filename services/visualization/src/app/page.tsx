import type { Route } from "next";
import Link from "next/link";
import { ArrowRight, BookText, Bot, ChartSpline, HeartPulse, ShieldCheck } from "lucide-react";

const cards = [
  {
    href: "/agent" as Route,
    title: "内置 Agent",
    description:
      "在 visualization 页面内直接和 memory-native-agent 对话，查看注入、工具调用、MCP 状态和 prompt 检查结果。",
    icon: Bot
  },
  {
    href: "/memories" as Route,
    title: "记忆目录",
    description:
      "按工作区、用户、任务、记忆类型、作用域、状态和更新时间筛选结构化记忆记录。",
    icon: BookText
  },
  {
    href: "/runs" as Route,
    title: "运行轨迹",
    description:
      "查看单轮在触发、召回、注入和写回四个阶段发生了什么，理解记忆为什么被使用、裁剪或跳过。",
    icon: HeartPulse
  },
  {
    href: "/dashboard" as Route,
    title: "指标看板",
    description:
      "把 `retrieval-runtime` 和 `storage` 的指标放在一起看，区分策略漂移、数据质量问题和依赖故障。",
    icon: ChartSpline
  }
];

export default function HomePage() {
  return (
    <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">这个服务回答什么问题</p>
            <h2 className="font-[var(--font-serif)] text-3xl text-slate-900">
              在一个地方看到记忆系统知道什么、做了什么。
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
                  打开页面
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
            <p className="eyebrow">故障模型</p>
            <h2 className="font-[var(--font-serif)] text-3xl text-slate-900">
              本地健康状态和依赖健康状态必须分开看。
            </h2>
          </div>
        </div>
        <div className="panel-body space-y-4 text-sm leading-6 text-slate-700">
          <div className="rounded-xl border bg-white/80 p-4">
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
              <ShieldCheck className="h-4 w-4 text-success" />
              `liveness` 只反映当前进程。
            </div>
            <p className="mt-2">
              上游依赖故障不应该把可视化服务一起打挂，也不应该改变它的 `liveness` 状态。
            </p>
          </div>
          <div className="rounded-xl border bg-white/80 p-4">
            <div className="text-sm font-semibold text-slate-900">
              `readiness` 在降级响应仍可工作时保持可用。
            </div>
            <p className="mt-2">
              每个部件都可以独立失败。缺失数据源时应显示明确错误，而不是空白页。
            </p>
          </div>
          <div className="rounded-xl border bg-white/80 p-4">
            <div className="text-sm font-semibold text-slate-900">
              依赖探测独立执行，并带短时缓存。
            </div>
            <p className="mt-2">
              健康检查、看板刷新和读模型查询各自使用独立的超时预算和失败处理。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
