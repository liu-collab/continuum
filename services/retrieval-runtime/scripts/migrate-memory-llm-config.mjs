#!/usr/bin/env node

import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const entryPath = path.join(scriptDir, "..", "dist", "src", "memory-llm-config-migration.js");

if (!fs.existsSync(entryPath)) {
  console.error("Missing built migration entry. Run `npm run build` first.");
  process.exit(1);
}

const child = spawn(process.execPath, [entryPath, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
