"use client";

import React from "react";

import { PageSkeleton } from "@/components/page-skeleton";
import { useAppI18n } from "@/lib/i18n/client";

export default function DashboardLoading() {
  const { t } = useAppI18n();

  return (
    <PageSkeleton
      kicker={t("dashboard.kicker")}
      title={t("dashboard.title")}
      subtitle={t("dashboard.loadingSubtitle")}
      sections={[
        { title: "retrieval-runtime", count: 4, columns: "md:grid-cols-2 xl:grid-cols-4" },
        { title: "storage", count: 4, columns: "md:grid-cols-2 xl:grid-cols-4" },
        { title: t("dashboard.trendsKicker"), count: 2, columns: "md:grid-cols-2" }
      ]}
      testId="dashboard-loading-state"
    />
  );
}
