import React from "react";

import { PageSkeleton } from "@/components/page-skeleton";
import { getServerTranslator } from "@/lib/i18n/server";

export default async function ConfigurationDocLoading() {
  const { t } = await getServerTranslator();

  return (
    <PageSkeleton
      kicker={t("docs.kicker")}
      title={t("docs.configTitle")}
      subtitle={t("dashboard.loadingSubtitle")}
      sections={[
        { title: t("docs.toc"), count: 4 },
        { title: t("docs.configTitle"), count: 4 }
      ]}
      testId="docs-configuration-loading-state"
    />
  );
}
