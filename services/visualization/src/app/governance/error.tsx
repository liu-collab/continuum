"use client";

import React from "react";

import { PageError } from "@/components/page-error-boundary";
import { useAppI18n } from "@/lib/i18n/client";

export default function GovernanceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useAppI18n();

  return (
    <PageError
      error={error}
      reset={reset}
      title={t("service.apiErrors.memoryCatalogFailed")}
      description={t("common.retryLater")}
      retryLabel={t("dashboard.reload")}
      kicker={t("governance.kicker")}
      heading={t("governance.title")}
      subtitle={t("governance.subtitle")}
      testId="governance-error-state"
    />
  );
}
