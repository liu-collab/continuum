import process from "node:process";

import { parseArgs } from "./args.js";
import { runClaudeInstallCommand, runClaudeUninstallCommand } from "./claude-command.js";
import {
  runCodexUninstallCommand,
  runCodexUseCommand,
} from "./codex-command.js";
import { renderHelp } from "./help.js";
import { runMcpCommand } from "./mcp-command.js";
import { runMnaCommand } from "./mna-command.js";
import { bilingualMessage, formatErrorMessage } from "./messages.js";
import { runRuntimeCommand } from "./runtime-command.js";
import { runStartCommand } from "./start-command.js";
import { runStopCommand } from "./stop-command.js";
import { runStatusCommand } from "./status-command.js";
import { runUiCommand } from "./ui-command.js";
import { readCliVersion } from "./version.js";

const CODEX_VALID_SUBCOMMANDS = new Set(["uninstall", "use"]);

export async function runCli(argv: string[], importMetaUrl: string) {
  try {
    return await runCliUnchecked(argv, importMetaUrl);
  } catch (error) {
    const message = formatErrorMessage(error);
    process.stderr.write(`${bilingualMessage(
      `Axis CLI 遇到未预期的错误：${message}`,
      `Axis CLI encountered an unexpected error: ${message}`,
    )}\n`);
    if (process.env.NODE_ENV === "development" && error instanceof Error && error.stack) {
      process.stderr.write(`${error.stack}\n`);
    }
    process.exit(1);
  }
}

async function runCliUnchecked(argv: string[], importMetaUrl: string) {
  if (
    argv.length === 1
    && (argv[0] === "--version" || argv[0] === "-v" || argv[0] === "version")
  ) {
    process.stdout.write(`${await readCliVersion()}\n`);
    return 0;
  }

  const parsed = parseArgs(argv);
  const [primary, secondary] = parsed.command;

  if (primary === "--version" || primary === "-v" || primary === "version") {
    process.stdout.write(`${await readCliVersion()}\n`);
    return 0;
  }

  if (!primary || primary === "help" || primary === "--help") {
    process.stdout.write(renderHelp());
    return 0;
  }

  if (primary === "status") {
    return runStatusCommand(parsed.options);
  }

  if (primary === "ui") {
    await runUiCommand(parsed.options, importMetaUrl);
    return 0;
  }

  if (primary === "start") {
    await runStartCommand(parsed.options, importMetaUrl);
    return 0;
  }

  if (primary === "stop") {
    await runStopCommand();
    return 0;
  }

  if (primary === "claude" && secondary === "install") {
    await runClaudeInstallCommand(parsed.options, importMetaUrl);
    return 0;
  }

  if (primary === "claude" && secondary === "uninstall") {
    await runClaudeUninstallCommand(parsed.options);
    return 0;
  }

  if (primary === "codex") {
    const subcommand = secondary ?? "use";
    if (!CODEX_VALID_SUBCOMMANDS.has(subcommand)) {
      process.stderr.write(`${bilingualMessage(
        `未知的 codex 子命令: ${subcommand}`,
        `Unknown codex subcommand: ${subcommand}`,
      )}\n`);
      process.stderr.write(`${bilingualMessage(
        `可用: ${[...CODEX_VALID_SUBCOMMANDS].join(", ")}`,
        `Available: ${[...CODEX_VALID_SUBCOMMANDS].join(", ")}`,
      )}\n`);
      return 1;
    }


    if (subcommand === "uninstall") {
      await runCodexUninstallCommand(parsed.options);
      return 0;
    }

    await runCodexUseCommand(parsed.options, importMetaUrl);
    return 0;
  }

  if (primary === "runtime") {
    await runRuntimeCommand(importMetaUrl);
    return 0;
  }

  if (primary === "mna") {
    return runMnaCommand(secondary, parsed.options, importMetaUrl);
  }

  if (primary === "mcp-server") {
    await runMcpCommand(importMetaUrl);
    return 0;
  }

  process.stderr.write(`${bilingualMessage(
    `未知命令: ${parsed.command.join(" ")}`,
    `Unknown command: ${parsed.command.join(" ")}`,
  )}\n`);
  process.stdout.write(renderHelp());
  return 1;
}
