#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import "./load-env.mjs";
import { TASKS } from "./tasks.mjs";
import { callOpenAiCompatibleChat, extractJsonObject } from "./openai-compatible-client.mjs";

const DEFAULT_OUTPUT_DIR = path.resolve("docs", "real-user-experience-eval");

function parseArgs(argv) {
  const args = {
    limit: 100,
    offset: 0,
    concurrency: 1,
    seed: false,
    seedOnly: false,
    runtime: process.env.MEMORY_RUNTIME_BASE_URL ?? "http://127.0.0.1:3002",
    storage: process.env.STORAGE_API_BASE_URL ?? "http://127.0.0.1:3001",
    outputDir: process.env.REAL_UX_EVAL_OUTPUT_DIR ?? DEFAULT_OUTPUT_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--limit" && value) {
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
    } else if (key === "--seed") {
      args.seed = true;
    } else if (key === "--seed-only") {
      args.seed = true;
      args.seedOnly = true;
    }
  }

  return args;
}

function envConfig() {
  const baseUrl = process.env.EVAL_MODEL_BASE_URL ?? process.env.MEMORY_LLM_BASE_URL;
  const apiKey = process.env.EVAL_MODEL_API_KEY ?? process.env.MEMORY_LLM_API_KEY;
  const answerModel = process.env.EVAL_ANSWER_MODEL ?? process.env.MEMORY_LLM_MODEL;
  const judgeModel = process.env.EVAL_JUDGE_MODEL ?? answerModel;
  const timeoutMs = Number.parseInt(process.env.EVAL_MODEL_TIMEOUT_MS ?? "120000", 10);

  if (!baseUrl) {
    throw new Error("缺少 EVAL_MODEL_BASE_URL 或 MEMORY_LLM_BASE_URL");
  }
  if (!answerModel) {
    throw new Error("缺少 EVAL_ANSWER_MODEL 或 MEMORY_LLM_MODEL");
  }
  if (!judgeModel) {
    throw new Error("缺少 EVAL_JUDGE_MODEL 或 MEMORY_LLM_MODEL");
  }

  return {
    baseUrl,
    apiKey,
    answerModel,
    judgeModel,
    timeoutMs,
  };
}

