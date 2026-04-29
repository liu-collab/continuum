import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parse as parseYaml } from "yaml";

import {
  DEFAULT_RAW_CONFIG,
} from "./defaults.js";
import {
  configFileSchema,
  memoryModeSchema,
  mergedConfigSchema,
  type ConfigFileInput,
  type Locale,
  type MemoryMode,
  type PlanMode,
  type ProviderKind,
} from "./schema.js";
import {
  deriveWorkspaceId,
  normalizeWorkspacePath,
  persistWorkspaceMapping,
  resolveMnaHomeDirectory,
  resolveLocale,
  resolveUserId,
} from "./resolver.js";

export interface ProviderConfig {
  kind: ProviderKind;
  model: string;
  baseUrl: string;
  apiKey?: string;
  apiKeyEnv?: string;
  temperature: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max" | null;
  maxTokens?: number | null;
  organization?: string;
  keepAlive?: string | number;
  fixtureDir?: string;
  fixtureName?: string;
  recordReplayTarget?: Exclude<ProviderKind, "record-replay" | "not-configured">;
}

export interface McpServerConfig {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  cwd?: string;
  startup_timeout_ms?: number;
  request_timeout_ms?: number;
  reconnect_on_failure?: boolean;
}

export interface AgentConfig {
  runtime: {
    baseUrl: string;
    requestTimeoutMs: number;
    finalizeTimeoutMs: number;
  };
  provider: ProviderConfig;
  memory: {
    mode: MemoryMode;
    userId: string;
    workspaceId: string;
    cwd: string;
    injectionTokenBudget: number;
  };
  mcp: {
    servers: McpServerConfig[];
  };
  tools: {
    maxOutputChars: number;
    approvalMode: "confirm" | "yolo";
    shellExec: {
      enabled: boolean;
      timeoutMs: number;
      denyPatterns: string[];
    };
  };
  cli: {
    systemPrompt: string | null;
  };
  context: {
    maxTokens: number | null;
    reserveTokens: number;
    compactionStrategy: "truncate" | "summarize";
  };
  planning: {
    planMode: PlanMode;
  };
  logging: {
    level: "silent" | "error" | "warn" | "info" | "debug" | "trace";
    format: "json" | "pretty";
  };
  streaming: {
    flushChars: number;
    flushIntervalMs: number;
  };
  skills: {
    enabled: boolean;
    autoDiscovery: boolean;
    discoveryPaths: string[];
  };
  locale: Locale;
}

export interface LoadConfigOptions {
  configPath?: string;
  cwdOverride?: string;
  memoryModeOverride?: MemoryMode;
  env?: NodeJS.ProcessEnv;
}

type LoadedConfigLayer = {
  path: string;
  data: ConfigFileInput;
  required: boolean;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override as T) ?? base;
  }

  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) {
      continue;
    }

    const current = result[key];
    if (Array.isArray(value)) {
      result[key] = [...value];
      continue;
    }

    if (isPlainObject(current) && isPlainObject(value)) {
      result[key] = deepMerge(current, value);
      continue;
    }

    result[key] = value;
  }

  return result as T;
}

function formatValidationError(prefix: string, error: { issues: Array<{ path: Array<string | number>; message: string }> }): string {
  return `${prefix}: ${error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ")}`;
}

function parseConfigFile(filePath: string): ConfigFileInput {
  const content = readFileSync(filePath, "utf8");
  const extension = path.extname(filePath).toLowerCase();
  const raw =
    extension === ".json"
      ? JSON.parse(content)
      : parseYaml(content);
  const normalizedRaw = normalizeLegacyConfig(raw);

  const parsed = configFileSchema.safeParse(normalizedRaw);
  if (!parsed.success) {
    throw new Error(formatValidationError(`Invalid config file ${filePath}`, parsed.error));
  }

  return parsed.data;
}

function normalizeLegacyConfig(raw: unknown) {
  return raw;
}

function buildCandidateConfigFiles(options: {
  configPath?: string;
  cwd: string;
  mnaHomeDirectory: string;
}): LoadedConfigLayer[] {
  const globalCandidates = [
    path.join(options.mnaHomeDirectory, "config.yaml"),
    path.join(options.mnaHomeDirectory, "config.yml"),
    path.join(options.mnaHomeDirectory, "config.json"),
  ];
  const localCandidates = [
    path.join(options.cwd, ".mna", "config.yaml"),
    path.join(options.cwd, ".mna", "config.yml"),
    path.join(options.cwd, ".mna", "config.json"),
  ];

  const pickedGlobal = globalCandidates.find((candidate) => existsSync(candidate));
  const pickedLocal = localCandidates.find((candidate) => existsSync(candidate));
  const layers: LoadedConfigLayer[] = [];

  if (pickedGlobal) {
    layers.push({ path: pickedGlobal, data: parseConfigFile(pickedGlobal), required: false });
  }

  if (pickedLocal) {
    layers.push({ path: pickedLocal, data: parseConfigFile(pickedLocal), required: false });
  }

  if (options.configPath) {
    const explicitPath = path.resolve(options.configPath);
    if (!existsSync(explicitPath)) {
      throw new Error(`Config file not found: ${explicitPath}`);
    }

    layers.push({ path: explicitPath, data: parseConfigFile(explicitPath), required: true });
  }

  return layers;
}

