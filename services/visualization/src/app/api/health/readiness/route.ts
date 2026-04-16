import { NextResponse } from "next/server";

import { getSourceHealth } from "@/features/source-health/service";

export async function GET() {
  const health = await getSourceHealth();

  return NextResponse.json({
    status: health.readiness.status,
    checkedAt: health.readiness.checkedAt,
    summary: health.readiness.summary,
    service: health.service
  });
}
