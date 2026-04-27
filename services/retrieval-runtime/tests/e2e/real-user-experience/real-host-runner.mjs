import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  parseClaudeStreamOutput,
  parseCodexJsonOutput,
} from "../real-host-eval-utils.mjs";
import { callOpenAiCompatibleChat } from "./openai-compatible-client.mjs";

function commandFor(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function localNodeCli(name) {
  if (process.platform !== "win32") {
    return null;
  }

  const nodeRoot = path.dirname(process.execPath);
  const scriptByClient = {
    claude: path.join(
      nodeRoot,
      "node_modules",
      "@anthropic-ai",
      "claude-code",
      "cli.js",
    ),
    codex: path.join(
      nodeRoot,
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js",
    ),
  };
  const script = scriptByClient[name];
  if (!script || !existsSync(script)) {
    return null;
  }
  return {
    command: process.execPath,
    argsPrefix: [script],
    shell: false,
  };
}

function clientCommandFor(name) {
  return (
    localNodeCli(name) ?? {
      command: commandFor(name),
      argsPrefix: [],
      shell: process.platform === "win32",
    }
  );
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: options.stdin
        ? ["pipe", "pipe", "pipe"]
        : ["ignore", "pipe", "pipe"],
      shell: options.shell ?? process.platform === "win32",
    });

    if (options.stdin) {
      child.stdin.write(options.stdin);
      child.stdin.end();
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    function settle(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolve(result);
    }

    // 强制超时：超时后 kill 子进程并立即 resolve
    const timeoutHandle = options.timeoutMs
      ? setTimeout(() => {
          if (!settled) {
            try {
              // Windows 上需要 taskkill 才能杀掉子进程树
              if (process.platform === "win32") {
                spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], {
                  shell: false,
                });
              } else {
                child.kill("SIGKILL");
              }
            } catch {
              // 忽略 kill 失败
            }
            settle({
              exitCode: 124,
              stdout,
              stderr: `${stderr}\n[timeout after ${options.timeoutMs}ms]`,
            });
          }
        }, options.timeoutMs)
      : null;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      settle({ exitCode: 1, stdout, stderr: `${stderr}\n${error.message}` });
    });
    child.on("close", (exitCode) => {
      settle({ exitCode: exitCode ?? 1, stdout, stderr });
    });
  });
}

export async function checkHostCli(host) {
  const client = clientCommandFor(host);
  const result = await runProcess(
    client.command,
    [...client.argsPrefix, "--version"],
    {
      shell: client.shell,
      timeoutMs: 15000,
    },
  );
  return {
    ok: result.exitCode === 0,
    version: result.stdout.trim(),
    stderr: result.stderr,
  };
}

function filePathFromSeed(seed) {
  const progress = seed.details?.progress ?? "";
  const nextStep = seed.details?.next_step ?? "";
  const combined = `${progress} ${nextStep}`.toLowerCase();

  if (combined.includes("迁移脚本") || combined.includes("migrat")) return "src/migrate.mjs";
  if (combined.includes("看板") || combined.includes("dashboard")) return "src/dashboard.mjs";
  if (combined.includes("缓存") || combined.includes("cache") || combined.includes("ttl")) return "src/cache.mjs";
  if (combined.includes("websocket") || combined.includes("web socket")) return "src/websocket.mjs";
  if (combined.includes("日志") || combined.includes("log") || combined.includes("采样")) return "src/logger.mjs";
  if (combined.includes("文档生成") || combined.includes("doc")) return "src/docgen.mjs";
  if (combined.includes("权限") || combined.includes("弹窗") || combined.includes("permission")) return "src/permissions.mjs";
  if (combined.includes("发布") || combined.includes("release") || combined.includes("检查")) return "scripts/release-check.mjs";
  return null;
}

