#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const rootDir = path.resolve(process.cwd());

function runVitest(testFile) {
  return new Promise((resolve) => {
    const child = spawn(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["vitest", "run", "--config", "vitest.e2e.config.ts", testFile],
      {
        cwd: rootDir,
        env: process.env,
        stdio: "inherit",
        shell: process.platform === "win32",
      },
    );

    child.on("error", (error) => {
      console.error("[local-host-checks] spawn error:", error.message);
      resolve(1);
    });

    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
}

async function main() {
  console.log("[local-host-checks] root:", rootDir);
  console.log(
    "[local-host-checks] E2E 测试会自启动 in-process runtime，无需外部 runtime",
  );
  console.log();

  console.log("[local-host-checks] 运行 Claude Code E2E ...");
  const claudeResult = await runVitest(
    "tests/e2e/claude-local-host.e2e.test.ts",
  );

  console.log();
  console.log("[local-host-checks] 运行 Codex E2E ...");
  const codexResult = await runVitest("tests/e2e/codex-local-host.e2e.test.ts");

  console.log();

  if (claudeResult !== 0 || codexResult !== 0) {
    console.error("[local-host-checks] 本地宿主验收未通过", {
      claude: claudeResult === 0 ? "pass" : "fail",
      codex: codexResult === 0 ? "pass" : "fail",
    });
    process.exitCode = 1;
    return;
  }

  console.log("[local-host-checks] 全部本地宿主验收通过 ✓");
}

void main();
