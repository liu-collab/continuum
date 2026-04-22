#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { migrateMemoryLlmConfigText } from "../services/retrieval-runtime/src/memory-llm-config-migration.ts";

function main(argv) {
  const targetPath = argv[2];
  if (!targetPath) {
    process.stderr.write("usage: node scripts/migrate-memory-llm-config.mjs <env-file>\n");
    process.exitCode = 1;
    return;
  }

  const resolvedPath = path.resolve(targetPath);
  const original = fs.readFileSync(resolvedPath, "utf8");
  const migrated = migrateMemoryLlmConfigText(original);
  fs.writeFileSync(resolvedPath, migrated, "utf8");
  process.stdout.write(`migrated memory llm config: ${resolvedPath}\n`);
}

const entryUrl = process.argv[1] ? new URL(`file://${path.resolve(process.argv[1]).replace(/\\/g, "/")}`) : null;
if (entryUrl && import.meta.url === entryUrl.href) {
  main(process.argv);
}
