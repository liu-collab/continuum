import { NextRequest, NextResponse } from "next/server";

import { getDashboard } from "@/features/dashboard/service";
import { getServerTranslator } from "@/lib/i18n/server";
import { parseDashboardWindow } from "@/lib/query-params";
import { jsonApiError } from "@/lib/server/api-errors";

export async function GET(request: NextRequest) {
  const { t } = await getServerTranslator();

  try {
    const window = parseDashboardWindow(request.nextUrl.searchParams);
    const data = await getDashboard(window);
    return NextResponse.json(data);
  } catch {
    return jsonApiError("dashboard_failed", t("service.apiErrors.dashboardFailed"), 500);
  }
}
