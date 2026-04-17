import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { getRunTrace } from "@/features/run-trace/service";
import { parseRunTraceFilters } from "@/lib/query-params";
import { jsonApiError, zodApiError } from "@/lib/server/api-errors";

export async function GET(request: NextRequest) {
  try {
    const filters = parseRunTraceFilters(request.nextUrl.searchParams);
    const data = await getRunTrace(filters);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof ZodError) {
      return zodApiError(error);
    }

    return jsonApiError("run_trace_failed", "Failed to load run trace.", 500);
  }
}