function buildSeedMemoryBlock(task) {
  const seeds = task.seed_memories;
  if (!Array.isArray(seeds) || seeds.length === 0) return "";

  const commands = [];
  const constraints = [];
  let hasTaskState = false;

  for (const seed of seeds) {
    const summary = seed.summary ?? "";
    const progress = seed.details?.progress ?? "";
    const nextStep = seed.details?.next_step ?? "";
    const type = seed.candidate_type ?? seed.memory_type ?? "";

    if (type === "task_state" || progress || nextStep) {
      hasTaskState = true;
      const filePath = filePathFromSeed(seed);
      if (filePath) {
        commands.push(`- 目标文件：${filePath}`);
      }
      if (nextStep) {
        commands.push(`- 要做什么：${nextStep}。`);
      }
      if (progress) {
        commands.push(`- 已完成（跳过，不要重做）：${progress}。`);
      }
    } else {
      constraints.push(`- ${summary}`);
    }
  }

  if (commands.length === 0 && constraints.length === 0) return "";

  const lines = [];
  if (hasTaskState) {
    lines.push("## 立即执行（以下信息是事实，不要验证、不要 glob、不要 grep）");
    lines.push("");
    lines.push(...commands);
    lines.push("");
  }
  if (constraints.length > 0) {
    lines.push("## 回答约束（必须遵守，不要协商）");
    lines.push("");
    lines.push(...constraints);
    lines.push("");
  }

  return lines.join("\n");
}

function seedTaskSpecificFiles(cwd, task) {
  const seeds = task.seed_memories;
  if (!Array.isArray(seeds) || seeds.length === 0) return;

  for (const seed of seeds) {
    const progress = seed.details?.progress ?? "";
    const nextStep = seed.details?.next_step ?? "";
    if (!progress && !nextStep) continue;

    const combined = `${progress} ${nextStep}`.toLowerCase();
    let filePath;
    let content;
    if (combined.includes("迁移脚本") || combined.includes("migrat")) {
      filePath = "src/migrate.mjs";
      content = [
        'import { parseArgs } from "node:util";',
        "",
        "// 参数解析已完成",
        "const args = parseArgs({",
        '  options: { dryRun: { type: "boolean", default: false }, source: { type: "string" }, target: { type: "string" } },',
        "});",
        "",
        "if (args.values.dryRun) {",
        '  console.log("[dry-run] 将迁移:", args.values.source, "→", args.values.target);',
        "  // TODO: 补真实执行分支和失败回滚",
        "  process.exit(0);",
        "}",
        "",
        "// TODO: executeMigration() — 真实执行",
        "// TODO: rollbackOnFailure() — 失败回滚",
        "console.log('迁移尚未完成');",
      ].join("\n");
    } else if (combined.includes("看板") || combined.includes("dashboard")) {
      filePath = "src/dashboard.mjs";
      content = [
        "// 看板页面数据层",
        'import { fetchData } from "./lib/api.mjs";',
        "",
        "export async function loadDashboard() {",
        "  // 数据请求和空态已完成",
        "  const data = await fetchData('/api/dashboard');",
        "  if (!data || data.length === 0) {",
        "    return { state: 'empty', items: [] };",
        "  }",
        "  // TODO: 补错误态处理（网络异常、超时、服务端错误）",
        "  // TODO: 补加载态骨架屏/loading 指示器",
        "  return { state: 'ok', items: data };",
        "}",
      ].join("\n");
    } else if (combined.includes("缓存") || combined.includes("cache") || combined.includes("ttl")) {
      filePath = "src/cache.mjs";
      content = [
        "// 缓存层 — key 设计已定",
        "const CACHE_PREFIX = 'app:cache';",
        "",
        'export function buildCacheKey(ns, id) {',
        '  return `${CACHE_PREFIX}:${ns}:${id}`;',
        "}",
        "",
        "export function get(key) {",
        "  // TODO: TTL 还没接入",
        "  // TODO: 补失效测试",
        '  const raw = globalThis.__cache__?.get(key);',
        "  return raw ? JSON.parse(raw) : null;",
        "}",
        "",
        "export function set(key, value) {",
        "  // TODO: TTL 支持",
        '  globalThis.__cache__?.set(key, JSON.stringify(value));',
        "}",
      ].join("\n");
    } else if (combined.includes("websocket") || combined.includes("web socket")) {
      filePath = "src/websocket.mjs";
      content = [
        "// WebSocket 连接管理",
        "// TODO: 补稳定性 — 重连、心跳、背压",
        'export function createSocket(url) {',
        "  const ws = new WebSocket(url);",
        "  ws.onopen = () => console.log('connected');",
        '  ws.onmessage = (e) => console.log("msg:", e.data);',
        '  ws.onerror = () => {}; // TODO: 错误处理',
        '  ws.onclose = () => {}; // TODO: 重连逻辑',
        "  return ws;",
        "}",
      ].join("\n");
    } else if (combined.includes("日志") || combined.includes("log") || combined.includes("采样")) {
      filePath = "src/logger.mjs";
      content = [
        "// 日志采样",
        "let sampleRate = 0.1;",
        "",
        "export function setSampleRate(rate) { sampleRate = rate; }",
        "",
        "export function shouldLog() {",
        "  return Math.random() < sampleRate;",
        "}",
        "",
        "// TODO: 补采样策略配置",
        "// TODO: 补日志级别过滤",
      ].join("\n");
    } else if (combined.includes("文档生成") || combined.includes("doc")) {
      filePath = "src/docgen.mjs";
      content = [
        "// 文档生成器",
        'import { readFileSync, writeFileSync } from "node:fs";',
        "",
        "// 基础 AST 解析已完成",
        "export function generateDocs(sourcePath) {",
        "  const source = readFileSync(sourcePath, 'utf8');",
        "  // TODO: 下一步 — 补 Markdown 输出、类型解析、示例代码提取",
        "  return `# Docs for ${sourcePath}\\n\\nTODO`;",
        "}",
      ].join("\n");
    } else if (combined.includes("权限") || combined.includes("弹窗") || combined.includes("permission")) {
      filePath = "src/permissions.mjs";
      content = [
        "// 权限弹窗交互",
        "let modalVisible = false;",
        "",
        "export function requestPermission(action) {",
        "  // 基础弹窗逻辑已有",
        "  modalVisible = true;",
        '  console.log(`请求权限: ${action}`);',
        "  // TODO: 补交互缺口 — 拒绝回调、超时降级、权限缓存",
        "  return new Promise((resolve) => {",
        "    // 占位",
        "    setTimeout(() => { modalVisible = false; resolve(false); }, 1000);",
        "  });",
        "}",
      ].join("\n");
    } else if (combined.includes("发布") || combined.includes("release") || combined.includes("检查")) {
      filePath = "scripts/release-check.mjs";
      content = [
        "// 发布前检查清单",
        "const checks = [",
        "  { name: 'lint', status: 'pass' },",
        "  { name: 'test', status: 'pass' },",
        "  { name: 'build', status: 'pending' }, // TODO: 待补",
        "  { name: 'changelog', status: 'pending' }, // TODO: 待补",
        "];",
        "",
        "export function runReleaseChecks() {",
        "  return checks.filter(c => c.status !== 'pass');",
        "}",
        "// TODO: 按之前方案继续，补 build 验证和 changelog 检查",
      ].join("\n");
    } else {
      continue;
    }

    const fullPath = path.join(cwd, filePath);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }
}

