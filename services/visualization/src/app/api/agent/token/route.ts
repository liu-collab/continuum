import { NextResponse } from "next/server";
import path from "node:path";
import os from "node:os";
import * as fs from "node:fs/promises";

import { getAppConfig } from "@/lib/env";
import { AgentTokenBootstrapResponse } from "@/lib/contracts";
import { getServerTranslator } from "@/lib/i18n/server";
import { logApiError } from "@/lib/server/api-errors";

const TOKEN_READ_TIMEOUT_MS = 100;

function resolveTokenPath(rawPath: string) {
  if (rawPath.startsWith("~/")) {
    return path.join(os.homedir(), rawPath.slice(2));
  }

  return rawPath;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("TOKEN_READ_TIMEOUT")), timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function json(payload: AgentTokenBootstrapResponse, status = 200) {
  return NextResponse.json(payload, { status });
}

async function probeMna(baseUrl: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOKEN_READ_TIMEOUT_MS);

  try {
    const response = await fetch(new URL("/healthz", `${baseUrl.replace(/\/+$/, "")}/`), {
      method: "GET",
      cache: "no-store",
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const { t } = await getServerTranslator();
  const { values } = getAppConfig();
  const tokenPath = resolveTokenPath(values.MNA_TOKEN_PATH);
  const browserMnaBaseUrl = values.NEXT_PUBLIC_MNA_BASE_URL;

  try {
    const token = (await withTimeout(fs.readFile(tokenPath, "utf8"), TOKEN_READ_TIMEOUT_MS)).trim();

    if (!token) {
      return json({
        status: "token_missing",
        token: null,
        reason: t("service.agentToken.empty"),
        mnaBaseUrl: browserMnaBaseUrl
      });
    }

    if (!/^[A-Za-z0-9._-]+$/.test(token)) {
      return json({
        status: "token_invalid",
        token: null,
        reason: t("service.agentToken.invalidFormat"),
        mnaBaseUrl: browserMnaBaseUrl
      });
    }

    // Do not hard-block the browser bootstrap on server-side probe results.
    // In managed mode, visualization may run inside Docker while mna runs on the host
    // and only binds 127.0.0.1, which makes container-side probing unreliable.
    void probeMna(values.MNA_INTERNAL_BASE_URL ?? browserMnaBaseUrl).catch(() => false);

    return json({
      status: "ok",
      token,
      reason: null,
      mnaBaseUrl: browserMnaBaseUrl
    });
  } catch (error) {
    if (error instanceof Error && error.message === "TOKEN_READ_TIMEOUT") {
      return json({
        status: "token_missing",
        token: null,
        reason: t("service.agentToken.readTimeout"),
        mnaBaseUrl: browserMnaBaseUrl
      });
    }

    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return json({
        status: "mna_not_running",
        token: null,
        reason: t("service.agentToken.notFound"),
        mnaBaseUrl: browserMnaBaseUrl
      });
    }

    if ((error as NodeJS.ErrnoException)?.code === "EACCES") {
      return json({
        status: "token_invalid",
        token: null,
        reason: t("service.agentToken.permissionDenied"),
        mnaBaseUrl: browserMnaBaseUrl
      });
    }

    logApiError("GET /api/agent/token", error);
    return json({
      status: "token_invalid",
      token: null,
      reason: error instanceof Error ? error.message : t("service.agentToken.readFailed"),
      mnaBaseUrl: browserMnaBaseUrl
    });
  }
}
