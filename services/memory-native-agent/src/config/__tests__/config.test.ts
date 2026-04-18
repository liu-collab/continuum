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
    expect(config.provider.kind).toBe("ollama");
    expect(config.memory.mode).toBe("workspace_plus_global");
    expect(config.memory.userId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(config.cli.systemPrompt).toBeNull();
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
memory:
  mode: workspace_only
tools:
  shell_exec:
    enabled: false
`,
    );
    writeYaml(
      path.join(workspaceDir, ".mna", "config.yaml"),
      `
runtime:
  request_timeout_ms: 1200
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

  it("persists identity and reuses the same user id", () => {
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

    expect(first.memory.userId).toBe(second.memory.userId);

    const identity = JSON.parse(readFileSync(path.join(homeDir, ".mna", "identity.json"), "utf8")) as { user_id: string };
    expect(identity.user_id).toBe(first.memory.userId);
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

  it("throws a clear error when provider api key env is missing", () => {
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

    expect(() =>
      loadConfig({
        cwdOverride: workspaceDir,
        env: {
          HOME: homeDir,
        },
      }),
    ).toThrow("Environment variable OPENAI_API_KEY is required");
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
});
