import React from "react";

import { RepositoryDocPage } from "@/app/docs/_components/repository-doc-page";
import { renderRepositoryMarkdown } from "@/lib/server/docs";

export default async function ConfigurationDocPage() {
  const document = await renderRepositoryMarkdown("docs/configuration-guide.md");

  return (
    <RepositoryDocPage
      eyebrow="Documentation"
      title="项目技术文档"
      description="这一页集中整理项目介绍、启动方式、命令、配置、skills、MCP、使用方式和排查路径，作为当前仓库的统一技术说明入口。"
      document={document}
    />
  );
}
