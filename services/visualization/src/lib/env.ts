import { z } from "zod";

import { dashboardThresholdDefaults, dashboardThresholdEnvKeys } from "@/lib/dashboard-thresholds";

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be a valid SQL identifier");

const envSchema = z.object({
  NEXT_PUBLIC_APP_NAME: z.string().default("Agent Memory Observatory"),
  NEXT_PUBLIC_APP_DESCRIPTION: z
    .string()
    .default("Structured memory catalog, run trace, and metrics dashboard"),
  NEXT_PUBLIC_MNA_BASE_URL: z.string().url().default("http://127.0.0.1:4193"),
  MNA_INTERNAL_BASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_MNA_DEFAULT_LOCALE: z.enum(["zh-CN", "en-US"]).default("zh-CN"),
  STORAGE_READ_MODEL_DSN: z.string().optional(),
  STORAGE_READ_MODEL_SCHEMA: identifierSchema.default("storage_shared_v1"),
  STORAGE_READ_MODEL_TABLE: identifierSchema.default("memory_read_model_v1"),
  STORAGE_READ_MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(5),
  STORAGE_API_BASE_URL: z.string().url().optional(),
  STORAGE_API_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
  RUNTIME_API_BASE_URL: z.string().url().optional(),
  RUNTIME_API_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
  PLATFORM_USER_ID: z
    .string({
      required_error: "PLATFORM_USER_ID is required. Set PLATFORM_USER_ID to a valid UUID before starting visualization."
    })
    .uuid("PLATFORM_USER_ID must be a valid UUID."),
  MNA_TOKEN_PATH: z.string().default("~/.mna/token.txt"),
  DEFAULT_PAGE_SIZE: z.coerce.number().int().positive().max(100).default(20),
  HEALTH_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  SOURCE_HEALTH_CACHE_MS: z.coerce.number().int().positive().default(8000),
  DASHBOARD_REFRESH_MS: z.coerce.number().int().positive().default(30000),
  DASHBOARD_CACHE_MS: z.coerce.number().int().positive().default(20000),
  ...Object.fromEntries(
    dashboardThresholdEnvKeys.map((key) => [
      key,
      z.coerce.number().default(dashboardThresholdDefaults[key])
    ])
  )
} satisfies z.ZodRawShape);

type RawEnv = {
  NEXT_PUBLIC_APP_NAME?: string;
  NEXT_PUBLIC_APP_DESCRIPTION?: string;
  NEXT_PUBLIC_MNA_BASE_URL?: string;
  MNA_INTERNAL_BASE_URL?: string;
  NEXT_PUBLIC_MNA_DEFAULT_LOCALE?: string;
  STORAGE_READ_MODEL_DSN?: string;
  STORAGE_READ_MODEL_SCHEMA?: string;
  STORAGE_READ_MODEL_TABLE?: string;
  STORAGE_READ_MODEL_TIMEOUT_MS?: string;
  DATABASE_POOL_MAX?: string;
  STORAGE_API_BASE_URL?: string;
  STORAGE_API_TIMEOUT_MS?: string;
  RUNTIME_API_BASE_URL?: string;
  RUNTIME_API_TIMEOUT_MS?: string;
  PLATFORM_USER_ID?: string;
  MNA_TOKEN_PATH?: string;
  DEFAULT_PAGE_SIZE?: string;
  HEALTH_POLL_INTERVAL_MS?: string;
  SOURCE_HEALTH_CACHE_MS?: string;
  DASHBOARD_REFRESH_MS?: string;
  DASHBOARD_CACHE_MS?: string;
} & Partial<Record<(typeof dashboardThresholdEnvKeys)[number], string>>;

export type AppConfig = {
  values: z.infer<typeof envSchema>;
  issues: string[];
};

declare global {
  var __AXIS_VIZ_CONFIG__: AppConfig | undefined;
}

function normalizeRawEnv(env: NodeJS.ProcessEnv): RawEnv {
  return {
    NEXT_PUBLIC_APP_NAME: env.NEXT_PUBLIC_APP_NAME,
    NEXT_PUBLIC_APP_DESCRIPTION: env.NEXT_PUBLIC_APP_DESCRIPTION,
    NEXT_PUBLIC_MNA_BASE_URL: env.NEXT_PUBLIC_MNA_BASE_URL,
    MNA_INTERNAL_BASE_URL: env.MNA_INTERNAL_BASE_URL,
    NEXT_PUBLIC_MNA_DEFAULT_LOCALE: env.NEXT_PUBLIC_MNA_DEFAULT_LOCALE,
    STORAGE_READ_MODEL_DSN: env.STORAGE_READ_MODEL_DSN || undefined,
    STORAGE_READ_MODEL_SCHEMA: env.STORAGE_READ_MODEL_SCHEMA,
    STORAGE_READ_MODEL_TABLE: env.STORAGE_READ_MODEL_TABLE,
    STORAGE_READ_MODEL_TIMEOUT_MS: env.STORAGE_READ_MODEL_TIMEOUT_MS,
    DATABASE_POOL_MAX: env.DATABASE_POOL_MAX,
    STORAGE_API_BASE_URL: env.STORAGE_API_BASE_URL || undefined,
    STORAGE_API_TIMEOUT_MS: env.STORAGE_API_TIMEOUT_MS,
    RUNTIME_API_BASE_URL: env.RUNTIME_API_BASE_URL || undefined,
    RUNTIME_API_TIMEOUT_MS: env.RUNTIME_API_TIMEOUT_MS,
    PLATFORM_USER_ID: env.PLATFORM_USER_ID,
    MNA_TOKEN_PATH: env.MNA_TOKEN_PATH,
    DEFAULT_PAGE_SIZE: env.DEFAULT_PAGE_SIZE,
    HEALTH_POLL_INTERVAL_MS: env.HEALTH_POLL_INTERVAL_MS,
    SOURCE_HEALTH_CACHE_MS: env.SOURCE_HEALTH_CACHE_MS,
    DASHBOARD_REFRESH_MS: env.DASHBOARD_REFRESH_MS,
    DASHBOARD_CACHE_MS: env.DASHBOARD_CACHE_MS,
    ...Object.fromEntries(dashboardThresholdEnvKeys.map((key) => [key, env[key]]))
  };
}

export function getAppConfig(): AppConfig {
  if (globalThis.__AXIS_VIZ_CONFIG__) {
    return globalThis.__AXIS_VIZ_CONFIG__;
  }

  const rawEnv = normalizeRawEnv(process.env);
  const parsed = envSchema.safeParse(rawEnv);

  if (parsed.success) {
    const config = {
      values: parsed.data,
      issues: []
    };

    globalThis.__AXIS_VIZ_CONFIG__ = config;
    return config;
  }

  const platformUserIssue = parsed.error.issues.find((issue) => issue.path.join(".") === "PLATFORM_USER_ID");
  if (platformUserIssue) {
    throw new Error(platformUserIssue.message);
  }

  const fallback = envSchema.parse({
    PLATFORM_USER_ID: rawEnv.PLATFORM_USER_ID
  });
  const config = {
    values: fallback,
    issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "env"} ${issue.message}`)
  };

  globalThis.__AXIS_VIZ_CONFIG__ = config;
  return config;
}
