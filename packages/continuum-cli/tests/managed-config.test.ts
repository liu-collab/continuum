import os from "node:os";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CONTINUUM_MNA_PROVIDER_API_KEY_ENV,
  continuumManagedEmbeddingConfigPath,
  managedMnaProviderConfigPath,
  managedMnaProviderSecretPath,
  readManagedEmbeddingConfig,
  readManagedMnaProviderConfig,
  writeManagedMnaProviderConfig,
} from "../src/managed-config.js";

describe("managed mna provider config", () => {
  const tempHome = path.join(os.tmpdir(), `continuum-managed-config-${Date.now()}`);
  const mnaHome = path.join(tempHome, ".continuum", "managed", "mna");

  beforeEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
    await mkdir(mnaHome, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it("writes snake_case provider fields for memory-native-agent config", async () => {
    await writeManagedMnaProviderConfig(mnaHome, {
      kind: "openai-compatible",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
      apiKeyEnv: "DEEPSEEK_API_KEY",
    });

    const content = JSON.parse(
      await readFile(managedMnaProviderConfigPath(mnaHome), "utf8"),
    ) as {
      provider: Record<string, string>;
    };

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
      await readFile(managedMnaProviderConfigPath(mnaHome), "utf8"),
    ) as {
      provider: Record<string, string>;
    };
    const secretContent = JSON.parse(
      await readFile(managedMnaProviderSecretPath(mnaHome), "utf8"),
    ) as {
      version: 1;
      apiKey: string;
    };

    expect(configContent.provider.api_key).toBeUndefined();
    expect(configContent.provider.apiKey).toBeUndefined();
    expect(configContent.provider.api_key_env).toBe(CONTINUUM_MNA_PROVIDER_API_KEY_ENV);
    expect(secretContent).toEqual({
      version: 1,
      apiKey: "secret-key",
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
      managedMnaProviderSecretPath(mnaHome),
      JSON.stringify({
        version: 1,
        apiKey: "stale-key",
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
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;

    try {
      const configPath = continuumManagedEmbeddingConfigPath();
      await mkdir(path.dirname(configPath), { recursive: true });
      await writeFile(configPath, "{bad json", "utf8");

      await expect(readManagedEmbeddingConfig()).rejects.toMatchObject({
        code: "config_corrupted",
        filePath: configPath,
        hint: "请删除该文件后重新运行",
      });
    } finally {
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
    }
  });
});
