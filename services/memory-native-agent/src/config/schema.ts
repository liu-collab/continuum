import { z } from "zod";

export const localeSchema = z.enum(["zh-CN", "en-US"]);
export const memoryModeSchema = z.enum(["workspace_only", "workspace_plus_global"]);
export const providerKindSchema = z.enum(["not-configured", "openai-compatible", "openai-responses", "anthropic", "ollama", "record-replay"]);
export const approvalModeSchema = z.enum(["confirm", "yolo"]);
export const planModeSchema = z.enum(["advisory", "confirm"]);

const nonEmptyStringSchema = z.string().trim().min(1);
const timeoutMsSchema = z.coerce.number().int().min(1);
const probabilitySchema = z.coerce.number().min(0).max(2);
const providerEffortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
const logLevelSchema = z.enum(["silent", "error", "warn", "info", "debug", "trace"]);
const logFormatSchema = z.enum(["json", "pretty"]);
const compactionStrategySchema = z.enum(["truncate", "summarize"]);

const partialRuntimeSchema = z
  .object({
    base_url: z.string().trim().url().optional(),
    request_timeout_ms: timeoutMsSchema.optional(),
    finalize_timeout_ms: timeoutMsSchema.optional(),
  })
  .strict();

const partialProviderSchema = z
  .object({
    kind: providerKindSchema.optional(),
    model: nonEmptyStringSchema.optional(),
    base_url: z.string().trim().url().optional(),
    api_key: nonEmptyStringSchema.optional(),
    api_key_env: nonEmptyStringSchema.optional(),
    temperature: probabilitySchema.optional(),
    effort: providerEffortSchema.optional(),
    max_tokens: z.coerce.number().int().min(1).nullable().optional(),
    organization: nonEmptyStringSchema.optional(),
    keep_alive: z.union([nonEmptyStringSchema, z.coerce.number().int().min(0)]).optional(),
    fixture_dir: nonEmptyStringSchema.optional(),
    fixture_name: nonEmptyStringSchema.optional(),
    record_replay_target: z.enum(["openai-compatible", "openai-responses", "anthropic", "ollama"]).optional(),
  })
  .strict();

const partialMcpServerSchema = z
  .object({
    name: nonEmptyStringSchema,
    transport: z.enum(["stdio", "http"]),
    command: nonEmptyStringSchema.optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    url: z.string().trim().url().optional(),
    headers: z.record(z.string()).optional(),
    cwd: nonEmptyStringSchema.optional(),
    startup_timeout_ms: timeoutMsSchema.max(120_000).optional(),
    request_timeout_ms: timeoutMsSchema.max(120_000).optional(),
    reconnect_on_failure: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.transport === "stdio" && !value.command) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["command"],
        message: "stdio transport requires command",
      });
    }

    if (value.transport === "http" && !value.url) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "http transport requires url",
      });
    }
  });

const partialMemorySchema = z
  .object({
    mode: memoryModeSchema.optional(),
    user_id: z.string().uuid().nullable().optional(),
  })
  .strict();

