import type { Route } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { getRepositoryDocs, type RepositoryDocIndexEntry } from "@/lib/server/docs";

type DocCategoryGroup = {
  key: string;
  label: string;
  order: number;
  docs: RepositoryDocIndexEntry[];
};

export default async function DocsIndexPage() {
  const groups = groupDocsByCategory(await getRepositoryDocs());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">文档</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          仓库内文档的页面入口，会按文档元数据和目录自动排序。
        </p>
      </div>

      {groups.length > 0 ? (
        groups.map((group) => (
          <section key={group.key} className="space-y-3">
            <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {group.label}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {group.docs.map((doc) => (
                <Link
                  key={doc.relativePath}
                  href={doc.href as Route}
                  className="group flex flex-col gap-3 rounded-lg border bg-surface p-4 transition hover:border-border-strong hover:shadow-soft"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 truncate text-base font-semibold text-foreground">{doc.title}</div>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:text-foreground" />
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">{doc.description}</p>
                </Link>
              ))}
            </div>
          </section>
        ))
      ) : (
        <EmptyState
          title="暂无文档"
          description="当前仓库 docs 目录下还没有可展示的 Markdown 文档。"
          testId="docs-index-empty"
        />
      )}
    </div>
  );
}

function groupDocsByCategory(docs: RepositoryDocIndexEntry[]): DocCategoryGroup[] {
  const groups = new Map<string, DocCategoryGroup>();

  for (const doc of docs) {
    const group = groups.get(doc.category.key);
    if (group) {
      group.docs.push(doc);
      continue;
    }

    groups.set(doc.category.key, {
      key: doc.category.key,
      label: doc.category.label,
      order: doc.category.order,
      docs: [doc],
    });
  }

  return Array.from(groups.values()).sort((left, right) => {
    const order = left.order - right.order;
    return order === 0 ? left.label.localeCompare(right.label, "zh-Hans") : order;
  });
}
