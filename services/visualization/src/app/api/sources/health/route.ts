import { NextResponse } from "next/server";

import { getSourceHealth } from "@/features/source-health/service";
import { getServerTranslator } from "@/lib/i18n/server";
import { jsonApiError } from "@/lib/server/api-errors";

export async function GET() {
  const { t } = await getServerTranslator();

  try {
    const data = await getSourceHealth();
    return NextResponse.json(data);
  } catch {
    return jsonApiError("source_health_failed", t("service.apiErrors.sourceHealthFailed"), 500);
  }
}
