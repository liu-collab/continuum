import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import { callMemoryLlm, parseMemoryLlmJsonPayload } from "../memory-orchestrator/llm-client.js";
import { buildEvalCases } from "./memory-orchestrator-real-eval-cases.js";

export const DEFAULT_MODEL = "gpt-5.3-codex-spark";
export const DEFAULT_OUTPUT_BASE = path.resolve("docs", "memory-orchestrator-real-llm-eval");
export const DEFAULT_MANAGED_CONFIG_PATH = path.join(os.homedir(), ".continuum", "managed", "mna", "config.json");
export const PASS_THRESHOLD = 0.6;

export type Protocol = "anthropic" | "openai-compatible";

type CliArgs = {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  protocol?: Protocol;
  timeoutMs?: number;
  outputBase?: string;
  configPath?: string;
  updateBaseline?: boolean;
  concurrency?: number;
};

export type ErrorType = "network" | "schema" | "logic";

export type CheckResult = {
  score: number;
  actual: string;
};

export type EvalCase<T> = {
  id: string;
  metric: string;
  module: string;
  promptName: string;
  expected: string;
  systemPrompt: string;
  payload: unknown;
  schema: z.ZodType<T>;
  maxTokens: number;
  check: (output: T) => CheckResult;
};

export type EvalCaseResult = {
  id: string;
  metric: string;
  module: string;
  promptName: string;
  expected: string;
  pass: boolean;
  score: number;
  actual: string;
  durationMs: number;
  systemPrompt: string;
  payload: unknown;
  rawOutput?: string;
  parsedOutput?: unknown;
  error?: string;
  errorType?: ErrorType;
};

export type MetricSummary = {
  metric: string;
  passed: number;
  total: number;
  rate: number;
  avgScore: number;
  errorCounts: { network: number; schema: number; logic: number };
  baselineRate?: number;
  rateDelta?: number;
  baselineAvgScore?: number;
  avgScoreDelta?: number;
};

type ManagedConfig = {
  provider?: {
    kind?: string;
    base_url?: string;
    api_key?: string;
    model?: string;
  };
};

type BaselineFile = {
  generated_at?: string;
  model?: string;
  summary?: Array<{
    metric: string;
    passed: number;
    total: number;
    rate: number;
    avgScore?: number;
  }>;
};

function parseInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--")) {
      continue;
    }

    switch (key) {
      case "--base-url":
        args.baseUrl = value;
        index += 1;
        break;
      case "--api-key":
        args.apiKey = value;
        index += 1;
        break;
      case "--model":
        args.model = value;
        index += 1;
        break;
      case "--protocol":
        args.protocol = value === "anthropic" ? "anthropic" : "openai-compatible";
        index += 1;
        break;
      case "--timeout-ms":
        args.timeoutMs = parseInteger(value);
        index += 1;
        break;
      case "--output-base":
        args.outputBase = value;
        index += 1;
        break;
      case "--config-path":
        args.configPath = value;
        index += 1;
        break;
      case "--update-baseline":
        args.updateBaseline = true;
        break;
      case "--concurrency":
        args.concurrency = parseInteger(value);
        index += 1;
        break;
      default:
        break;
    }
  }

  return args;
}

async function loadManagedConfig(configPath: string): Promise<ManagedConfig> {
  const text = await readFile(configPath, "utf8");
  return JSON.parse(text) as ManagedConfig;
}

export function classifyError(error: unknown): ErrorType {
  if (error instanceof z.ZodError || (error instanceof Error && error.name === "ZodError")) {
    return "schema";
  }

  const message = error instanceof Error ? error.message : String(error);

  if (
    message.includes("memory llm response did not contain valid JSON")
    || message.includes("memory llm response did not include text content")
    || message.includes("did not match")
  ) {
    return "schema";
  }

  if (
    message.includes("memory_llm_timeout")
    || message.includes("fetch failed")
    || message.includes("ECONNRESET")
    || message.includes("ETIMEDOUT")
    || message.includes("memory llm request failed")
    || message.includes("503")
    || message.includes("502")
    || message.includes("504")
    || message.includes("429")
  ) {
    return "network";
  }

  return "logic";
}

