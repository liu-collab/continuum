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
  apiKeyEnv?: string;
  temperature: number;
  organization?: string;
  keepAlive?: string | number;
  fixtureDir?: string;
  fixtureName?: string;
  recordReplayTarget?: Exclude<ProviderKind, "record-replay">;
}

export interface McpServerConfig {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
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
  };
  mcp: {
    servers: McpServerConfig[];
  };
  tools: {
    shellExec: {
      enabled: boolean;
      timeoutMs: number;
      denyPatterns: string[];
    };
  };
  cli: {
    systemPrompt: string | null;
  };
  streaming: {
    flushChars: number;
    flushIntervalMs: number;
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

  const parsed = configFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(formatValidationError(`Invalid config file ${filePath}`, parsed.error));
  }

  return parsed.data;
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
  api_key_env?: string;
  record_replay_target?: Exclude<ProviderKind, "record-replay">;
}, env: NodeJS.ProcessEnv) {
  if (provider.kind === "record-replay") {
    const mode = env.MNA_PROVIDER_MODE?.trim();
    const target = env.MNA_REC_TARGET?.trim() || provider.record_replay_target;
    if ((mode === "record" || mode === "live") && !target) {
      throw new Error("record-replay provider requires MNA_REC_TARGET or provider.record_replay_target in live/record mode");
    }
    return;
  }

  if (provider.kind === "ollama" || provider.kind === "demo") {
    return;
  }

  if (!provider.api_key_env) {
    throw new Error(`provider.api_key_env is required for provider kind "${provider.kind}"`);
  }

  const actualValue = env[provider.api_key_env];
  if (!actualValue || actualValue.trim().length === 0) {
    throw new Error(`Environment variable ${provider.api_key_env} is required for provider kind "${provider.kind}"`);
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
    env.MNA_PROVIDER_KIND
    || env.MNA_PROVIDER_MODEL
    || env.MNA_PROVIDER_BASE_URL
    || env.MNA_PROVIDER_API_KEY_ENV
    || env.MNA_FIXTURE_DIR
    || env.MNA_FIXTURE_NAME
    || env.MNA_REC_TARGET
  ) {
    const reparsed = mergedConfigSchema.safeParse({
      ...parsed.data,
      provider: {
        ...parsed.data.provider,
        kind: (env.MNA_PROVIDER_KIND as ProviderKind | undefined) ?? parsed.data.provider.kind,
        model: env.MNA_PROVIDER_MODEL?.trim() || parsed.data.provider.model,
        base_url: env.MNA_PROVIDER_BASE_URL?.trim() || parsed.data.provider.base_url,
        api_key_env: env.MNA_PROVIDER_API_KEY_ENV?.trim() || parsed.data.provider.api_key_env,
        fixture_dir: env.MNA_FIXTURE_DIR?.trim() || parsed.data.provider.fixture_dir,
        fixture_name: env.MNA_FIXTURE_NAME?.trim() || parsed.data.provider.fixture_name,
        record_replay_target:
          (env.MNA_REC_TARGET?.trim() as Exclude<ProviderKind, "record-replay"> | undefined)
          ?? parsed.data.provider.record_replay_target,
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
      apiKeyEnv: effectiveConfig.provider.api_key_env,
      temperature: effectiveConfig.provider.temperature,
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
      })),
    },
    tools: {
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
    streaming: {
      flushChars: effectiveConfig.streaming.flush_chars,
      flushIntervalMs: effectiveConfig.streaming.flush_interval_ms,
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
