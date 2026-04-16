import { z } from "zod";

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be a valid SQL identifier");

const envSchema = z.object({
  NEXT_PUBLIC_APP_NAME: z.string().default("Agent Memory Observatory"),
  NEXT_PUBLIC_APP_DESCRIPTION: z
    .string()
    .default("Structured memory catalog, run trace, and metrics dashboard"),
  STORAGE_READ_MODEL_DSN: z.string().optional(),
  STORAGE_READ_MODEL_SCHEMA: identifierSchema.default("storage_shared_v1"),
  STORAGE_READ_MODEL_TABLE: identifierSchema.default("memory_read_model_v1"),
  STORAGE_READ_MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
  STORAGE_API_BASE_URL: z.string().url().optional(),
  STORAGE_API_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
  RUNTIME_API_BASE_URL: z.string().url().optional(),
  RUNTIME_API_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
  DEFAULT_PAGE_SIZE: z.coerce.number().int().positive().max(100).default(20),
  HEALTH_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  SOURCE_HEALTH_CACHE_MS: z.coerce.number().int().positive().default(8000),
  DASHBOARD_REFRESH_MS: z.coerce.number().int().positive().default(30000),
  DASHBOARD_CACHE_MS: z.coerce.number().int().positive().default(20000)
});

type RawEnv = {
  NEXT_PUBLIC_APP_NAME?: string;
  NEXT_PUBLIC_APP_DESCRIPTION?: string;
  STORAGE_READ_MODEL_DSN?: string;
  STORAGE_READ_MODEL_SCHEMA?: string;
  STORAGE_READ_MODEL_TABLE?: string;
  STORAGE_READ_MODEL_TIMEOUT_MS?: string;
  STORAGE_API_BASE_URL?: string;
  STORAGE_API_TIMEOUT_MS?: string;
  RUNTIME_API_BASE_URL?: string;
  RUNTIME_API_TIMEOUT_MS?: string;
  DEFAULT_PAGE_SIZE?: string;
  HEALTH_POLL_INTERVAL_MS?: string;
  SOURCE_HEALTH_CACHE_MS?: string;
  DASHBOARD_REFRESH_MS?: string;
  DASHBOARD_CACHE_MS?: string;
};

export type AppConfig = {
  values: z.infer<typeof envSchema>;
  issues: string[];
};

declare global {
  var __AGENT_MEMORY_VIZ_CONFIG__: AppConfig | undefined;
}

function normalizeRawEnv(env: NodeJS.ProcessEnv): RawEnv {
  return {
    NEXT_PUBLIC_APP_NAME: env.NEXT_PUBLIC_APP_NAME,
    NEXT_PUBLIC_APP_DESCRIPTION: env.NEXT_PUBLIC_APP_DESCRIPTION,
    STORAGE_READ_MODEL_DSN: env.STORAGE_READ_MODEL_DSN || undefined,
    STORAGE_READ_MODEL_SCHEMA: env.STORAGE_READ_MODEL_SCHEMA,
    STORAGE_READ_MODEL_TABLE: env.STORAGE_READ_MODEL_TABLE,
    STORAGE_READ_MODEL_TIMEOUT_MS: env.STORAGE_READ_MODEL_TIMEOUT_MS,
    STORAGE_API_BASE_URL: env.STORAGE_API_BASE_URL || undefined,
    STORAGE_API_TIMEOUT_MS: env.STORAGE_API_TIMEOUT_MS,
    RUNTIME_API_BASE_URL: env.RUNTIME_API_BASE_URL || undefined,
    RUNTIME_API_TIMEOUT_MS: env.RUNTIME_API_TIMEOUT_MS,
    DEFAULT_PAGE_SIZE: env.DEFAULT_PAGE_SIZE,
    HEALTH_POLL_INTERVAL_MS: env.HEALTH_POLL_INTERVAL_MS,
    SOURCE_HEALTH_CACHE_MS: env.SOURCE_HEALTH_CACHE_MS,
    DASHBOARD_REFRESH_MS: env.DASHBOARD_REFRESH_MS,
    DASHBOARD_CACHE_MS: env.DASHBOARD_CACHE_MS
  };
}

export function getAppConfig(): AppConfig {
  if (globalThis.__AGENT_MEMORY_VIZ_CONFIG__) {
    return globalThis.__AGENT_MEMORY_VIZ_CONFIG__;
  }

  const parsed = envSchema.safeParse(normalizeRawEnv(process.env));

  if (parsed.success) {
    const config = {
      values: parsed.data,
      issues: []
    };

    globalThis.__AGENT_MEMORY_VIZ_CONFIG__ = config;
    return config;
  }

  const fallback = envSchema.parse({});
  const config = {
    values: fallback,
    issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "env"} ${issue.message}`)
  };

  globalThis.__AGENT_MEMORY_VIZ_CONFIG__ = config;
  return config;
}
