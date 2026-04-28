import React from "react";

import { RepositoryDocPage } from "@/app/docs/_components/repository-doc-page";
import { getServerTranslator } from "@/lib/i18n/server";
import { renderRepositoryMarkdown } from "@/lib/server/docs";

export default async function ConfigurationDocPage() {
  const { t } = await getServerTranslator();
  const document = await renderRepositoryMarkdown("docs/configuration-guide.md");

  return (
    <RepositoryDocPage
      eyebrow={t("docs.kicker")}
      title={t("docs.configTitle")}
      description={t("docs.configDescription")}
      document={document}
      tocLabel={t("docs.toc")}
    />
  );
}