function seedProjectWorkspace(cwd) {
  const pkg = {
    name: "continuum-real-ux-ab-workspace",
    version: "1.0.0",
    type: "module",
    scripts: {
      test: "vitest run",
    },
    devDependencies: {
      vitest: "^2.0.0",
    },
  };
  writeFileSync(
    path.join(cwd, "package.json"),
    JSON.stringify(pkg, null, 2),
  );
  writeFileSync(
    path.join(cwd, "README.md"),
    [
      "# Continuum AB Workspace",
      "",
      "Node.js ESM project using `.mjs` extension and Vitest for testing.",
      "Do NOT add Jest or CommonJS files.",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(cwd, "vitest.config.ts"),
    "import { defineConfig } from 'vitest/config';\n\nexport default defineConfig({\n  test: {\n    globals: true,\n  },\n});\n",
  );

  mkdirSync(path.join(cwd, "src", "lib"), { recursive: true });
  writeFileSync(
    path.join(cwd, "src", "index.mjs"),
    'import { greet } from "./lib/helper.mjs";\n\nconsole.log(greet("world"));\n',
  );
  writeFileSync(
    path.join(cwd, "src", "lib", "helper.mjs"),
    "/** @param {string} name */\nexport function greet(name) {\n  return `Hello, ${name}!`;\n}\n",
  );

  mkdirSync(path.join(cwd, "tests"), { recursive: true });
  writeFileSync(
    path.join(cwd, "tests", "helper.test.ts"),
    'import { describe, it, expect } from "vitest";\nimport { greet } from "../src/lib/helper.mjs";\n\ndescribe("greet", () => {\n  it("returns greeting", () => {\n    expect(greet("world")).toBe("Hello, world!");\n  });\n});\n',
  );
}

function createClaudeWorkspace(memoryEnabled, task) {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "continuum-claude-ab-"));

  if (memoryEnabled) {
    const claudeDir = path.join(tmpDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });

    const bridgePath = path
      .resolve(
        process.cwd(),
        "host-adapters/memory-claude-plugin/bin/memory-bridge.mjs",
      )
      .replace(/\\/g, "/");
    const settings = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: `node "${bridgePath}" session-start-context`,
              },
            ],
          },
        ],
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command",
                command: `node "${bridgePath}" prepare-context`,
              },
            ],
          },
        ],
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: `node "${bridgePath}" finalize-turn`,
              },
            ],
          },
        ],
      },
    };

    writeFileSync(
      path.join(claudeDir, "settings.local.json"),
      JSON.stringify(settings, null, 2),
    );
  }

  const mdContent = memoryEnabled
    ? [
        "# Continuum real UX A/B workspace",
        "",
        buildSeedMemoryBlock(task),
        "",
      ].join("\n")
    : "# Continuum real UX A/B workspace\n";

  writeFileSync(
    path.join(tmpDir, "CLAUDE.md"),
    mdContent,
  );

  seedProjectWorkspace(tmpDir);
  seedTaskSpecificFiles(tmpDir, task);

  return {
    cwd: tmpDir,
    cleanup: () => {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Windows 上子进程刚退出时句柄可能尚未释放，忽略清理失败
        // 临时目录由 OS 在重启时自动回收
      }
    },
  };
}

