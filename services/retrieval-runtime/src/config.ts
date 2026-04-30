import { z } from "zod";

import { ConfigurationError } from "./errors.js";
import { resolveRuntimeGovernanceConfig } from "./runtime-config.js";

const booleanCoerceSchema = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === "boolean") {
      return value;
    }
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off", ""].includes(normalized)) {
      return false;
    }
    throw new Error(`invalid boolean literal: ${value}`);
  });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3002),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  LOG_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  READ_MODEL_SCHEMA: z.string().default("storage_shared_v1"),
  READ_MODEL_TABLE: z.string().default("memory_read_model_v1"),
  RUNTIME_SCHEMA: z.string().default("runtime_private"),
  STORAGE_WRITEBACK_URL: z.string().url("STORAGE_WRITEBACK_URL must be a valid URL"),
  EMBEDDING_BASE_URL: z.string().url("EMBEDDING_BASE_URL must be a valid URL").optional(),
  EMBEDDING_MODEL: z.string().min(1).default("text-embedding-3-small"),
  EMBEDDING_API_KEY: z.string().optional(),
  EMBEDDING_CACHE_TTL_MS: z.coerce.number().int().min(0).default(5 * 60 * 1000),
  EMBEDDING_CACHE_MAX_ENTRIES: z.coerce.number().int().min(0).default(1000),
  AXIS_EMBEDDING_CONFIG_PATH: z.string().optional(),
  AXIS_MEMORY_LLM_CONFIG_PATH: z.string().optional(),
  AXIS_RUNTIME_CONFIG_PATH: z.string().optional(),
  AXIS_MANAGED_CONFIG_PATH: z.string().optional(),
  AXIS_MANAGED_SECRETS_PATH: z.string().optional(),
  MEMORY_LLM_BASE_URL: z.string().url("MEMORY_LLM_BASE_URL must be a valid URL").optional(),
  MEMORY_LLM_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  MEMORY_LLM_API_KEY: z.string().optional(),
  MEMORY_LLM_PROTOCOL: z.enum(["anthropic", "openai-compatible", "openai-responses", "ollama"]).default("openai-compatible"),
  MEMORY_LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
  MEMORY_LLM_FALLBACK_ENABLED: booleanCoerceSchema.default(true),
  MEMORY_LLM_DEGRADED_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),
  MEMORY_LLM_RECOVERY_INTERVAL_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
  MEMORY_LLM_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  MEMORY_LLM_MAX_TOKENS: z.coerce.number().int().positive().optional(),
  RECALL_LLM_JUDGE_ENABLED: booleanCoerceSchema.default(true),
  RECALL_LLM_JUDGE_WAIT_MS: z.coerce.number().int().positive().default(5_000),
  RECALL_SEMANTIC_PREFETCH_ENABLED: booleanCoerceSchema.default(true),
  RECALL_LLM_JUDGE_MAX_TOKENS: z.coerce.number().int().positive().default(10000),
  RECALL_LLM_CANDIDATE_LIMIT: z.coerce.number().int().positive().max(50).default(12),
  MEMORY_LLM_REFINE_MAX_TOKENS: z.coerce.number().int().positive().default(800),
  WRITEBACK_REFINE_ENABLED: booleanCoerceSchema.default(true),
  WRITEBACK_MAX_CANDIDATES: z.coerce.number().int().positive().max(5).default(3),
  WRITEBACK_OUTBOX_FLUSH_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  WRITEBACK_OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().max(200).default(50),
  WRITEBACK_OUTBOX_MAX_RETRIES: z.coerce.number().int().min(1).max(20).default(5),
  WRITEBACK_MAINTENANCE_ENABLED: booleanCoerceSchema.default(false),
  WRITEBACK_MAINTENANCE_INTERVAL_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  WRITEBACK_MAINTENANCE_WORKSPACE_INTERVAL_MS: z.coerce.number().int().positive().default(60 * 60 * 1000),
  WRITEBACK_MAINTENANCE_WORKSPACE_BATCH: z.coerce.number().int().min(1).max(20).default(3),
  WRITEBACK_MAINTENANCE_SEED_LIMIT: z.coerce.number().int().min(1).max(100).default(20),
  WRITEBACK_MAINTENANCE_RELATED_LIMIT: z.coerce.number().int().min(1).max(200).default(40),
  WRITEBACK_MAINTENANCE_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.35),
  WRITEBACK_MAINTENANCE_SEED_LOOKBACK_MS: z.coerce.number().int().positive().default(24 * 60 * 60 * 1000),
  WRITEBACK_MAINTENANCE_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS: z.coerce.number().int().positive().default(1500),
  WRITEBACK_MAINTENANCE_MAX_ACTIONS: z.coerce.number().int().min(1).max(100).default(10),
  WRITEBACK_MAINTENANCE_MIN_IMPORTANCE: z.coerce.number().int().min(1).max(5).default(2),
  WRITEBACK_MAINTENANCE_ACTOR_ID: z.string().min(1).default("retrieval-runtime-maintenance"),
  WRITEBACK_SESSION_EPISODIC_TTL_MS: z.coerce.number().int().positive().default(7 * 24 * 60 * 60 * 1000),
  WRITEBACK_GOVERNANCE_VERIFY_ENABLED: booleanCoerceSchema.default(true),
  WRITEBACK_GOVERNANCE_VERIFY_MAX_TOKENS: z.coerce.number().int().positive().default(1000),
  WRITEBACK_GOVERNANCE_ARCHIVE_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.85),
  WRITEBACK_GOVERNANCE_DELETE_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.92),
  WRITEBACK_GOVERNANCE_SHADOW_MODE: booleanCoerceSchema.default(false),
  FINALIZE_IDEMPOTENCY_TTL_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
  FINALIZE_IDEMPOTENCY_MAX_ENTRIES: z.coerce.number().int().positive().default(500),
  WRITEBACK_INPUT_OVERLAP_THRESHOLD: z.coerce.number().min(0).max(1).default(0.2),
  WRITEBACK_CROSS_REFERENCE_CONFIRMATION_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
  WRITEBACK_CROSS_REFERENCE_PARTIAL_MATCH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),
  QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(800),
  STORAGE_TIMEOUT_MS: z.coerce.number().int().positive().default(800),
  EMBEDDING_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  QUERY_CANDIDATE_LIMIT: z.coerce.number().int().positive().max(100).default(100),
  PACKET_RECORD_LIMIT: z.coerce.number().int().positive().max(20).default(10),
  INJECTION_RECORD_LIMIT: z.coerce.number().int().positive().max(10).default(5),
  INJECTION_TOKEN_BUDGET: z.coerce.number().int().positive().default(1500),
  INJECTION_DEDUP_ENABLED: booleanCoerceSchema.default(true),
  INJECTION_HARD_WINDOW_TURNS_FACT: z.coerce.number().int().min(0).default(5),
  INJECTION_HARD_WINDOW_TURNS_PREFERENCE: z.coerce.number().int().min(0).default(5),
  INJECTION_HARD_WINDOW_TURNS_TASK_STATE: z.coerce.number().int().min(0).default(3),
  INJECTION_HARD_WINDOW_TURNS_EPISODIC: z.coerce.number().int().min(0).default(2),
  INJECTION_HARD_WINDOW_MS_FACT: z.coerce.number().int().min(0).default(30 * 60 * 1000),
  INJECTION_HARD_WINDOW_MS_PREFERENCE: z.coerce.number().int().min(0).default(30 * 60 * 1000),
  INJECTION_HARD_WINDOW_MS_TASK_STATE: z.coerce.number().int().min(0).default(10 * 60 * 1000),
  INJECTION_HARD_WINDOW_MS_EPISODIC: z.coerce.number().int().min(0).default(5 * 60 * 1000),
  INJECTION_SOFT_WINDOW_MS_TASK_STATE: z.coerce.number().int().min(0).default(30 * 60 * 1000),
  INJECTION_SOFT_WINDOW_MS_EPISODIC: z.coerce.number().int().min(0).default(15 * 60 * 1000),
  INJECTION_RECENT_STATE_TTL_MS: z.coerce.number().int().positive().default(60 * 60 * 1000),
  INJECTION_RECENT_STATE_MAX_SESSIONS: z.coerce.number().int().positive().default(500),
  SEMANTIC_TRIGGER_THRESHOLD: z.coerce.number().min(0).max(1).default(0.72),
  SEMANTIC_TRIGGER_CANDIDATE_LIMIT: z.coerce.number().int().positive().max(100).default(30),
  SEMANTIC_TRIGGER_BEST_SCORE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
  SEMANTIC_TRIGGER_TOP3_AVG_THRESHOLD: z.coerce.number().min(0).max(1).default(0.75),
  SEMANTIC_TRIGGER_ABOVE_COUNT_THRESHOLD: z.coerce.number().int().positive().max(100).default(5),
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

  const runtimeGovernanceConfig = resolveRuntimeGovernanceConfig(parsed.data);
  const merged = {
    ...parsed.data,
    ...runtimeGovernanceConfig,
  };
  const reparsed = envSchema.safeParse(merged);

  if (!reparsed.success) {
    throw new ConfigurationError("Invalid retrieval-runtime managed configuration", reparsed.error.flatten());
  }

  return reparsed.data;
}