const partialToolsSchema = z
  .object({
    max_output_chars: z.coerce.number().int().min(256).max(256 * 1024).optional(),
    approval_mode: approvalModeSchema.optional(),
    shell_exec: z
      .object({
        enabled: z.boolean().optional(),
        timeout_ms: timeoutMsSchema.max(120_000).optional(),
        deny_patterns: z.array(nonEmptyStringSchema).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const partialCliSchema = z
  .object({
    system_prompt_file: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

const partialContextSchema = z
  .object({
    max_tokens: z.coerce.number().int().min(1).nullable().optional(),
    reserve_tokens: z.coerce.number().int().min(128).max(128 * 1024).optional(),
    compaction_strategy: compactionStrategySchema.optional(),
  })
  .strict();

const partialPlanningSchema = z
  .object({
    plan_mode: planModeSchema.optional(),
  })
  .strict();

const partialLoggingSchema = z
  .object({
    level: logLevelSchema.optional(),
    format: logFormatSchema.optional(),
  })
  .strict();

const partialStreamingSchema = z
  .object({
    flush_chars: z.coerce.number().int().min(1).max(1024).optional(),
    flush_interval_ms: z.coerce.number().int().min(1).max(5000).optional(),
  })
  .strict();

const partialSkillsSchema = z
  .object({
    enabled: z.boolean().optional(),
    auto_discovery: z.boolean().optional(),
    discovery_paths: z.array(nonEmptyStringSchema).optional(),
  })
  .strict();

export const configFileSchema = z
  .object({
    runtime: partialRuntimeSchema.optional(),
    provider: partialProviderSchema.optional(),
    memory: partialMemorySchema.optional(),
    mcp: z.object({ servers: z.array(partialMcpServerSchema).optional() }).strict().optional(),
    tools: partialToolsSchema.optional(),
    cli: partialCliSchema.optional(),
    context: partialContextSchema.optional(),
    planning: partialPlanningSchema.optional(),
    logging: partialLoggingSchema.optional(),
    streaming: partialStreamingSchema.optional(),
    skills: partialSkillsSchema.optional(),
    locale: localeSchema.optional(),
  })
  .strict();

const mergedRuntimeSchema = z
  .object({
    base_url: z.string().trim().url(),
    request_timeout_ms: timeoutMsSchema,
    finalize_timeout_ms: timeoutMsSchema,
  })
  .strict();

const mergedProviderSchema = z
  .object({
    kind: providerKindSchema,
    model: nonEmptyStringSchema,
    base_url: z.string().trim().url(),
    api_key: nonEmptyStringSchema.optional(),
    api_key_env: nonEmptyStringSchema.optional(),
    temperature: probabilitySchema,
    effort: providerEffortSchema.nullable(),
    max_tokens: z.coerce.number().int().min(1).nullable(),
    organization: nonEmptyStringSchema.optional(),
    keep_alive: z.union([nonEmptyStringSchema, z.coerce.number().int().min(0)]).optional(),
    fixture_dir: nonEmptyStringSchema.optional(),
    fixture_name: nonEmptyStringSchema.optional(),
    record_replay_target: z.enum(["openai-compatible", "openai-responses", "anthropic", "ollama"]).optional(),
  })
  .strict();

const mergedMemorySchema = z
  .object({
    mode: memoryModeSchema,
    user_id: z.string().uuid().nullable(),
  })
  .strict();

const mergedMcpSchema = z
  .object({
    servers: z.array(partialMcpServerSchema),
  })
  .strict();

const mergedToolsSchema = z
  .object({
    max_output_chars: z.coerce.number().int().min(256).max(256 * 1024),
    approval_mode: approvalModeSchema,
    shell_exec: z
      .object({
        enabled: z.boolean(),
        timeout_ms: timeoutMsSchema.max(120_000),
        deny_patterns: z.array(nonEmptyStringSchema),
      })
      .strict(),
  })
  .strict();

const mergedCliSchema = z
  .object({
    system_prompt_file: z.string().trim().min(1).nullable(),
  })
  .strict();

const mergedContextSchema = z
  .object({
    max_tokens: z.coerce.number().int().min(1).nullable(),
    reserve_tokens: z.coerce.number().int().min(128).max(128 * 1024),
    compaction_strategy: compactionStrategySchema,
  })
  .strict();

const mergedPlanningSchema = z
  .object({
    plan_mode: planModeSchema,
  })
  .strict();

const mergedLoggingSchema = z
  .object({
    level: logLevelSchema,
    format: logFormatSchema,
  })
  .strict();

const mergedStreamingSchema = z
  .object({
    flush_chars: z.coerce.number().int().min(1).max(1024),
    flush_interval_ms: z.coerce.number().int().min(1).max(5000),
  })
  .strict();

const mergedSkillsSchema = z
  .object({
    enabled: z.boolean(),
    auto_discovery: z.boolean(),
    discovery_paths: z.array(nonEmptyStringSchema),
  })
  .strict();

export const mergedConfigSchema = z
  .object({
    runtime: mergedRuntimeSchema,
    provider: mergedProviderSchema,
    memory: mergedMemorySchema,
    mcp: mergedMcpSchema,
    tools: mergedToolsSchema,
    cli: mergedCliSchema,
    context: mergedContextSchema,
    planning: mergedPlanningSchema,
    logging: mergedLoggingSchema,
    streaming: mergedStreamingSchema,
    skills: mergedSkillsSchema,
    locale: localeSchema.optional(),
  })
  .strict();

export type MemoryMode = z.infer<typeof memoryModeSchema>;
export type Locale = z.infer<typeof localeSchema>;
export type ProviderKind = z.infer<typeof providerKindSchema>;
export type PlanMode = z.infer<typeof planModeSchema>;
export type ConfigFileInput = z.infer<typeof configFileSchema>;
export type MergedConfig = z.infer<typeof mergedConfigSchema>;
