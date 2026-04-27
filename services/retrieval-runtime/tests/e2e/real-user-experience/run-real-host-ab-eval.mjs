#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import "./load-env.mjs";
import { TASKS } from "./tasks.mjs";
import {
  callOpenAiCompatibleChat,
  extractJsonObject,
} from "./openai-compatible-client.mjs";
import { checkHostCli, runHostAnswer } from "./real-host-runner.mjs";

const DEFAULT_OUTPUT_DIR = path.resolve(
  "docs",
  "real-user-experience-host-eval",
);

function parseArgs(argv) {
  const args = {
    host: "claude",
    limit: 100,
    offset: 0,
    concurrency: 10,
    runtime: process.env.MEMORY_RUNTIME_BASE_URL ?? "http://127.0.0.1:3002",
    storage: process.env.STORAGE_API_BASE_URL ?? "http://127.0.0.1:3001",
    seed: false,
    seedOnly: false,
    outputDir: process.env.REAL_UX_HOST_EVAL_OUTPUT_DIR ?? DEFAULT_OUTPUT_DIR,
    timeoutMs: Number.parseInt(
      process.env.REAL_UX_HOST_TIMEOUT_MS ?? "180000",
      10,
    ),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--host" && value) {
      args.host = value;
      index += 1;
    } else if (key === "--limit" && value) {
      args.limit = Number.parseInt(value, 10);
      index += 1;
    } else if (key === "--offset" && value) {
      args.offset = Number.parseInt(value, 10);
      index += 1;
    } else if (key === "--concurrency" && value) {
      args.concurrency = Number.parseInt(value, 10);
      index += 1;
    } else if (key === "--runtime" && value) {
      args.runtime = value;
      index += 1;
    } else if (key === "--storage" && value) {
      args.storage = value;
      index += 1;
    } else if (key === "--output-dir" && value) {
      args.outputDir = path.resolve(value);
      index += 1;
    } else if (key === "--timeout-ms" && value) {
      args.timeoutMs = Number.parseInt(value, 10);
      index += 1;
    } else if (key === "--seed") {
      args.seed = true;
    } else if (key === "--seed-only") {
      args.seed = true;
      args.seedOnly = true;
    }
  }

  if (args.host !== "claude" && args.host !== "codex" && args.host !== "llm") {
    throw new Error("--host must be claude, codex, or llm");
  }
  return args;
}

function judgeConfig() {
  // judge 模型必须有独立配置，禁止回退到 MEMORY_LLM_* 以避免循环评价（self-judge bias）
  const baseUrl =
    process.env.EVAL_MODEL_BASE_URL;
  const apiKey =
    process.env.EVAL_MODEL_API_KEY;
  const judgeModel =
    process.env.EVAL_JUDGE_MODEL;
  const timeoutMs = Number.parseInt(
    process.env.EVAL_MODEL_TIMEOUT_MS ?? "120000",
    10,
  );
  if (!baseUrl) {
    throw new Error("缺少 EVAL_MODEL_BASE_URL（judge 模型必须独立配置，不可复用 MEMORY_LLM_BASE_URL）");
  }
  if (!judgeModel) {
    throw new Error("缺少 EVAL_JUDGE_MODEL（judge 模型必须独立配置，不可复用 MEMORY_LLM_MODEL）");
  }
  return { baseUrl, apiKey, judgeModel, timeoutMs };
}

