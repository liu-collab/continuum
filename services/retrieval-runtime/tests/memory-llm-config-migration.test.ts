import { describe, expect, it } from "vitest";

import { migrateMemoryLlmConfigText } from "../src/memory-llm-config-migration.js";

describe("memory llm config migration script", () => {
  it("renames legacy writeback llm keys to memory llm keys", () => {
    const migrated = migrateMemoryLlmConfigText([
      "WRITEBACK_LLM_BASE_URL=https://api.openai.com/v1",
      "WRITEBACK_LLM_MODEL=gpt-5-mini",
      "WRITEBACK_LLM_API_KEY=test-key",
    ].join("\n"));

    expect(migrated).toContain("MEMORY_LLM_BASE_URL=https://api.openai.com/v1");
    expect(migrated).toContain("MEMORY_LLM_MODEL=gpt-5-mini");
    expect(migrated).toContain("MEMORY_LLM_API_KEY=test-key");
    expect(migrated).not.toContain("WRITEBACK_LLM_BASE_URL=");
  });

  it("keeps existing memory llm keys and drops duplicated legacy lines", () => {
    const migrated = migrateMemoryLlmConfigText([
      "MEMORY_LLM_MODEL=claude-haiku-4-5-20251001",
      "WRITEBACK_LLM_MODEL=gpt-5-mini",
      "WRITEBACK_LLM_TIMEOUT_MS=9000",
    ].join("\n"));

    expect(migrated).toContain("MEMORY_LLM_MODEL=claude-haiku-4-5-20251001");
    expect(migrated).not.toContain("WRITEBACK_LLM_MODEL=gpt-5-mini");
    expect(migrated).toContain("MEMORY_LLM_TIMEOUT_MS=9000");
  });
});
