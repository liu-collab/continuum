import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { MemoryRestoreVersionRequestSchema } from "@/lib/contracts";
import { jsonApiError, zodApiError } from "@/lib/server/api-errors";
import { restoreMemoryVersion } from "@/lib/server/storage-governance-client";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const payload = MemoryRestoreVersionRequestSchema.parse(await request.json());
    const data = await restoreMemoryVersion(id, payload);
    return NextResponse.json(data, { status: data.ok ? 200 : 502 });
  } catch (error) {
    if (error instanceof ZodError) {
      return zodApiError(error);
    }

    return jsonApiError("memory_restore_failed", "Failed to restore memory version.", 500);
  }
}
