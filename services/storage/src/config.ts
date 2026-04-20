import "dotenv/config";

import { z } from "zod";

const configSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().trim().min(1).default("0.0.0.0"),
  LOG_LEVEL: z.string().trim().min(1).default("info"),
  DATABASE_URL: z.string().trim().min(1),
  STORAGE_SCHEMA_PRIVATE: z.string().trim().min(1).default("storage_private"),
  STORAGE_SCHEMA_SHARED: z.string().trim().min(1).default("storage_shared_v1"),
  WRITE_JOB_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(1000),
  WRITE_JOB_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  WRITE_JOB_MAX_RETRIES: z.coerce.number().int().min(0).max(20).default(3),
  READ_MODEL_REFRESH_MAX_RETRIES: z.coerce
    .number()
    .int()
    .min(0)
    .max(20)
    .default(3),
  EMBEDDING_BASE_URL: z.string().trim().optional().transform((value) => value || undefined),
  EMBEDDING_API_KEY: z.string().trim().optional().transform((value) => value || undefined),
  EMBEDDING_MODEL: z.string().trim().default("text-embedding-3-small"),
  CONTINUUM_EMBEDDING_CONFIG_PATH: z.string().trim().optional().transform((value) => value || undefined),
  REDIS_URL: z.string().trim().optional().transform((value) => value || undefined),
});

export type StorageConfig = {
  port: number;
  host: string;
  log_level: string;
  database_url: string;
  storage_schema_private: string;
  storage_schema_shared: string;
  write_job_poll_interval_ms: number;
  write_job_batch_size: number;
  write_job_max_retries: number;
  read_model_refresh_max_retries: number;
  embedding_base_url?: string | undefined;
  embedding_api_key?: string | undefined;
  embedding_model: string;
  continuum_embedding_config_path?: string | undefined;
  redis_url?: string | undefined;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  const parsed = configSchema.safeParse(env);

  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");

    throw new Error(`Invalid storage configuration: ${message}`);
  }

  return {
    port: parsed.data.PORT,
    host: parsed.data.HOST,
    log_level: parsed.data.LOG_LEVEL,
    database_url: parsed.data.DATABASE_URL,
    storage_schema_private: parsed.data.STORAGE_SCHEMA_PRIVATE,
    storage_schema_shared: parsed.data.STORAGE_SCHEMA_SHARED,
    write_job_poll_interval_ms: parsed.data.WRITE_JOB_POLL_INTERVAL_MS,
    write_job_batch_size: parsed.data.WRITE_JOB_BATCH_SIZE,
    write_job_max_retries: parsed.data.WRITE_JOB_MAX_RETRIES,
    read_model_refresh_max_retries: parsed.data.READ_MODEL_REFRESH_MAX_RETRIES,
    embedding_base_url: parsed.data.EMBEDDING_BASE_URL,
    embedding_api_key: parsed.data.EMBEDDING_API_KEY,
    embedding_model: parsed.data.EMBEDDING_MODEL,
    continuum_embedding_config_path: parsed.data.CONTINUUM_EMBEDDING_CONFIG_PATH,
    redis_url: parsed.data.REDIS_URL,
  };
}
