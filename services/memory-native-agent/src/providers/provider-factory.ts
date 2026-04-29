import type { ProviderConfig } from "../config/index.js";
import { AnthropicProvider } from "./anthropic.js";
import { MisconfiguredProvider } from "./misconfigured.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";
import { OpenAIResponsesProvider } from "./openai-responses.js";
import { RecordReplayProvider } from "./record-replay.js";
import { ProviderAuthError, type IModelProvider } from "./types.js";

export function createProvider(config: ProviderConfig, env: NodeJS.ProcessEnv = process.env): IModelProvider {
  if (config.kind === "not-configured") {
    return new MisconfiguredProvider({
      kind: config.kind,
      model: config.model,
      detail: "尚未配置聊天主模型。请在 Agent 页面的设置面板中配置 provider。 | Primary chat model is not configured. Configure a provider in Agent settings.",
    });
  }

  if (config.kind === "record-replay") {
    const mode = resolveRecordReplayMode(env);
    const targetProvider = createRecordReplayTargetProvider(config, env);
    if ((mode === "live" || mode === "record") && !targetProvider) {
      return new MisconfiguredProvider({
        kind: config.kind,
        model: config.model,
        detail: "provider record-replay 缺少目标 provider 配置",
      });
    }

    return new RecordReplayProvider({
      fixtureDir: config.fixtureDir,
      fixtureName: config.fixtureName,
      mode,
      modelId: config.model,
      targetProvider,
    });
  }

  if (config.kind === "openai-compatible" || config.kind === "openai-responses") {
    const apiKey = resolveApiKey(config, env, config.kind);
    if (!apiKey) {
      return new MisconfiguredProvider({
        kind: config.kind,
        model: config.model,
        detail: `provider ${config.kind} 缺少 API key 配置`,
      });
    }
    if (config.kind === "openai-responses") {
      return new OpenAIResponsesProvider({
        baseUrl: config.baseUrl,
        model: config.model,
        apiKey,
        organization: config.organization,
        effort: config.effort ?? undefined,
        maxTokens: config.maxTokens ?? undefined,
      });
    }
    return new OpenAICompatibleProvider({
      baseUrl: config.baseUrl,
      model: config.model,
      apiKey,
      organization: config.organization,
      effort: config.effort ?? undefined,
      maxTokens: config.maxTokens ?? undefined,
    });
  }

  if (config.kind === "anthropic") {
    const apiKey = resolveApiKey(config, env, config.kind);
    if (!apiKey) {
      return new MisconfiguredProvider({
        kind: config.kind,
        model: config.model,
        detail: `provider ${config.kind} 缺少 API key 配置`,
      });
    }
    return new AnthropicProvider({
      baseUrl: config.baseUrl,
      model: config.model,
      apiKey,
      effort: config.effort ?? undefined,
      maxTokens: config.maxTokens ?? undefined,
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
  if (!targetKind || !isRecordReplayTargetKind(targetKind)) {
    return undefined;
  }

  const targetConfig: ProviderConfig = {
    ...config,
    kind: targetKind,
  };

  if (targetKind === "openai-compatible" || targetKind === "openai-responses" || targetKind === "anthropic") {
    targetConfig.apiKeyEnv ??= targetKind === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  }

  return createProvider(targetConfig, env);
}

function isRecordReplayTargetKind(value: string): value is "openai-compatible" | "openai-responses" | "anthropic" | "ollama" {
  return value === "openai-compatible" || value === "openai-responses" || value === "anthropic" || value === "ollama";
}

function resolveRecordReplayMode(env: NodeJS.ProcessEnv): "live" | "record" | "replay" {
  const mode = env.MNA_PROVIDER_MODE?.trim();
  if (mode === "record" || mode === "replay") {
    return mode;
  }

  return "live";
}

function resolveApiKey(
  config: ProviderConfig,
  env: NodeJS.ProcessEnv,
  providerKind: ProviderConfig["kind"],
): string | null {
  if (config.apiKey && config.apiKey.trim().length > 0) {
    return config.apiKey;
  }

  if (!config.apiKeyEnv) {
    return null;
  }

  const apiKey = env[config.apiKeyEnv];
  if (!apiKey || apiKey.trim().length === 0) {
    return null;
  }

  return apiKey;
}
