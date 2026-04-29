import { NextResponse } from "next/server";
import { z } from "zod";

import { getAppConfig } from "@/lib/env";
import { createTranslator } from "@/lib/i18n/messages";
import { getRequestLocale } from "@/lib/i18n/server";
import { jsonApiError, jsonLoggedApiError, zodApiError } from "@/lib/server/api-errors";

const runtimeGovernanceConfigUpdateSchema = z.object({
  WRITEBACK_MAINTENANCE_ENABLED: z.boolean().optional(),
  WRITEBACK_MAINTENANCE_INTERVAL_MS: z.number().int().min(30_000).optional(),
  WRITEBACK_GOVERNANCE_VERIFY_ENABLED: z.boolean().optional(),
  WRITEBACK_GOVERNANCE_SHADOW_MODE: z.boolean().optional(),
  WRITEBACK_MAINTENANCE_MAX_ACTIONS: z.number().int().min(1).max(20).optional(),
}).strict();

const updateRuntimeConfigSchema = z.object({
  governance: runtimeGovernanceConfigUpdateSchema.optional(),
}).strict();

export async function PUT(request: Request) {
  const locale = await getRequestLocale();
  const t = createTranslator(locale);
  const parsed = updateRuntimeConfigSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return zodApiError(parsed.error);
  }

  const { values } = getAppConfig();
  if (!values.RUNTIME_API_BASE_URL) {
    return jsonApiError("runtime_config_missing_base_url", t("service.upstream.missingBaseUrl"), 400);
  }

  try {
    const response = await fetch(new URL("/v1/runtime/config", `${values.RUNTIME_API_BASE_URL.replace(/\/+$/, "")}/`), {
      method: "PUT",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(parsed.data),
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        payload ?? {
          error: {
            code: "runtime_config_update_failed",
            message: t("common.requestFailedStatus", { status: response.status }),
          },
        },
        { status: response.status },
      );
    }

    return NextResponse.json(payload);
  } catch (error) {
    return jsonLoggedApiError(
      "PUT /api/runtime/config",
      error,
      "runtime_config_update_failed",
      error instanceof Error ? error.message : t("service.upstream.unreachable"),
      500,
    );
  }
}
