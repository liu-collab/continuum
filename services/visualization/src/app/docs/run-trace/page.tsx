import React from "react";

import { RepositoryDocPage } from "@/app/docs/_components/repository-doc-page";
import { renderRepositoryMarkdown } from "@/lib/server/docs";

export default async function RunTraceDocPage() {
  const document = await renderRepositoryMarkdown("docs/run-trace-guide.md");

  return (
    <RepositoryDocPage
      eyebrow="Documentation"
      title="运行轨迹说明"
      description="这一页说明运行轨迹的阶段、字段、筛选方式和排查顺序。文档页面只读，只渲染仓库 Markdown，不触发业务写入。"
      document={document}
    />
  );
}
