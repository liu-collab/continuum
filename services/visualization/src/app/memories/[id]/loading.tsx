import React from "react";

import { PageSkeleton } from "@/components/page-skeleton";
import { getServerTranslator } from "@/lib/i18n/server";

export default async function MemoryDetailLoading() {
  const { t } = await getServerTranslator();

  return (
    <PageSkeleton
      kicker={t("memories.detail.kicker")}
      title={t("memories.detail.kicker")}
      subtitle={t("dashboard.loadingSubtitle")}
      sections={[
        { title: t("common.details"), count: 3 },
        { title: t("memories.detail.governance.title"), count: 2, columns: "md:grid-cols-2" }
      ]}
      testId="memory-detail-loading-state"
    />
  );
}
