import React from "react";
import Link from "next/link";

import { renderRepositoryMarkdown } from "@/lib/server/docs";

export default async function ConfigurationDocPage() {
  const document = await renderRepositoryMarkdown("docs/configuration-guide.md");

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] border bg-[linear-gradient(135deg,rgba(24,24,27,0.96),rgba(39,39,42,0.92))] px-6 py-7 text-white shadow-soft sm:px-8">
        <div className="max-w-3xl">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/60">Documentation</div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">项目技术文档</h1>
          <p className="mt-3 text-sm leading-7 text-white/72 sm:text-base">
            这一页集中整理项目介绍、启动方式、命令、配置、skills、MCP、使用方式和排查路径，作为当前仓库的统一技术说明入口。
          </p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="h-fit rounded-[28px] border bg-surface p-5 shadow-soft xl:sticky xl:top-24">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">目录</div>
          <nav className="mt-4">
            <ul className="space-y-1.5">
              {document.headings
                .filter((heading) => heading.level === 2)
                .map((heading) => (
                  <li key={heading.id}>
                    <Link
                      href={`#${heading.id}`}
                      className="block rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
                    >
                      {heading.text.replace(/^\d+\.\s*/, "")}
                    </Link>
                  </li>
                ))}
            </ul>
          </nav>
        </aside>

        <article
          className="agent-doc rounded-[28px] border bg-surface px-6 py-8 shadow-soft sm:px-8"
          dangerouslySetInnerHTML={{ __html: document.html }}
        />
      </div>
    </div>
  );
}