async function httpJson(baseUrl, pathName, method = "GET", body) {
  const url = new URL(
    pathName,
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  );
  const response = await fetch(url, {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    throw new Error(
      `${method} ${url.pathname} failed with ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`,
    );
  }
  return payload;
}

async function fetchRuntimeRuns(args, task, lookup = {}) {
  const traceId = lookup.trace_id;
  const sessionId = lookup.session_id ?? task.session_id;
  const query = traceId
    ? `/v1/runtime/observe/runs?trace_id=${encodeURIComponent(traceId)}`
    : `/v1/runtime/observe/runs?session_id=${encodeURIComponent(sessionId)}&page_size=20`;
  try {
    return await httpJson(args.runtime, query);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function materializeSeed(task, seed) {
  const summary = seed.summary ?? "";
  return {
    ...seed,
    workspace_id: task.workspace_id,
    user_id: task.user_id,
    task_id: seed.scope === "task" ? task.task_id : null,
    session_id: seed.scope === "session" ? task.session_id : null,
    source: {
      ...(seed.source ?? {}),
      origin_workspace_id: task.workspace_id,
    },
    idempotency_key: `ux-eval-${task.id}-${seed.scope}-${seed.candidate_type}-${Buffer.from(summary).toString("base64url").slice(0, 48)}`,
  };
}

async function seedTaskMemories(args, task) {
  const seeds = Array.isArray(task.seed_memories) ? task.seed_memories : [];
  if (seeds.length === 0) {
    return [];
  }

  const candidates = seeds.map((seed) => materializeSeed(task, seed));
  const response = await httpJson(
    args.storage,
    "/v1/storage/write-back-candidates",
    "POST",
    { candidates },
  );
  const jobs = response.jobs ?? response.submitted_jobs ?? response.data?.jobs ?? [];
  return jobs.map((job) => job.job_id).filter(Boolean);
}

async function waitForProjection(args, jobIds) {
  if (jobIds.length === 0) {
    return;
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const payload = await httpJson(
        args.runtime,
        "/v1/runtime/write-projection-status",
        "POST",
        { job_ids: jobIds },
      );
      const items = payload.items ?? payload.data?.items ?? [];
      if (
        items.length > 0 &&
        items.every(
          (item) => item.projection_ready || item.write_job_status === "succeeded",
        )
      ) {
        return;
      }
    } catch {
      // Projection lookup is best effort; continue until timeout.
    }
  }
}

async function seedMemories(args, tasks) {
  const allJobIds = [];
  for (const task of tasks) {
    const jobIds = await seedTaskMemories(args, task);
    allJobIds.push(...jobIds);
  }
  await waitForProjection(args, allJobIds);
  return allJobIds;
}

export const JUDGE_SCORE_RUBRIC = `
评分标准（每个维度 1-5）：

task_success（任务完成度）：
  1 = 完全偏离任务需求，回答与问题无关
  2 = 仅部分相关，但遗漏关键信息或错误
  3 = 基本完成任务，有少量不足但不影响理解
  4 = 较好地完成任务，信息准确完整
  5 = 出色完成任务，超出预期

memory_usefulness（记忆有用性，仅对 B 组/有记忆组评分）：
  0 = 未使用记忆或记忆被忽略
  1 = 记忆被提及但与任务无关
  2 = 记忆被部分使用，但未显著改善回答
  3 = 记忆被合理使用，使回答更准确
  4 = 记忆显著提升了回答质量
  5 = 记忆被精准运用，回答因此大幅改善

continuity（上下文延续性）：
  1 = 完全忽略之前的交互上下文
  2 = 弱延续，仅做了模糊引用
  3 = 基本延续了之前的上下文
  4 = 良好延续，体现了对上下文的准确理解
  5 = 完美延续，上下文被自然融入回答

preference_following（偏好遵循）：
  1 = 完全无视用户表达的风格/约束偏好
  2 = 部分遵循，但有多处不符
  3 = 基本遵循，少数偏差不影响整体
  4 = 良好遵循，仅在必要时做了合理偏离
  5 = 完美遵循用户的每项表达偏好

boolean 维度：
  memory_misuse = true 表示误解或歪曲了记忆内容
  irrelevant_memory_noise = true 表示塞入了无关记忆噪声
  omission = true 表示遗漏了关键信息或约束
`;

function judgeMessages(task, answerOne, answerTwo) {
  return [
    {
      role: "system",
      content: [
        "你是严格的盲评裁判，评估两个助手对同一个用户问题的回答。",
        "你不知道哪个助手开启了记忆功能（如果做了 A/B 对照）。",
        JUDGE_SCORE_RUBRIC,
        "输出格式：只输出一个 JSON 对象，不要加 Markdown 包裹。",
        "如果两个回答都不可接受（如都偏离任务、都有重大错误），请选择 both_bad 而非强行选一个。",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          task_id: task.id,
          scenario: task.scenario,
          user_input: task.user_input,
          expected_context: task.expected,
          answer_1: answerOne,
          answer_2: answerTwo,
          required_json_shape: {
            answer_1: {
              task_success: "number 1-5",
              memory_usefulness: "number 0-5",
              memory_misuse: "boolean",
              irrelevant_memory_noise: "boolean",
              continuity: "number 1-5",
              preference_following: "number 1-5",
              omission: "boolean",
            },
            answer_2: "same shape as answer_1",
            overall_winner: '"answer_1" | "answer_2" | "tie" | "both_bad"',
            confidence: "number 0-1 — 你对自己判断的确信度",
            reason: "简短中文理由，说明谁赢/平/都差以及为什么",
          },
        },
        null,
        2,
      ),
    },
  ];
}

function scoreNumber(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(5, numeric));
}

