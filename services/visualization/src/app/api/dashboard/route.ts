import { NextRequest, NextResponse } from "next/server";

import { getDashboard } from "@/features/dashboard/service";
import { parseDashboardWindow } from "@/lib/query-params";

export async function GET(request: NextRequest) {
  try {
    const window = parseDashboardWindow(request.nextUrl.searchParams);
    const data = await getDashboard(window);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Failed to load dashboard." }, { status: 500 });
  }
}
