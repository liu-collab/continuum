import { existsSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const distEntry = path.resolve(currentDir, "../dist/src/index.js");
const sourceEntry = path.resolve(currentDir, "../src/index.ts");

async function loadEntrypoint() {
  if (existsSync(distEntry)) {
    return import(pathToFileURL(distEntry).href);
  }

  register("tsx/esm", import.meta.url);
  return import(pathToFileURL(sourceEntry).href);
}

async function loadModule(distRelativePath, sourceRelativePath) {
  if (existsSync(distEntry)) {
    return import(pathToFileURL(path.resolve(currentDir, distRelativePath)).href);
  }

  register("tsx/esm", import.meta.url);
  return import(pathToFileURL(path.resolve(currentDir, sourceRelativePath)).href);
}

const { start, stop } = await loadEntrypoint();

if (process.argv[2] === "skill" && process.argv[3] === "import") {
  const importPath = process.argv[4];
  if (!importPath) {
    console.error("memory-native-agent skill 导入失败: 缺少路径参数。");
    process.exit(2);
  }

  const { loadConfig } = await loadModule("../dist/src/config/index.js", "../src/config/index.ts");
  const { SkillRegistry } = await loadModule("../dist/src/skills/index.js", "../src/skills/index.ts");
  const { resolveMnaHomeDirectory } = await loadModule("../dist/src/shared/token.js", "../src/shared/token.ts");
  const config = loadConfig({
    cwdOverride: process.env.MNA_WORKSPACE_CWD?.trim() || process.cwd(),
  });
  const registry = new SkillRegistry({
    persistencePath: path.join(resolveMnaHomeDirectory(), "skills", "registry.json"),
  });
  registry.loadPersisted();

  try {
    const skill = registry.importFromPath(importPath);
    console.log(JSON.stringify({
      ok: true,
      id: skill.id,
      name: skill.name,
      slash_name: skill.invocation.slashName,
      source_kind: skill.source.kind,
      workspace: config.memory.cwd,
    }, null, 2));
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`memory-native-agent skill 导入失败: ${message}`);
    process.exit(1);
  }
}

const port = Number.parseInt(process.env.MNA_PORT ?? "", 10) || 4193;
const host = process.env.MNA_HOST || "127.0.0.1";
const workspaceCwd = process.env.MNA_WORKSPACE_CWD?.trim() || process.cwd();
let app;

try {
  app = await start({
    host,
    port,
    config: {
      cwdOverride: workspaceCwd,
    },
  });
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  const message = error instanceof Error ? error.message : String(error);

  if (error instanceof Error && "cause" in error && error.cause && typeof error.cause === "object" && "code" in error.cause && error.cause.code === "EADDRINUSE") {
    console.error(`memory-native-agent 启动失败: 端口 ${port} 已被占用。`);
    process.exit(3);
  }

  if (code === "api_version_mismatch") {
    console.error(`memory-native-agent 启动失败: ${message}`);
    process.exit(4);
  }

  if (error && typeof error === "object" && "code" in error && error.code === "EADDRINUSE") {
    console.error(`memory-native-agent 启动失败: 端口 ${port} 已被占用。`);
    process.exit(3);
  }

  console.error(`memory-native-agent 启动失败: ${message}`);
  process.exit(1);
}

let closing = false;

async function shutdown() {
  if (closing) {
    return;
  }

  closing = true;
  try {
    await stop(app);
  } finally {
    process.exitCode = 0;
  }
}

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
