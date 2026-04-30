import { describe, expect, it } from "vitest";

import { parseCliArgs } from "../src/cli/memory-orchestrator-real-eval.js";

describe("memory orchestrator real eval cli", () => {
  it("parses all supported memory llm protocols", () => {
    expect(parseCliArgs(["--protocol", "anthropic"]).protocol).toBe("anthropic");
    expect(parseCliArgs(["--protocol", "openai-compatible"]).protocol).toBe("openai-compatible");
    expect(parseCliArgs(["--protocol", "openai-responses"]).protocol).toBe("openai-responses");
    expect(parseCliArgs(["--protocol", "ollama"]).protocol).toBe("ollama");
  });
});