export async function runCase(
  config: {
    MEMORY_LLM_BASE_URL: string;
    MEMORY_LLM_MODEL: string;
    MEMORY_LLM_API_KEY?: string;
    MEMORY_LLM_PROTOCOL: Protocol;
    MEMORY_LLM_TIMEOUT_MS: number;
    MEMORY_LLM_EFFORT: "low" | "medium" | "high" | "xhigh" | "max";
  },
  evalCase: EvalCase<unknown>,
): Promise<EvalCaseResult> {
  const startedAt = Date.now();

  try {
    const rawOutput = await callMemoryLlm(
      config,
      evalCase.systemPrompt,
      evalCase.payload,
      evalCase.maxTokens,
    );
    const parsed = evalCase.schema.parse(parseMemoryLlmJsonPayload(rawOutput));
    const checked = evalCase.check(parsed);
    const score = clampScore(checked.score);
    const pass = score >= PASS_THRESHOLD;

    return {
      id: evalCase.id,
      metric: evalCase.metric,
      module: evalCase.module,
      promptName: evalCase.promptName,
      expected: evalCase.expected,
      pass,
      score,
      actual: checked.actual,
      durationMs: Date.now() - startedAt,
      systemPrompt: evalCase.systemPrompt,
      payload: evalCase.payload,
      rawOutput,
      parsedOutput: parsed,
      errorType: pass ? undefined : "logic",
    };
  } catch (error) {
    const errorType = classifyError(error);
    return {
      id: evalCase.id,
      metric: evalCase.metric,
      module: evalCase.module,
      promptName: evalCase.promptName,
      expected: evalCase.expected,
      pass: false,
      score: 0,
      actual: errorType === "network" ? "网络/上游错误" : "执行失败",
      durationMs: Date.now() - startedAt,
      systemPrompt: evalCase.systemPrompt,
      payload: evalCase.payload,
      error: error instanceof Error ? error.message : String(error),
      errorType,
    };
  }
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return Number(value.toFixed(4));
}

export function summarizeResults(results: EvalCaseResult[]): MetricSummary[] {
  const grouped = new Map<
    string,
    {
      passed: number;
      total: number;
      scoreSum: number;
      errorCounts: { network: number; schema: number; logic: number };
    }
  >();

  for (const result of results) {
    const current =
      grouped.get(result.metric) ?? {
        passed: 0,
        total: 0,
        scoreSum: 0,
        errorCounts: { network: 0, schema: 0, logic: 0 },
      };
    current.total += 1;
    current.scoreSum += result.score;
    if (result.pass) {
      current.passed += 1;
    }
    if (result.errorType) {
      current.errorCounts[result.errorType] += 1;
    }
    grouped.set(result.metric, current);
  }

  return Array.from(grouped.entries()).map(([metric, value]) => ({
    metric,
    passed: value.passed,
    total: value.total,
    rate: value.total === 0 ? 0 : Number((value.passed / value.total).toFixed(4)),
    avgScore: value.total === 0 ? 0 : Number((value.scoreSum / value.total).toFixed(4)),
    errorCounts: value.errorCounts,
  }));
}