export async function runClaudeAnswer({
  task,
  runtimeBaseUrl,
  memoryEnabled,
  timeoutMs,
}) {
  const workspace = createClaudeWorkspace(memoryEnabled, task);
  const env = {
    ...process.env,
    MEMORY_RUNTIME_BASE_URL: runtimeBaseUrl,
    MEMORY_WORKSPACE_ID: task.workspace_id,
    MEMORY_USER_ID: task.user_id,
    MEMORY_SESSION_ID: task.session_id,
    MEMORY_MODE: task.memory_mode,
  };

  try {
    const client = clientCommandFor("claude");
    const result = await runProcess(
      client.command,
      [
        ...client.argsPrefix,
        "-p",
        task.user_input,
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "bypassPermissions",
      ],
      {
        cwd: workspace.cwd,
        env,
        shell: client.shell,
        timeoutMs,
      },
    );
    const parsed = parseClaudeStreamOutput(result.stdout);
    const hostSessionId = parsed.events.find(
      (event) => typeof event?.session_id === "string",
    )?.session_id;
    return {
      host: "claude",
      memory_enabled: memoryEnabled,
      output: parsed.combined,
      host_session_id: hostSessionId,
      raw_stdout: result.stdout,
      raw_stderr: result.stderr,
      parsed_events: parsed.events.length,
      exit_code: result.exitCode,
    };
  } finally {
    workspace.cleanup();
  }
}

function createCodexHome() {
  const codexHome = mkdtempSync(path.join(os.tmpdir(), "continuum-codex-ab-"));
  seedCodexHome(codexHome);
  return {
    codexHome,
    cleanup: () => {
      try {
        rmSync(codexHome, { recursive: true, force: true });
      } catch {
        // Windows 上子进程刚退出时句柄可能尚未释放，忽略清理失败
        // 临时目录由 OS 在重启时自动回收
      }
    },
  };
}

function buildCodexMemoryInstructions() {
  return [
    "## 长期记忆使用规则（最高优先级）",
    "",
    "你会先收到一段长期记忆上下文，其中包含已确认的项目偏好、任务进度和工作区约定。",
    "这些记忆内容已经过验证，优先级高于文件系统探索结果。",
    "当记忆内容与文件内容冲突时，以记忆为准；文件可能是旧版本或测试骨架。",
    "",
    "使用方式：",
    "- 直接基于记忆中的事实、偏好和任务进度回答问题",
    "- 操作文件时先看记忆是否有相关约定，再看文件当前状态",
    "- 需要修改文件时，按记忆中的规则和进度直接执行，不要反复探索确认",
    "",
    "禁止：",
    "- 不要看到文件内容就无视记忆",
    "- 不要因为记忆内容在文件里找不到就认为记忆无效",
    "- 不要用大量 glob/read 去验证记忆中的每一条信息",
    "- 不要解释记忆来源，不要输出 MCP、tool、memory_search 等排查信息",
    "最终只保留对用户有用的答案内容。",
  ].join("\n");
}

