import process from "node:process";

import { detectLiteMemoryData, runLiteToFullMigration } from "./lite-migration.js";
import { bilingualMessage } from "./messages.js";
import { runStartCommand } from "./start-command.js";
import { DEFAULT_STORAGE_URL } from "./utils.js";

export async function runMigrateCommand(
  options: Record<string, string | boolean>,
  importMetaUrl: string,
) {
  if (options.to !== "full") {
    process.stderr.write(`${bilingualMessage(
      "当前只支持 axis migrate --to full。",
      "Only axis migrate --to full is supported.",
    )}\n`);
    return 1;
  }

  const detected = await detectLiteMemoryData();
  if (detected.count === 0) {
    process.stdout.write(`${bilingualMessage(
      "没有检测到需要迁移的精简模式记忆。",
      "No lite memories were found for migration.",
    )}\n`);
    return 0;
  }

  if (options["no-start"] !== true) {
    await runStartCommand({
      ...options,
      full: true,
      "skip-lite-migration-prompt": true,
    }, importMetaUrl);
  }

  const result = await runLiteToFullMigration({
    storageUrl: typeof options["storage-url"] === "string" ? options["storage-url"] : DEFAULT_STORAGE_URL,
    memoryDir: detected.memoryDir,
  });

  process.stdout.write(`${bilingualMessage(
    `精简模式迁移完成：提交 ${result.submitted} 条，跳过 ${result.skipped.length} 条。`,
    `Lite migration completed: submitted ${result.submitted}, skipped ${result.skipped.length}.`,
  )}\n`);
  process.stdout.write(`mapping: ${result.mappingPath}\n`);
  return result.submitted > 0 || result.skipped.length === 0 ? 0 : 1;
}
