import { NextResponse } from "next/server";
import path from "node:path";
import os from "node:os";
import * as fs from "node:fs/promises";

import { getAppConfig } from "@/lib/env";
import { AgentTokenBootstrapResponse } from "@/lib/contracts";

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

export async function GET() {
  const { values } = getAppConfig();
  const tokenPath = resolveTokenPath(values.MNA_TOKEN_PATH);

  try {
    const token = (await withTimeout(fs.readFile(tokenPath, "utf8"), TOKEN_READ_TIMEOUT_MS)).trim();

    if (!token) {
      return json({
        status: "token_missing",
        token: null,
        reason: "token 文件为空。",
        mnaBaseUrl: values.NEXT_PUBLIC_MNA_BASE_URL
      });
    }

    if (!/^[A-Za-z0-9._-]+$/.test(token)) {
      return json({
        status: "token_invalid",
        token: null,
        reason: "token 文件格式不合法。",
        mnaBaseUrl: values.NEXT_PUBLIC_MNA_BASE_URL
      });
    }

    return json({
      status: "ok",
      token,
      reason: null,
      mnaBaseUrl: values.NEXT_PUBLIC_MNA_BASE_URL
    });
  } catch (error) {
    if (error instanceof Error && error.message === "TOKEN_READ_TIMEOUT") {
      return json({
        status: "token_missing",
        token: null,
        reason: "读取 token 文件超时。",
        mnaBaseUrl: values.NEXT_PUBLIC_MNA_BASE_URL
      });
    }

    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return json({
        status: "mna_not_running",
        token: null,
        reason: "未找到 token 文件，请先启动 memory-native-agent。",
        mnaBaseUrl: values.NEXT_PUBLIC_MNA_BASE_URL
      });
    }

    if ((error as NodeJS.ErrnoException)?.code === "EACCES") {
      return json({
        status: "token_invalid",
        token: null,
        reason: "没有权限读取 token 文件。",
        mnaBaseUrl: values.NEXT_PUBLIC_MNA_BASE_URL
      });
    }

    return json({
      status: "token_invalid",
      token: null,
      reason: error instanceof Error ? error.message : "读取 token 文件失败。",
      mnaBaseUrl: values.NEXT_PUBLIC_MNA_BASE_URL
    });
  }
}
