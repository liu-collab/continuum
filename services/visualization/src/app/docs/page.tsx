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
    <div className="app-page">
      <section className="tile tile-light">
        <div className="tile-inner">
          <div className="tile-head">
            <div className="section-kicker">文档</div>
            <h1 className="tile-title">项目文档</h1>
            <p className="tile-subtitle">
              仓库内文档的只读入口，按目录和元数据分组展示。
            </p>
          </div>
        </div>
      </section>

      <section className="tile tile-parchment">
        <div className="tile-inner">
          {groups.length > 0 ? (
            <div className="grid gap-12">
              {groups.map((group) => (
                <section key={group.key}>
                  <div className="tile-head">
                    <div className="section-kicker">{group.label}</div>
                  </div>
                  <div className="utility-grid">
                    {group.docs.map((doc) => (
                      <Link key={doc.relativePath} href={doc.href as Route} className="record-link group">
                        <div className="flex items-start justify-between gap-4">
                          <h2 className="text-[21px] font-semibold leading-[1.19] text-text">{doc.title}</h2>
                          <ArrowUpRight className="h-5 w-5 shrink-0 text-muted-foreground transition group-hover:text-primary" />
                        </div>
                        <p className="mt-3 text-[17px] leading-[1.47] text-muted">{doc.description}</p>
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <EmptyState
              title="暂无文档"
              description="当前仓库 docs 目录下还没有可展示的 Markdown 文档。"
              testId="docs-index-empty"
            />
          )}
        </div>
      </section>
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
