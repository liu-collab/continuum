import { notFound } from "next/navigation";
import React from "react";

import { RepositoryDocPage } from "@/app/docs/_components/repository-doc-page";
import { findRepositoryDocBySlug, renderRepositoryMarkdown } from "@/lib/server/docs";

export default async function RepositoryMarkdownDocPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const doc = await findRepositoryDocBySlug(slug);

  if (!doc) {
    notFound();
  }

  const document = await renderRepositoryMarkdown(doc.relativePath);

  return (
    <RepositoryDocPage
      eyebrow={doc.category.label}
      title={doc.title}
      description={doc.description}
      document={document}
    />
  );
}
