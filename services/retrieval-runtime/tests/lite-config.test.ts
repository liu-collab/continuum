import { describe, expect, it } from "vitest";

import { loadLiteConfig } from "../src/config.js";

describe("loadLiteConfig", () => {
  it("does not require full-mode database or storage configuration", () => {
    const config = loadLiteConfig({
      HOST: "127.0.0.1",
      PORT: "33902",
    } as NodeJS.ProcessEnv);

    expect(config.HOST).toBe("127.0.0.1");
    expect(config.PORT).toBe(33902);
    expect(config.LOG_LEVEL).toBe("info");
  });

  it("keeps lite memory model configuration available", () => {
    const config = loadLiteConfig({
      MEMORY_LLM_BASE_URL: "http://localhost:11434/v1",
      MEMORY_LLM_MODEL: "memory-model",
      MEMORY_LLM_TIMEOUT_MS: "2000",
    } as NodeJS.ProcessEnv);

    expect(config.MEMORY_LLM_BASE_URL).toBe("http://localhost:11434/v1");
    expect(config.MEMORY_LLM_MODEL).toBe("memory-model");
    expect(config.MEMORY_LLM_TIMEOUT_MS).toBe(2000);
  });
});
