import { NextResponse } from "next/server";

import { getAppConfig } from "@/lib/env";
import { jsonApiError } from "@/lib/server/api-errors";
import { pickWorkspaceDirectory } from "@/lib/server/workspace-picker";

export async function POST() {
  const proxied = await tryProxyToManagedMna();
  if (proxied) {
    return proxied;
  }

  try {
    const cwd = await pickWorkspaceDirectory();
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
        error instanceof Error ? error.message : "当前系统没有可用的文件夹选择器，请改用手动输入路径。",
        400,
      );
    }

    return jsonApiError(
      "workspace_picker_failed",
      error instanceof Error ? error.message : "打开文件夹选择器失败。",
      500,
    );
  }
}

async function tryProxyToManagedMna() {
  const { values } = getAppConfig();
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
            message: `Request failed with status ${response.status}.`,
          },
        },
        { status: response.status },
      );
    }

    if (!payload || typeof payload !== "object") {
      return jsonApiError("workspace_picker_failed", "文件夹选择结果无效。", 500);
    }

    return NextResponse.json(payload);
  } catch {
    return null;
  }
}