export async function loadBaseline(baselinePath: string): Promise<BaselineFile | undefined> {
  try {
    const text = await readFile(baselinePath, "utf8");
    return JSON.parse(text) as BaselineFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export function applyBaseline(
  summary: MetricSummary[],
  baseline: BaselineFile | undefined,
): MetricSummary[] {
  if (!baseline?.summary) {
    return summary;
  }

  const baselineMap = new Map<string, { rate: number; avgScore?: number }>();
  for (const item of baseline.summary) {
    baselineMap.set(item.metric, { rate: item.rate, avgScore: item.avgScore });
  }

  return summary.map((item) => {
    const baselineEntry = baselineMap.get(item.metric);
    if (!baselineEntry) {
      return item;
    }
    return {
      ...item,
      baselineRate: baselineEntry.rate,
      rateDelta: Number((item.rate - baselineEntry.rate).toFixed(4)),
      baselineAvgScore: baselineEntry.avgScore,
      avgScoreDelta:
        baselineEntry.avgScore !== undefined
          ? Number((item.avgScore - baselineEntry.avgScore).toFixed(4))
          : undefined,
    };
  });
}

function formatDelta(delta: number | undefined): string {
  if (delta === undefined) {
    return "NEW";
  }
  const pct = (delta * 100).toFixed(1);
  if (delta > 0) {
    return `+${pct}%`;
  }
  if (delta < 0) {
    return `${pct}%`;
  }
  return `±0.0%`;
}

function buildMarkdownReport(
  config: {
    baseUrl: string;
    model: string;
    protocol: Protocol;
    timeoutMs: number;
  },
  results: EvalCaseResult[],
  summary: MetricSummary[],
): string {
  const lines: string[] = [];
  lines.push("# Memory Orchestrator 真实模型离线评测");
  lines.push("");
  lines.push(`- 评测时间：${new Date().toISOString()}`);
  lines.push(`- 模型：\`${config.model}\``);
  lines.push(`- 协议：\`${config.protocol}\``);
  lines.push(`- 端点：\`${config.baseUrl}\``);
  lines.push(`- 超时：\`${config.timeoutMs}\`（毫秒）`);
  lines.push(`- 通过阈值：\`score >= ${PASS_THRESHOLD}\``);
  lines.push(`- 总用例数：\`${results.length}\``);
  lines.push("");

  const totalErrors = results.reduce(
    (acc, item) => {
      if (item.errorType) {
        acc[item.errorType] += 1;
      }
      return acc;
    },
    { network: 0, schema: 0, logic: 0 },
  );
  lines.push(
    `- 错误分布：网络 \`${totalErrors.network}\`，结构 \`${totalErrors.schema}\`，逻辑 \`${totalErrors.logic}\``,
  );
  lines.push("");

  lines.push("## 指标汇总");
  lines.push("");
  lines.push("| 指标 | 通过数 | 总数 | 通过率 | 平均分 | 基线对比 | 网络错误 | 结构错误 | 逻辑错误 |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const item of summary) {
    lines.push(
      `| ${item.metric} | ${item.passed} | ${item.total} | ${(item.rate * 100).toFixed(1)}% | ${item.avgScore.toFixed(3)} | ${formatDelta(item.rateDelta)} | ${item.errorCounts.network} | ${item.errorCounts.schema} | ${item.errorCounts.logic} |`,
    );
  }
  lines.push("");

  lines.push("## 样本明细");
  lines.push("");

  for (const result of results) {
    lines.push(`### ${result.id}`);
    lines.push("");
    lines.push(`- 模块：\`${result.module}\``);
    lines.push(`- 指标：\`${result.metric}\``);
    lines.push(`- Prompt：\`${result.promptName}\``);
    lines.push(`- 预期：${result.expected}`);
    lines.push(`- 实际：${result.actual}`);
    lines.push(`- 评分：\`${result.score.toFixed(3)}\``);
    lines.push(`- 结果：${result.pass ? "通过" : "未通过"}`);
    lines.push(`- 耗时：${result.durationMs}ms`);
    if (result.errorType) {
      lines.push(`- 错误类型：\`${result.errorType}\``);
    }
    if (result.error) {
      lines.push(`- 错误：\`${result.error}\``);
    }
    lines.push("");
    lines.push("#### 测试提示词");
    lines.push("");
    lines.push("```text");
    lines.push(result.systemPrompt);
    lines.push("```");
    lines.push("");
    lines.push("#### 测试输入");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(result.payload, null, 2));
    lines.push("```");
    lines.push("");
    if (result.rawOutput) {
      lines.push("#### 模型原始输出");
      lines.push("");
      lines.push("```json");
      lines.push(result.rawOutput);
      lines.push("```");
      lines.push("");
    }
    if (result.parsedOutput) {
      lines.push("#### 结构化结果");
      lines.push("");
      lines.push("```json");
      lines.push(JSON.stringify(result.parsedOutput, null, 2));
      lines.push("```");
      lines.push("");
    }
  }

  lines.push("## 说明");
  lines.push("");
  lines.push("- 这份报告是离线代理评测，只验证真实模型在当前 prompt 和 schema 下的结构化决策质量。");
  lines.push("- 评分采用 0-1 梯度评分，pass = score >= 0.6。avgScore 反映的是实际质量，比通过率更连续。");
  lines.push("- 错误分类：`network`（上游/超时），`schema`（输出结构不合规），`logic`（输出合规但决策错误）。");
  lines.push("- 基线对比来自 `--output-base` 同名 `-baseline.json`，使用 `--update-baseline` 可写入新基线。");
  lines.push("- 推荐采纳率、用户满意度、优先级调整后的长期命中率，仍然需要真实线上埋点或人工采样。");
  lines.push("");

  return lines.join("\n");
}

async function runCasesWithConcurrency(
  config: {
    MEMORY_LLM_BASE_URL: string;
    MEMORY_LLM_MODEL: string;
    MEMORY_LLM_API_KEY?: string;
    MEMORY_LLM_PROTOCOL: Protocol;
    MEMORY_LLM_TIMEOUT_MS: number;
    MEMORY_LLM_EFFORT: "low" | "medium" | "high" | "xhigh" | "max";
  },
  cases: Array<EvalCase<unknown>>,
  concurrency: number,
): Promise<EvalCaseResult[]> {
  const results: EvalCaseResult[] = new Array(cases.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= cases.length) {
        return;
      }
      const evalCase = cases[index];
      if (!evalCase) {
        return;
      }
      results[index] = await runCase(config, evalCase);
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, cases.length)) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function runRealEval(argv: string[]): Promise<{
  results: EvalCaseResult[];
  summary: MetricSummary[];
  markdownPath: string;
  jsonPath: string;
  baselinePath: string;
  baselineWritten: boolean;
}> {
  const args = parseCliArgs(argv);
  const managedConfig = await loadManagedConfig(args.configPath ?? DEFAULT_MANAGED_CONFIG_PATH);
  const baseUrl = args.baseUrl ?? managedConfig.provider?.base_url;
  const apiKey = args.apiKey ?? managedConfig.provider?.api_key;
  const model = args.model ?? DEFAULT_MODEL;
  const protocol = args.protocol ?? "openai-compatible";
  const timeoutMs = args.timeoutMs ?? 20_000;
  const outputBase = path.resolve(args.outputBase ?? DEFAULT_OUTPUT_BASE);
  const concurrency = args.concurrency ?? 1;

  if (!baseUrl) {
    throw new Error("缺少 baseUrl，可通过 --base-url 或托管配置提供");
  }

  const llmConfig = {
    MEMORY_LLM_BASE_URL: baseUrl,
    MEMORY_LLM_MODEL: model,
    MEMORY_LLM_API_KEY: apiKey,
    MEMORY_LLM_PROTOCOL: protocol,
    MEMORY_LLM_TIMEOUT_MS: timeoutMs,
    MEMORY_LLM_EFFORT: "medium" as const,
  };

  const cases = buildEvalCases();
  const results = await runCasesWithConcurrency(llmConfig, cases, concurrency);

  const baselinePath = `${outputBase}-baseline.json`;
  const baseline = await loadBaseline(baselinePath);
  const summary = applyBaseline(summarizeResults(results), baseline);

  await mkdir(path.dirname(outputBase), { recursive: true });

  const markdownPath = `${outputBase}.md`;
  const jsonPath = `${outputBase}.json`;
  const markdown = buildMarkdownReport(
    {
      baseUrl,
      model,
      protocol,
      timeoutMs,
    },
    results,
    summary,
  );

  await writeFile(markdownPath, markdown, "utf8");
  await writeFile(
    jsonPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        model,
        protocol,
        base_url: baseUrl,
        timeout_ms: timeoutMs,
        pass_threshold: PASS_THRESHOLD,
        summary,
        results,
      },
      null,
      2,
    ),
    "utf8",
  );

  let baselineWritten = false;
  if (args.updateBaseline) {
    await writeFile(
      baselinePath,
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          model,
          summary: summary.map((item) => ({
            metric: item.metric,
            passed: item.passed,
            total: item.total,
            rate: item.rate,
            avgScore: item.avgScore,
          })),
        },
        null,
        2,
      ),
      "utf8",
    );
    baselineWritten = true;
  }

  return {
    results,
    summary,
    markdownPath,
    jsonPath,
    baselinePath,
    baselineWritten,
  };
}

async function main(): Promise<void> {
  const { summary, markdownPath, jsonPath, baselinePath, baselineWritten } = await runRealEval(
    process.argv.slice(2),
  );
  process.stdout.write(`memory orchestrator real eval finished\n`);
  process.stdout.write(`markdown: ${markdownPath}\n`);
  process.stdout.write(`json: ${jsonPath}\n`);
  if (baselineWritten) {
    process.stdout.write(`baseline updated: ${baselinePath}\n`);
  }
  for (const item of summary) {
    const delta = item.rateDelta !== undefined ? ` (Δ ${formatDelta(item.rateDelta)})` : "";
    process.stdout.write(
      `${item.metric}: ${item.passed}/${item.total} (${(item.rate * 100).toFixed(1)}%, avg ${item.avgScore.toFixed(3)})${delta}\n`,
    );
  }
}

const isMainModule = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMainModule) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
