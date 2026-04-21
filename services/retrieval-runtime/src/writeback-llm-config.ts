import fs from "node:fs";

type WritebackLlmConfigSource = {
  WRITEBACK_LLM_BASE_URL?: string;
  WRITEBACK_LLM_MODEL?: string;
  WRITEBACK_LLM_API_KEY?: string;
  WRITEBACK_LLM_TIMEOUT_MS?: number | string;
  WRITEBACK_LLM_PROTOCOL?: string;
  CONTINUUM_WRITEBACK_LLM_CONFIG_PATH?: string;
};

export type RuntimeWritebackLlmProtocol = "anthropic" | "openai-compatible";

export type RuntimeWritebackLlmConfig = {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  protocol?: RuntimeWritebackLlmProtocol;
};

function readNonEmpty(value: string | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeUrl(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function normalizeTimeout(value: number | string | undefined) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.trunc(parsed);
}

function normalizeProtocol(value: string | undefined): RuntimeWritebackLlmProtocol | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "anthropic" || normalized === "openai-compatible") {
    return normalized;
  }

  return undefined;
}

function readManagedWritebackLlmConfig(filePath: string | undefined): RuntimeWritebackLlmConfig {
  if (!filePath || !fs.existsSync(filePath)) {
    return {};
  }

  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      baseUrl?: string;
      model?: string;
      apiKey?: string;
      timeoutMs?: number | string;
      protocol?: string;
    };

    const baseUrl = normalizeUrl(readNonEmpty(payload.baseUrl));
    const model = readNonEmpty(payload.model);
    const apiKey = readNonEmpty(payload.apiKey);
    const timeoutMs = normalizeTimeout(payload.timeoutMs);
    const protocol = normalizeProtocol(readNonEmpty(payload.protocol));

    return {
      ...(baseUrl ? { baseUrl } : {}),
      ...(model ? { model } : {}),
      ...(apiKey ? { apiKey } : {}),
      ...(timeoutMs ? { timeoutMs } : {}),
      ...(protocol ? { protocol } : {}),
    };
  } catch {
    return {};
  }
}

export function resolveRuntimeWritebackLlmConfig(
  source: WritebackLlmConfigSource,
): RuntimeWritebackLlmConfig {
  const envBaseUrl = normalizeUrl(readNonEmpty(source.WRITEBACK_LLM_BASE_URL));
  const envModel = readNonEmpty(source.WRITEBACK_LLM_MODEL);
  const envApiKey = readNonEmpty(source.WRITEBACK_LLM_API_KEY);
  const envTimeoutMs = normalizeTimeout(source.WRITEBACK_LLM_TIMEOUT_MS);
  const envProtocol = normalizeProtocol(readNonEmpty(source.WRITEBACK_LLM_PROTOCOL));

  return {
    ...(envBaseUrl ? { baseUrl: envBaseUrl } : {}),
    ...(envModel ? { model: envModel } : {}),
    ...(envApiKey ? { apiKey: envApiKey } : {}),
    ...(envTimeoutMs ? { timeoutMs: envTimeoutMs } : {}),
    ...(envProtocol ? { protocol: envProtocol } : {}),
    ...readManagedWritebackLlmConfig(readNonEmpty(source.CONTINUUM_WRITEBACK_LLM_CONFIG_PATH)),
  };
}

export function hasCompleteRuntimeWritebackLlmConfig(source: WritebackLlmConfigSource) {
  const config = resolveRuntimeWritebackLlmConfig(source);
  return Boolean(config.baseUrl && config.model);
}
