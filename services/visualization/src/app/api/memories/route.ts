import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { getMemoryCatalog } from "@/features/memory-catalog/service";
import { parseMemoryCatalogFilters } from "@/lib/query-params";

export async function GET(request: NextRequest) {
  try {
    const filters = parseMemoryCatalogFilters(request.nextUrl.searchParams);
    const data = await getMemoryCatalog(filters);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: error.issues.map((issue) => issue.message).join("; ") },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: "Failed to load memory catalog." }, { status: 500 });
  }
}
