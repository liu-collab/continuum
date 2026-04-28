import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { MemoryGovernanceActionRequestSchema } from "@/lib/contracts";
import { getServerTranslator } from "@/lib/i18n/server";
import { jsonLoggedApiError, zodApiError } from "@/lib/server/api-errors";
import { confirmMemory } from "@/lib/server/storage-governance-client";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { locale, t } = await getServerTranslator();

  try {
    const { id } = await context.params;
    const payload = MemoryGovernanceActionRequestSchema.parse(await request.json());
    const data = await confirmMemory(id, payload, { locale });
    return NextResponse.json(data, { status: data.ok ? 200 : 502 });
  } catch (error) {
    if (error instanceof ZodError) {
      return zodApiError(error);
    }

    return jsonLoggedApiError(
      "POST /api/memories/[id]/confirm",
      error,
      "memory_confirm_failed",
      t("service.apiErrors.memoryConfirmFailed"),
      500
    );
  }
}
