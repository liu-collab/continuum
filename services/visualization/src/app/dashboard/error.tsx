"use client";

import React from "react";

import { PageError } from "@/components/page-error-boundary";
import { useAppI18n } from "@/lib/i18n/client";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useAppI18n();

  return (
    <PageError
      error={error}
      reset={reset}
      title={t("dashboard.loadFailedTitle")}
      description={t("dashboard.loadFailedDescription")}
      retryLabel={t("dashboard.reload")}
      kicker={t("dashboard.kicker")}
      heading={t("dashboard.title")}
      subtitle={t("dashboard.errorSubtitle")}
      testId="dashboard-error-state"
    />
  );
}
