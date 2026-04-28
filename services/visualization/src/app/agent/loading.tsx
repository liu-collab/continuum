import React from "react";

import { PageSkeleton } from "@/components/page-skeleton";
import { getServerTranslator } from "@/lib/i18n/server";

export default async function AgentLoading() {
  const { t } = await getServerTranslator();

  return (
    <PageSkeleton
      kicker="Agent"
      title={t("layout.nav.agent")}
      subtitle={t("dashboard.loadingSubtitle")}
      sections={[
        { title: "workspace", count: 3 },
        { title: "chat", count: 2, columns: "md:grid-cols-2" }
      ]}
      testId="agent-loading-state"
    />
  );
}
