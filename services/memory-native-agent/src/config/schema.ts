import { z } from "zod";

export const localeSchema = z.enum(["zh-CN", "en-US"]);
export const memoryModeSchema = z.enum(["workspace_only", "workspace_plus_global"]);
export const providerKindSchema = z.enum(["openai-compatible", "anthropic", "ollama"]);

const nonEmptyStringSchema = z.string().trim().min(1);
const timeoutMsSchema = z.coerce.number().int().min(1);
const probabilitySchema = z.coerce.number().min(0).max(2);

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
    api_key_env: nonEmptyStringSchema.optional(),
    temperature: probabilitySchema.optional(),
    organization: nonEmptyStringSchema.optional(),
    keep_alive: z.union([nonEmptyStringSchema, z.coerce.number().int().min(0)]).optional(),
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

const partialStreamingSchema = z
  .object({
    flush_chars: z.coerce.number().int().min(1).max(1024).optional(),
    flush_interval_ms: z.coerce.number().int().min(1).max(5000).optional(),
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
    streaming: partialStreamingSchema.optional(),
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
    api_key_env: nonEmptyStringSchema.optional(),
    temperature: probabilitySchema,
    organization: nonEmptyStringSchema.optional(),
    keep_alive: z.union([nonEmptyStringSchema, z.coerce.number().int().min(0)]).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.kind === "openai-compatible" || value.kind === "anthropic") && !value.api_key_env) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["api_key_env"],
        message: `${value.kind} provider requires api_key_env`,
      });
    }
  });

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

const mergedStreamingSchema = z
  .object({
    flush_chars: z.coerce.number().int().min(1).max(1024),
    flush_interval_ms: z.coerce.number().int().min(1).max(5000),
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
    streaming: mergedStreamingSchema,
    locale: localeSchema.optional(),
  })
  .strict();

export type MemoryMode = z.infer<typeof memoryModeSchema>;
export type Locale = z.infer<typeof localeSchema>;
export type ProviderKind = z.infer<typeof providerKindSchema>;
export type ConfigFileInput = z.infer<typeof configFileSchema>;
export type MergedConfig = z.infer<typeof mergedConfigSchema>;
