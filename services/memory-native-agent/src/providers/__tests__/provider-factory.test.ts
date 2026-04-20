import { describe, expect, it } from "vitest";

import { createProvider } from "../provider-factory.js";

describe("createProvider", () => {
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
