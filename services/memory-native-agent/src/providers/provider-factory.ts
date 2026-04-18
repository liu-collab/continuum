import type { ProviderConfig } from "../config/index.js";
import { AnthropicProvider } from "./anthropic.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";
import { ProviderAuthError, type IModelProvider } from "./types.js";

export function createProvider(config: ProviderConfig, env: NodeJS.ProcessEnv = process.env): IModelProvider {
  if (config.kind === "openai-compatible") {
    const apiKey = resolveApiKey(config.apiKeyEnv, env, config.kind);
    return new OpenAICompatibleProvider({
      baseUrl: config.baseUrl,
      model: config.model,
      apiKey,
      organization: config.organization,
    });
  }

  if (config.kind === "anthropic") {
    const apiKey = resolveApiKey(config.apiKeyEnv, env, config.kind);
    return new AnthropicProvider({
      baseUrl: config.baseUrl,
      model: config.model,
      apiKey,
    });
  }

  return new OllamaProvider({
    baseUrl: config.baseUrl,
    model: config.model,
    keepAlive: config.keepAlive,
  });
}

function resolveApiKey(
  apiKeyEnv: string | undefined,
  env: NodeJS.ProcessEnv,
  providerKind: ProviderConfig["kind"],
): string {
  if (!apiKeyEnv) {
    throw new ProviderAuthError(`Missing api_key_env for provider kind "${providerKind}".`);
  }

  const apiKey = env[apiKeyEnv];
  if (!apiKey || apiKey.trim().length === 0) {
    throw new ProviderAuthError(`Environment variable ${apiKeyEnv} is missing for provider kind "${providerKind}".`);
  }

  return apiKey;
}
