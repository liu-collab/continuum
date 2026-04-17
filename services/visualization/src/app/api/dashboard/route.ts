import { NextRequest, NextResponse } from "next/server";

import { getDashboard } from "@/features/dashboard/service";
import { parseDashboardWindow } from "@/lib/query-params";
import { jsonApiError } from "@/lib/server/api-errors";

export async function GET(request: NextRequest) {
  try {
    const window = parseDashboardWindow(request.nextUrl.searchParams);
    const data = await getDashboard(window);
    return NextResponse.json(data);
  } catch {
    return jsonApiError("dashboard_failed", "Failed to load dashboard.", 500);
  }
}
