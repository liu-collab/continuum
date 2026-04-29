import os from "node:os";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AXIS_MNA_PROVIDER_API_KEY_ENV,
  axisManagedConfigPath,
  axisManagedSecretsPath,
  migrateManagedConfigFiles,
  managedMnaProviderConfigPath,
  managedMnaProviderSecretPath,
  type ManagedWritebackLlmConfig,
  mergeManagedConfig,
  readManagedEmbeddingConfig,
  readManagedMnaProviderConfig,
  resolveOptionalManagedMemoryLlmCliConfig,
  resolveOptionalManagedMemoryLlmEnvConfig,
  writeManagedMnaProviderConfig,
} from "../src/managed-config.js";

describe("managed mna provider config", () => {
  const tempHome = path.join(os.tmpdir(), `axis-managed-config-${Date.now()}`);
  const mnaHome = path.join(tempHome, ".axis", "managed", "mna");
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  beforeEach(async () => {
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
    await rm(tempHome, { recursive: true, force: true });
    await mkdir(mnaHome, { recursive: true });
  });

  it("merges managed config with CLI over persisted over environment priority", () => {
    expect(
      mergeManagedConfig<ManagedWritebackLlmConfig>(
        {
          version: 1,
          model: "persisted-model",
          apiKey: "persisted-key",
        },
        {
          version: 1,
          baseUrl: "https://env.example/v1",
          model: "env-model",
          apiKey: "env-key",
        },
        {
          model: "cli-model",
        },
      ),
    ).toEqual({
      version: 1,
      baseUrl: "https://env.example/v1",
      model: "cli-model",
      apiKey: "persisted-key",
    });
  });

  it("resolves managed memory llm environment and CLI config", () => {
    expect(
      resolveOptionalManagedMemoryLlmEnvConfig({
        MEMORY_LLM_BASE_URL: "https://api.example.com/v1/",
        MEMORY_LLM_MODEL: "env-model",
        MEMORY_LLM_API_KEY: "env-key",
        MEMORY_LLM_PROTOCOL: "openai-compatible",
        MEMORY_LLM_TIMEOUT_MS: "7000",
        MEMORY_LLM_EFFORT: "medium",
        MEMORY_LLM_MAX_TOKENS: "2048",
      }),
    ).toEqual({
      baseUrl: "https://api.example.com/v1",
      model: "env-model",
      apiKey: "env-key",
      protocol: "openai-compatible",
      timeoutMs: 7000,
      effort: "medium",
      maxTokens: 2048,
    });

    expect(
      resolveOptionalManagedMemoryLlmCliConfig({
        "memory-llm-model": "cli-model",
        "memory-llm-timeout-ms": "9000",
      }),
    ).toEqual({
      model: "cli-model",
      timeoutMs: 9000,
    });
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
  });

  it("writes snake_case provider fields to the unified managed config", async () => {
    await writeManagedMnaProviderConfig(mnaHome, {
      kind: "openai-compatible",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
      apiKeyEnv: "DEEPSEEK_API_KEY",
    });

    const content = JSON.parse(
      await readFile(axisManagedConfigPath(), "utf8"),
    ) as {
      version: 2;
      provider: Record<string, string>;
    };

    expect(content.version).toBe(2);
    expect(content.provider.base_url).toBe("https://api.deepseek.com");
    expect(content.provider.api_key_env).toBe("DEEPSEEK_API_KEY");
    expect(content.provider.baseUrl).toBeUndefined();
    expect(content.provider.apiKeyEnv).toBeUndefined();
  });

  it("reads legacy camelCase provider fields for backward compatibility", async () => {
    await writeFile(
      managedMnaProviderConfigPath(mnaHome),
      JSON.stringify({
        provider: {
          kind: "openai-compatible",
          model: "deepseek-chat",
          baseUrl: "https://api.deepseek.com",
          apiKeyEnv: "DEEPSEEK_API_KEY",
        },
      }),
      "utf8",
    );

    await expect(readManagedMnaProviderConfig(mnaHome)).resolves.toEqual({
      kind: "openai-compatible",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
      apiKeyEnv: "DEEPSEEK_API_KEY",
    });
  });

  it("stores inline api key in secret file and keeps config schema-compatible", async () => {
    await writeManagedMnaProviderConfig(mnaHome, {
      kind: "openai-compatible",
      model: "gpt-5.4",
      baseUrl: "http://localhost:8090/v1",
      apiKey: "secret-key",
    });

    const configContent = JSON.parse(
      await readFile(axisManagedConfigPath(), "utf8"),
    ) as {
      provider: Record<string, string>;
    };
    const secretContent = JSON.parse(
      await readFile(axisManagedSecretsPath(), "utf8"),
    ) as {
      version: 2;
      provider_api_key: string;
    };

    expect(configContent.provider.api_key).toBeUndefined();
    expect(configContent.provider.apiKey).toBeUndefined();
    expect(configContent.provider.api_key_env).toBeUndefined();
    expect(secretContent).toEqual({
      version: 2,
      provider_api_key: "secret-key",
    });
    await expect(readManagedMnaProviderConfig(mnaHome)).resolves.toEqual({
      kind: "openai-compatible",
      model: "gpt-5.4",
      baseUrl: "http://localhost:8090/v1",
      apiKey: "secret-key",
    });
  });

  it("removes stale secret file when provider no longer has inline api key", async () => {
    await writeFile(
      axisManagedSecretsPath(),
      JSON.stringify({
        version: 2,
        provider_api_key: "stale-key",
      }),
      "utf8",
    );

    await writeManagedMnaProviderConfig(mnaHome, {
      kind: "openai-compatible",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
      apiKeyEnv: "DEEPSEEK_API_KEY",
    });

    await expect(readFile(managedMnaProviderSecretPath(mnaHome), "utf8")).rejects.toThrow();
    await expect(readFile(axisManagedSecretsPath(), "utf8").then(JSON.parse)).resolves.toEqual({
      version: 2,
    });
  });

  it("reads legacy snake_case inline api key for backward compatibility", async () => {
    await writeFile(
      managedMnaProviderConfigPath(mnaHome),
      JSON.stringify({
        provider: {
          kind: "openai-compatible",
          model: "gpt-5.4",
          base_url: "http://localhost:8090/v1",
          api_key: "legacy-inline-key",
        },
      }),
      "utf8",
    );

    await expect(readManagedMnaProviderConfig(mnaHome)).resolves.toEqual({
      kind: "openai-compatible",
      model: "gpt-5.4",
      baseUrl: "http://localhost:8090/v1",
      apiKey: "legacy-inline-key",
    });
  });

  it("reports a clear error when a managed JSON config is corrupted", async () => {
    const configPath = axisManagedConfigPath();
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, "{bad json", "utf8");

    await expect(readManagedEmbeddingConfig()).rejects.toMatchObject({
      code: "config_corrupted",
      filePath: configPath,
      hint: "请删除该文件后重新运行",
    });
  });

  it("migrates legacy managed files to unified config and secrets", async () => {
    await writeFile(
      managedMnaProviderConfigPath(mnaHome),
      JSON.stringify({
        provider: {
          kind: "openai-compatible",
          model: "deepseek-chat",
          base_url: "https://api.deepseek.com",
          api_key_env: AXIS_MNA_PROVIDER_API_KEY_ENV,
        },
      }),
      "utf8",
    );
    await writeFile(
      managedMnaProviderSecretPath(mnaHome),
      JSON.stringify({
        version: 1,
        apiKey: "provider-key",
      }),
      "utf8",
    );
    await writeFile(
      path.join(tempHome, ".axis", "managed", "embedding-config.json"),
      JSON.stringify({
        version: 1,
        baseUrl: "https://api.openai.com/v1",
        model: "text-embedding-3-small",
        apiKey: "embedding-key",
      }),
      "utf8",
    );
    await writeFile(
      path.join(tempHome, ".axis", "managed", "memory-llm-config.json"),
      JSON.stringify({
        version: 1,
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet-4-20250514",
        apiKey: "memory-key",
        protocol: "anthropic",
      }),
      "utf8",
    );

    await migrateManagedConfigFiles(mnaHome);

    await expect(readFile(managedMnaProviderConfigPath(mnaHome), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(tempHome, ".axis", "managed", "embedding-config.json"), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(tempHome, ".axis", "managed", "memory-llm-config.json"), "utf8")).rejects.toThrow();
    await expect(readFile(axisManagedConfigPath(), "utf8").then(JSON.parse)).resolves.toMatchObject({
      version: 2,
      provider: {
        kind: "openai-compatible",
        model: "deepseek-chat",
        base_url: "https://api.deepseek.com",
      },
      embedding: {
        baseUrl: "https://api.openai.com/v1",
        model: "text-embedding-3-small",
      },
      memory_llm: {
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet-4-20250514",
        protocol: "anthropic",
      },
    });
    await expect(readFile(axisManagedSecretsPath(), "utf8").then(JSON.parse)).resolves.toMatchObject({
      version: 2,
      provider_api_key: "provider-key",
      embedding_api_key: "embedding-key",
      memory_llm_api_key: "memory-key",
    });
  });
});
