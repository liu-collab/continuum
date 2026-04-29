#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const DEFAULT_MEMORY_CONFIG_PATH = path.join(
  os.homedir(),
  ".axis",
  "managed",
  "memory-llm-config.json",
);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--host" && value) {
      args.host = value;
      index += 1;
    } else if (key === "--output-dir" && value) {
      args.outputDir = value;
      index += 1;
    } else if (key === "--config-path" && value) {
      args.configPath = value;
      index += 1;
    } else if (key === "--timeout-ms" && value) {
      args.timeoutMs = value;
      index += 1;
    } else if (key === "--concurrency" && value) {
      args.concurrency = value;
      index += 1;
    }
  }
  return args;
}

async function readManagedMemoryConfig(configPath) {
  const content = await readFile(configPath, "utf8");
  return JSON.parse(content);
}

async function writeEvalConfig(config) {
  const tempPath = path.join(
    os.tmpdir(),
    `host-real-eval-${process.pid}-${Date.now()}.json`,
  );
  await writeFile(
    tempPath,
    JSON.stringify(
      {
        provider: {
          base_url: config.baseUrl,
          api_key: config.apiKey,
          model: config.model,
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  return tempPath;
}

function npxCommand() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function runProcess(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

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

function totalPassed(summary) {
  return summary.reduce((sum, item) => sum + item.passed, 0);
}

function totalCases(summary) {
  return summary.reduce((sum, item) => sum + item.total, 0);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const host = args.host;
  if (host !== "claude_code" && host !== "codex") {
    throw new Error("--host must be claude_code or codex");
  }

  const outputDir = path.resolve(args.outputDir ?? path.join("docs", "host-real-eval"));
  await mkdir(outputDir, { recursive: true });

  const memoryConfig = await readManagedMemoryConfig(args.configPath ?? DEFAULT_MEMORY_CONFIG_PATH);
  if (!memoryConfig.baseUrl || !memoryConfig.model) {
    throw new Error("managed memory llm config must include baseUrl and model");
  }

  const tempConfigPath = await writeEvalConfig(memoryConfig);
  const outputBase = path.join(outputDir, `${host}-memory-orchestrator-real-eval`);
  try {
    const evalResult = await runProcess(npxCommand(), [
      "tsx",
      "src/cli/memory-orchestrator-real-eval.ts",
      "--config-path",
      tempConfigPath,
      "--model",
      memoryConfig.model,
      "--protocol",
      memoryConfig.protocol ?? "openai-compatible",
      "--timeout-ms",
      args.timeoutMs ?? String(memoryConfig.timeoutMs ?? 45_000),
      "--concurrency",
      args.concurrency ?? "2",
      "--output-base",
      outputBase,
    ]);

    if (evalResult.exitCode !== 0) {
      throw new Error(`real eval failed: ${evalResult.stderr || evalResult.stdout}`);
    }

    const reportJsonPath = `${outputBase}.json`;
    const reportMarkdownPath = `${outputBase}.md`;
    const report = JSON.parse(await readFile(reportJsonPath, "utf8"));
    const summary = report.summary ?? [];

    const passed = totalPassed(summary);
    const total = totalCases(summary);
    const metrics = {
      generated_at: new Date().toISOString(),
      host,
      client_verified_by: process.env.HOST_REAL_EVAL_CLIENT ?? "unknown",
      model: memoryConfig.model,
      protocol: memoryConfig.protocol ?? "openai-compatible",
      base_url: memoryConfig.baseUrl,
      passed,
      total,
      pass_rate: total > 0 ? passed / total : 0,
      summary,
      report: {
        markdown: reportMarkdownPath,
        json: reportJsonPath,
      },
    };

    const metricsPath = path.join(outputDir, `${host}-metrics.json`);
    await writeFile(metricsPath, JSON.stringify(metrics, null, 2), "utf8");
    process.stdout.write(
      JSON.stringify({
        ok: true,
        host,
        passed,
        total,
        pass_rate: metrics.pass_rate,
        metrics_path: metricsPath,
        report_json: reportJsonPath,
        report_markdown: reportMarkdownPath,
      }),
    );
  } finally {
    await import("node:fs/promises").then(({ rm }) => rm(tempConfigPath, { force: true }));
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
