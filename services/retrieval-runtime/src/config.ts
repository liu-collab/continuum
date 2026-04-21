import { z } from "zod";

import { ConfigurationError } from "./errors.js";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3002),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  READ_MODEL_SCHEMA: z.string().default("storage_shared_v1"),
  READ_MODEL_TABLE: z.string().default("memory_read_model_v1"),
  RUNTIME_SCHEMA: z.string().default("runtime_private"),
  STORAGE_WRITEBACK_URL: z.string().url("STORAGE_WRITEBACK_URL must be a valid URL"),
  EMBEDDING_BASE_URL: z.string().url("EMBEDDING_BASE_URL must be a valid URL").optional(),
  EMBEDDING_MODEL: z.string().min(1).default("text-embedding-3-small"),
  EMBEDDING_API_KEY: z.string().optional(),
  CONTINUUM_EMBEDDING_CONFIG_PATH: z.string().optional(),
  CONTINUUM_WRITEBACK_LLM_CONFIG_PATH: z.string().optional(),
  WRITEBACK_LLM_BASE_URL: z.string().url("WRITEBACK_LLM_BASE_URL must be a valid URL").optional(),
  WRITEBACK_LLM_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  WRITEBACK_LLM_API_KEY: z.string().optional(),
  WRITEBACK_LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  WRITEBACK_MAX_CANDIDATES: z.coerce.number().int().positive().max(5).default(3),
  WRITEBACK_OUTBOX_FLUSH_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  WRITEBACK_OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().max(200).default(50),
  WRITEBACK_OUTBOX_MAX_RETRIES: z.coerce.number().int().min(1).max(20).default(5),
  FINALIZE_IDEMPOTENCY_TTL_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
  FINALIZE_IDEMPOTENCY_MAX_ENTRIES: z.coerce.number().int().positive().default(500),
  WRITEBACK_INPUT_OVERLAP_THRESHOLD: z.coerce.number().min(0).max(1).default(0.2),
  QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(800),
  STORAGE_TIMEOUT_MS: z.coerce.number().int().positive().default(800),
  EMBEDDING_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  QUERY_CANDIDATE_LIMIT: z.coerce.number().int().positive().max(100).default(30),
  PACKET_RECORD_LIMIT: z.coerce.number().int().positive().max(20).default(10),
  INJECTION_RECORD_LIMIT: z.coerce.number().int().positive().max(10).default(5),
  INJECTION_TOKEN_BUDGET: z.coerce.number().int().positive().default(1500),
  SEMANTIC_TRIGGER_THRESHOLD: z.coerce.number().min(0).max(1).default(0.72),
  IMPORTANCE_THRESHOLD_SESSION_START: z.coerce.number().int().min(1).max(5).default(4),
  IMPORTANCE_THRESHOLD_DEFAULT: z.coerce.number().int().min(1).max(5).default(3),
  IMPORTANCE_THRESHOLD_SEMANTIC: z.coerce.number().int().min(1).max(5).default(4),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    throw new ConfigurationError("Invalid retrieval-runtime configuration", parsed.error.flatten());
  }

  return parsed.data;
}