function normalizeAnswerScore(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    task_success: scoreNumber(source.task_success, 1),
    memory_usefulness: scoreNumber(source.memory_usefulness, 0),
    memory_misuse: Boolean(source.memory_misuse),
    irrelevant_memory_noise: Boolean(source.irrelevant_memory_noise),
    continuity: scoreNumber(source.continuity, 1),
    preference_following: scoreNumber(source.preference_following, 1),
    omission: Boolean(source.omission),
  };
}

function normalizeJudge(value) {
  return {
    answer_1: normalizeAnswerScore(value.answer_1),
    answer_2: normalizeAnswerScore(value.answer_2),
    winner: ["answer_1", "answer_2", "tie", "both_bad"].includes(value.overall_winner)
      ? value.overall_winner
      : "tie",
    confidence: Math.max(0, Math.min(1, Number(value.confidence ?? 0))),
    reason: typeof value.reason === "string" ? value.reason : "",
  };
}

async function callJudge(config, task, answerOne, answerTwo) {
  try {
    const response = await callOpenAiCompatibleChat({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.judgeModel,
      messages: judgeMessages(task, answerOne, answerTwo),
      temperature: 0,
      maxTokens: 1200,
      timeoutMs: config.timeoutMs,
    });
    return {
      raw_output: response.content,
      parsed: normalizeJudge(extractJsonObject(response.content)),
      duration_ms: response.duration_ms,
    };
  } catch (error) {
    return {
      raw_output: "",
      parsed: null,
      duration_ms: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function answerOrderFor(task) {
  const numeric = Number(task.id.replace(/\D/g, ""));
  return numeric % 2 === 0 ? ["B", "A"] : ["A", "B"];
}

function mapJudge(task, judge) {
  if (!judge) {
    return null;
  }
  const order = answerOrderFor(task);
  const firstGroup = order[0];
  const secondGroup = order[1];
  const byGroup = {
    [firstGroup]: judge.answer_1,
    [secondGroup]: judge.answer_2,
  };
  let winner = "tie";
  if (judge.winner === "answer_1") {
    winner = firstGroup;
  } else if (judge.winner === "answer_2") {
    winner = secondGroup;
  } else if (judge.winner === "both_bad") {
    winner = "both_bad";
  }
  return {
    A: byGroup.A,
    B: byGroup.B,
    winner,
    confidence: judge.confidence,
    reason: judge.reason,
  };
}

async function runTask(args, config, task) {
  const groupA = await runHostAnswer({
    host: args.host,
    task,
    runtimeBaseUrl: args.runtime,
    memoryEnabled: false,
    timeoutMs: args.timeoutMs,
  });
  const groupB = await runHostAnswer({
    host: args.host,
    task,
    runtimeBaseUrl: args.runtime,
    memoryEnabled: true,
    timeoutMs: args.timeoutMs,
  });
  const runs =
    args.host !== "llm"
      ? await fetchRuntimeRuns(args, task, {
          trace_id: groupB.trace_id,
          session_id: groupB.host_session_id,
        })
      : null;

  const order = answerOrderFor(task);
  const answerOne = order[0] === "A" ? groupA.output : groupB.output;
  const answerTwo = order[1] === "A" ? groupA.output : groupB.output;
  const judge = await callJudge(config, task, answerOne, answerTwo);

  return {
    task,
    host: args.host,
    answer_order: { answer_1: order[0], answer_2: order[1] },
    group_a: groupA,
    group_b: groupB,
    trace_lookup_session_id: groupB.host_session_id ?? task.session_id,
    trace_lookup_trace_id: groupB.trace_id ?? null,
    observe_runs: runs,
    blind_judge: {
      ...judge,
      mapped: mapJudge(task, judge.parsed),
    },
  };
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (valid.length === 0) return 0;
  return Number(
    (valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(4),
  );
}

function summarize(results, host) {
  const judged = results.filter((result) => result.blind_judge.mapped);
  let bWins = 0, aWins = 0, ties = 0, bothBad = 0;
  for (const result of judged) {
    const w = result.blind_judge.mapped.winner;
    if (w === "B") bWins++;
    else if (w === "A") aWins++;
    else if (w === "both_bad") bothBad++;
    else ties++;
  }
  const decidable = judged.length - bothBad;

  function weightedAverage(items, getScore) {
    let sumWeight = 0, sumScore = 0;
    for (const item of items) {
      const conf = item.blind_judge.mapped.confidence;
      const score = getScore(item);
      if (Number.isFinite(score) && Number.isFinite(conf) && conf > 0) {
        sumWeight += conf;
        sumScore += score * conf;
      }
    }
    return sumWeight > 0 ? Number((sumScore / sumWeight).toFixed(4)) : average(items.map(getScore));
  }

  const retrievalResults = results.filter(
    (result) =>
      result.task.scenario !== "irrelevant_no_memory" &&
      result.task.scenario !== "writeback_quality",
  );
  const retrievalJudged = retrievalResults.filter(
    (result) => result.blind_judge.mapped,
  );
  let retrievalBWins = 0;
  for (const result of retrievalJudged) {
    if (result.blind_judge.mapped.winner === "B") retrievalBWins++;
  }

  const suppressionResults = results.filter(
    (result) => result.task.scenario === "irrelevant_no_memory",
  );
  const suppressionJudged = suppressionResults.filter(
    (result) => result.blind_judge.mapped,
  );

  const writebackResults = results.filter(
    (result) => result.task.scenario === "writeback_quality",
  );
  const writebackTriggered = writebackResults.filter(
    (result) =>
      Array.isArray(result.observe_runs?.writeback_submissions) &&
      result.observe_runs.writeback_submissions.length > 0,
  ).length;
  const platformDeliveryResults = results.filter(
    (result) => result.group_b?.memory_delivery?.attempted,
  );
  const platformDelivered = platformDeliveryResults.filter(
    (result) => result.group_b.memory_delivery.host_context_delivered,
  ).length;
  const platformMemoryDelivered = platformDeliveryResults.filter(
    (result) => result.group_b.memory_delivery.memory_delivered,
  ).length;

  return {
    generated_at: new Date().toISOString(),
    total: results.length,
    judged: judged.length,
    both_bad: bothBad,
    b_wins: bWins,
    a_wins: aWins,
    ties,
    b_win_rate:
      decidable === 0 ? 0 : Number((bWins / decidable).toFixed(4)),
    retrieval_b_win_rate:
      retrievalJudged.length === 0
        ? 0
        : Number((retrievalBWins / retrievalJudged.length).toFixed(4)),
    avg_task_success_a: average(
      judged.map((result) => result.blind_judge.mapped.A.task_success),
    ),
    avg_task_success_b: average(
      judged.map((result) => result.blind_judge.mapped.B.task_success),
    ),
    avg_task_success_a_weighted: weightedAverage(
      judged,
      (r) => r.blind_judge.mapped.A.task_success,
    ),
    avg_task_success_b_weighted: weightedAverage(
      judged,
      (r) => r.blind_judge.mapped.B.task_success,
    ),
    avg_memory_usefulness_b: average(
      judged.map((result) => result.blind_judge.mapped.B.memory_usefulness),
    ),
    avg_memory_usefulness_b_weighted: weightedAverage(
      judged,
      (r) => r.blind_judge.mapped.B.memory_usefulness,
    ),
    memory_misuse_rate_b:
      judged.length === 0
        ? 0
        : Number(
            (
              judged.filter(
                (result) => result.blind_judge.mapped.B.memory_misuse,
              ).length / judged.length
            ).toFixed(4),
          ),
    runtime_trace_rate:
      host === "llm"
        ? null
        : results.length === 0
          ? 0
          : Number(
              (
                results.filter(
                  (result) =>
                    Array.isArray(result.observe_runs?.turns) &&
                    result.observe_runs.turns.length > 0,
                ).length / results.length
              ).toFixed(4),
            ),
    platform_delivery_rate:
      platformDeliveryResults.length === 0
        ? null
        : Number((platformDelivered / platformDeliveryResults.length).toFixed(4)),
    platform_memory_delivery_rate:
      platformDeliveryResults.length === 0
        ? null
        : Number((platformMemoryDelivered / platformDeliveryResults.length).toFixed(4)),
    avg_tool_events_a: average(
      results.map((r) => r.group_a?.parsed_events ?? 0),
    ),
    avg_tool_events_b: average(
      results.map((r) => r.group_b?.parsed_events ?? 0),
    ),
    tool_event_ratio_b_a:
      results.length === 0
        ? 0
        : Number(
            (
              results.reduce((s, r) => s + (r.group_b?.parsed_events ?? 0), 0) /
              (results.reduce((s, r) => s + (r.group_a?.parsed_events ?? 0), 0) || 1)
            ).toFixed(4),
          ),
    tool_events_by_scenario: (() => {
      const map = {};
      for (const r of results) {
        const s = r.task.scenario;
        if (!map[s]) map[s] = { a: 0, b: 0, n: 0 };
        map[s].a += r.group_a?.parsed_events ?? 0;
        map[s].b += r.group_b?.parsed_events ?? 0;
        map[s].n++;
      }
      const out = {};
      for (const [s, g] of Object.entries(map)) {
        out[s] = {
          avg_a: Math.round(g.a / g.n),
          avg_b: Math.round(g.b / g.n),
          ratio_b_a: Number((g.b / (g.a || 1)).toFixed(2)),
        };
      }
      return out;
    })(),
    retrieval_group: {
      total: retrievalResults.length,
      judged: retrievalJudged.length,
      b_win_rate:
        retrievalJudged.length === 0
          ? 0
          : Number((retrievalBWins / retrievalJudged.length).toFixed(4)),
    },
    suppression_group: {
      total: suppressionResults.length,
      judged: suppressionJudged.length,
      memory_misuse_rate_b:
        suppressionJudged.length === 0
          ? 0
          : Number(
              (
                suppressionJudged.filter(
                  (result) => result.blind_judge.mapped.B.memory_misuse,
                ).length / suppressionJudged.length
              ).toFixed(4),
            ),
    },
    writeback_group: {
      total: writebackResults.length,
      writeback_trigger_rate:
        writebackResults.length === 0
          ? 0
          : Number((writebackTriggered / writebackResults.length).toFixed(4)),
    },
  };
}

async function runWithConcurrency(items, concurrency, handler) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await handler(items[index], index);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(concurrency, items.length)) },
      () => worker(),
    ),
  );
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tasks = TASKS.slice(args.offset, args.offset + args.limit);
  await mkdir(args.outputDir, { recursive: true });

  console.log(`[real-host-ab] tasks=${tasks.length} output=${args.outputDir}`);

  if (args.seed) {
    console.log("[real-host-ab] seeding memories...");
    const jobIds = await seedMemories(args, tasks);
    console.log(`[real-host-ab] seed jobs=${jobIds.length}`);
  }

  if (args.seedOnly) {
    return;
  }

  const config = judgeConfig();

  if (args.host !== "llm") {
    const cli = await checkHostCli(args.host);
    if (!cli.ok) {
      throw new Error(`${args.host} CLI unavailable: ${cli.stderr}`);
    }
    console.log(`[real-host-ab] host=${args.host} version=${cli.version}`);
  } else {
    console.log("[real-host-ab] host=llm pure-model ab eval");
  }

  const results = await runWithConcurrency(
    tasks,
    args.concurrency,
    async (task, index) => {
      console.log(
        `[real-host-ab] ${index + 1}/${tasks.length} ${task.id} ${task.scenario}`,
      );
      return runTask(args, config, task);
    },
  );
  const summary = summarize(results, args.host);

  await writeFile(
    path.join(args.outputDir, `${args.host}-ab-results.json`),
    JSON.stringify({ summary, results }, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(args.outputDir, `${args.host}-ab-results.jsonl`),
    `${results.map((result) => JSON.stringify(result)).join("\n")}\n`,
    "utf8",
  );
  await writeFile(
    path.join(args.outputDir, `${args.host}-summary.json`),
    JSON.stringify(summary, null, 2),
    "utf8",
  );

  console.log(`[real-host-ab] summary ${JSON.stringify(summary)}`);
}

void main().catch((error) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
});
