"use client";

import React from "react";

import { PageError } from "@/components/page-error-boundary";
import { useAppI18n } from "@/lib/i18n/client";

export default function ConfigurationDocError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useAppI18n();

  return (
    <PageError
      error={error}
      reset={reset}
      title={t("service.apiErrors.sourceHealthFailed")}
      description={t("common.retryLater")}
      retryLabel={t("dashboard.reload")}
      kicker={t("docs.kicker")}
      heading={t("docs.configTitle")}
      subtitle={t("docs.configDescription")}
      testId="docs-configuration-error-state"
    />
  );
}
