import { describe, expect, it } from "vitest";

import { buildBaseUrl } from "../shared.js";

describe("provider shared utilities", () => {
  it("keeps the OpenAI-compatible version prefix when base_url already includes it", () => {
    expect(buildBaseUrl("https://api.openai.com/v1", "/v1/chat/completions").toString()).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
  });

  it("keeps third-party OpenAI-compatible path prefixes", () => {
    expect(
      buildBaseUrl(
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "/v1/chat/completions",
      ).toString(),
    ).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
  });

  it("adds the provider endpoint when base_url is only a host", () => {
    expect(buildBaseUrl("https://api.deepseek.com", "/v1/chat/completions").toString()).toBe(
      "https://api.deepseek.com/v1/chat/completions",
    );
  });
});
