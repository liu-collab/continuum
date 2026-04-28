import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { getRunTrace } from "@/features/run-trace/service";
import { getServerTranslator } from "@/lib/i18n/server";
import { parseRunTraceFilters } from "@/lib/query-params";
import { jsonLoggedApiError, zodApiError } from "@/lib/server/api-errors";

export async function GET(request: NextRequest) {
  const { t } = await getServerTranslator();

  try {
    const filters = parseRunTraceFilters(request.nextUrl.searchParams);
    const data = await getRunTrace(filters);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof ZodError) {
      return zodApiError(error);
    }

    return jsonLoggedApiError(
      "GET /api/runs",
      error,
      "run_trace_failed",
      t("service.apiErrors.runTraceFailed"),
      500
    );
  }
}
