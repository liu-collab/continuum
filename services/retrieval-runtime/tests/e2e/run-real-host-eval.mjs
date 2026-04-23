#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const outputDir = path.resolve("docs", "host-real-eval");
const clientOutputDir = "docs/host-real-eval";
const clientWorkerPath = "tests/e2e/host-real-eval-worker.mjs";

function commandFor(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
      timeout: options.timeoutMs,
    });

    if (options.stdin) {
      child.stdin.write(options.stdin);
    }
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
      resolve({ exitCode: 1, stdout, stderr: `${stderr}\n${error.message}` });
    });
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

async function checkCli(name) {
  const result = await runProcess(commandFor(name), ["--version"], {
    timeoutMs: 15_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(`${name} CLI is unavailable: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function extractJsonObject(text) {
  const trimmed = text.trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first < 0 || last < first) {
    throw new Error(`no JSON object found in client output: ${trimmed.slice(0, 500)}`);
  }
  return JSON.parse(trimmed.slice(first, last + 1));
}

async function runClaudeEval() {
  const version = await checkCli("claude");
  const command = `node ${clientWorkerPath} --host claude_code --output-dir ${clientOutputDir} --timeout-ms 45000 --concurrency 2`;
  const prompt = [
    "你必须通过真实本地命令运行 memory orchestrator 真实模型评测。",
    "不要模拟结果，不要手写指标。",
    "必须使用 Bash 工具执行下面这个命令，Bash timeout 设置为 1200000 毫秒。",
    "等待命令完成，然后原样输出命令 stdout 中的 JSON：",
    command,
  ].join("\n");

  const result = await runProcess(
    commandFor("claude"),
    [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "bypassPermissions",
      "--tools",
      "Bash",
    ],
    {
      env: {
        ...process.env,
        HOST_REAL_EVAL_CLIENT: "claude_code",
      },
      timeoutMs: 1_200_000,
    },
  );

  if (result.exitCode !== 0) {
    throw new Error(`Claude Code eval failed: ${result.stderr || result.stdout}`);
  }
  const events = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const usedBash = events.some((event) =>
    event?.message?.content?.some?.((item) => item?.type === "tool_use" && item?.name === "Bash"),
  );
  if (!usedBash) {
    throw new Error("Claude Code did not execute the eval through the Bash tool");
  }
  const resultEvent = events.find((event) => event?.type === "result");
  const payload = extractJsonObject(resultEvent?.result ?? result.stdout);
  return {
    host: "claude_code",
    version,
    payload,
    raw_stdout_tail: result.stdout.slice(-1000),
    stderr_tail: result.stderr.slice(-1000),
  };
}

async function runCodexEval() {
  const version = await checkCli("codex");
  const command = `node ${clientWorkerPath} --host codex --output-dir ${clientOutputDir} --timeout-ms 45000 --concurrency 2`;
  const prompt = [
    "You must run a real local command for the memory orchestrator model eval.",
    "Do not simulate results. Do not write metrics by hand.",
    "Run exactly this command and return the JSON printed by stdout:",
    command,
  ].join("\n");

  const result = await runProcess(
    commandFor("codex"),
    [
      "exec",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "--json",
      "-",
    ],
    {
      stdin: prompt,
      env: {
        ...process.env,
        HOST_REAL_EVAL_CLIENT: "codex",
      },
      timeoutMs: 1_200_000,
    },
  );

  if (result.exitCode !== 0) {
    throw new Error(`Codex eval failed: ${result.stderr || result.stdout}`);
  }

  const lines = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const messages = lines
    .map((event) => event?.item?.text ?? event?.message?.content ?? event?.text)
    .filter((value) => typeof value === "string");
  const payload = extractJsonObject(messages.join("\n") || result.stdout);
  return {
    host: "codex",
    version,
    payload,
    raw_stdout_tail: result.stdout.slice(-1000),
    stderr_tail: result.stderr.slice(-1000),
  };
}

async function readMetrics(host) {
  const metricsPath = path.join(outputDir, `${host}-metrics.json`);
  return JSON.parse(await readFile(metricsPath, "utf8"));
}

async function main() {
  await mkdir(outputDir, { recursive: true });

  const claude = await runClaudeEval();
  const codex = await runCodexEval();
  const claudeMetrics = await readMetrics("claude_code");
  const codexMetrics = await readMetrics("codex");
  const combined = {
    generated_at: new Date().toISOString(),
    output_dir: outputDir,
    clients: {
      claude_code: {
        version: claude.version,
        payload: claude.payload,
        metrics: claudeMetrics,
      },
      codex: {
        version: codex.version,
        payload: codex.payload,
        metrics: codexMetrics,
      },
    },
  };
  const combinedPath = path.join(outputDir, "host-real-eval-summary.json");
  await writeFile(combinedPath, JSON.stringify(combined, null, 2), "utf8");
  process.stdout.write(JSON.stringify({ ok: true, combined_path: combinedPath, combined }, null, 2));
  process.stdout.write("\n");
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
