import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const DEFAULT_RUNTIME_URL = "http://127.0.0.1:3002";
export const DEFAULT_STORAGE_URL = "http://127.0.0.1:3001";
export const DEFAULT_UI_URL = "http://127.0.0.1:3003";
export const DEFAULT_TIMEOUT_MS = 2000;
export const DEFAULT_CODEX_MCP_SERVER_NAME = "memory";

export function packageRootFromImportMeta(importMetaUrl: string) {
  const currentFile = fileURLToPath(importMetaUrl);
  const currentDir = path.dirname(currentFile);
  const parentDirName = path.basename(path.dirname(currentDir));
  const grandparentDirName = path.basename(path.dirname(path.dirname(currentDir)));

  if (parentDirName === "src" && grandparentDirName === "dist") {
    return path.resolve(currentDir, "..", "..", "..");
  }

  return path.resolve(currentDir, "..", "..");
}

export function vendorPath(packageRoot: string, ...segments: string[]) {
  return path.join(packageRoot, "vendor", ...segments);
}

export async function pathExists(targetPath: string) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function fetchJson(
  url: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status?: number; body?: unknown; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body: text ? parseJsonResponse(text) : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function parseJsonResponse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class AppError extends Error {
  readonly code: string;
  readonly hint?: string;
  readonly filePath?: string;

  constructor(
    message: string,
    options: {
      code: string;
      hint?: string;
      filePath?: string;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = options.code;
    this.hint = options.hint;
    this.filePath = options.filePath;
  }
}

export function safeJsonParse<T>(filePath: string, raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new AppError(`配置文件损坏: ${filePath}`, {
      code: "config_corrupted",
      hint: "请删除该文件后重新运行",
      filePath,
      cause: error,
    });
  }
}

export async function openBrowser(url: string) {
  const platform = process.platform;
  if (platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], {
      stdio: "ignore",
      detached: true,
    }).unref();
    return;
  }

  const command = platform === "darwin" ? "open" : "xdg-open";
  spawn(command, [url], {
    stdio: "ignore",
    detached: true,
  }).unref();
}

type RunCommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  captureOutput?: boolean;
};

export async function runCommand(command: string, args: string[], options: RunCommandOptions = {}) {
  const { cwd, env, captureOutput = false } = options;

  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child =
      process.platform === "win32"
        ? spawn("cmd", ["/c", command, ...args], {
            cwd,
            env,
            stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
          })
        : spawn(command, args, {
            cwd,
            env,
            stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
          });

    let stdout = "";
    let stderr = "";

    if (captureOutput) {
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk) => {
        stderr += chunk;
      });
    }

    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

export async function installClaudePlugin(options: {
  sourceDir: string;
  targetDir: string;
  force: boolean;
}) {
  const { sourceDir, targetDir, force } = options;
  const exists = await pathExists(targetDir);

  if (exists && !force) {
    throw new Error(`target already exists: ${targetDir}`);
  }

  if (exists) {
    await rm(targetDir, { recursive: true, force: true });
  }

  await mkdir(path.dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true });
}

export async function uninstallClaudePlugin(targetDir: string) {
  const exists = await pathExists(targetDir);
  if (!exists) {
    return false;
  }

  await rm(targetDir, { recursive: true, force: true });
  return true;
}

function buildCodexCommandEnv(codexHome?: string) {
  return codexHome
    ? {
        ...process.env,
        CODEX_HOME: codexHome,
      }
    : process.env;
}

export async function uninstallCodexMcpServer(options: { name: string; codexHome?: string }) {
  const { name, codexHome } = options;
  const result = await runCommand("codex", ["mcp", "remove", name], {
    env: buildCodexCommandEnv(codexHome),
    captureOutput: true,
  });

  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  const notFound =
    output.includes(`No MCP server named '${name}'`) || output.includes(`No MCP server named "${name}"`);

  if (notFound) {
    return false;
  }

  if (result.code === 0) {
    return true;
  }

  throw new Error(output || `codex mcp remove failed with exit code ${result.code}`);
}

export async function rewriteClaudePluginCommands(
  pluginDir: string,
  packageSpecifier: string,
) {
  const runtimeCommand = `npx -y -p ${packageSpecifier} continuum runtime`;
  const mcpCommand = `npx -y -p ${packageSpecifier} continuum mcp-server`;

  const bootstrapPath = path.join(pluginDir, "bin", "memory-runtime-bootstrap.mjs");
  const bootstrapContent = await readFile(bootstrapPath, "utf8");
  await writeFile(
    bootstrapPath,
    bootstrapContent
      .replace(
        /process\.env\.MEMORY_RUNTIME_START_COMMAND \?\? ".*?"/,
        `process.env.MEMORY_RUNTIME_START_COMMAND ?? "${runtimeCommand}"`,
      )
      .replace(
        /process\.env\.MEMORY_MCP_COMMAND \?\? ".*?"/,
        `process.env.MEMORY_MCP_COMMAND ?? "${mcpCommand}"`,
      ),
    "utf8",
  );

  const mcpConfigPath = path.join(pluginDir, ".mcp.json");
  const mcpConfig = JSON.parse(await readFile(mcpConfigPath, "utf8")) as {
    mcpServers?: {
      memory?: {
        env?: Record<string, string>;
      };
    };
  };

  if (!mcpConfig.mcpServers) {
    mcpConfig.mcpServers = {};
  }
  if (!mcpConfig.mcpServers.memory) {
    mcpConfig.mcpServers.memory = { env: {} };
  }
  if (!mcpConfig.mcpServers.memory.env) {
    mcpConfig.mcpServers.memory.env = {};
  }
  mcpConfig.mcpServers.memory.env.MEMORY_MCP_COMMAND = mcpCommand;
  await writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2), "utf8");
}

export function defaultClaudePluginInstallDir() {
  return path.join(os.homedir(), ".continuum", "claude-plugin");
}
