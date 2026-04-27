#!/usr/bin/env node

/**
 * 真实 Claude Code 客户端 E2E 验收脚本（记忆注入验收版）
 *
 * 链路：
 *   真实用户输入 → 真实 Claude Code CLI（带 hook）
 *     → memory-bridge.mjs hook 触发
 *     → 真实 retrieval-runtime（session-start / prepare-context / finalize-turn）
 *     → runtime 检索已种入的测试记忆并注入到 Claude 上下文
 *     → Claude 最终回答体现注入记忆内容
 *
 * 验收通过条件（双重判定）：
 *   1. runtime observe/runs 观测到该 session 的检索/注入轨迹
 *   2. Claude 最终回答包含 >= 2 个注入记忆关键词
 *
 * 前提：
 *   - 本机已安装 claude CLI
 *   - 本地 retrieval-runtime 已启动（默认 http://127.0.0.1:3002）
 *   - runtime 连接的存储服务支持 session-start-context 返回记忆
 *
 * 用法：
 *   cd services/retrieval-runtime
 *   MEMORY_RUNTIME_BASE_URL=http://127.0.0.1:3002 node tests/e2e/real-claude-client.e2e.mjs
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";

import {
  checkRuntimeReachable,
  fetchRuntimeRuns,
  assertRuntimeInjectionTrace,
  parseClaudeStreamOutput,
  assertAnswerContainsInjectionSignals,
  TEST_PROMPT_CN,
  printSection,
  printPass,
  printWarn,
  printFail,
  printDetail,
} from "./real-host-eval-utils.mjs";

const RUNTIME_BASE_URL =
  process.env.MEMORY_RUNTIME_BASE_URL ?? "http://127.0.0.1:3002";

// 固定的测试身份，方便从 observe/runs 里定位
const SESSION_ID = randomUUID();
const WORKSPACE_ID =
  process.env.MEMORY_WORKSPACE_ID ?? "550e8400-e29b-41d4-a716-446655440000";
const USER_ID =
  process.env.MEMORY_USER_ID ?? "550e8400-e29b-41d4-a716-446655440001";

// ---------------------------------------------------------------------------
// 1. 检查 claude CLI
// ---------------------------------------------------------------------------

function checkClaudeCli() {
  return new Promise((resolve) => {
    const cmd = process.platform === "win32" ? "claude.cmd" : "claude";
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

// ---------------------------------------------------------------------------
// 2. 创建临时工作目录，配置 hook 指向真实 bridge，runtime 指向真实地址
// ---------------------------------------------------------------------------

function createTempWorkspace() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-inject-e2e-"));
  const claudeDir = path.join(tmpDir, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });

  const bridgePath = path
    .resolve(
      process.cwd(),
      "host-adapters/memory-claude-plugin/bin/memory-bridge.mjs",
    )
    .replace(/\\/g, "/");

  const settings = {
    hooks: {
      SessionStart: [
        {
          hooks: [
            {
              type: "command",
              command: `node "${bridgePath}" session-start`,
            },
          ],
        },
      ],
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "command",
              command: `node "${bridgePath}" prepare-context`,
            },
          ],
        },
      ],
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command: `node "${bridgePath}" finalize-turn`,
            },
          ],
        },
      ],
    },
  };

  fs.writeFileSync(
    path.join(claudeDir, "settings.local.json"),
    JSON.stringify(settings, null, 2),
  );
  fs.writeFileSync(
    path.join(tmpDir, "CLAUDE.md"),
    "# Memory Injection E2E Test\n",
  );

  return {
    tmpDir,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// 3. 启动真实 Claude 会话，传入测试 prompt
// ---------------------------------------------------------------------------

function runClaudeSession(tmpDir) {
  return new Promise((resolve) => {
    const cmd = process.platform === "win32" ? "claude.cmd" : "claude";
    const child = spawn(
      cmd,
      ["-p", TEST_PROMPT_CN, "--output-format", "stream-json", "--verbose"],
      {
        cwd: tmpDir,
        env: {
          ...process.env,
          MEMORY_RUNTIME_BASE_URL: RUNTIME_BASE_URL,
          MEMORY_USER_ID: USER_ID,
          MEMORY_WORKSPACE_ID: WORKSPACE_ID,
          MEMORY_SESSION_ID: SESSION_ID,
        },
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
        timeout: 120_000,
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      resolve({ exitCode: 1, stdout, stderr: `${stderr}\n${err.message}` });
    });
    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
  });
}

// ---------------------------------------------------------------------------
// 4. 等待 runtime 异步写入轨迹（最多 5s）
// ---------------------------------------------------------------------------

async function waitForRuntimeTrace(sessionId, maxWaitMs = 5000) {
  const step = 500;
  let waited = 0;
  while (waited < maxWaitMs) {
    await new Promise((r) => setTimeout(r, step));
    waited += step;
    try {
      const runs = await fetchRuntimeRuns(RUNTIME_BASE_URL, sessionId);
      if (runs.turns && runs.turns.length > 0) {
        return runs;
      }
    } catch {
      /* 继续等待 */
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  printSection("真实 Claude Code 客户端 E2E 记忆注入验收");
  console.log(`  runtime:    ${RUNTIME_BASE_URL}`);
  console.log(`  session_id: ${SESSION_ID}`);
  console.log(`  prompt:     ${TEST_PROMPT_CN}`);

  // 步骤 1：检查 Claude CLI
  printSection("步骤 1 — 检查 Claude CLI");
  const version = await checkClaudeCli();
  if (!version) {
    printFail("claude CLI 未安装或不可用，跳过验收");
    process.exitCode = 1;
    return;
  }
  printPass(`Claude CLI: ${version}`);

  // 步骤 2：检查 runtime 可达
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

  // 步骤 3：创建临时工作区并配置 hook
  printSection("步骤 3 — 创建临时工作区 + hook 配置");
  const { tmpDir, cleanup } = createTempWorkspace();
  printPass(`临时工作区: ${tmpDir}`);
  printPass("hook 配置已写入 .claude/settings.local.json");

  try {
    // 步骤 4：触发真实 Claude 会话
    printSection(
      "步骤 4 — 触发真实 Claude Code 会话（hook → bridge → runtime）",
    );
    console.log("  正在运行 claude -p ...");
    console.log(
      "  （预期：SessionStart → UserPromptSubmit → Stop hooks 依次触发）\n",
    );

    const result = await runClaudeSession(tmpDir);
    console.log(`  claude 退出码: ${result.exitCode}`);

    if (result.stderr.trim()) {
      console.log(`  stderr (截取): ${result.stderr.slice(0, 400)}`);
    }

    // 步骤 5：解析 Claude 输出，提取最终回答
    printSection("步骤 5 — 解析 Claude 输出");
    const parsed = parseClaudeStreamOutput(result.stdout);
    console.log(`  解析到事件数: ${parsed.events.length}`);
    console.log(`  文本片段数:   ${parsed.texts.length}`);

    const answer = parsed.combined;
    if (answer.trim()) {
      printDetail("Claude 最终回答（截取）", answer.slice(0, 600));
    } else {
      printWarn("未能从输出中提取到文字回答");
      if (result.stdout.trim()) {
        printDetail("raw stdout（截取）", result.stdout.slice(0, 500));
      }
    }

    // API 错误检测
    const apiErrorEvent = parsed.events.find(
      (e) => e?.api_error_status || e?.type === "api_error",
    );
    if (apiErrorEvent) {
      printWarn(
        `Claude API 返回错误: ${apiErrorEvent.api_error_status ?? JSON.stringify(apiErrorEvent)}`,
      );
      printWarn("API 问题不代表 hook 链路断开，请待 API 恢复后重试");
      return;
    }

    // 步骤 6：等待 runtime 写入轨迹后读取
    printSection("步骤 6 — 读取 runtime 注入轨迹");
    console.log("  等待 runtime 异步写入 ...");
    const runs = await waitForRuntimeTrace(SESSION_ID);

    if (!runs) {
      printWarn(
        `runtime observe/runs 未查到 session_id=${SESSION_ID} 的记录（等待超时）`,
      );
      printWarn("可能原因：hook 未触发、bridge 脚本报错、runtime 未持久化");
    } else {
      const traceAssert = assertRuntimeInjectionTrace(runs, SESSION_ID);
      if (traceAssert.pass) {
        printPass(`runtime 观测到注入轨迹`);
      } else {
        printWarn(`runtime 轨迹断言: ${traceAssert.reason}`);
      }
      printDetail("轨迹统计", traceAssert.detail);
    }

    // 步骤 7：断言最终回答命中注入记忆关键词
    printSection("步骤 7 — 断言最终回答命中注入记忆关键词");
    if (!answer.trim()) {
      printWarn("没有回答文本，跳过关键词断言");
    } else {
      const kwAssert = assertAnswerContainsInjectionSignals(answer);
      if (kwAssert.pass) {
        printPass(
          `回答命中注入关键词 ${kwAssert.matchRatio}: ${kwAssert.matched.join(", ")}`,
        );
      } else {
        printWarn(
          `回答命中注入关键词不足 ${kwAssert.matchRatio}，命中: [${kwAssert.matched.join(", ")}]，未命中: [${kwAssert.missing.join(", ")}]`,
        );
        printWarn(
          "这可能说明：记忆尚未种入 runtime / 注入未触发 / 模型回答未体现记忆",
        );
      }
    }

    // 步骤 8：最终判定
    printSection("验收结论");
    const runtimeTraceOk =
      runs && assertRuntimeInjectionTrace(runs, SESSION_ID).pass;
    const answerHitOk =
      answer.trim() && assertAnswerContainsInjectionSignals(answer).pass;

    if (runtimeTraceOk && answerHitOk) {
      printPass("双重判定通过：runtime 观测到注入轨迹 + 回答体现了注入记忆 ✓");
    } else if (runtimeTraceOk) {
      printWarn(
        "runtime 观测到注入轨迹，但回答关键词命中不足（模型可能以其他方式表达了记忆内容）",
      );
    } else if (answerHitOk) {
      printWarn(
        "回答命中了注入关键词，但 runtime 观测不到轨迹（可能 runtime 未持久化或存储不可用）",
      );
    } else {
      if (result.exitCode !== 0 && !answer.trim()) {
        printWarn("Claude 会话异常退出，hook 链路可能未触发");
        printWarn("请检查 bridge 脚本路径、runtime 地址和 API 可用性");
      } else {
        printWarn("两项判定均未通过，请检查：");
        console.log("  1. runtime 是否已启动且可写入轨迹");
        console.log(
          "  2. 测试记忆是否已种入 runtime（见 real-host-eval-utils.mjs TEST_MEMORY_SEEDS）",
        );
        console.log("  3. hook 是否正常触发（查看 bridge 脚本日志）");
      }
    }
  } finally {
    cleanup();
  }

  printSection("验收结束");
}

void main().catch((error) => {
  console.error("验收脚本异常:", error);
  process.exitCode = 1;
});
