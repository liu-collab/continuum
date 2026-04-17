import process from "node:process";

import { parseArgs } from "./args.js";
import { runClaudeInstallCommand } from "./claude-command.js";
import { runCodexCommand } from "./codex-command.js";
import { renderHelp } from "./help.js";
import { runMcpCommand } from "./mcp-command.js";
import { runRuntimeCommand } from "./runtime-command.js";
import { runStartCommand } from "./start-command.js";
import { runStopCommand } from "./stop-command.js";
import { runStatusCommand } from "./status-command.js";
import { runUiCommand } from "./ui-command.js";

export async function runCli(argv: string[], importMetaUrl: string) {
  const parsed = parseArgs(argv);
  const [primary, secondary] = parsed.command;

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

  if (primary === "codex") {
    await runCodexCommand(parsed.options, importMetaUrl);
    return 0;
  }

  if (primary === "runtime") {
    await runRuntimeCommand(importMetaUrl);
    return 0;
  }

  if (primary === "mcp-server") {
    await runMcpCommand(importMetaUrl);
    return 0;
  }

  process.stderr.write(`Unknown command: ${parsed.command.join(" ")}\n`);
  process.stdout.write(renderHelp());
  return 1;
}
