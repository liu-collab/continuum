import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function jsonApiError(code: string, message: string, status: number) {
  return NextResponse.json(
    {
      error: {
        code,
        message
      }
    },
    { status }
  );
}

export function logApiError(scope: string, error: unknown) {
  console.error(`[api] ${scope}:`, error);
}

export function jsonLoggedApiError(
  scope: string,
  error: unknown,
  code: string,
  message: string,
  status: number
) {
  logApiError(scope, error);
  return jsonApiError(code, message, status);
}

export function zodApiError(error: ZodError) {
  return jsonApiError(
    "validation_failed",
    error.issues.map((issue) => issue.message).join("; "),
    400
  );
}
