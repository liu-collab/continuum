import React from "react";
import Link from "next/link";

import type { DocHeading } from "@/lib/server/docs";

type RepositoryDocPageProps = {
  eyebrow: string;
  title: string;
  description: string;
  document: {
    html: string;
    headings: DocHeading[];
  };
};

export function RepositoryDocPage({ eyebrow, title, description, document }: RepositoryDocPageProps) {
  return (
    <div className="app-page">
      <section className="tile tile-light">
        <div className="tile-inner">
          <div className="tile-head">
            <div className="section-kicker">{eyebrow}</div>
            <h1 className="tile-title">{title}</h1>
            <p className="tile-subtitle">{description}</p>
          </div>
        </div>
      </section>

      <section className="tile tile-parchment">
        <div className="tile-inner">
          <div className="master-detail-grid">
            <aside className="panel h-fit p-5 xl:sticky xl:top-28">
              <div className="section-kicker">目录</div>
              <nav className="mt-4">
                <ul className="grid gap-1.5">
                  {document.headings
                    .filter((heading) => heading.level === 2)
                    .map((heading) => (
                      <li key={heading.id}>
                        <Link
                          href={`#${heading.id}`}
                          className="block px-3 py-2 text-[14px] leading-[1.43] text-muted-foreground transition hover:text-primary"
                          style={{ borderRadius: "var(--radius-sm)" }}
                        >
                          {heading.text.replace(/^\d+\.\s*/, "")}
                        </Link>
                      </li>
                    ))}
                </ul>
              </nav>
            </aside>

            <article
              className="agent-doc panel px-6 py-8 sm:px-8"
              dangerouslySetInnerHTML={{ __html: document.html }}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
