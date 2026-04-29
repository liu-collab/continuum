export type ManagedMnaProviderConfig =
  | {
      kind: "demo";
      model: string;
      baseUrl?: string;
      apiKey?: undefined;
      apiKeyEnv?: undefined;
    }
  | {
      kind: "openai-compatible" | "anthropic";
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
): ManagedMnaProviderConfig {
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

  if (explicitKind === "demo" || !hasManagedMnaProviderOptionOverrides(options)) {
    return {
      kind: "demo",
      model: explicitModel || "axis-demo",
      baseUrl: explicitBaseUrl || undefined,
    };
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

  return {
    kind: "ollama",
    model: explicitModel || "qwen2.5-coder",
    baseUrl: explicitBaseUrl || "http://127.0.0.1:11434",
  };
}
