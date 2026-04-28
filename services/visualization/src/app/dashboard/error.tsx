"use client";

import React from "react";

import { ErrorState } from "@/components/error-state";
import { useAppI18n } from "@/lib/i18n/client";

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useAppI18n();

  return (
    <div className="app-page" data-testid="dashboard-error-state">
      <section className="tile tile-light">
        <div className="tile-inner">
          <div className="tile-head tile-head-row">
            <div>
              <div className="section-kicker">{t("dashboard.kicker")}</div>
              <h1 className="tile-title">{t("dashboard.title")}</h1>
              <p className="tile-subtitle">{t("dashboard.errorSubtitle")}</p>
            </div>
            <button type="button" onClick={reset} className="button-primary">
              {t("dashboard.reload")}
            </button>
          </div>
          <ErrorState
            title={t("dashboard.loadFailedTitle")}
            description={t("dashboard.loadFailedDescription")}
          />
        </div>
      </section>
    </div>
  );
}
