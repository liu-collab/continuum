import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { getMemoryCatalog } from "@/features/memory-catalog/service";
import { parseMemoryCatalogFilters } from "@/lib/query-params";
import { jsonApiError, zodApiError } from "@/lib/server/api-errors";

export async function GET(request: NextRequest) {
  try {
    const filters = parseMemoryCatalogFilters(request.nextUrl.searchParams);
    const data = await getMemoryCatalog(filters);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof ZodError) {
      return zodApiError(error);
    }

    return jsonApiError("memory_catalog_failed", "Failed to load memory catalog.", 500);
  }
}
