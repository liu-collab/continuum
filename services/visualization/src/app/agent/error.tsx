"use client";

import React from "react";

import { PageError } from "@/components/page-error-boundary";
import { useAppI18n } from "@/lib/i18n/client";

export default function AgentError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useAppI18n();

  return (
    <PageError
      error={error}
      reset={reset}
      title={t("agentErrors.unavailable")}
      description={t("common.retryLater")}
      retryLabel={t("dashboard.reload")}
      kicker="Agent"
      heading={t("layout.nav.agent")}
      subtitle={t("agentErrors.unavailable")}
      testId="agent-error-state"
    />
  );
}
