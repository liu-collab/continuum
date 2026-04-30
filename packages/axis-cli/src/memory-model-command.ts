import process from "node:process";

import {
  readManagedMemoryLlmConfig,
  resolveOptionalManagedMemoryLlmCliConfig,
  writeManagedMemoryLlmConfig,
  type ManagedWritebackLlmConfig,
} from "./managed-config.js";
import { bilingualMessage } from "./messages.js";

function withMemoryLlmAliases(options: Record<string, string | boolean>): Record<string, string | boolean> {
  return {
    ...options,
    ...(typeof options["base-url"] === "string" ? { "memory-llm-base-url": options["base-url"] } : {}),
    ...(typeof options.model === "string" ? { "memory-llm-model": options.model } : {}),
    ...(typeof options["api-key"] === "string" ? { "memory-llm-api-key": options["api-key"] } : {}),
    ...(typeof options.protocol === "string" ? { "memory-llm-protocol": options.protocol } : {}),
    ...(typeof options.effort === "string" ? { "memory-llm-effort": options.effort } : {}),
    ...(typeof options["timeout-ms"] === "string" ? { "memory-llm-timeout-ms": options["timeout-ms"] } : {}),
    ...(typeof options["max-tokens"] === "string" ? { "memory-llm-max-tokens": options["max-tokens"] } : {}),
  };
}

function isConfigured(config: ManagedWritebackLlmConfig | null | undefined) {
  return Boolean(config?.baseUrl && config.model);
}

export async function writeMemoryModelConfigurationHint() {
  const config = await readManagedMemoryLlmConfig().catch(() => null);
  if (isConfigured(config)) {
    return;
  }

  process.stdout.write(`${bilingualMessage(
    "记忆模型未配置，lite 模式会先使用规则降级；可以先跳过，之后运行 axis memory-model configure 配置。",
    "Memory model is not configured. Lite mode will use rule fallback; you can skip it now and run axis memory-model configure later.",
  )}\n`);
}

export async function runMemoryModelCommand(
  subcommand: string | undefined,
  options: Record<string, string | boolean>,
) {
  const action = subcommand ?? "status";
  if (action === "status") {
    const config = await readManagedMemoryLlmConfig();
    process.stdout.write(`${isConfigured(config) ? "configured" : "not_configured"}\n`);
    if (config?.baseUrl) {
      process.stdout.write(`base-url: ${config.baseUrl}\n`);
    }
    if (config?.model) {
      process.stdout.write(`model: ${config.model}\n`);
    }
    return 0;
  }

  if (action !== "configure") {
    process.stderr.write(`${bilingualMessage(
      `未知的 memory-model 子命令: ${action}`,
      `Unknown memory-model subcommand: ${action}`,
    )}\n`);
    return 1;
  }

  const existing = await readManagedMemoryLlmConfig();
  const overrides = resolveOptionalManagedMemoryLlmCliConfig(withMemoryLlmAliases(options));
  const next: ManagedWritebackLlmConfig = {
    version: 1,
    ...(existing ?? {}),
    ...overrides,
  };

  if (!next.baseUrl || !next.model) {
    throw new Error(bilingualMessage(
      "配置记忆模型至少需要 --base-url 和 --model。",
      "Configuring the memory model requires at least --base-url and --model.",
    ));
  }

  await writeManagedMemoryLlmConfig(next);
  process.stdout.write(`${bilingualMessage("记忆模型配置已保存。", "Memory model config saved.")}\n`);
  process.stdout.write(`base-url: ${next.baseUrl}\n`);
  process.stdout.write(`model: ${next.model}\n`);
  return 0;
}
