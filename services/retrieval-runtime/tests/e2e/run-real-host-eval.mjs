#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const outputDir = path.resolve("docs", "host-real-eval");
const clientOutputDir = "docs/host-real-eval";
const clientWorkerPath = "tests/e2e/host-real-eval-worker.mjs";

function commandFor(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function localNodeCli(name) {
  if (process.platform !== "win32") {
    return null;
  }

  const nodeRoot = path.dirname(process.execPath);
  const scriptByClient = {
    claude: path.join(nodeRoot, "node_modules", "@anthropic-ai", "claude-code", "cli.js"),
    codex: path.join(nodeRoot, "node_modules", "@openai", "codex", "bin", "codex.js"),
  };
  const script = scriptByClient[name];
  if (!script || !existsSync(script)) {
    return null;
  }
  return {
    command: process.execPath,
    argsPrefix: [script],
    shell: false,
  };
}

function clientCommandFor(name) {
  return localNodeCli(name) ?? {
    command: commandFor(name),
    argsPrefix: [],
    shell: process.platform === "win32",
  };
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: options.shell ?? process.platform === "win32",
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
  const cli = clientCommandFor(name);
  const result = await runProcess(cli.command, [...cli.argsPrefix, "--version"], {
    shell: cli.shell,
    timeoutMs: 15_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(`${name} CLI is unavailable: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function parseJsonLines(output) {
  return output
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
}

function extractJsonObjects(text) {
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (start >= 0) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = !inString;
        continue;
      }
      if (inString) {
        continue;
      }
    }

    if (char === "{") {
      if (depth === 0) {
        start = index;
        inString = false;
        escaped = false;
      }
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const candidate = text.slice(start, index + 1);
        try {
          objects.push(JSON.parse(candidate));
        } catch {
          /* keep scanning; client streams can include non-JSON braces */
        }
        start = -1;
        inString = false;
        escaped = false;
      }
    }
  }

  return objects;
}

function extractJsonObject(text) {
  const objects = extractJsonObjects(text);
  if (objects.length === 0) {
    throw new Error(`no JSON object found in client output: ${text.trim().slice(0, 500)}`);
  }
  return objects[objects.length - 1];
}

function contentItems(event) {
  const content = event?.message?.content ?? event?.item?.content ?? event?.content;
  if (Array.isArray(content)) {
    return content;
  }
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return [];
}

function textFromContentItem(item) {
  if (typeof item === "string") {
    return item;
  }
  if (typeof item?.content === "string") {
    return item.content;
  }
  if (typeof item?.text === "string") {
    return item.text;
  }
  return null;
}

function isHostEvalPayload(value, host) {
  return (
    value &&
    typeof value === "object" &&
    value.ok === true &&
    value.host === host &&
    typeof value.metrics_path === "string"
  );
}

function extractHostEvalPayload(texts, host) {
  const candidates = texts.flatMap((text) => extractJsonObjects(text));
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    if (isHostEvalPayload(candidates[index], host)) {
      return candidates[index];
    }
  }
  throw new Error(`no ${host} eval JSON payload found in real client output`);
}

function eventMatches(event, predicates) {
  const serialized = JSON.stringify(event);
  return predicates.some((predicate) => serialized.includes(predicate));
}

function summarizeEvents(events) {
  return events
    .slice(0, 20)
    .map((event) => {
      const itemType = event?.item?.type ? ` item=${event.item.type}` : "";
      const subtype = event?.subtype ? ` subtype=${event.subtype}` : "";
      const taskType = event?.task_type ? ` task=${event.task_type}` : "";
      return `${event?.type ?? "unknown"}${subtype}${itemType}${taskType}`;
    })
    .join(", ");
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
    clientCommandFor("claude").command,
    [
      ...clientCommandFor("claude").argsPrefix,
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
      shell: clientCommandFor("claude").shell,
      env: {
        ...process.env,
        HOST_REAL_EVAL_CLIENT: "claude_code",
      },
      timeoutMs: 1_200_000,
    },
  );
  await writeFile(path.join(outputDir, "claude_code-client-stdout.jsonl"), result.stdout, "utf8");
  await writeFile(path.join(outputDir, "claude_code-client-stderr.log"), result.stderr, "utf8");

  if (result.exitCode !== 0) {
    throw new Error(`Claude Code eval failed: ${result.stderr || result.stdout}`);
  }
  const events = parseJsonLines(result.stdout);
  const usedBash = events.some((event) => {
    if (event?.task_type === "local_bash") {
      return true;
    }
    return contentItems(event).some(
      (item) => item?.type === "tool_use" && item?.name === "Bash",
    ) || eventMatches(event, ['"name":"Bash"', '"task_type":"local_bash"']);
  });
  if (!usedBash) {
    throw new Error(
      [
        "Claude Code did not execute the eval through the Bash tool",
        `events: ${summarizeEvents(events)}`,
        `stdout_tail: ${result.stdout.slice(-1000)}`,
        `stderr_tail: ${result.stderr.slice(-1000)}`,
      ].join("\n"),
    );
  }
  const texts = [];
  for (const event of events) {
    for (const item of contentItems(event)) {
      const text = textFromContentItem(item);
      if (text) {
        texts.push(text);
      }
    }
    if (typeof event?.result === "string") {
      texts.push(event.result);
    }
  }
  const payload = extractHostEvalPayload(texts.length > 0 ? texts : [result.stdout], "claude_code");
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
    clientCommandFor("codex").command,
    [
      ...clientCommandFor("codex").argsPrefix,
      "exec",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "--json",
      "-",
    ],
    {
      shell: clientCommandFor("codex").shell,
      stdin: prompt,
      env: {
        ...process.env,
        HOST_REAL_EVAL_CLIENT: "codex",
      },
      timeoutMs: 1_200_000,
    },
  );
  await writeFile(path.join(outputDir, "codex-client-stdout.jsonl"), result.stdout, "utf8");
  await writeFile(path.join(outputDir, "codex-client-stderr.log"), result.stderr, "utf8");

  if (result.exitCode !== 0) {
    throw new Error(`Codex eval failed: ${result.stderr || result.stdout}`);
  }

  const lines = parseJsonLines(result.stdout);
  const usedCommand = lines.some((event) =>
    eventMatches(event, [
      '"type":"command_execution"',
      '"type":"exec_command"',
      '"type":"tool_call"',
      '"cmd"',
    ]),
  );
  if (!usedCommand) {
    throw new Error(
      [
        "Codex did not execute the eval through a real local command",
        `events: ${summarizeEvents(lines)}`,
        `stdout_tail: ${result.stdout.slice(-1000)}`,
        `stderr_tail: ${result.stderr.slice(-1000)}`,
      ].join("\n"),
    );
  }
  const messages = lines
    .map((event) => event?.item?.text ?? event?.message?.content ?? event?.text)
    .filter((value) => typeof value === "string");
  const payload = extractHostEvalPayload(messages.length > 0 ? messages : [result.stdout], "codex");
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
