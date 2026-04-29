import { bilingualMessage } from "./messages.js";

export type ManagedMnaProviderConfig =
  | {
      kind: "openai-compatible" | "openai-responses" | "anthropic";
      model: string;
      baseUrl: string;
      apiKey?: string;
      apiKeyEnv?: string;
    }
  | {
      kind: "ollama";
      model: string;
      baseUrl: string;
      apiKey?: undefined;
      apiKeyEnv?: undefined;
    };

function isNonEmptyString(value: string | boolean | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function shouldUseDeepSeekDefaults(model: string, baseUrl: string) {
  return model.startsWith("deepseek") || baseUrl.includes("api.deepseek.com");
}

function isSupportedProviderKind(value: string) {
  return value === "openai-compatible" || value === "openai-responses" || value === "anthropic" || value === "ollama";
}

export function hasManagedMnaProviderOptionOverrides(options: Record<string, string | boolean>) {
  return [
    options["provider-kind"],
    options["provider-model"],
    options["provider-base-url"],
    options["provider-api-key-env"],
  ].some(isNonEmptyString);
}

export function resolveManagedMnaProviderConfig(
  options: Record<string, string | boolean>,
): ManagedMnaProviderConfig | null {
  const explicitKind =
    typeof options["provider-kind"] === "string" ? options["provider-kind"].trim() : "";
  const explicitModel =
    typeof options["provider-model"] === "string" ? options["provider-model"].trim() : "";
  const explicitBaseUrl =
    typeof options["provider-base-url"] === "string" ? options["provider-base-url"].trim() : "";
  const explicitApiKeyEnv =
    typeof options["provider-api-key-env"] === "string"
      ? options["provider-api-key-env"].trim()
      : "";

  if (!hasManagedMnaProviderOptionOverrides(options)) {
    return null;
  }

  if (explicitKind && !isSupportedProviderKind(explicitKind)) {
    throw new Error(bilingualMessage(
      `不支持的 provider-kind: ${explicitKind}`,
      `Unsupported provider-kind: ${explicitKind}`,
    ));
  }

  const resolvedKind = explicitKind || "ollama";

  if (resolvedKind === "anthropic") {
    return {
      kind: "anthropic",
      model: explicitModel || "claude-3-5-haiku-latest",
      baseUrl: explicitBaseUrl || "https://api.anthropic.com",
      apiKeyEnv: explicitApiKeyEnv || "ANTHROPIC_API_KEY",
    };
  }

  if (resolvedKind === "openai-compatible") {
    const useDeepSeekDefaults = shouldUseDeepSeekDefaults(explicitModel, explicitBaseUrl);
    const defaultApiKeyEnv = useDeepSeekDefaults ? "DEEPSEEK_API_KEY" : "OPENAI_API_KEY";
    const defaultBaseUrl = useDeepSeekDefaults ? "https://api.deepseek.com" : "https://api.openai.com/v1";
    const defaultModel = useDeepSeekDefaults ? "deepseek-chat" : "gpt-4.1-mini";

    return {
      kind: "openai-compatible",
      model: explicitModel || defaultModel,
      baseUrl: explicitBaseUrl || defaultBaseUrl,
      apiKeyEnv: explicitApiKeyEnv || defaultApiKeyEnv,
    };
  }

  if (resolvedKind === "openai-responses") {
    return {
      kind: "openai-responses",
      model: explicitModel || "gpt-4.1-mini",
      baseUrl: explicitBaseUrl || "https://api.openai.com/v1",
      apiKeyEnv: explicitApiKeyEnv || "OPENAI_API_KEY",
    };
  }

  return {
    kind: "ollama",
    model: explicitModel || "qwen2.5-coder",
    baseUrl: explicitBaseUrl || "http://127.0.0.1:11434",
  };
}
