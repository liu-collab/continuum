#!/usr/bin/env node

/**
 * 真实 Claude Code 客户端 E2E 验收脚本
 *
 * 做的事情：
 * 1. 启动一个轻量 HTTP 录制服务器（recording proxy），记录所有进入的请求
 * 2. 创建临时目录，配置 .claude/settings.local.json hooks 指向 memory-bridge.mjs
 * 3. 设置 MEMORY_RUNTIME_BASE_URL 指向录制服务器
 * 4. 用 `claude -p` 触发一次真实 Claude Code 会话
 * 5. 验证录制服务器收到了来自 bridge 的 HTTP 请求
 *
 * 前提：
 * - 本机已安装 claude CLI（claude -p 可用）
 * - Claude API 可用（非 402 / 非网络问题）
 *
 * 用法：
 *   cd services/retrieval-runtime
 *   node tests/e2e/real-claude-client.e2e.mjs
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";

// ---------------------------------------------------------------------------
// 1. 检查 claude CLI 是否可用
// ---------------------------------------------------------------------------

function checkClaudeCli() {
  return new Promise((resolve) => {
    const child = spawn(
      process.platform === "win32" ? "claude.cmd" : "claude",
      ["--version"],
      {
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
        timeout: 10_000,
      },
    );
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
// 2. 启动 HTTP 录制服务器
//    接收所有 POST 请求，记录路径和 body，返回合法的空响应
// ---------------------------------------------------------------------------

function startRecordingServer() {
  const records = [];

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      let parsed = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        /* ignore */
      }

      records.push({
        method: req.method,
        url: req.url,
        body: parsed,
        timestamp: new Date().toISOString(),
      });

      // 根据路径返回合法的空响应
      res.setHeader("content-type", "application/json");

      if (req.url?.includes("session-start-context")) {
        res.end(
          JSON.stringify({
            additional_context: "E2E recording server: session started",
            trace_id: "recording-trace-001",
            dependency_status: {},
          }),
        );
      } else if (req.url?.includes("prepare-context")) {
        res.end(
          JSON.stringify({
            trigger: true,
            trigger_reason: "e2e_recording",
            trace_id: "recording-trace-002",
            injection_block: {
              injection_reason: "E2E 录制服务器",
              memory_summary: "这是来自录制服务器的记忆注入",
            },
            memory_packet_ids: [],
          }),
        );
      } else if (req.url?.includes("finalize-turn")) {
        res.end(
          JSON.stringify({
            trace_id: "recording-trace-003",
            writeback_submitted: false,
            candidate_count: 0,
            write_back_candidates: [],
          }),
        );
      } else if (req.url?.includes("healthz")) {
        res.end(JSON.stringify({ version: "recording", liveness: "ok" }));
      } else {
        res.end(JSON.stringify({ ok: true }));
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({ server, records, baseUrl, port });
    });
  });
}

// ---------------------------------------------------------------------------
// 3. 创建临时工作目录 + hooks 配置
// ---------------------------------------------------------------------------

