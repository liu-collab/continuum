import { describe, expect, it } from "vitest";

import { parseCliArgs, summarizeResults, type EvalCaseResult } from "../src/cli/memory-orchestrator-real-eval.js";

describe("memory orchestrator real eval cli", () => {
  it("parses cli args with overrides", () => {
    expect(
      parseCliArgs([
        "--base-url",
        "http://localhost:8090/v1",
        "--api-key",
        "test-key",
        "--model",
        "gpt-5.3-codex-spark",
        "--protocol",
        "anthropic",
        "--timeout-ms",
        "25000",
        "--output-base",
        "docs/custom-report",
        "--config-path",
        "C:\\temp\\mna-config.json",
      ]),
    ).toEqual({
      baseUrl: "http://localhost:8090/v1",
      apiKey: "test-key",
      model: "gpt-5.3-codex-spark",
      protocol: "anthropic",
      timeoutMs: 25000,
      outputBase: "docs/custom-report",
      configPath: "C:\\temp\\mna-config.json",
    });
  });

  it("summarizes pass rate by metric", () => {
    const results: EvalCaseResult[] = [
      {
        id: "r1",
        metric: "intent_accuracy",
        module: "intent-analyzer",
        promptName: "PROMPT_1",
        expected: "should pass",
        pass: true,
        actual: "ok",
        durationMs: 10,
        systemPrompt: "system",
        payload: {},
      },
      {
        id: "r2",
        metric: "intent_accuracy",
        module: "intent-analyzer",
        promptName: "PROMPT_1",
        expected: "should fail",
        pass: false,
        actual: "bad",
        durationMs: 12,
        systemPrompt: "system",
        payload: {},
      },
      {
        id: "r3",
        metric: "knowledge_extraction_accuracy",
        module: "evolution-planner",
        promptName: "PROMPT_2",
        expected: "should pass",
        pass: true,
        actual: "ok",
        durationMs: 15,
        systemPrompt: "system",
        payload: {},
      },
    ];

    expect(summarizeResults(results)).toEqual([
      {
        metric: "intent_accuracy",
        passed: 1,
        total: 2,
        rate: 0.5,
      },
      {
        metric: "knowledge_extraction_accuracy",
        passed: 1,
        total: 1,
        rate: 1,
      },
    ]);
  });
});
