import type {
  RuntimeWritebackLlmConfig,
  RuntimeWritebackLlmProtocol,
} from "../writeback-llm-config.js";
import { resolveRuntimeWritebackLlmConfig } from "../writeback-llm-config.js";

export interface LiteMemoryModelConfigSource {
  MEMORY_LLM_BASE_URL?: string;
  MEMORY_LLM_MODEL?: string;
  MEMORY_LLM_API_KEY?: string;
  MEMORY_LLM_TIMEOUT_MS?: number | string;
  MEMORY_LLM_PROTOCOL?: string;
  MEMORY_LLM_EFFORT?: string;
  MEMORY_LLM_MAX_TOKENS?: number | string;
  AXIS_MEMORY_LLM_CONFIG_PATH?: string;
  AXIS_MANAGED_CONFIG_PATH?: string;
  AXIS_MANAGED_SECRETS_PATH?: string;
  AXIS_RUNTIME_CONTAINER?: string | boolean;
  AXIS_RUNTIME_LOCALHOST_HOST?: string;
}

export interface LiteMemoryModelStatus {
  configured: boolean;
  status: "configured" | "not_configured";
  baseUrl?: string;
  model?: string;
  protocol?: RuntimeWritebackLlmProtocol;
  timeoutMs?: number;
  effort?: RuntimeWritebackLlmConfig["effort"];
  maxTokens?: number | null;
  apiKeyConfigured: boolean;
  degraded: boolean;
  degradationReason?: "memory_model_not_configured";
}

export interface LiteMemoryModelResolution {
  config: RuntimeWritebackLlmConfig;
  status: LiteMemoryModelStatus;
}

export function resolveLiteMemoryModelConfig(
  source: LiteMemoryModelConfigSource,
): RuntimeWritebackLlmConfig {
  return resolveRuntimeWritebackLlmConfig(source);
}

export function resolveLiteMemoryModel(
  source: LiteMemoryModelConfigSource,
): LiteMemoryModelResolution {
  const config = resolveLiteMemoryModelConfig(source);
  return {
    config,
    status: getLiteMemoryModelStatus(config),
  };
}

export function getLiteMemoryModelStatus(
  config: RuntimeWritebackLlmConfig,
): LiteMemoryModelStatus {
  const configured = Boolean(config.baseUrl && config.model);

  return {
    configured,
    status: configured ? "configured" : "not_configured",
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    ...(config.model ? { model: config.model } : {}),
    ...(config.protocol ? { protocol: config.protocol } : {}),
    ...(config.timeoutMs ? { timeoutMs: config.timeoutMs } : {}),
    ...(config.effort !== undefined ? { effort: config.effort } : {}),
    ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
    apiKeyConfigured: Boolean(config.apiKey),
    degraded: !configured,
    ...(configured ? {} : { degradationReason: "memory_model_not_configured" as const }),
  };
}