function resolveSystemPrompt(options: {
  filePath: string | null;
  sourceConfigPath: string | null;
}): string | null {
  if (!options.filePath) {
    return null;
  }

  const resolvedPath = path.isAbsolute(options.filePath)
    ? options.filePath
    : path.resolve(options.sourceConfigPath ? path.dirname(options.sourceConfigPath) : process.cwd(), options.filePath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`System prompt file not found: ${resolvedPath}`);
  }

  return readFileSync(resolvedPath, "utf8");
}

function validateProviderEnvironment(provider: {
  kind: ProviderKind;
  record_replay_target?: Exclude<ProviderKind, "record-replay" | "not-configured">;
}, env: NodeJS.ProcessEnv) {
  if (provider.kind === "record-replay") {
    // record-replay missing target should not block startup.
    // provider-factory will surface it as misconfigured at runtime when needed.
    return;
  }
}

export function loadConfig(options: LoadConfigOptions = {}): AgentConfig {
  const env = options.env ?? process.env;
  const mnaHomeDirectory = resolveMnaHomeDirectory(env);
  const configuredCwd = options.cwdOverride ?? process.cwd();
  const normalizedCwd = normalizeWorkspacePath(configuredCwd);
  const layers = buildCandidateConfigFiles({
    configPath: options.configPath,
    cwd: normalizedCwd,
    mnaHomeDirectory,
  });

  let merged = structuredClone(DEFAULT_RAW_CONFIG);
  let systemPromptSourcePath: string | null = null;

  for (const layer of layers) {
    merged = deepMerge(merged, layer.data);
    if (layer.data.cli?.system_prompt_file !== undefined) {
      systemPromptSourcePath = layer.path;
    }
  }

  if (options.memoryModeOverride) {
    merged.memory.mode = memoryModeSchema.parse(options.memoryModeOverride);
  }

  const parsed = mergedConfigSchema.safeParse(merged);
  if (!parsed.success) {
    throw new Error(formatValidationError("Invalid merged config", parsed.error));
  }

  let effectiveConfig = parsed.data;

  if (
    env.RUNTIME_BASE_URL
    || env.RUNTIME_REQUEST_TIMEOUT_MS
    || env.RUNTIME_FINALIZE_TIMEOUT_MS
  ) {
    const reparsed = mergedConfigSchema.safeParse({
      ...effectiveConfig,
      runtime: {
        ...effectiveConfig.runtime,
        base_url: env.RUNTIME_BASE_URL?.trim() || effectiveConfig.runtime.base_url,
        request_timeout_ms:
          env.RUNTIME_REQUEST_TIMEOUT_MS && env.RUNTIME_REQUEST_TIMEOUT_MS.trim().length > 0
            ? Number(env.RUNTIME_REQUEST_TIMEOUT_MS)
            : effectiveConfig.runtime.request_timeout_ms,
        finalize_timeout_ms:
          env.RUNTIME_FINALIZE_TIMEOUT_MS && env.RUNTIME_FINALIZE_TIMEOUT_MS.trim().length > 0
            ? Number(env.RUNTIME_FINALIZE_TIMEOUT_MS)
            : effectiveConfig.runtime.finalize_timeout_ms,
      },
    });
    if (!reparsed.success) {
      throw new Error(formatValidationError("Invalid runtime env override", reparsed.error));
    }
    effectiveConfig = reparsed.data;
  }

  if (env.MNA_MEMORY_INJECTION_TOKEN_BUDGET || env.INJECTION_TOKEN_BUDGET) {
    const rawBudget = env.MNA_MEMORY_INJECTION_TOKEN_BUDGET?.trim() || env.INJECTION_TOKEN_BUDGET?.trim();
    const reparsed = mergedConfigSchema.safeParse({
      ...effectiveConfig,
      memory: {
        ...effectiveConfig.memory,
        injection_token_budget:
          rawBudget && rawBudget.length > 0
            ? Number(rawBudget)
            : effectiveConfig.memory.injection_token_budget,
      },
    });
    if (!reparsed.success) {
      throw new Error(formatValidationError("Invalid memory env override", reparsed.error));
    }
    effectiveConfig = reparsed.data;
  }

  if (
    env.MNA_PROVIDER_KIND
    || env.MNA_PROVIDER_MODEL
    || env.MNA_PROVIDER_BASE_URL
    || env.MNA_PROVIDER_API_KEY
    || env.MNA_PROVIDER_API_KEY_ENV
    || env.MNA_FIXTURE_DIR
    || env.MNA_FIXTURE_NAME
    || env.MNA_REC_TARGET
  ) {
    const envProviderKind = env.MNA_PROVIDER_KIND?.trim();
    const reparsed = mergedConfigSchema.safeParse({
      ...effectiveConfig,
      provider: {
        ...effectiveConfig.provider,
        kind: (envProviderKind as ProviderKind | undefined) ?? effectiveConfig.provider.kind,
        model: env.MNA_PROVIDER_MODEL?.trim() || effectiveConfig.provider.model,
        base_url: env.MNA_PROVIDER_BASE_URL?.trim() || effectiveConfig.provider.base_url,
        api_key: env.MNA_PROVIDER_API_KEY?.trim() || effectiveConfig.provider.api_key,
        api_key_env: env.MNA_PROVIDER_API_KEY_ENV?.trim() || effectiveConfig.provider.api_key_env,
        fixture_dir: env.MNA_FIXTURE_DIR?.trim() || effectiveConfig.provider.fixture_dir,
        fixture_name: env.MNA_FIXTURE_NAME?.trim() || effectiveConfig.provider.fixture_name,
        record_replay_target:
          (env.MNA_REC_TARGET?.trim() as Exclude<ProviderKind, "record-replay" | "not-configured"> | undefined)
          ?? effectiveConfig.provider.record_replay_target,
      },
    });
    if (!reparsed.success) {
      throw new Error(formatValidationError("Invalid provider env override", reparsed.error));
    }
    effectiveConfig = reparsed.data;
  }

  validateProviderEnvironment(effectiveConfig.provider, env);

  const userId = resolveUserId(effectiveConfig.memory.user_id, mnaHomeDirectory);
  const workspaceId = deriveWorkspaceId(normalizedCwd);
  persistWorkspaceMapping(mnaHomeDirectory, normalizedCwd, workspaceId);

  return {
    runtime: {
      baseUrl: effectiveConfig.runtime.base_url,
      requestTimeoutMs: effectiveConfig.runtime.request_timeout_ms,
      finalizeTimeoutMs: effectiveConfig.runtime.finalize_timeout_ms,
    },
    provider: {
      kind: effectiveConfig.provider.kind,
      model: effectiveConfig.provider.model,
      baseUrl: effectiveConfig.provider.base_url,
      apiKey: effectiveConfig.provider.api_key,
      apiKeyEnv: effectiveConfig.provider.api_key_env,
      temperature: effectiveConfig.provider.temperature,
      effort: effectiveConfig.provider.effort,
      maxTokens: effectiveConfig.provider.max_tokens,
      organization: effectiveConfig.provider.organization,
      keepAlive: effectiveConfig.provider.keep_alive,
      fixtureDir: effectiveConfig.provider.fixture_dir,
      fixtureName: effectiveConfig.provider.fixture_name,
      recordReplayTarget: effectiveConfig.provider.record_replay_target,
    },
    memory: {
      mode: effectiveConfig.memory.mode,
      userId,
      workspaceId,
      cwd: normalizedCwd,
      injectionTokenBudget: effectiveConfig.memory.injection_token_budget,
    },
    mcp: {
      servers: effectiveConfig.mcp.servers.map((server) => ({
        name: server.name,
        transport: server.transport,
        command: server.command,
        args: server.args,
        env: server.env,
        url: server.url,
        headers: server.headers,
        cwd: server.cwd,
        startup_timeout_ms: server.startup_timeout_ms,
        request_timeout_ms: server.request_timeout_ms,
        reconnect_on_failure: server.reconnect_on_failure,
      })),
    },
    tools: {
      maxOutputChars: effectiveConfig.tools.max_output_chars,
      approvalMode: effectiveConfig.tools.approval_mode,
      shellExec: {
        enabled: effectiveConfig.tools.shell_exec.enabled,
        timeoutMs: effectiveConfig.tools.shell_exec.timeout_ms,
        denyPatterns: effectiveConfig.tools.shell_exec.deny_patterns,
      },
    },
    cli: {
      systemPrompt: resolveSystemPrompt({
        filePath: effectiveConfig.cli.system_prompt_file,
        sourceConfigPath: systemPromptSourcePath,
      }),
    },
    context: {
      maxTokens: effectiveConfig.context.max_tokens,
      reserveTokens: effectiveConfig.context.reserve_tokens,
      compactionStrategy: effectiveConfig.context.compaction_strategy,
    },
    planning: {
      planMode: effectiveConfig.planning.plan_mode,
    },
    logging: {
      level: effectiveConfig.logging.level,
      format: effectiveConfig.logging.format,
    },
    streaming: {
      flushChars: effectiveConfig.streaming.flush_chars,
      flushIntervalMs: effectiveConfig.streaming.flush_interval_ms,
    },
    skills: {
      enabled: effectiveConfig.skills.enabled,
      autoDiscovery: effectiveConfig.skills.auto_discovery,
      discoveryPaths: [...effectiveConfig.skills.discovery_paths],
    },
    locale: resolveLocale(effectiveConfig.locale, env),
  };
}

export {
  deriveWorkspaceId,
  normalizeWorkspacePath,
  resolveLocale,
  resolveUserId,
};
