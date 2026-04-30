import type { FastifyReply } from "fastify";
import type { ZodError } from "zod";

export type LiteErrorCode =
  | "invalid_lite_memory_query"
  | "invalid_lite_record_id"
  | "lite_record_not_found"
  | "invalid_prepare_context"
  | "invalid_after_response"
  | "invalid_trace_id"
  | "trace_not_found"
  | "lite_runtime_error";

const LITE_ERROR_MESSAGES: Record<LiteErrorCode, { zh: string; en: string }> = {
  invalid_lite_memory_query: {
    zh: "记忆列表查询参数无效。",
    en: "Invalid lite memory list query.",
  },
  invalid_lite_record_id: {
    zh: "记忆记录 ID 无效。",
    en: "Invalid lite record id.",
  },
  lite_record_not_found: {
    zh: "未找到这条 lite 记忆记录。",
    en: "Lite record not found.",
  },
  invalid_prepare_context: {
    zh: "prepare-context 请求参数无效。",
    en: "Invalid lite prepare-context payload.",
  },
  invalid_after_response: {
    zh: "after-response 请求参数无效。",
    en: "Invalid lite after-response payload.",
  },
  invalid_trace_id: {
    zh: "trace ID 无效。",
    en: "Invalid trace id.",
  },
  trace_not_found: {
    zh: "未找到这条 trace。",
    en: "Trace not found.",
  },
  lite_runtime_error: {
    zh: "lite runtime 处理失败。",
    en: "Lite runtime error.",
  },
};

export function liteErrorPayload(
  code: LiteErrorCode,
  options: {
    details?: unknown;
    cause?: unknown;
  } = {},
) {
  const message = LITE_ERROR_MESSAGES[code];
  return {
    error: {
      code,
      message: `${message.zh} | ${message.en}`,
      message_zh: message.zh,
      message_en: message.en,
      ...(options.details === undefined ? {} : { details: options.details }),
      ...(options.cause === undefined ? {} : { cause: sanitizeCause(options.cause) }),
    },
  };
}

export function sendLiteError(
  reply: FastifyReply,
  statusCode: number,
  code: LiteErrorCode,
  options: {
    details?: unknown;
    cause?: unknown;
  } = {},
) {
  reply.status(statusCode);
  return liteErrorPayload(code, options);
}

export function flattenZodError(error: ZodError) {
  return error.flatten();
}

function sanitizeCause(cause: unknown) {
  if (cause instanceof Error) {
    return cause.message;
  }
  return String(cause);
}
