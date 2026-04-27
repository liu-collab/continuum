#!/usr/bin/env node

/**
 * 真实 Codex 客户端 E2E 验收脚本（平台强制注入版）
 *
 * 链路：
 *   平台先调用 retrieval-runtime prepare-context
 *     → 记录平台侧 memory_delivery 事实
 *     → 将长期记忆上下文和用户输入一起传给真实 Codex CLI
 *     → 查询 observe/runs，确认 runtime 侧检索/注入轨迹
 *
 * 验收通过条件：
 *   1. 平台侧确认已把强制注入上下文写入 Codex 输入
 *   2. runtime observe/runs 观测到该 session 的检索/注入轨迹
 *
 * 注意：这里不再要求 Codex 主动调用 memory_search，也不依赖 Codex 最终回答来证明它收到了记忆。
 */

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import process from "node:process";

import {
  checkRuntimeReachable,
  fetchRuntimeRuns,
  assertRuntimeInjectionTrace,
  parseCodexJsonOutput,
  TEST_PROMPT_CN,
  printSection,
  printPass,
  printWarn,
  printFail,
  printDetail,
} from "./real-host-eval-utils.mjs";

const RUNTIME_BASE_URL =
  process.env.MEMORY_RUNTIME_BASE_URL ?? "http://127.0.0.1:3002";
const SESSION_ID = randomUUID();
const WORKSPACE_ID =
  process.env.MEMORY_WORKSPACE_ID ?? "550e8400-e29b-41d4-a716-446655440000";
const USER_ID =
  process.env.MEMORY_USER_ID ?? "550e8400-e29b-41d4-a716-446655440001";
const MEMORY_MODE = process.env.MEMORY_MODE ?? "workspace_plus_global";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function checkCodexCli() {
  return new Promise((resolve) => {
    const cmd = process.platform === "win32" ? "codex.cmd" : "codex";
    const child = spawn(cmd, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      timeout: 10_000,
    });

    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      resolve(code === 0 ? stdout.trim() : null);
    });
  });
}

async function runtimePost(pathName, body) {
  const response = await fetch(new URL(pathName, RUNTIME_BASE_URL), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }

  if (!response.ok) {
    throw new Error(
      `runtime ${pathName} returned ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`,
    );
  }

  return payload;
}

async function prepareCodexMemoryContext() {
  return runtimePost("/v1/runtime/prepare-context", {
    host: "codex_app_server",
    workspace_id: WORKSPACE_ID,
    user_id: USER_ID,
    session_id: SESSION_ID,
    phase: "before_response",
    current_input: TEST_PROMPT_CN,
    memory_mode: MEMORY_MODE,
  });
}

function injectionRecordIds(result) {
  const records = result?.injection_block?.memory_records;
  if (!Array.isArray(records)) {
    return [];
  }
  return records.map((record) => record?.id).filter((id) => typeof id === "string");
}

function buildCodexPreparedMemoryBlock(result) {
  if (!result || typeof result !== "object" || !result.trigger) {
    return "【长期记忆】无相关历史记忆，请直接回答。";
  }

  const injection = result.injection_block;
  if (
    injection &&
    Array.isArray(injection.memory_records) &&
    injection.memory_records.length > 0
  ) {
    const lines = [
      "【长期记忆】以下信息仅在与当前问题直接相关时使用，请优先转化为答案中的约束、默认值或步骤，不要逐条转述：",
    ];
    if (injection.injection_reason) {
      lines.push(`命中原因：${injection.injection_reason}`);
    }
    if (injection.memory_summary) {
      lines.push(`可直接采用的上下文：${injection.memory_summary}`);
    }
    lines.push("可用事实：");
    for (const record of injection.memory_records) {
      const scope = record.scope ?? "";
      const type = record.memory_type ?? record.type ?? "";
      const summary = record.summary ?? record.content ?? JSON.stringify(record);
      lines.push(`- 记忆[${type}${scope ? "/" + scope : ""}]：${summary}`);
    }
    lines.push(
      "使用要求：如果这些记忆能帮助回答，就直接体现在最终答案里；不要单独开一段复述记忆，也不要说你看到了记忆。",
    );
    return lines.join("\n");
  }

  return "【长期记忆】无相关历史记忆，请直接回答。";
}

function buildCodexForcedPrompt(prepareResult) {
  return [
    "你会先收到一段已经准备好的长期记忆上下文。",
    "回答时优先使用这段已提供的上下文来判断是否存在相关历史信息。",
    "只有当上下文给出可用事实时，才将其中对当前问题直接有用的信息自然融入回答。",
    "不要解释长期记忆上下文的来源，不要输出 MCP、tool、memory_search 等排查信息。",
    "最终只保留对用户有用的答案内容。",
    "",
    buildCodexPreparedMemoryBlock(prepareResult),
    "",
    "用户问题：",
    TEST_PROMPT_CN,
  ].join("\n");
}

function buildMemoryDeliveryFact(prepareResult, promptText) {
  const recordIds = injectionRecordIds(prepareResult);
  return {
    method: "platform_prepare_context_stdin",
    attempted: true,
    prepared: true,
    host_context_delivered: Boolean(promptText),
    memory_delivered: recordIds.length > 0,
    trace_id: typeof prepareResult?.trace_id === "string" ? prepareResult.trace_id : null,
    trigger: Boolean(prepareResult?.trigger),
    trigger_reason:
      typeof prepareResult?.trigger_reason === "string"
        ? prepareResult.trigger_reason
        : null,
    injected_count: recordIds.length,
    record_ids: recordIds,
    memory_packet_ids: Array.isArray(prepareResult?.memory_packet_ids)
      ? prepareResult.memory_packet_ids
      : [],
    content_chars: promptText.length,
    content_sha256: createHash("sha256").update(promptText).digest("hex"),
  };
}