function createTempWorkspace(runtimeBaseUrl) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-real-e2e-"));
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

  // 写一个空 CLAUDE.md 让 Claude Code 识别为项目
  fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# E2E Test Project\n");

  return {
    tmpDir,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// 4. 触发真实 Claude Code 会话
// ---------------------------------------------------------------------------

function runClaudeSession(tmpDir, runtimeBaseUrl) {
  return new Promise((resolve) => {
    const child = spawn(
      process.platform === "win32" ? "claude.cmd" : "claude",
      ["-p", "say hello", "--output-format", "json"],
      {
        cwd: tmpDir,
        env: {
          ...process.env,
          MEMORY_RUNTIME_BASE_URL: runtimeBaseUrl,
          MEMORY_USER_ID: "550e8400-e29b-41d4-a716-446655440001",
          MEMORY_WORKSPACE_ID: "550e8400-e29b-41d4-a716-446655440000",
          MEMORY_SESSION_ID: "550e8400-e29b-41d4-a716-446655440099",
        },
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
        timeout: 60_000,
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
      resolve({ exitCode: 1, stdout, stderr: stderr + "\n" + err.message });
    });
    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
  });
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== 真实 Claude Code 客户端 E2E 验收 ===\n");

  // 检查 claude CLI
  const version = await checkClaudeCli();
  if (!version) {
    console.error("✗ claude CLI 未安装或不可用");
    process.exitCode = 1;
    return;
  }
  console.log("✓ Claude Code CLI:", version);

  // 启动录制服务器
  const { server, records, baseUrl } = await startRecordingServer();
  console.log("✓ 录制服务器监听:", baseUrl);

  // 创建临时工作目录
  const { tmpDir, cleanup } = createTempWorkspace(baseUrl);
  console.log("✓ 临时工作目录:", tmpDir);

  try {
    // 触发真实 Claude Code 会话
    console.log('\n  正在执行 claude -p "say hello" ...');
    console.log(
      "  （这会触发真实 SessionStart → UserPromptSubmit → Stop hooks）\n",
    );

    const result = await runClaudeSession(tmpDir, baseUrl);
    console.log("  claude 退出码:", result.exitCode);

    // 尝试解析输出
    let claudeOutput = null;
    try {
      claudeOutput = JSON.parse(result.stdout);
    } catch {
      // 非 JSON 输出
    }

    if (claudeOutput) {
      console.log("  session_id:", claudeOutput.session_id);
      console.log("  num_turns:", claudeOutput.num_turns);
      const apiError = claudeOutput.api_error_status;
      if (apiError) {
        console.warn(`  ⚠ API 返回 ${apiError}（配额/网络问题）`);
      }
    } else if (result.stdout) {
      console.log("  stdout (截取):", result.stdout.slice(0, 200));
    }

    // 分析录制的请求
    console.log("\n  录制服务器收到的请求:");
    console.log("  总计:", records.length, "个请求");

    const sessionStarts = records.filter((r) =>
      r.url?.includes("session-start"),
    );
    const prepareContexts = records.filter((r) =>
      r.url?.includes("prepare-context"),
    );
    const finalizeTurns = records.filter((r) =>
      r.url?.includes("finalize-turn"),
    );

    console.log(`  - session-start-context: ${sessionStarts.length} 个`);
    console.log(`  - prepare-context:       ${prepareContexts.length} 个`);
    console.log(`  - finalize-turn:         ${finalizeTurns.length} 个`);

    if (sessionStarts.length > 0) {
      console.log("\n  session-start 请求 body:");
      console.log(
        "   ",
        JSON.stringify(sessionStarts[0].body, null, 2)
          .split("\n")
          .join("\n    "),
      );
    }

    // 判断结果
    const hooksFired = sessionStarts.length > 0;

    if (hooksFired) {
      console.log(
        "\n✓ 真实 Claude Code 客户端成功触发了 hook 并发送请求到 runtime！",
      );

      // 验证请求包含预期字段
      const body = sessionStarts[0].body;
      if (body?.host === "claude_code_plugin") {
        console.log("✓ host 字段正确: claude_code_plugin");
      }
      if (body?.workspace_id && body?.user_id && body?.session_id) {
        console.log("✓ identity 字段齐全: workspace_id, user_id, session_id");
      }
    } else {
      console.warn("\n⚠ 录制服务器未收到 hook 请求。");
      console.warn("  可能原因：");
      console.warn("  - Claude API 不可用（402/403），会话未完整启动");
      console.warn(
        "  - hooks 配置未被 Claude Code 在 .claude/settings.local.json 中加载",
      );
      console.warn("  - bridge 脚本路径不正确");

      if (claudeOutput?.api_error_status) {
        console.log(
          `\n  ⚠ API 错误 ${claudeOutput.api_error_status}，非 hook 链路问题`,
        );
        console.log("  当 API 恢复后重新运行此脚本即可验证完整链路");
      } else {
        console.error("✗ 验收失败");
        process.exitCode = 1;
      }
    }
  } finally {
    server.close();
    cleanup();
  }

  console.log("\n=== 验收结束 ===");
}

void main().catch((error) => {
  console.error("验收脚本异常:", error);
  process.exitCode = 1;
});
