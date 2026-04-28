import React from "react";

import { PageSkeleton } from "@/components/page-skeleton";
import { getServerTranslator } from "@/lib/i18n/server";

export default async function GovernanceLoading() {
  const { t } = await getServerTranslator();

  return (
    <PageSkeleton
      kicker={t("governance.kicker")}
      title={t("governance.title")}
      subtitle={t("dashboard.loadingSubtitle")}
      sections={[
        { title: t("governance.recentKicker"), count: 4 },
        { title: t("governance.detailKicker"), count: 3 }
      ]}
      testId="governance-loading-state"
    />
  );
}