function runCodexExec(prompt) {
  return new Promise((resolve) => {
    const cmd = process.platform === "win32" ? "codex.cmd" : "codex";
    const args = [
      "exec",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "--json",
      "-",
    ];

    const child = spawn(cmd, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MEMORY_RUNTIME_BASE_URL: RUNTIME_BASE_URL,
        MEMORY_WORKSPACE_ID: WORKSPACE_ID,
        MEMORY_USER_ID: USER_ID,
        MEMORY_SESSION_ID: SESSION_ID,
        MEMORY_MODE,
      },
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
      timeout: 120_000,
    });

    child.stdin.write(prompt);
    child.stdin.end();

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve({
        exitCode: 1,
        stdout,
        stderr: `${stderr}\n${error.message}`,
      });
    });
    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
  });
}

async function waitForRuntimeTrace(sessionId, maxWaitMs = 5000) {
  const step = 500;
  let waited = 0;
  while (waited < maxWaitMs) {
    await delay(step);
    waited += step;
    try {
      const runs = await fetchRuntimeRuns(RUNTIME_BASE_URL, sessionId);
      if (runs.turns && runs.turns.length > 0) {
        return runs;
      }
    } catch {
      /* continue waiting */
    }
  }
  return null;
}

async function main() {
  printSection("真实 Codex 客户端 E2E 平台强制注入验收");
  console.log(`  runtime:    ${RUNTIME_BASE_URL}`);
  console.log(`  session_id: ${SESSION_ID}`);
  console.log(`  prompt:     ${TEST_PROMPT_CN}`);

  printSection("步骤 1 — 检查 Codex CLI");
  const version = await checkCodexCli();
  if (!version) {
    printFail("codex CLI 未安装或不可用，跳过验收");
    process.exitCode = 1;
    return;
  }
  printPass(`Codex CLI: ${version}`);

  printSection("步骤 2 — 检查 retrieval-runtime 可达性");
  const runtimeOk = await checkRuntimeReachable(RUNTIME_BASE_URL);
  if (!runtimeOk) {
    printFail(
      `retrieval-runtime 不可达（${RUNTIME_BASE_URL}）\n  请先启动 runtime 再运行此脚本`,
    );
    process.exitCode = 1;
    return;
  }
  printPass(`runtime 可达: ${RUNTIME_BASE_URL}`);

  printSection("步骤 3 — 平台侧准备并强制注入记忆上下文");
  let prepareResult;
  let forcedPrompt;
  let memoryDelivery;
  try {
    prepareResult = await prepareCodexMemoryContext();
    forcedPrompt = buildCodexForcedPrompt(prepareResult);
    memoryDelivery = buildMemoryDeliveryFact(prepareResult, forcedPrompt);
    printPass("平台已生成 Codex 强制注入上下文");
    printDetail("memory_delivery", memoryDelivery);
  } catch (error) {
    printFail(`prepare-context 失败: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  printSection("步骤 4 — 运行真实 Codex 会话");
  const result = await runCodexExec(forcedPrompt);
  console.log(`  codex 退出码: ${result.exitCode}`);
  if (result.stderr.trim()) {
    console.log(`  stderr (截取): ${result.stderr.slice(0, 400)}`);
  }

  printSection("步骤 5 — 解析 Codex 输出（仅用于调试，不作为注入送达证明）");
  const parsed = parseCodexJsonOutput(result.stdout);
  console.log(`  解析到事件数: ${parsed.events.length}`);
  console.log(`  文本片段数:   ${parsed.texts.length}`);
  console.log(`  MCP 调用数:   ${parsed.mcpCalls.length}`);
  const answer = parsed.combined;
  if (answer.trim()) {
    printDetail("Codex 最终回答（截取）", answer.slice(0, 600));
  } else if (result.stdout.trim()) {
    printDetail("raw stdout（截取）", result.stdout.slice(0, 500));
  }

  printSection("步骤 6 — 读取 runtime 注入轨迹");
  const runs = await waitForRuntimeTrace(SESSION_ID);
  let runtimeTraceOk = false;
  if (!runs) {
    printWarn(
      `runtime observe/runs 未查到 session_id=${SESSION_ID} 的记录（等待超时）`,
    );
  } else {
    const traceAssert = assertRuntimeInjectionTrace(runs, SESSION_ID);
    runtimeTraceOk = traceAssert.pass;
    if (traceAssert.pass) {
      printPass("runtime 观测到检索/注入轨迹");
    } else {
      printWarn(`runtime 轨迹断言: ${traceAssert.reason}`);
    }
    printDetail("轨迹统计", traceAssert.detail);
  }

  printSection("验收结论");
  const platformDeliveryOk =
    memoryDelivery.host_context_delivered && memoryDelivery.memory_delivered;
  if (platformDeliveryOk && runtimeTraceOk) {
    printPass("通过：平台侧已强制交付记忆上下文 + runtime 观测到注入轨迹");
  } else {
    if (!memoryDelivery.host_context_delivered) {
      printWarn("平台侧未确认注入上下文交付");
    }
    if (!memoryDelivery.memory_delivered) {
      printWarn("平台侧未确认交付了具体记忆记录");
    }
    if (!runtimeTraceOk) {
      printWarn("runtime 未观测到完整检索/注入轨迹");
    }
    process.exitCode = 1;
  }

  printSection("验收结束");
}

void main().catch((error) => {
  console.error("验收脚本异常:", error);
  process.exitCode = 1;
});
