import os from "node:os";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  managedMnaProviderConfigPath,
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
});
