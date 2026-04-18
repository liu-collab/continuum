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
  resolveHomeDirectory,
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
  homeDirectory: string;
}): LoadedConfigLayer[] {
  const globalCandidates = [
    path.join(options.homeDirectory, ".mna", "config.yaml"),
    path.join(options.homeDirectory, ".mna", "config.yml"),
    path.join(options.homeDirectory, ".mna", "config.json"),
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
}, env: NodeJS.ProcessEnv) {
  if (provider.kind === "ollama") {
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
  const homeDirectory = resolveHomeDirectory(env);
  const configuredCwd = options.cwdOverride ?? process.cwd();
  const normalizedCwd = normalizeWorkspacePath(configuredCwd);
  const layers = buildCandidateConfigFiles({
    configPath: options.configPath,
    cwd: normalizedCwd,
    homeDirectory,
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

  validateProviderEnvironment(parsed.data.provider, env);

  const userId = resolveUserId(parsed.data.memory.user_id, homeDirectory);
  const workspaceId = deriveWorkspaceId(normalizedCwd);
  persistWorkspaceMapping(homeDirectory, normalizedCwd, workspaceId);

  return {
    runtime: {
      baseUrl: parsed.data.runtime.base_url,
      requestTimeoutMs: parsed.data.runtime.request_timeout_ms,
      finalizeTimeoutMs: parsed.data.runtime.finalize_timeout_ms,
    },
    provider: {
      kind: parsed.data.provider.kind,
      model: parsed.data.provider.model,
      baseUrl: parsed.data.provider.base_url,
      apiKeyEnv: parsed.data.provider.api_key_env,
      temperature: parsed.data.provider.temperature,
      organization: parsed.data.provider.organization,
      keepAlive: parsed.data.provider.keep_alive,
    },
    memory: {
      mode: parsed.data.memory.mode,
      userId,
      workspaceId,
      cwd: normalizedCwd,
    },
    mcp: {
      servers: parsed.data.mcp.servers.map((server) => ({
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
        enabled: parsed.data.tools.shell_exec.enabled,
        timeoutMs: parsed.data.tools.shell_exec.timeout_ms,
        denyPatterns: parsed.data.tools.shell_exec.deny_patterns,
      },
    },
    cli: {
      systemPrompt: resolveSystemPrompt({
        filePath: parsed.data.cli.system_prompt_file,
        sourceConfigPath: systemPromptSourcePath,
      }),
    },
    locale: resolveLocale(parsed.data.locale, env),
  };
}

export {
  deriveWorkspaceId,
  normalizeWorkspacePath,
  resolveLocale,
  resolveUserId,
};
