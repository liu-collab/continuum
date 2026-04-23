#!/usr/bin/env node

/**
 * MCP debug wrapper — captures all stdin/stdout/stderr of the real MCP server
 * to diagnose rmcp compatibility issues.
 *
 * Usage: codex mcp add test-debug -- node "tests/e2e/mcp-debug-wrapper.mjs"
 */

import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const LOG_FILE = path.resolve(process.cwd(), "mcp-debug.log");

function log(prefix, data) {
  const ts = new Date().toISOString();
  const lines = String(data).split("\n");
  for (const line of lines) {
    if (line.trim()) {
      appendFileSync(LOG_FILE, `[${ts}] ${prefix}: ${line}\n`);
    }
  }
}

log("INIT", `wrapper started, cwd=${process.cwd()}`);
log(
  "INIT",
  `env MEMORY_RUNTIME_BASE_URL=${process.env.MEMORY_RUNTIME_BASE_URL || "(not set)"}`,
);

const mcpScript = path.resolve(
  process.cwd(),
  "host-adapters/memory-codex-adapter/mcp/memory-mcp-server.mjs",
);
log("INIT", `launching: node ${mcpScript}`);

const child = spawn("node", [mcpScript], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"],
});

// Pipe stdin through and log
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  log("STDIN", chunk);
  child.stdin.write(chunk);
});
process.stdin.on("end", () => {
  log("STDIN", "<EOF>");
  child.stdin.end();
});

// Pipe stdout through and log
child.stdout.on("data", (chunk) => {
  const str = String(chunk);
  log("STDOUT", str);
  process.stdout.write(chunk);
});

// Pipe stderr through and log
child.stderr.on("data", (chunk) => {
  const str = String(chunk);
  log("STDERR", str);
  process.stderr.write(chunk);
});

child.on("exit", (code) => {
  log("EXIT", `child exited with code ${code}`);
  process.exit(code ?? 1);
});

child.on("error", (err) => {
  log("ERROR", err.message);
  process.exit(1);
});
