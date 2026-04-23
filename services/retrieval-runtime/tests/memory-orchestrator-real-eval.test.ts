import { describe, expect, it } from "vitest";

import { buildEvalCases } from "../src/cli/memory-orchestrator-real-eval-cases.js";
import {
  applyBaseline,
  classifyError,
  parseCliArgs,
  PASS_THRESHOLD,
  summarizeResults,
  type EvalCaseResult,
  type MetricSummary,
} from "../src/cli/memory-orchestrator-real-eval.js";

function makeResult(overrides: Partial<EvalCaseResult> & { id: string; metric: string }): EvalCaseResult {
  return {
    module: "test",
    promptName: "TEST_PROMPT",
    expected: "test",
    pass: true,
    score: 1.0,
    actual: "ok",
    durationMs: 10,
    systemPrompt: "system",
    payload: {},
    ...overrides,
  };
}

describe("parseCliArgs", () => {
  it("parses all known flags", () => {
    expect(
      parseCliArgs([
        "--base-url", "http://localhost:8090/v1",
        "--api-key", "test-key",
        "--model", "gpt-5.3-codex-spark",
        "--protocol", "anthropic",
        "--timeout-ms", "25000",
        "--output-base", "docs/custom-report",
        "--config-path", "C:\\temp\\mna-config.json",
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

  it("parses --update-baseline flag", () => {
    const args = parseCliArgs(["--update-baseline"]);
    expect(args.updateBaseline).toBe(true);
  });

  it("parses --concurrency flag", () => {
    const args = parseCliArgs(["--concurrency", "4"]);
    expect(args.concurrency).toBe(4);
  });

  it("ignores unknown flags", () => {
    const args = parseCliArgs(["--unknown", "value"]);
    expect(Object.keys(args)).toHaveLength(0);
  });
});

describe("summarizeResults", () => {
  it("aggregates pass rate and avg score by metric", () => {
    const results: EvalCaseResult[] = [
      makeResult({ id: "r1", metric: "intent_accuracy", score: 0.9, pass: true }),
      makeResult({ id: "r2", metric: "intent_accuracy", score: 0.3, pass: false, errorType: "logic" }),
      makeResult({ id: "r3", metric: "knowledge_extraction_accuracy", score: 1.0, pass: true }),
    ];

    const summary = summarizeResults(results);

    expect(summary).toEqual([
      {
        metric: "intent_accuracy",
        passed: 1,
        total: 2,
        rate: 0.5,
        avgScore: 0.6,
        errorCounts: { network: 0, schema: 0, logic: 1 },
      },
      {
        metric: "knowledge_extraction_accuracy",
        passed: 1,
        total: 1,
        rate: 1,
        avgScore: 1,
        errorCounts: { network: 0, schema: 0, logic: 0 },
      },
    ]);
  });

  it("handles empty results", () => {
    expect(summarizeResults([])).toEqual([]);
  });

  it("counts error types correctly", () => {
    const results: EvalCaseResult[] = [
      makeResult({ id: "r1", metric: "m", score: 0, pass: false, errorType: "network" }),
      makeResult({ id: "r2", metric: "m", score: 0, pass: false, errorType: "schema" }),
      makeResult({ id: "r3", metric: "m", score: 0, pass: false, errorType: "logic" }),
      makeResult({ id: "r4", metric: "m", score: 0, pass: false, errorType: "network" }),
    ];

    const summary = summarizeResults(results);
    expect(summary[0]?.errorCounts).toEqual({ network: 2, schema: 1, logic: 1 });
  });
});

describe("classifyError", () => {
  it("classifies ZodError as schema", () => {
    const { ZodError } = require("zod") as typeof import("zod");
    const error = new ZodError([]);
    expect(classifyError(error)).toBe("schema");
  });

  it("classifies JSON parse failure as schema", () => {
    expect(classifyError(new Error("memory llm response did not contain valid JSON"))).toBe("schema");
  });

  it("classifies timeout as network", () => {
    expect(classifyError(new Error("memory_llm_timeout"))).toBe("network");
  });

  it("classifies fetch failure as network", () => {
    expect(classifyError(new Error("fetch failed"))).toBe("network");
  });

  it("classifies connection reset as network", () => {
    expect(classifyError(new Error("ECONNRESET"))).toBe("network");
  });

  it("classifies 503 as network", () => {
    expect(classifyError(new Error("memory llm request failed with 503"))).toBe("network");
  });

  it("classifies unknown errors as logic", () => {
    expect(classifyError(new Error("unexpected"))).toBe("logic");
  });

  it("classifies non-Error as logic", () => {
    expect(classifyError("some string")).toBe("logic");
  });
});

describe("applyBaseline", () => {
  const baseSummary: MetricSummary[] = [
    { metric: "intent_accuracy", passed: 8, total: 10, rate: 0.8, avgScore: 0.85, errorCounts: { network: 0, schema: 0, logic: 2 } },
    { metric: "new_metric", passed: 3, total: 5, rate: 0.6, avgScore: 0.7, errorCounts: { network: 0, schema: 0, logic: 2 } },
  ];

  it("returns summary unchanged when no baseline", () => {
    const result = applyBaseline(baseSummary, undefined);
    expect(result).toEqual(baseSummary);
  });

  it("computes deltas against baseline", () => {
    const baseline = {
      generated_at: "2026-04-20T00:00:00.000Z",
      model: "gpt-5.3",
      summary: [
        { metric: "intent_accuracy", passed: 7, total: 10, rate: 0.7, avgScore: 0.75 },
      ],
    };

    const result = applyBaseline(baseSummary, baseline);
    const intent = result.find((s) => s.metric === "intent_accuracy");
    expect(intent?.baselineRate).toBe(0.7);
    expect(intent?.rateDelta).toBe(0.1);
    expect(intent?.baselineAvgScore).toBe(0.75);
    expect(intent?.avgScoreDelta).toBe(0.1);

    const newMetric = result.find((s) => s.metric === "new_metric");
    expect(newMetric?.baselineRate).toBeUndefined();
    expect(newMetric?.rateDelta).toBeUndefined();
  });
});

describe("buildEvalCases", () => {
  const cases = buildEvalCases();

  it("returns exactly 100 cases", () => {
    expect(cases).toHaveLength(100);
  });

  it("has unique ids", () => {
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers all expected metrics", () => {
    const metrics = new Set(cases.map((c) => c.metric));
    expect(metrics).toContain("intent_accuracy");
    expect(metrics).toContain("recall_accuracy_proxy");
    expect(metrics).toContain("writeback_extraction_accuracy");
    expect(metrics).toContain("writeback_refine_accuracy");
    expect(metrics).toContain("governance_plan_accuracy");
    expect(metrics).toContain("low_quality_intercept_rate");
    expect(metrics).toContain("relation_discovery_accuracy");
    expect(metrics).toContain("recommendation_acceptance_proxy");
    expect(metrics).toContain("knowledge_extraction_accuracy");
    expect(metrics).toContain("governance_correctness_proxy");
    expect(metrics).toContain("effectiveness_adjustment_direction_proxy");
  });

  it("each metric has at least 5 cases", () => {
    const grouped = new Map<string, number>();
    for (const c of cases) {
      grouped.set(c.metric, (grouped.get(c.metric) ?? 0) + 1);
    }
    for (const [metric, count] of grouped) {
      expect(count, `metric ${metric} has only ${count} cases`).toBeGreaterThanOrEqual(5);
    }
  });

  it("every case has required fields", () => {
    for (const c of cases) {
      expect(c.id).toBeTruthy();
      expect(c.metric).toBeTruthy();
      expect(c.module).toBeTruthy();
      expect(c.systemPrompt.length).toBeGreaterThan(10);
      expect(c.maxTokens).toBeGreaterThan(0);
      expect(typeof c.check).toBe("function");
    }
  });
});

describe("PASS_THRESHOLD", () => {
  it("is 0.6", () => {
    expect(PASS_THRESHOLD).toBe(0.6);
  });
});
