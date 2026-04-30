import React from "react";

import { getDashboard } from "@/features/dashboard/service";
import { getSourceHealth } from "@/features/source-health/service";
import { getServerTranslator } from "@/lib/i18n/server";
import { parseDashboardWindow } from "@/lib/query-params";

import { DashboardWorkspace } from "./dashboard-workspace";

export default async function DashboardPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { locale } = await getServerTranslator();
  const window = parseDashboardWindow(params);
  const [response, health] = await Promise.all([getDashboard(window), getSourceHealth()]);

  return (
    <DashboardWorkspace
      initialResponse={response}
      health={health}
      initialWindow={window}
      locale={locale}
    />
  );
}
