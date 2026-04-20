import type { ProviderConfig } from "../config/index.js";
import { AnthropicProvider } from "./anthropic.js";
import { DemoProvider } from "./demo.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";
import { RecordReplayProvider } from "./record-replay.js";
import { ProviderAuthError, type IModelProvider } from "./types.js";

export function createProvider(config: ProviderConfig, env: NodeJS.ProcessEnv = process.env): IModelProvider {
  if (config.kind === "record-replay") {
    return new RecordReplayProvider({
      fixtureDir: config.fixtureDir,
      fixtureName: config.fixtureName,
      mode: resolveRecordReplayMode(env),
      modelId: config.model,
      targetProvider: createRecordReplayTargetProvider(config, env),
    });
  }

  if (config.kind === "demo") {
    return new DemoProvider({
      model: config.model,
    });
  }

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

function createRecordReplayTargetProvider(
  config: ProviderConfig,
  env: NodeJS.ProcessEnv,
): IModelProvider | undefined {
  const targetKind = (env.MNA_REC_TARGET?.trim() as ProviderConfig["kind"] | undefined) ?? config.recordReplayTarget;
  if (!targetKind || targetKind === "record-replay") {
    return undefined;
  }

  const targetConfig: ProviderConfig = {
    ...config,
    kind: targetKind,
  };

  return createProvider(targetConfig, env);
}

function resolveRecordReplayMode(env: NodeJS.ProcessEnv): "live" | "record" | "replay" {
  const mode = env.MNA_PROVIDER_MODE?.trim();
  if (mode === "record" || mode === "replay") {
    return mode;
  }

  return "live";
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