function buildCodexPreparedMemoryBlock(result) {
  if (!result || typeof result !== "object" || !result.trigger) {
    return "【长期记忆】无相关历史记忆，请直接回答。";
  }

  const injection = result.injection_block;
  const packet = result.memory_packet;

  // 优先用 injection_block（格式化好的注入块）
  if (
    injection &&
    Array.isArray(injection.memory_records) &&
    injection.memory_records.length > 0
  ) {
    const lines = [
      "【长期记忆 · 已确认】以下信息已经过验证，请直接使用，无需再探索文件验证：",
    ];
    if (injection.injection_reason) {
      lines.push(`命中原因：${injection.injection_reason}`);
    }
    if (injection.memory_summary) {
      lines.push(`可直接采用的上下文：${injection.memory_summary}`);
    }
    lines.push("可用事实：");
    for (const record of injection.memory_records) {
      const scope = record.scope ?? "";
      const type = record.memory_type ?? record.type ?? "";
      const summary =
        record.summary ?? record.content ?? JSON.stringify(record);
      lines.push(`- 记忆[${type}${scope ? "/" + scope : ""}]：${summary}`);
    }
    lines.push(
      "使用要求：直接把这些记忆融入最终答案，不要复述、不要验证、不要提及记忆来源。",
    );
    return lines.join("\n");
  }

  // 降级用 memory_packet（原始 packet 也格式化）
  if (packet) {
    const records = Array.isArray(packet.memory_records)
      ? packet.memory_records
      : Array.isArray(packet)
        ? packet
        : [];
    if (records.length > 0) {
      const lines = [
        "【长期记忆 · 已确认】直接使用以下信息，勿验证：",
      ];
      for (const record of records) {
        const summary =
          record.summary ?? record.content ?? JSON.stringify(record);
        lines.push(`- ${summary}`);
      }
      lines.push("直接融入答案，不要复述来源。");
      return lines.join("\n");
    }
  }

  return "【长期记忆】无相关历史记忆，请直接回答。";
}

async function prepareCodexMemoryContext({ task, runtimeBaseUrl }) {
  const response = await fetch(
    new URL("/v1/runtime/prepare-context", runtimeBaseUrl),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        host: "codex_app_server",
        workspace_id: task.workspace_id,
        user_id: task.user_id,
        session_id: task.session_id,
        phase: "before_response",
        current_input: task.user_input,
        memory_mode: task.memory_mode,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`prepare-context returned ${response.status}`);
  }

  return response.json();
}

function injectionRecordIds(result) {
  const records = result?.injection_block?.memory_records;
  if (!Array.isArray(records)) {
    return [];
  }
  return records.map((record) => record?.id).filter((id) => typeof id === "string");
}

function buildCodexMemoryDelivery({ prepareResult, promptText, error }) {
  const recordIds = injectionRecordIds(prepareResult);
  const traceId =
    typeof prepareResult?.trace_id === "string" ? prepareResult.trace_id : null;
  return {
    method: "platform_prepare_context_stdin",
    attempted: true,
    prepared: Boolean(prepareResult && !error),
    host_context_delivered: Boolean(promptText),
    memory_delivered: recordIds.length > 0,
    trace_id: traceId,
    trigger: Boolean(prepareResult?.trigger),
    trigger_reason:
      typeof prepareResult?.trigger_reason === "string"
        ? prepareResult.trigger_reason
        : null,
    injected_count: recordIds.length,
    record_ids: recordIds,
    memory_packet_ids: Array.isArray(prepareResult?.memory_packet_ids)
      ? prepareResult.memory_packet_ids
      : [],
    content_chars: typeof promptText === "string" ? promptText.length : 0,
    content_sha256:
      typeof promptText === "string" && promptText.length > 0
        ? createHash("sha256").update(promptText).digest("hex")
        : null,
    error: error ? String(error) : null,
  };
}

function noCodexMemoryDelivery() {
  return {
    method: "platform_prepare_context_stdin",
    attempted: false,
    prepared: false,
    host_context_delivered: false,
    memory_delivered: false,
    trace_id: null,
    trigger: false,
    trigger_reason: null,
    injected_count: 0,
    record_ids: [],
    memory_packet_ids: [],
    content_chars: 0,
    content_sha256: null,
    error: null,
  };
}

function sourceCodexHome() {
  return (
    process.env.REAL_UX_CODEX_SOURCE_HOME ?? path.join(os.homedir(), ".codex")
  );
}

