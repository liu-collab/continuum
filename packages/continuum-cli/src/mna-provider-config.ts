export type ManagedMnaProviderConfig =
  | {
      kind: "demo";
      model: string;
      baseUrl?: string;
      apiKeyEnv?: undefined;
    }
  | {
      kind: "openai-compatible" | "anthropic";
      model: string;
      baseUrl: string;
      apiKeyEnv: string;
    }
  | {
      kind: "ollama";
      model: string;
      baseUrl: string;
      apiKeyEnv?: undefined;
    };

export function resolveManagedMnaProviderConfig(
  options: Record<string, string | boolean>,
  env: NodeJS.ProcessEnv = process.env,
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

  if (explicitKind === "demo" || (!explicitKind && !hasAnyThirdPartyProvider(env))) {
    return {
      kind: "demo",
      model: explicitModel || "continuum-demo",
      baseUrl: explicitBaseUrl || undefined,
    };
  }

  const resolvedKind =
    explicitKind ||
    (env.DEEPSEEK_API_KEY ? "openai-compatible" : env.OPENAI_API_KEY ? "openai-compatible" : env.ANTHROPIC_API_KEY ? "anthropic" : "ollama");

  if (resolvedKind === "anthropic") {
    return {
      kind: "anthropic",
      model: explicitModel || "claude-3-5-haiku-latest",
      baseUrl: explicitBaseUrl || "https://api.anthropic.com",
      apiKeyEnv: explicitApiKeyEnv || "ANTHROPIC_API_KEY",
    };
  }

  if (resolvedKind === "openai-compatible") {
    const defaultApiKeyEnv = env.DEEPSEEK_API_KEY ? "DEEPSEEK_API_KEY" : "OPENAI_API_KEY";
    const defaultBaseUrl = env.DEEPSEEK_API_KEY ? "https://api.deepseek.com" : "https://api.openai.com/v1";
    const defaultModel = env.DEEPSEEK_API_KEY ? "deepseek-chat" : "gpt-4.1-mini";

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

function hasAnyThirdPartyProvider(env: NodeJS.ProcessEnv) {
  return Boolean(env.DEEPSEEK_API_KEY || env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY);
}
