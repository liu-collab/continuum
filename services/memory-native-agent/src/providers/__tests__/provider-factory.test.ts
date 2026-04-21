import { describe, expect, it } from "vitest";

import { createProvider } from "../provider-factory.js";

describe("createProvider", () => {
  it("returns a misconfigured provider when openai-compatible has no api key yet", () => {
    const provider = createProvider(
      {
        kind: "openai-compatible",
        model: "gpt-4.1-mini",
        baseUrl: "https://api.openai.com/v1",
        temperature: 0.2,
        apiKeyEnv: "OPENAI_API_KEY",
      },
      {},
    );

    expect(provider.id()).toBe("openai-compatible");
    expect(provider.model()).toBe("gpt-4.1-mini");
    expect(provider.status?.()).toEqual({
      status: "misconfigured",
      detail: "provider openai-compatible 缺少 API key 配置",
    });
  });

  it("prefers inline api key for openai-compatible providers", () => {
    const provider = createProvider(
      {
        kind: "openai-compatible",
        model: "gpt-4.1-mini",
        baseUrl: "https://api.openai.com/v1",
        temperature: 0.2,
        effort: "high",
        maxTokens: 4096,
        apiKey: "inline-key",
      },
      {},
    );

    expect(provider.id()).toBe("openai-compatible");
    expect(provider.model()).toBe("gpt-4.1-mini");
    expect(provider.status?.()).toBeUndefined();
  });

  it("creates a record-replay provider with replay mode and no target provider", () => {
    const provider = createProvider(
      {
        kind: "record-replay",
        model: "fixture-model",
        baseUrl: "http://127.0.0.1:11434",
        temperature: 0.2,
        fixtureDir: "tests/fixtures/model-record-replay",
        fixtureName: "sample",
      },
      {
        MNA_PROVIDER_MODE: "replay",
      },
    );

    expect(provider.id()).toBe("record-replay");
    expect(provider.model()).toBe("fixture-model");
  });

  it("returns a misconfigured provider when record-replay live mode has no target provider", () => {
    const provider = createProvider(
      {
        kind: "record-replay",
        model: "fixture-model",
        baseUrl: "http://127.0.0.1:11434",
        temperature: 0.2,
        fixtureDir: "tests/fixtures/model-record-replay",
        fixtureName: "sample",
      },
      {
        MNA_PROVIDER_MODE: "record",
      },
    );

    expect(provider.id()).toBe("record-replay");
    expect(provider.model()).toBe("fixture-model");
    expect(provider.status?.()).toEqual({
      status: "misconfigured",
      detail: "provider record-replay 缺少目标 provider 配置",
    });
  });

  it("creates a record-replay provider with an ollama target in record mode", () => {
    const provider = createProvider(
      {
        kind: "record-replay",
        model: "fixture-model",
        baseUrl: "http://127.0.0.1:11434",
        temperature: 0.2,
        fixtureDir: "tests/fixtures/model-record-replay",
        fixtureName: "sample",
        recordReplayTarget: "ollama",
      },
      {
        MNA_PROVIDER_MODE: "record",
      },
    );

    expect(provider.id()).toBe("record-replay");
    expect(provider.model()).toBe("fixture-model");
  });
});