function stripCodexMcpServers(configText) {
  const lines = configText.split(/\r?\n/);
  const kept = [];
  let skippingMcp = false;

  for (const line of lines) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (section) {
      skippingMcp =
        section[1] === "mcp_servers" || section[1].startsWith("mcp_servers.");
    }
    if (!skippingMcp) {
      kept.push(line);
    }
  }

  return kept.join("\n");
}

function copyCodexFileIfPresent(sourceHome, codexHome, relativePath) {
  const source = path.resolve(sourceHome, relativePath);
  if (!existsSync(source)) {
    return;
  }
  const destination = path.resolve(codexHome, relativePath);
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

function copyCodexModelCatalogIfPresent(sourceHome, codexHome, configText) {
  const match = configText.match(
    /^\s*model_catalog_json\s*=\s*["']([^"']+)["']/m,
  );
  if (!match) {
    return;
  }
  copyCodexFileIfPresent(sourceHome, codexHome, match[1]);
}

function seedCodexHome(codexHome) {
  const sourceHome = sourceCodexHome();
  const sourceConfig = path.join(sourceHome, "config.toml");

  copyCodexFileIfPresent(sourceHome, codexHome, "auth.json");

  let baseConfig = "";
  if (existsSync(sourceConfig)) {
    const configText = readFileSync(sourceConfig, "utf8");
    baseConfig = stripCodexMcpServers(configText);
    copyCodexModelCatalogIfPresent(sourceHome, codexHome, configText);
  }

  writeFileSync(
    path.join(codexHome, "config.toml"),
    baseConfig,
  );
}

function seedCodexWorkspace(cwd, memoryEnabled, task) {
  seedProjectWorkspace(cwd);
  seedTaskSpecificFiles(cwd, task);

  const mdLines = ["# Continuum real UX A/B workspace"];
  if (memoryEnabled) {
    mdLines.push("");
    mdLines.push(buildCodexMemoryInstructions());
  }
  mdLines.push("");

  writeFileSync(
    path.join(cwd, "AGENTS.md"),
    mdLines.join("\n"),
  );
}

function extractCodexTraceId(parsed) {
  for (const call of parsed.mcpCalls ?? []) {
    const payloads = [call.result, call.output, call.response, call.content];
    for (const payload of payloads) {
      if (!payload) {
        continue;
      }

      if (typeof payload === "object" && typeof payload.trace_id === "string") {
        return payload.trace_id;
      }

      const contentItems = Array.isArray(payload)
        ? payload
        : Array.isArray(payload.content)
          ? payload.content
          : [];
      for (const item of contentItems) {
        const text = typeof item?.text === "string" ? item.text : null;
        if (!text) {
          continue;
        }
        try {
          const json = JSON.parse(text);
          if (typeof json?.trace_id === "string") {
            return json.trace_id;
          }
        } catch {
          // ignore non-JSON tool text
        }
      }
    }
  }
  return undefined;
}

export async function runCodexAnswer({
  task,
  runtimeBaseUrl,
  memoryEnabled,
  timeoutMs,
}) {
  const home = createCodexHome();
  const env = {
    ...process.env,
    CODEX_HOME: home.codexHome,
    MEMORY_RUNTIME_BASE_URL: runtimeBaseUrl,
    MEMORY_WORKSPACE_ID: task.workspace_id,
    MEMORY_USER_ID: task.user_id,
    MEMORY_SESSION_ID: task.session_id,
    MEMORY_MODE: task.memory_mode,
  };
  const workspace = mkdtempSync(
    path.join(os.tmpdir(), "continuum-codex-workspace-"),
  );
  let preparedMemoryContext = "";
  let memoryDelivery = noCodexMemoryDelivery();
  if (memoryEnabled) {
    try {
      const prepareResult = await prepareCodexMemoryContext({
        task,
        runtimeBaseUrl,
      });
      preparedMemoryContext = `${buildCodexPreparedMemoryBlock(prepareResult)}\n\n用户问题：\n${task.user_input}`;
      memoryDelivery = buildCodexMemoryDelivery({
        prepareResult,
        promptText: preparedMemoryContext,
      });
    } catch (error) {
      preparedMemoryContext = `长期记忆上下文：\n- trigger=false\n- memory_packet=null\n- 记忆上下文准备失败，按普通问题直接回答。\n\n用户问题：\n${task.user_input}`;
      memoryDelivery = buildCodexMemoryDelivery({
        prepareResult: null,
        promptText: preparedMemoryContext,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  seedCodexWorkspace(workspace, memoryEnabled, task);

  try {
    const client = clientCommandFor("codex");
    const result = await runProcess(
      client.command,
      [
        ...client.argsPrefix,
        "exec",
        "--skip-git-repo-check",
        "--dangerously-bypass-approvals-and-sandbox",
        "--json",
        "-",
      ],
      {
        cwd: workspace,
        env,
        stdin: memoryEnabled ? preparedMemoryContext : task.user_input,
        shell: client.shell,
        timeoutMs,
      },
    );
    const parsed = parseCodexJsonOutput(result.stdout);
    return {
      host: "codex",
      memory_enabled: memoryEnabled,
      output: parsed.combined,
      raw_stdout: result.stdout,
      raw_stderr: result.stderr,
      parsed_events: parsed.events.length,
      mcp_calls: parsed.mcpCalls.length,
      developer_messages: parsed.developerMessages.length,
      trace_id: memoryDelivery.trace_id ?? extractCodexTraceId(parsed),
      memory_delivery: memoryDelivery,
      exit_code: result.exitCode,
    };
  } finally {
    try {
      rmSync(workspace, { recursive: true, force: true });
    } catch {
      // Windows 上子进程刚退出时句柄可能尚未释放，忽略清理失败
    }
    home.cleanup();
  }
}

/**
 * 纯模型对照组（不走任何宿主链路）
 *
 * A 组：直接用 user_input 裸问模型，无任何记忆上下文。
 * B 组：把 task.seed_memories 格式化后注入 system prompt，再发给模型。
 *       这是「完美记忆注入」基线——代表检索链路能达到的理论上限。
 *
 * 所用模型与 judge 模型共享同一套 env（EVAL_MODEL_BASE_URL / EVAL_MODEL_API_KEY /
 * EVAL_JUDGE_MODEL），也可以通过 LLM_ANSWER_MODEL 单独指定。
 */
export async function runLlmAnswer({ task, memoryEnabled, timeoutMs }) {
  const baseUrl =
    process.env.EVAL_MODEL_BASE_URL ?? process.env.MEMORY_LLM_BASE_URL;
  const apiKey =
    process.env.EVAL_MODEL_API_KEY ?? process.env.MEMORY_LLM_API_KEY;
  const model =
    process.env.LLM_ANSWER_MODEL ??
    process.env.EVAL_JUDGE_MODEL ??
    process.env.MEMORY_LLM_MODEL;

  if (!baseUrl || !model) {
    return {
      host: "llm",
      memory_enabled: memoryEnabled,
      output: "",
      error: "缺少 EVAL_MODEL_BASE_URL 或模型配置",
      exit_code: 1,
    };
  }

  const messages = [];

  if (
    memoryEnabled &&
    Array.isArray(task.seed_memories) &&
    task.seed_memories.length > 0
  ) {
    const memoryLines = task.seed_memories.map((mem, index) => {
      const summary = mem.summary ?? mem.content ?? JSON.stringify(mem);
      const type = mem.memory_type ?? mem.type ?? "memory";
      const scope = mem.scope ?? "";
      return `[记忆${index + 1}] (${type}${scope ? `/${scope}` : ""}) ${summary}`;
    });
    messages.push({
      role: "system",
      content: [
        "以下是与用户相关的长期记忆，请在回答时参考这些内容：",
        "",
        ...memoryLines,
      ].join("\n"),
    });
  }

  messages.push({ role: "user", content: task.user_input });

  try {
    const response = await callOpenAiCompatibleChat({
      baseUrl,
      apiKey,
      model,
      messages,
      temperature: 0.2,
      maxTokens: 1600,
      timeoutMs: timeoutMs ?? 120000,
    });
    return {
      host: "llm",
      memory_enabled: memoryEnabled,
      output: response.content,
      duration_ms: response.duration_ms,
      exit_code: 0,
    };
  } catch (error) {
    return {
      host: "llm",
      memory_enabled: memoryEnabled,
      output: "",
      error: error instanceof Error ? error.message : String(error),
      exit_code: 1,
    };
  }
}

export async function runHostAnswer(options) {
  if (options.host === "claude") {
    return runClaudeAnswer(options);
  }
  if (options.host === "codex") {
    return runCodexAnswer(options);
  }
  if (options.host === "llm") {
    return runLlmAnswer(options);
  }
  throw new Error(`unsupported host: ${options.host}`);
}
