import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { MemoryGovernanceActionRequestSchema } from "@/lib/contracts";
import { getServerTranslator } from "@/lib/i18n/server";
import { jsonApiError, zodApiError } from "@/lib/server/api-errors";
import { invalidateMemory } from "@/lib/server/storage-governance-client";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { locale, t } = await getServerTranslator();

  try {
    const { id } = await context.params;
    const payload = MemoryGovernanceActionRequestSchema.parse(await request.json());
    const data = await invalidateMemory(id, payload, { locale });
    return NextResponse.json(data, { status: data.ok ? 200 : 502 });
  } catch (error) {
    if (error instanceof ZodError) {
      return zodApiError(error);
    }

    return jsonApiError("memory_invalidate_failed", t("service.apiErrors.memoryInvalidateFailed"), 500);
  }
}
