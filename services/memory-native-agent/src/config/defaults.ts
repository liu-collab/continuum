export const MNA_HOME_DIRNAME = ".mna";
export const IDENTITY_FILENAME = "identity.json";
export const WORKSPACE_MAP_FILENAME = "workspaces.json";
export const WORKSPACE_NAMESPACE_UUID = "8b7ee9a4-2fa7-54c3-a941-8e1b8db4f4d9";

export const DEFAULT_RUNTIME_BASE_URL = "http://127.0.0.1:3002";
export const DEFAULT_RUNTIME_REQUEST_TIMEOUT_MS = 800;
export const DEFAULT_RUNTIME_FINALIZE_TIMEOUT_MS = 1500;
export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";

export const DEFAULT_SHELL_DENY_PATTERNS = [
  "rm -rf /",
  "rm -rf ~",
  "sudo ",
  "curl * | sh",
  "wget * | sh",
  "del /f /s /q c:\\",
  "format c:",
];

export const DEFAULT_RAW_CONFIG = {
  runtime: {
    base_url: DEFAULT_RUNTIME_BASE_URL,
    request_timeout_ms: DEFAULT_RUNTIME_REQUEST_TIMEOUT_MS,
    finalize_timeout_ms: DEFAULT_RUNTIME_FINALIZE_TIMEOUT_MS,
  },
  provider: {
    kind: "ollama",
    model: "qwen2.5-coder",
    base_url: DEFAULT_OLLAMA_BASE_URL,
    temperature: 0.2,
  },
  memory: {
    mode: "workspace_plus_global",
    user_id: null,
  },
  mcp: {
    servers: [] as Array<{
      name: string;
      transport: "stdio" | "http";
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      url?: string;
      headers?: Record<string, string>;
    }>,
  },
  tools: {
    shell_exec: {
      enabled: true,
      timeout_ms: 30_000,
      deny_patterns: DEFAULT_SHELL_DENY_PATTERNS,
    },
  },
  cli: {
    system_prompt_file: null as string | null,
  },
  locale: undefined as "zh-CN" | "en-US" | undefined,
};
