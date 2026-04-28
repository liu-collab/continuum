"use client";

import React from "react";

import { PageError } from "@/components/page-error-boundary";
import { useAppI18n } from "@/lib/i18n/client";

export default function RunsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useAppI18n();

  return (
    <PageError
      error={error}
      reset={reset}
      title={t("service.apiErrors.runTraceFailed")}
      description={t("common.retryLater")}
      retryLabel={t("dashboard.reload")}
      kicker={t("runs.kicker")}
      heading={t("runs.title")}
      subtitle={t("runs.subtitle")}
      testId="runs-error-state"
    />
  );
}
