import { NextResponse } from "next/server";

import { getAppConfig } from "@/lib/env";
import { createTranslator, type AppLocale } from "@/lib/i18n/messages";
import { getRequestLocale } from "@/lib/i18n/server";
import { jsonApiError, jsonLoggedApiError, logApiError } from "@/lib/server/api-errors";
import { pickWorkspaceDirectory } from "@/lib/server/workspace-picker";

export async function POST() {
  const locale = await getRequestLocale();
  const t = createTranslator(locale);
  const proxied = await tryProxyToManagedMna(locale);
  if (proxied) {
    return proxied;
  }

  try {
    const cwd = await pickWorkspaceDirectory({ locale });
    return NextResponse.json({
      cancelled: !cwd,
      cwd: cwd ?? null,
    });
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: string }).code)
        : "";

    if (code === "workspace_picker_unsupported") {
      return jsonApiError(
        "workspace_picker_unsupported",
        error instanceof Error ? error.message : t("service.workspacePicker.unsupported"),
        400,
      );
    }

    return jsonLoggedApiError(
      "POST /api/agent/workspaces/pick",
      error,
      "workspace_picker_failed",
      error instanceof Error ? error.message : t("service.workspacePicker.failed"),
      500,
    );
  }
}

async function tryProxyToManagedMna(locale: AppLocale) {
  const { values } = getAppConfig();
  const t = createTranslator(locale);
  const mnaBaseUrl = values.MNA_INTERNAL_BASE_URL?.trim();
  const tokenPath = values.MNA_TOKEN_PATH?.trim();

  if (!mnaBaseUrl || !tokenPath) {
    return null;
  }

  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const os = await import("node:os");

    const resolvedTokenPath = tokenPath.startsWith("~/")
      ? path.join(os.homedir(), tokenPath.slice(2))
      : tokenPath;
    const token = (await fs.readFile(resolvedTokenPath, "utf8")).trim();

    if (!token) {
      return null;
    }

    const response = await fetch(new URL("/v1/agent/workspaces/pick", `${mnaBaseUrl.replace(/\/+$/, "")}/`), {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json(
        payload ?? {
          error: {
            code: "workspace_picker_failed",
            message: t("common.requestFailedStatus", { status: response.status }),
          },
        },
        { status: response.status },
      );
    }

    if (!payload || typeof payload !== "object") {
      return jsonApiError("workspace_picker_failed", t("service.workspacePicker.invalidResult"), 500);
    }

    return NextResponse.json(payload);
  } catch (error) {
    logApiError("POST /api/agent/workspaces/pick proxy", error);
    return null;
  }
}
