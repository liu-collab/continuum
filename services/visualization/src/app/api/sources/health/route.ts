import { NextResponse } from "next/server";

import { getSourceHealth } from "@/features/source-health/service";
import { getServerTranslator } from "@/lib/i18n/server";
import { jsonLoggedApiError } from "@/lib/server/api-errors";

export async function GET() {
  const { t } = await getServerTranslator();

  try {
    const data = await getSourceHealth();
    return NextResponse.json(data);
  } catch (error) {
    return jsonLoggedApiError(
      "GET /api/sources/health",
      error,
      "source_health_failed",
      t("service.apiErrors.sourceHealthFailed"),
      500
    );
  }
}
