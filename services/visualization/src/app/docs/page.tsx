import type { Route } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

const docs = [
  {
    href: "/docs/configuration" as Route,
    title: "配置与使用指南",
    description: "环境变量、命令、skills、MCP、页面设置、宿主接入和部署编排。",
  },
];

export default function DocsIndexPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">文档</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          仓库内文档的页面入口。当前先提供完整的配置说明。
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {docs.map((doc) => (
          <Link
            key={doc.href}
            href={doc.href}
            className="group flex flex-col gap-3 rounded-lg border bg-surface p-4 transition hover:border-border-strong hover:shadow-soft"
          >
            <div className="flex items-center justify-between">
              <div className="text-base font-semibold text-foreground">{doc.title}</div>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground transition group-hover:text-foreground" />
            </div>
            <p className="text-sm leading-6 text-muted-foreground">{doc.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