async function httpJson(baseUrl, pathName, method = "GET", body) {
  const url = new URL(pathName, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
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
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }
  if (!response.ok) {
    throw new Error(`${method} ${url.pathname} failed with ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  return payload;
}

function materializeSeed(task, seed) {
  return {
    ...seed,
    workspace_id: task.workspace_id,
    user_id: task.user_id,
    task_id: seed.scope === "task" ? task.task_id : null,
    session_id: seed.scope === "session" ? task.session_id : null,
    source: {
      ...seed.source,
      origin_workspace_id: task.workspace_id,
    },
    idempotency_key: `ux-eval-${task.id}-${seed.scope}-${seed.candidate_type}-${Buffer.from(seed.summary).toString("base64url").slice(0, 48)}`,
  };
}

async function seedTaskMemories(args, task) {
  if (task.seed_memories.length === 0) {
    return [];
  }

  const candidates = task.seed_memories.map((seed) => materializeSeed(task, seed));
  const response = await httpJson(args.storage, "/v1/storage/write-back-candidates", "POST", { candidates });
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
      const payload = await httpJson(args.runtime, "/v1/runtime/write-projection-status", "POST", {
        job_ids: jobIds,
      });
      const items = payload.items ?? payload.data?.items ?? [];
      if (items.length > 0 && items.every((item) => item.projection_ready || item.write_job_status === "succeeded")) {
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

function injectionToSystemText(injectionBlock) {
  if (!injectionBlock || !Array.isArray(injectionBlock.memory_records) || injectionBlock.memory_records.length === 0) {
    return "";
  }
  const lines = [
    "以下是系统在当前轮检索到的相关记忆。请自然使用，不要生硬声明“我看到了记忆”。",
    `原因：${injectionBlock.injection_reason}`,
    `摘要：${injectionBlock.memory_summary}`,
    "支撑记录：",
  ];
  for (const record of injectionBlock.memory_records) {
    lines.push(`- [${record.memory_type}/${record.scope}] ${record.summary}`);
  }
  return lines.join("\n");
}

function buildAnswerMessages(task, injectionBlock) {
  const messages = [
    {
      role: "system",
      content: [
        "你是一个真实编码助手。",
        "请完成用户当前请求。",
        "不要提及评测、A/B 测试、隐藏标签或评分规则。",
        "如果没有必要，不要主动提历史上下文。",
      ].join("\n"),
    },
  ];

  const memoryText = injectionToSystemText(injectionBlock);
  if (memoryText) {
    messages.push({ role: "system", content: memoryText });
  }

  messages.push({ role: "user", content: task.user_input });
  return messages;
}

async function prepareContext(args, task) {
  return httpJson(args.runtime, "/v1/runtime/prepare-context", "POST", {
    host: "custom_agent",
    workspace_id: task.workspace_id,
    user_id: task.user_id,
    task_id: task.task_id,
    session_id: task.session_id,
    turn_id: `${task.id}-turn-001`,
    memory_mode: task.memory_mode,
    phase: "before_response",
    current_input: task.user_input,
  });
}

async function finalizeTurn(args, task, assistantOutput) {
  return httpJson(args.runtime, "/v1/runtime/finalize-turn", "POST", {
    host: "custom_agent",
    workspace_id: task.workspace_id,
    user_id: task.user_id,
    task_id: task.task_id,
    session_id: task.session_id,
    turn_id: `${task.id}-turn-001`,
    memory_mode: task.memory_mode,
    current_input: task.user_input,
    assistant_output: assistantOutput || "未能生成有效回答。",
  });
}

async function fetchRuntimeRuns(args, task) {
  try {
    return await httpJson(
      args.runtime,
      `/v1/runtime/observe/runs?session_id=${encodeURIComponent(task.session_id)}&page_size=20`,
    );
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function callAnswerModel(modelConfig, task, injectionBlock) {
  try {
    return await callOpenAiCompatibleChat({
      baseUrl: modelConfig.baseUrl,
      apiKey: modelConfig.apiKey,
      model: modelConfig.answerModel,
      messages: buildAnswerMessages(task, injectionBlock),
      temperature: 0.2,
      maxTokens: 1800,
      timeoutMs: modelConfig.timeoutMs,
    });
  } catch (error) {
    return {
      content: "",
      raw: null,
      duration_ms: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function judgeMessages(task, answerOne, answerTwo) {
  return [
    {
      role: "system",
      content: [
        "你是严格的盲评裁判。",
        "你会看到同一个用户任务的两个回答，但不知道哪个开启了记忆。",
        "请按真实用户体验评分，不要偏向更长的回答。",
        "只输出 JSON，不要输出解释性前后缀。",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          task_id: task.id,
          scenario: task.scenario,
          user_input: task.user_input,
          evaluation_context: {
            helpful_facts: task.expected.helpful_facts,
            avoid_facts: task.expected.avoid_facts,
            should_use_memory: task.expected.should_use_memory,
            should_writeback: task.expected.should_writeback,
            judge_focus: task.expected.judge_focus,
          },
          answer_1: answerOne,
          answer_2: answerTwo,
          required_json_shape: {
            answer_1: {
              task_success: "number 1-5",
              memory_usefulness: "number 0-5; if memory is unnecessary, use 0 unless answer invents memory",
              memory_misuse: "boolean",
              irrelevant_memory_noise: "boolean",
              continuity: "number 1-5",
              preference_following: "number 1-5",
              omission: "boolean",
            },
            answer_2: "same shape as answer_1",
            winner: "answer_1 | answer_2 | tie",
            confidence: "number 0-1",
            reason: "short Chinese reason",
          },
        },
        null,
        2,
      ),
    },
  ];
}

async function callJudgeModel(modelConfig, task, answerOne, answerTwo) {
  try {
    const response = await callOpenAiCompatibleChat({
      baseUrl: modelConfig.baseUrl,
      apiKey: modelConfig.apiKey,
      model: modelConfig.judgeModel,
      messages: judgeMessages(task, answerOne, answerTwo),
      temperature: 0,
      maxTokens: 1200,
      timeoutMs: modelConfig.timeoutMs,
    });
    return {
      ...response,
      parsed: normalizeJudgeResult(extractJsonObject(response.content)),
    };
  } catch (error) {
    return {
      content: "",
      raw: null,
      duration_ms: 0,
      parsed: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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

function normalizeJudgeResult(value) {
  return {
    answer_1: normalizeAnswerScore(value.answer_1),
    answer_2: normalizeAnswerScore(value.answer_2),
    winner: ["answer_1", "answer_2", "tie"].includes(value.winner) ? value.winner : "tie",
    confidence: Math.max(0, Math.min(1, Number(value.confidence ?? 0))),
    reason: typeof value.reason === "string" ? value.reason : "",
  };
}

function answerOrderFor(task) {
  const numeric = Number(task.id.replace(/\D/g, ""));
  return numeric % 2 === 0 ? ["B", "A"] : ["A", "B"];
}

function mapJudgeToGroups(task, judge) {
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
  }
  return {
    A: byGroup.A,
    B: byGroup.B,
    winner,
    confidence: judge.confidence,
    reason: judge.reason,
  };
}

function runtimeInjectionStats(prepareResponse) {
  return {
    trigger: Boolean(prepareResponse?.trigger),
    degraded: Boolean(prepareResponse?.degraded),
    injected_count: prepareResponse?.injection_block?.memory_records?.length ?? 0,
    memory_packet_ids: prepareResponse?.memory_packet_ids ?? [],
  };
}

async function runTask(args, modelConfig, task) {
  const groupA = await callAnswerModel(modelConfig, task, null);
  const prepareResponse = await prepareContext(args, task).catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }));
  const groupB = await callAnswerModel(modelConfig, task, prepareResponse.injection_block ?? null);
  const finalizeResponse = await finalizeTurn(args, task, groupB.content).catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }));
  const runs = await fetchRuntimeRuns(args, task);

  const order = answerOrderFor(task);
  const answerOne = order[0] === "A" ? groupA.content : groupB.content;
  const answerTwo = order[1] === "A" ? groupA.content : groupB.content;
  const judge = await callJudgeModel(modelConfig, task, answerOne, answerTwo);
  const mappedJudge = mapJudgeToGroups(task, judge.parsed);

  return {
    task,
    models: {
      answer_model: modelConfig.answerModel,
      judge_model: modelConfig.judgeModel,
      base_url: modelConfig.baseUrl,
    },
    answer_order: {
      answer_1: order[0],
      answer_2: order[1],
    },
    group_a: {
      memory_enabled: false,
      input: task.user_input,
      output: groupA.content,
      duration_ms: groupA.duration_ms,
      error: groupA.error,
    },
    group_b: {
      memory_enabled: true,
      input: task.user_input,
      output: groupB.content,
      duration_ms: groupB.duration_ms,
      error: groupB.error,
      prepare_context: prepareResponse,
      finalize_turn: finalizeResponse,
      runtime_injection: runtimeInjectionStats(prepareResponse),
      observe_runs: runs,
    },
    blind_judge: {
      raw_output: judge.content,
      duration_ms: judge.duration_ms,
      error: judge.error,
      parsed: judge.parsed,
      mapped: mappedJudge,
    },
  };
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (valid.length === 0) {
    return 0;
  }
  return Number((valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(4));
}

function summarize(results) {
  const judged = results.filter((result) => result.blind_judge.mapped);
  const bWins = judged.filter((result) => result.blind_judge.mapped.winner === "B").length;
  const aWins = judged.filter((result) => result.blind_judge.mapped.winner === "A").length;
  const ties = judged.filter((result) => result.blind_judge.mapped.winner === "tie").length;
  const expectedMemory = judged.filter((result) => result.task.expected.should_use_memory);
  const expectedNoMemory = judged.filter((result) => !result.task.expected.should_use_memory);

  return {
    generated_at: new Date().toISOString(),
    total: results.length,
    judged: judged.length,
    b_wins: bWins,
    a_wins: aWins,
    ties,
    b_win_rate: judged.length === 0 ? 0 : Number((bWins / judged.length).toFixed(4)),
    b_win_rate_excluding_ties: bWins + aWins === 0 ? 0 : Number((bWins / (bWins + aWins)).toFixed(4)),
    avg_task_success_a: average(judged.map((result) => result.blind_judge.mapped.A.task_success)),
    avg_task_success_b: average(judged.map((result) => result.blind_judge.mapped.B.task_success)),
    avg_memory_usefulness_b: average(judged.map((result) => result.blind_judge.mapped.B.memory_usefulness)),
    memory_misuse_rate_b:
      judged.length === 0
        ? 0
        : Number((judged.filter((result) => result.blind_judge.mapped.B.memory_misuse).length / judged.length).toFixed(4)),
    irrelevant_noise_rate_b:
      expectedNoMemory.length === 0
        ? 0
        : Number(
            (
              expectedNoMemory.filter((result) => result.blind_judge.mapped.B.irrelevant_memory_noise).length /
              expectedNoMemory.length
            ).toFixed(4),
          ),
    omission_rate_b:
      expectedMemory.length === 0
        ? 0
        : Number((expectedMemory.filter((result) => result.blind_judge.mapped.B.omission).length / expectedMemory.length).toFixed(4)),
    runtime_injection_rate:
      results.length === 0
        ? 0
        : Number(
            (
              results.filter((result) => result.group_b.runtime_injection?.injected_count > 0).length /
              results.length
            ).toFixed(4),
          ),
    avg_latency_a_ms: average(results.map((result) => result.group_a.duration_ms)),
    avg_latency_b_ms: average(results.map((result) => result.group_b.duration_ms)),
    writeback_candidate_rate:
      results.length === 0
        ? 0
        : Number(
            (
              results.filter((result) => (result.group_b.finalize_turn?.candidate_count ?? 0) > 0).length /
              results.length
            ).toFixed(4),
          ),
    by_scenario: summarizeByScenario(judged),
  };
}

function summarizeByScenario(results) {
  const grouped = new Map();
  for (const result of results) {
    const key = result.task.scenario;
    const current = grouped.get(key) ?? [];
    current.push(result);
    grouped.set(key, current);
  }

  return Array.from(grouped.entries()).map(([scenario, items]) => ({
    scenario,
    total: items.length,
    b_wins: items.filter((item) => item.blind_judge.mapped.winner === "B").length,
    a_wins: items.filter((item) => item.blind_judge.mapped.winner === "A").length,
    ties: items.filter((item) => item.blind_judge.mapped.winner === "tie").length,
    avg_task_success_a: average(items.map((item) => item.blind_judge.mapped.A.task_success)),
    avg_task_success_b: average(items.map((item) => item.blind_judge.mapped.B.task_success)),
    memory_misuse_rate_b: Number((items.filter((item) => item.blind_judge.mapped.B.memory_misuse).length / items.length).toFixed(4)),
    omission_rate_b: Number((items.filter((item) => item.blind_judge.mapped.B.omission).length / items.length).toFixed(4)),
  }));
}

async function runWithConcurrency(items, concurrency, handler) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await handler(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => worker()));
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tasks = TASKS.slice(args.offset, args.offset + args.limit);
  await mkdir(args.outputDir, { recursive: true });

  console.log(`[real-user-experience] tasks=${tasks.length} output=${args.outputDir}`);

  if (args.seed) {
    console.log("[real-user-experience] seeding memories...");
    const jobIds = await seedMemories(args, tasks);
    console.log(`[real-user-experience] seed jobs=${jobIds.length}`);
  }

  if (args.seedOnly) {
    return;
  }

  const modelConfig = envConfig();
  console.log(`[real-user-experience] answer_model=${modelConfig.answerModel} judge_model=${modelConfig.judgeModel}`);

  const results = await runWithConcurrency(tasks, args.concurrency, async (task, index) => {
    console.log(`[real-user-experience] running ${index + 1}/${tasks.length} ${task.id} ${task.scenario}`);
    return runTask(args, modelConfig, task);
  });

  const summary = summarize(results);
  const resultPath = path.join(args.outputDir, "ab-results.json");
  const resultJsonlPath = path.join(args.outputDir, "ab-results.jsonl");
  const summaryPath = path.join(args.outputDir, "summary.json");

  await writeFile(resultPath, JSON.stringify({ summary, results }, null, 2), "utf8");
  await writeFile(resultJsonlPath, `${results.map((result) => JSON.stringify(result)).join("\n")}\n`, "utf8");
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");

  console.log(`[real-user-experience] summary: ${summaryPath}`);
  console.log(
    `[real-user-experience] B wins=${summary.b_wins}/${summary.judged}, A wins=${summary.a_wins}, ties=${summary.ties}, B win rate=${summary.b_win_rate}`,
  );
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
