import { NextResponse } from "next/server";

import { getSourceHealth } from "@/features/source-health/service";

export async function GET() {
  try {
    const data = await getSourceHealth();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Failed to load source health." }, { status: 500 });
  }
}
