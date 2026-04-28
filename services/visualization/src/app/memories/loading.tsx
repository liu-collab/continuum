import React from "react";

import { PageSkeleton } from "@/components/page-skeleton";
import { getServerTranslator } from "@/lib/i18n/server";

export default async function MemoriesLoading() {
  const { t } = await getServerTranslator();

  return (
    <PageSkeleton
      kicker={t("memories.kicker")}
      title={t("memories.title")}
      subtitle={t("dashboard.loadingSubtitle")}
      sections={[
        { title: t("memories.viewsKicker"), count: 2, columns: "md:grid-cols-2" },
        { title: t("memories.recordsKicker"), count: 4, columns: "md:grid-cols-2 xl:grid-cols-4" }
      ]}
      testId="memories-loading-state"
    />
  );
}
