import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { getRunTrace } from "@/features/run-trace/service";
import { parseRunTraceFilters } from "@/lib/query-params";

export async function GET(request: NextRequest) {
  try {
    const filters = parseRunTraceFilters(request.nextUrl.searchParams);
    const data = await getRunTrace(filters);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: error.issues.map((issue) => issue.message).join("; ") },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: "Failed to load run trace." }, { status: 500 });
  }
}
