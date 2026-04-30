import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getLiteMemoryModelStatus,
  resolveLiteMemoryModel,
  resolveLiteMemoryModelConfig,
} from "../src/lite/memory-model-config.js";

describe("lite memory model config", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "axis-lite-memory-model-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("resolves managed config and managed secrets without exposing the api key in status", async () => {
    const configPath = path.join(tempDir, "config.json");
    const secretsPath = path.join(tempDir, "secrets.json");
    await writeFile(
      configPath,
      JSON.stringify({
        version: 2,
        memory_llm: {
          baseUrl: "https://api.anthropic.com",
          model: "claude-haiku-4-5-20251001",
          protocol: "anthropic",
          timeoutMs: 12_000,
          effort: "medium",
          maxTokens: 900,
        },
      }),
      "utf8",
    );
    await writeFile(
      secretsPath,
      JSON.stringify({
        version: 2,
        memory_llm_api_key: "secret-key",
      }),
      "utf8",
    );

    const result = resolveLiteMemoryModel({
      AXIS_MANAGED_CONFIG_PATH: configPath,
      AXIS_MANAGED_SECRETS_PATH: secretsPath,
    });

    expect(result.config.apiKey).toBe("secret-key");
    expect(result.status).toEqual({
      configured: true,
      status: "configured",
      baseUrl: "https://api.anthropic.com",
      model: "claude-haiku-4-5-20251001",
      protocol: "anthropic",
      timeoutMs: 12_000,
      effort: "medium",
      maxTokens: 900,
      apiKeyConfigured: true,
      degraded: false,
    });
    expect(JSON.stringify(result.status)).not.toContain("secret-key");
  });

  it("resolves MEMORY_LLM environment style fields", () => {
    const config = resolveLiteMemoryModelConfig({
      AXIS_MANAGED_CONFIG_PATH: path.join(tempDir, "missing-config.json"),
      AXIS_MANAGED_SECRETS_PATH: path.join(tempDir, "missing-secrets.json"),
      MEMORY_LLM_BASE_URL: " https://api.deepseek.com/ ",
      MEMORY_LLM_MODEL: "deepseek-chat",
      MEMORY_LLM_PROTOCOL: "openai-compatible",
      MEMORY_LLM_TIMEOUT_MS: "8000",
      MEMORY_LLM_API_KEY: "env-key",
    });

    expect(config).toEqual({
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      protocol: "openai-compatible",
      timeoutMs: 8000,
      apiKey: "env-key",
    });
  });

  it("reports degraded status when required memory model fields are missing", () => {
    expect(getLiteMemoryModelStatus({})).toEqual({
      configured: false,
      status: "not_configured",
      apiKeyConfigured: false,
      degraded: true,
      degradationReason: "memory_model_not_configured",
    });

    expect(getLiteMemoryModelStatus({ model: "claude-haiku-4-5-20251001" }).configured).toBe(false);
    expect(getLiteMemoryModelStatus({ baseUrl: "https://api.anthropic.com" }).configured).toBe(false);
  });

  it("maps loopback URLs when the runtime is inside a container", () => {
    const config = resolveLiteMemoryModelConfig({
      AXIS_MANAGED_CONFIG_PATH: path.join(tempDir, "missing-config.json"),
      AXIS_MANAGED_SECRETS_PATH: path.join(tempDir, "missing-secrets.json"),
      MEMORY_LLM_BASE_URL: "http://127.0.0.1:8090/v1",
      MEMORY_LLM_MODEL: "local-memory-model",
      AXIS_RUNTIME_CONTAINER: "true",
      AXIS_RUNTIME_LOCALHOST_HOST: "host.containers.internal",
    });

    expect(config.baseUrl).toBe("http://host.containers.internal:8090/v1");
  });
});
