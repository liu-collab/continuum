import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { bilingualMessage } from "./messages.js";

export const DEFAULT_RUNTIME_URL = "http://127.0.0.1:3002";
export const DEFAULT_STORAGE_URL = "http://127.0.0.1:3001";
export const DEFAULT_UI_URL = "http://127.0.0.1:3003";
export const DEFAULT_TIMEOUT_MS = 5000;
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

export async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

type WaitForHealthyOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  maxRetries?: number;
  requestTimeoutMs?: number;
  extractBody?: boolean;
  timeoutMessage?: string;
  fetcher?: typeof fetchJson;
};

export async function waitForHealthy(
  url: string,
  options: WaitForHealthyOptions = {},
): Promise<unknown | undefined> {
  const intervalMs = options.intervalMs ?? 1_000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 1_500;
  const maxRetries = options.maxRetries;
  const deadline = Date.now() + (options.timeoutMs ?? intervalMs * (maxRetries ?? 40));
  const fetcher = options.fetcher ?? fetchJson;
  let attempts = 0;

  while (Date.now() < deadline && (maxRetries === undefined || attempts < maxRetries)) {
    attempts += 1;
    const result = await fetcher(url, requestTimeoutMs);
    if (result.ok) {
      return options.extractBody ? result.body : undefined;
    }
    await delay(intervalMs);
  }

  throw new Error(options.timeoutMessage ?? bilingualMessage(
    `服务未在预期时间内就绪: ${url}`,
    `Service did not become ready in time: ${url}`,
  ));
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

export function spawnCrossPlatform(
  command: string,
  args: string[],
  options: SpawnOptions = {},
): ChildProcess {
  if (process.platform === "win32") {
    return spawn("cmd", ["/c", command, ...args], options);
  }

  return spawn(command, args, options);
}

export async function terminateProcess(pid: number): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const child = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
        env: process.env,
      });

      child.on("exit", () => resolve());
      child.on("error", () => resolve());
    });
    return;
  }

  try {
    process.kill(pid, "SIGINT");
  } catch {
    return;
  }
}

type RunCommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  captureOutput?: boolean;
  timeoutMs?: number;
};

export async function runCommand(command: string, args: string[], options: RunCommandOptions = {}) {
  const { cwd, env, captureOutput = false, timeoutMs } = options;

  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawnCrossPlatform(command, args, {
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

    let settled = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          child.kill("SIGKILL");
          resolve({
            code: 124,
            stdout,
            stderr: stderr || `command timed out after ${timeoutMs}ms`,
          });
        }, timeoutMs)
      : null;

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      reject(error);
    });
    child.on("exit", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
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
    throw new Error(bilingualMessage(
      `目标目录已存在: ${targetDir}`,
      `Target already exists: ${targetDir}`,
    ));
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

  throw new Error(output || bilingualMessage(
    `codex mcp remove 失败，退出码 ${result.code}`,
    `codex mcp remove failed with exit code ${result.code}`,
  ));
}

export async function rewriteClaudePluginCommands(
  pluginDir: string,
  packageSpecifier: string,
) {
  const runtimeCommand = `npx -y -p ${packageSpecifier} axis runtime`;
  const mcpCommand = "off";
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
  await writeFile(mcpConfigPath, `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`, "utf8");
}

export function defaultClaudePluginInstallDir() {
  return path.join(os.homedir(), ".axis", "claude-plugin");
}
