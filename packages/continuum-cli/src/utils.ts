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
      body: text ? safeJsonParse(text) : undefined,
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

export function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
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
