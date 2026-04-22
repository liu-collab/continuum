import fs from "node:fs";

type WritebackLlmConfigSource = {
  MEMORY_LLM_BASE_URL?: string;
  MEMORY_LLM_MODEL?: string;
  MEMORY_LLM_API_KEY?: string;
  MEMORY_LLM_TIMEOUT_MS?: number | string;
  MEMORY_LLM_PROTOCOL?: string;
  MEMORY_LLM_EFFORT?: string;
  MEMORY_LLM_MAX_TOKENS?: number | string;
  CONTINUUM_MEMORY_LLM_CONFIG_PATH?: string;
};

export type RuntimeWritebackLlmProtocol = "anthropic" | "openai-compatible";

export type RuntimeWritebackLlmConfig = {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  protocol?: RuntimeWritebackLlmProtocol;
  effort?: "low" | "medium" | "high" | "xhigh" | "max" | null;
  maxTokens?: number | null;
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

function normalizeEffort(value: string | undefined): RuntimeWritebackLlmConfig["effort"] | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "low"
    || normalized === "medium"
    || normalized === "high"
    || normalized === "xhigh"
    || normalized === "max"
  ) {
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
      effort?: string | null;
      maxTokens?: number | string | null;
    };

    const baseUrl = normalizeUrl(readNonEmpty(payload.baseUrl));
    const model = readNonEmpty(payload.model);
    const apiKey = readNonEmpty(payload.apiKey);
    const timeoutMs = normalizeTimeout(payload.timeoutMs);
    const protocol = normalizeProtocol(readNonEmpty(payload.protocol));
    const effort = payload.effort === null ? null : normalizeEffort(readNonEmpty(payload.effort ?? undefined));
    const maxTokens = payload.maxTokens === null ? null : normalizeTimeout(payload.maxTokens ?? undefined);

    return {
      ...(baseUrl ? { baseUrl } : {}),
      ...(model ? { model } : {}),
      ...(apiKey ? { apiKey } : {}),
      ...(timeoutMs ? { timeoutMs } : {}),
      ...(protocol ? { protocol } : {}),
      ...(effort !== undefined ? { effort } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    };
  } catch {
    return {};
  }
}

export function resolveRuntimeWritebackLlmConfig(
  source: WritebackLlmConfigSource,
): RuntimeWritebackLlmConfig {
  const envBaseUrl = normalizeUrl(readNonEmpty(source.MEMORY_LLM_BASE_URL));
  const envModel = readNonEmpty(source.MEMORY_LLM_MODEL);
  const envApiKey = readNonEmpty(source.MEMORY_LLM_API_KEY);
  const envTimeoutMs = normalizeTimeout(source.MEMORY_LLM_TIMEOUT_MS);
  const envProtocol = normalizeProtocol(readNonEmpty(source.MEMORY_LLM_PROTOCOL));
  const envEffort = normalizeEffort(readNonEmpty(source.MEMORY_LLM_EFFORT));
  const envMaxTokens = normalizeTimeout(source.MEMORY_LLM_MAX_TOKENS);

  return {
    ...(envBaseUrl ? { baseUrl: envBaseUrl } : {}),
    ...(envModel ? { model: envModel } : {}),
    ...(envApiKey ? { apiKey: envApiKey } : {}),
    ...(envTimeoutMs ? { timeoutMs: envTimeoutMs } : {}),
    ...(envProtocol ? { protocol: envProtocol } : {}),
    ...(envEffort ? { effort: envEffort } : {}),
    ...(envMaxTokens ? { maxTokens: envMaxTokens } : {}),
    ...readManagedWritebackLlmConfig(readNonEmpty(source.CONTINUUM_MEMORY_LLM_CONFIG_PATH)),
  };
}

export function hasCompleteRuntimeWritebackLlmConfig(source: WritebackLlmConfigSource) {
  const config = resolveRuntimeWritebackLlmConfig(source);
  return Boolean(config.baseUrl && config.model);
}
