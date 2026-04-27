import type { Route } from "next";
import Link from "next/link";
import { Bot, Database, GitBranch, HeartPulse } from "lucide-react";

const entries = [
  {
    href: "/dashboard" as Route,
    title: "运行时指标",
    description: "查看召回、注入、写回、存储和治理的主要状态。",
    icon: HeartPulse
  },
  {
    href: "/memories" as Route,
    title: "记忆目录",
    description: "浏览结构化记忆、待确认项和不同作用域的可见性。",
    icon: Database
  },
  {
    href: "/runs" as Route,
    title: "运行轨迹",
    description: "定位一轮对话里触发、召回、注入和写回发生了什么。",
    icon: GitBranch
  },
  {
    href: "/agent" as Route,
    title: "Agent 工作台",
    description: "打开参考宿主，直接验证记忆注入与写回效果。",
    icon: Bot
  }
];

export default function HomePage() {
  return (
    <div className="app-page">
      <section className="tile tile-light">
        <div className="tile-inner">
          <div className="tile-head">
            <div className="section-kicker">Continuum</div>
            <h1 className="tile-title">持续记忆的观测台。</h1>
            <p className="tile-subtitle">
              这里用来确认记忆系统是否正确记住、召回、注入和治理。
            </p>
          </div>
          <div className="tile-actions">
            <Link href={"/dashboard" as Route} className="button-primary">查看指标</Link>
            <Link href={"/agent" as Route} className="button-secondary-pill">打开 Agent</Link>
          </div>
        </div>
      </section>

      <section className="tile tile-dark">
        <div className="tile-inner">
          <div className="tile-head">
            <div className="section-kicker">工作流</div>
            <h2 className="tile-title">从状态到细节。</h2>
            <p className="tile-subtitle">
              先看系统是否健康，再进入记忆、轨迹和治理详情。
            </p>
          </div>
          <div className="utility-grid">
            {entries.map((entry) => {
              const Icon = entry.icon;

              return (
                <Link key={entry.href} href={entry.href} className="record-link">
                  <div className="icon-button mb-5">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-[21px] font-semibold leading-[1.19] text-text">{entry.title}</h3>
                  <p className="mt-3 text-[17px] leading-[1.47] text-muted">{entry.description}</p>
                </Link>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
