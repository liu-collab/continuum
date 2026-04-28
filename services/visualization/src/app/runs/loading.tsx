import React from "react";

import { PageSkeleton } from "@/components/page-skeleton";
import { getServerTranslator } from "@/lib/i18n/server";

export default async function RunsLoading() {
  const { t } = await getServerTranslator();

  return (
    <PageSkeleton
      kicker={t("runs.kicker")}
      title={t("runs.title")}
      subtitle={t("dashboard.loadingSubtitle")}
      sections={[
        { title: t("runs.recentKicker"), count: 4 },
        { title: t("runs.selectedKicker"), count: 3 }
      ]}
      testId="runs-loading-state"
    />
  );
}
