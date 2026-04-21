import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../index.js";

function createTempDir(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function writeYaml(filePath: string, content: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content.trimStart(), "utf8");
}

describe("config loader", () => {
  const createdRoots: string[] = [];

  afterEach(() => {
    createdRoots.splice(0);
  });

  it("loads defaults when no config files exist", () => {
    const homeDir = createTempDir("mna-home-");
    const workspaceDir = createTempDir("mna-workspace-");
    createdRoots.push(homeDir, workspaceDir);

    const config = loadConfig({
      cwdOverride: workspaceDir,
      env: {
        HOME: homeDir,
      },
    });

    expect(config.runtime.baseUrl).toBe("http://127.0.0.1:3002");
    expect(config.provider.kind).toBe("demo");
    expect(config.provider.model).toBe("continuum-demo");
    expect(config.provider.effort).toBeNull();
    expect(config.provider.maxTokens).toBeNull();
    expect(config.memory.mode).toBe("workspace_plus_global");
    expect(config.memory.userId).toBe("00000000-0000-4000-8000-000000000001");
    expect(config.cli.systemPrompt).toBeNull();
    expect(config.tools.maxOutputChars).toBe(8192);
    expect(config.context.maxTokens).toBeNull();
    expect(config.context.reserveTokens).toBe(4096);
    expect(config.logging.level).toBe("info");
    expect(config.streaming.flushChars).toBe(32);
    expect(config.streaming.flushIntervalMs).toBe(30);
  });

  it("merges global and local config by field precedence", () => {
    const homeDir = createTempDir("mna-home-");
    const workspaceDir = createTempDir("mna-workspace-");
    createdRoots.push(homeDir, workspaceDir);

    writeYaml(
      path.join(homeDir, ".mna", "config.yaml"),
      `
runtime:
  base_url: http://127.0.0.1:3999
provider:
  kind: ollama
  model: qwen2.5-coder:7b
  base_url: http://127.0.0.1:11434
  effort: high
  max_tokens: 8192
memory:
  mode: workspace_only
tools:
  max_output_chars: 4096
  shell_exec:
    enabled: false
`,
    );
    writeYaml(
      path.join(workspaceDir, ".mna", "config.yaml"),
      `
runtime:
  request_timeout_ms: 1200
context:
  max_tokens: 64000
logging:
  level: debug
tools:
  shell_exec:
    enabled: true
    timeout_ms: 45000
    deny_patterns:
      - git reset --hard
`,
    );

    const config = loadConfig({
      cwdOverride: workspaceDir,
      env: {
        HOME: homeDir,
      },
    });

    expect(config.runtime.baseUrl).toBe("http://127.0.0.1:3999");
    expect(config.runtime.requestTimeoutMs).toBe(1200);
    expect(config.memory.mode).toBe("workspace_only");
    expect(config.provider.effort).toBe("high");
    expect(config.provider.maxTokens).toBe(8192);
    expect(config.tools.maxOutputChars).toBe(4096);
    expect(config.context.maxTokens).toBe(64000);
    expect(config.logging.level).toBe("debug");
    expect(config.tools.shellExec.enabled).toBe(true);
    expect(config.tools.shellExec.timeoutMs).toBe(45000);
    expect(config.tools.shellExec.denyPatterns).toEqual(["git reset --hard"]);
  });

  it("lets explicit config override local and global config", () => {
    const homeDir = createTempDir("mna-home-");
    const workspaceDir = createTempDir("mna-workspace-");
    const explicitDir = createTempDir("mna-explicit-");
    createdRoots.push(homeDir, workspaceDir, explicitDir);

    writeYaml(
      path.join(homeDir, ".mna", "config.yaml"),
      `
provider:
  kind: ollama
  model: qwen-from-home
  base_url: http://127.0.0.1:11434
`,
    );
    writeYaml(
      path.join(workspaceDir, ".mna", "config.yaml"),
      `
provider:
  model: qwen-from-local
`,
    );
    writeJson(path.join(explicitDir, "config.json"), {
      provider: {
        model: "qwen-from-explicit",
      },
    });

    const config = loadConfig({
      configPath: path.join(explicitDir, "config.json"),
      cwdOverride: workspaceDir,
      env: {
        HOME: homeDir,
      },
    });

    expect(config.provider.model).toBe("qwen-from-explicit");
  });

  it("uses the platform user id by default", () => {
    const homeDir = createTempDir("mna-home-");
    const workspaceDir = createTempDir("mna-workspace-");
    createdRoots.push(homeDir, workspaceDir);

    const first = loadConfig({
      cwdOverride: workspaceDir,
      env: {
        HOME: homeDir,
      },
    });
    const second = loadConfig({
      cwdOverride: workspaceDir,
      env: {
        HOME: homeDir,
      },
    });

    expect(first.memory.userId).toBe("00000000-0000-4000-8000-000000000001");
    expect(second.memory.userId).toBe("00000000-0000-4000-8000-000000000001");
  });

  it("keeps workspace id stable for the same path", () => {
    const homeDir = createTempDir("mna-home-");
    const workspaceDir = createTempDir("mna-workspace-");
    createdRoots.push(homeDir, workspaceDir);

    const first = loadConfig({
      cwdOverride: workspaceDir,
      env: {
        HOME: homeDir,
      },
    });
    const second = loadConfig({
      cwdOverride: path.join(workspaceDir, "."),
      env: {
        HOME: homeDir,
      },
    });

    expect(first.memory.workspaceId).toBe(second.memory.workspaceId);
  });

  it("writes workspace mapping for debugging", () => {
    const homeDir = createTempDir("mna-home-");
    const workspaceDir = createTempDir("mna-workspace-");
    createdRoots.push(homeDir, workspaceDir);

    const config = loadConfig({
      cwdOverride: workspaceDir,
      env: {
        HOME: homeDir,
      },
    });

    const mappings = JSON.parse(readFileSync(path.join(homeDir, ".mna", "workspaces.json"), "utf8")) as Record<string, string>;
    expect(mappings[config.memory.cwd]).toBe(config.memory.workspaceId);
  });

  it("lets memoryModeOverride replace config value", () => {
    const homeDir = createTempDir("mna-home-");
    const workspaceDir = createTempDir("mna-workspace-");
    createdRoots.push(homeDir, workspaceDir);

    writeYaml(
      path.join(homeDir, ".mna", "config.yaml"),
      `
memory:
  mode: workspace_only
`,
    );

    const config = loadConfig({
      cwdOverride: workspaceDir,
      memoryModeOverride: "workspace_plus_global",
      env: {
        HOME: homeDir,
      },
    });

    expect(config.memory.mode).toBe("workspace_plus_global");
  });

  it("loads system prompt files relative to the config file", () => {
    const homeDir = createTempDir("mna-home-");
    const workspaceDir = createTempDir("mna-workspace-");
    createdRoots.push(homeDir, workspaceDir);

    writeYaml(
      path.join(workspaceDir, ".mna", "config.yaml"),
      `
cli:
  system_prompt_file: prompts/custom.txt
`,
    );
    writeYaml(
      path.join(workspaceDir, ".mna", "prompts", "custom.txt"),
      `
这是一个自定义 system prompt。
`,
    );

    const config = loadConfig({
      cwdOverride: workspaceDir,
      env: {
        HOME: homeDir,
      },
    });

    expect(config.cli.systemPrompt).toContain("自定义 system prompt");
  });

  it("allows provider config to load even when api key env is not yet available", () => {
    const homeDir = createTempDir("mna-home-");
    const workspaceDir = createTempDir("mna-workspace-");
    createdRoots.push(homeDir, workspaceDir);

    writeYaml(
      path.join(homeDir, ".mna", "config.yaml"),
      `
provider:
  kind: openai-compatible
  model: gpt-4.1-mini
  base_url: https://api.openai.com
  api_key_env: OPENAI_API_KEY
`,
    );

    const config = loadConfig({
      cwdOverride: workspaceDir,
      env: {
        HOME: homeDir,
      },
    });

    expect(config.provider.kind).toBe("openai-compatible");
    expect(config.provider.apiKeyEnv).toBe("OPENAI_API_KEY");
    expect(config.provider.apiKey).toBeUndefined();
  });

  it("supports inline provider api key from config file", () => {
    const homeDir = createTempDir("mna-home-");
    const workspaceDir = createTempDir("mna-workspace-");
    createdRoots.push(homeDir, workspaceDir);

    writeYaml(
      path.join(homeDir, ".mna", "config.yaml"),
      `
provider:
  kind: openai-compatible
  model: gpt-4.1-mini
  base_url: https://api.openai.com/v1
  api_key: demo-inline-key
`,
    );

    const config = loadConfig({
      cwdOverride: workspaceDir,
      env: {
        HOME: homeDir,
      },
    });

    expect(config.provider.kind).toBe("openai-compatible");
    expect(config.provider.apiKey).toBe("demo-inline-key");
    expect(config.provider.apiKeyEnv).toBeUndefined();
  });

  it("throws when memory mode is invalid", () => {
    const homeDir = createTempDir("mna-home-");
    const workspaceDir = createTempDir("mna-workspace-");
    createdRoots.push(homeDir, workspaceDir);

    writeYaml(
      path.join(homeDir, ".mna", "config.yaml"),
      `
memory:
  mode: invalid_mode
`,
    );

    expect(() =>
      loadConfig({
        cwdOverride: workspaceDir,
        env: {
          HOME: homeDir,
        },
      }),
    ).toThrow("Invalid config file");
  });

  it("prefers config locale over env locale", () => {
    const homeDir = createTempDir("mna-home-");
    const workspaceDir = createTempDir("mna-workspace-");
    createdRoots.push(homeDir, workspaceDir);

    writeYaml(
      path.join(homeDir, ".mna", "config.yaml"),
      `
locale: en-US
`,
    );

    const config = loadConfig({
      cwdOverride: workspaceDir,
      env: {
        HOME: homeDir,
        MNA_LOCALE: "zh-CN",
      },
    });

    expect(config.locale).toBe("en-US");
  });

  it("prefers MNA_HOME over HOME and USERPROFILE", () => {
    const managedHome = createTempDir("mna-managed-home-");
    const workspaceDir = createTempDir("mna-workspace-");
    const unusedHome = createTempDir("mna-unused-home-");
    const unusedUserProfile = createTempDir("mna-unused-userprofile-");
    createdRoots.push(managedHome, workspaceDir, unusedHome, unusedUserProfile);

    writeYaml(
      path.join(managedHome, "config.yaml"),
      `
provider:
  kind: demo
  model: qwen-from-managed-home
  base_url: http://127.0.0.1:11434
`,
    );

    const config = loadConfig({
      cwdOverride: workspaceDir,
      env: {
        HOME: unusedHome,
        USERPROFILE: unusedUserProfile,
        MNA_HOME: managedHome,
      },
    });

    expect(config.provider.model).toBe("qwen-from-managed-home");
  });

  it("allows provider env overrides for managed startup", () => {
    const homeDir = createTempDir("mna-home-");
    const workspaceDir = createTempDir("mna-workspace-");
    createdRoots.push(homeDir, workspaceDir);

    const config = loadConfig({
      cwdOverride: workspaceDir,
      env: {
        HOME: homeDir,
        MNA_PROVIDER_KIND: "openai-compatible",
        MNA_PROVIDER_MODEL: "deepseek-chat",
        MNA_PROVIDER_BASE_URL: "https://api.deepseek.com",
        MNA_PROVIDER_API_KEY_ENV: "DEEPSEEK_API_KEY",
        DEEPSEEK_API_KEY: "demo-key",
      },
    });

    expect(config.provider.kind).toBe("openai-compatible");
    expect(config.provider.model).toBe("deepseek-chat");
    expect(config.provider.baseUrl).toBe("https://api.deepseek.com");
    expect(config.provider.apiKeyEnv).toBe("DEEPSEEK_API_KEY");
  });

  it("allows runtime env overrides for managed startup", () => {
    const homeDir = createTempDir("mna-home-");
    const workspaceDir = createTempDir("mna-workspace-");
    createdRoots.push(homeDir, workspaceDir);

    const config = loadConfig({
      cwdOverride: workspaceDir,
      env: {
        HOME: homeDir,
        RUNTIME_BASE_URL: "http://127.0.0.1:3999",
        RUNTIME_REQUEST_TIMEOUT_MS: "1200",
        RUNTIME_FINALIZE_TIMEOUT_MS: "3200",
      },
    });

    expect(config.runtime.baseUrl).toBe("http://127.0.0.1:3999");
    expect(config.runtime.requestTimeoutMs).toBe(1200);
    expect(config.runtime.finalizeTimeoutMs).toBe(3200);
  });

  it("allows record-replay provider env overrides for fixture and target settings", () => {
    const homeDir = createTempDir("mna-home-");
    const workspaceDir = createTempDir("mna-workspace-");
    createdRoots.push(homeDir, workspaceDir);

    const config = loadConfig({
      cwdOverride: workspaceDir,
      env: {
        HOME: homeDir,
        MNA_PROVIDER_KIND: "record-replay",
        MNA_PROVIDER_MODEL: "fixture-model",
        MNA_PROVIDER_BASE_URL: "http://127.0.0.1:11434",
        MNA_FIXTURE_DIR: "tests/fixtures/model-record-replay",
        MNA_FIXTURE_NAME: "agent-ui",
        MNA_REC_TARGET: "ollama",
        MNA_PROVIDER_MODE: "replay",
      },
    });

    expect(config.provider.kind).toBe("record-replay");
    expect(config.provider.fixtureDir).toBe("tests/fixtures/model-record-replay");
    expect(config.provider.fixtureName).toBe("agent-ui");
    expect(config.provider.recordReplayTarget).toBe("ollama");
  });

  it("does not block startup when record-replay target is missing", () => {
    const homeDir = createTempDir("mna-home-");
    const workspaceDir = createTempDir("mna-workspace-");
    createdRoots.push(homeDir, workspaceDir);

    const config = loadConfig({
      cwdOverride: workspaceDir,
      env: {
        HOME: homeDir,
        MNA_PROVIDER_KIND: "record-replay",
        MNA_PROVIDER_MODEL: "fixture-model",
        MNA_PROVIDER_BASE_URL: "http://127.0.0.1:11434",
        MNA_FIXTURE_DIR: "tests/fixtures/model-record-replay",
        MNA_FIXTURE_NAME: "agent-ui",
        MNA_PROVIDER_MODE: "record",
      },
    });

    expect(config.provider.kind).toBe("record-replay");
    expect(config.provider.recordReplayTarget).toBeUndefined();
  });

  it("normalizes mixed Windows separators and drive-letter casing before deriving workspace id", () => {
    const cwd = process.cwd();
    const root = path.parse(cwd).root;
    if (!/^[A-Za-z]:\\?$/.test(root)) {
      const first = loadConfig({ cwdOverride: cwd });
      const second = loadConfig({ cwdOverride: cwd });
      expect(first.memory.workspaceId).toBe(second.memory.workspaceId);
      return;
    }

    const relative = path.relative(root, cwd);
    const loweredRoot = `${root[0]?.toLowerCase()}:${root.slice(2).replace(/\\/g, "/")}`;
    const variant = `${loweredRoot}${relative.replace(/\\/g, "/")}/`;

    const first = loadConfig({ cwdOverride: cwd });
    const second = loadConfig({ cwdOverride: variant });
    expect(first.memory.workspaceId).toBe(second.memory.workspaceId);
  });
});
