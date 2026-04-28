import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { MemoryEditRequestSchema } from "@/lib/contracts";
import { getServerTranslator } from "@/lib/i18n/server";
import { jsonApiError, zodApiError } from "@/lib/server/api-errors";
import { editMemory } from "@/lib/server/storage-governance-client";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { locale, t } = await getServerTranslator();

  try {
    const { id } = await context.params;
    const payload = MemoryEditRequestSchema.parse(await request.json());
    const data = await editMemory(id, payload, { locale });
    return NextResponse.json(data, { status: data.ok ? 200 : 502 });
  } catch (error) {
    if (error instanceof ZodError) {
      return zodApiError(error);
    }

    return jsonApiError("memory_edit_failed", t("service.apiErrors.memoryEditFailed"), 500);
  }
}
