# Continuum CLI 优化方案

## 概述

Continuum CLI（`packages/continuum-cli`）是统一命令行工具，负责托管栈的完整生命周期：Docker 编排、服务启动、健康检查、宿主集成（Claude/Codex）、配置管理。本文档针对 14 个设计问题给出优化方案。

---

## 优化一：数据库密码从硬编码改为环境变量 + 随机生成

**状态：已完成**

### 问题

```typescript
// managed-state.ts
const DB_PASSWORD = "continuum_local_dev";
```

明文密码暴露在源码中，所有部署共用同一密码。

### 方案

```typescript
// managed-state.ts
const DB_PASSWORD = process.env.CONTINUUM_DB_PASSWORD ?? crypto.randomBytes(12).toString("hex");

export function resolveDatabasePassword(): string {
  const existing = readManagedState()?.dbPassword;
  return existing ?? DB_PASSWORD;
}
```

首次启动时随机生成并持久化到 `state.json`，后续启动复用。

### 效果

- 每个部署实例独立密码，不被源码泄漏
- 用户可通过 `CONTINUUM_DB_PASSWORD` 显式指定

---

## 优化二：JSON 解析统一增加 try-catch 保护

**状态：已完成**

### 问题

7 处 `JSON.parse()` 无异常保护：

| 文件 | 函数 |
|---|---|
| `managed-state.ts` | `readManagedState` |
| `managed-config.ts` | `readManagedEmbeddingConfig`、`readManagedMemoryLlmConfig`、`readManagedWritebackLlmConfig`、`readManagedMnaProviderConfig` |
| `version.ts` | `readCliVersion` |
| `build-state.mjs` | `readBuildState` |

配置文件损坏直接导致 CLI 崩溃，无任何错误提示。

### 方案

抽取共享安全解析函数：

```typescript
// utils.ts
export function safeJsonParse<T>(filePath: string, raw: string): T {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new AppError(`配置文件损坏: ${filePath}`, {
      code: "config_corrupted",
      hint: "请删除该文件后重新运行",
      filePath,
    });
  }
}
```

所有 `readManaged*` 函数改为调用 `safeJsonParse`。

### 效果

- 配置损坏时显示可操作的错误消息
- 不再出现未处理的 `SyntaxError` 崩溃

---

## 优化三：提取跨平台 spawn 工具函数

**状态：已完成**

### 问题

13+ 处相同的平台分支逻辑：

```typescript
if (process.platform === "win32") {
  spawn("cmd", ["/c", command, ...args], { ... });
} else {
  spawn(command, args, { ... });
}
```

### 方案

```typescript
// utils.ts
export function spawnCrossPlatform(
  command: string,
  args: string[],
  options?: SpawnOptions,
): ChildProcess {
  if (process.platform === "win32") {
    return spawn("cmd", ["/c", command, ...args], {
      shell: true,
      ...options,
    });
  }
  return spawn(command, args, options);
}
```

全局替换 13+ 处手动分支。

### 效果

- 消除 ~80 行重复代码
- 平台差异集中在一处管理

---

## 优化四：合并三份 `terminateManagedProcess` 实现

**状态：已完成**

### 问题

`start-command.ts`、`stop-command.ts`、`mna-command.ts` 各自实现了完全一致的进程终止逻辑。

### 方案

提取到 `utils.ts`：

```typescript
// utils.ts
export async function terminateProcess(pid: number, label?: string): Promise<void> {
  const name = label ?? `PID ${pid}`;
  if (process.platform === "win32") {
    await runCommand("taskkill", ["/PID", String(pid), "/T", "/F"]);
  } else {
    process.kill(pid, "SIGINT");
  }
  logger.info({ pid, label: name }, "process terminated");
}
```

三个文件删除内联实现，统一引用。

### 效果

- 一处修改，三处生效
- 消除 3 × 25 = 75 行重复

---

## 优化五：拆分 `start-command.ts`

**状态：已完成**

### 问题

964 行混合了 6 类职责：进程管理、Docker 管理、端口扫描、vendor 刷新、dev server 管理、主编排。

### 方案

```
src/
  start-command.ts          (~200 行，主编排器 runStartCommand)
  docker-lifecycle.ts       (~150 行，ensureDockerInstalled / DaemonReady / stopLegacy / cleanupStack)
  port-utils.ts             (~80 行，resolvePort / waitForTcp / isAvailable)
  vendor-refresh.ts         (~120 行，copyVendorBundle / refreshVendor)
  managed-process.ts        (~60 行，spawnManagedProcess / terminateProcess)
```

### 效果

- 每个文件单一职责
- Docker 变更和端口逻辑变更互不影响
- 可独立测试

---

## 优化六：Docker Desktop 路径配置化

**状态：已完成**

### 问题

```typescript
// start-command.ts
const dockerDesktopPath = "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe";
```

硬编码默认安装路径，不支持自定义安装或 Docker Engine。

### 方案

```typescript
const dockerDesktopPath =
  process.env.CONTINUUM_DOCKER_DESKTOP_PATH ??
  "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe";

// Linux 上不需要 Docker Desktop，直接检查 dockerd
if (process.platform === "linux") {
  await checkDockerEngineRunning();
}
```

### 效果

- 自定义安装用户可通过环境变量指定
- Linux Docker Engine 可正常检测

---

## 优化七：`host.docker.internal` Linux 兼容

### 问题

`start-command.ts` 中使用 `host.docker.internal` 让 MNA 连接容器内的服务。此主机名仅 Docker Desktop 支持，Linux Docker Engine 不可用。

### 方案

在 `docker run` 参数中增加条件配置：

```typescript
const extraHosts: string[] = [];
if (process.platform === "linux") {
  extraHosts.push("--add-host", "host.docker.internal:host-gateway");
}
```

### 效果

- Linux Docker Engine 上 MNA 可正常连接容器内服务

---

## 优化八：Boolean 参数归一化

### 问题

每处 boolean 判断都需要双重检查：

```typescript
options.flag === true || options.flag === "true"  // 出现 8+ 次
```

### 方案

在 `parseArgs()` 中增加后处理：

```typescript
// args.ts
const BOOLEAN_FLAGS = new Set([
  "open", "json", "strict", "force", "uiDev",
  "ensureRuntime", "skipGitRepoCheck",
]);

function normalizeOptions(raw: ParsedArgs): ParsedArgs {
  const normalized = { ...raw };
  for (const key of BOOLEAN_FLAGS) {
    if (normalized[key] === "true") normalized[key] = true;
    if (normalized[key] === "false") normalized[key] = false;
  }
  return normalized;
}
```

所有调用处删除 `=== "true"` 判断。

### 效果

- 消除 8+ 处双重判断
- 布尔选项从源头标准化

---

## 优化九：`codex` 命令严格子命令匹配

### 问题

```typescript
if (primary === "codex") {
  await runCodexUseCommand(args, options);  // codex install/uninstall 已在前分支处理
}
```

`codex foo` 不会报错，直接启动完整 Codex 启动器。

### 方案

```typescript
const CODEX_VALID_SUBCOMMANDS = new Set(["install", "uninstall", "use"]);
const sub = args[0] ?? "use";

if (!CODEX_VALID_SUBCOMMANDS.has(sub)) {
  console.error(`未知的 codex 子命令: ${sub}`);
  console.error(`可用: ${[...CODEX_VALID_SUBCOMMANDS].join(", ")}`);
  process.exit(1);
}
```

### 效果

- 输入错误有明确提示，不会静默误执行

---

## 优化十：合并 `waitForHealthy` 两个分叉版本

### 问题

- `start-command.ts`：返回 `void`，轮询 1500ms
- `mna-command.ts`：返回 `body`（含 version），轮询 1000ms

两个版本从同一份代码分叉，修改互不同步。

### 方案

合并为带参数的通用版本：

```typescript
// utils.ts
export async function waitForHealthy(
  url: string,
  options?: {
    intervalMs?: number;
    maxRetries?: number;
    extractBody?: boolean;
  },
): Promise<unknown | undefined> {
  const interval = options?.intervalMs ?? 1000;
  const maxRetries = options?.maxRetries ?? 40;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 200) {
        return options?.extractBody ? await res.json() : undefined;
      }
    } catch { /* continue */ }
    await delay(interval);
  }
  throw new Error(`health check timeout: ${url}`);
}
```

### 效果

- 一处修改双端生效
- 轮询参数可配置

---

## 优化十一：消除 `rewriteClaudePluginCommands` 重复

### 问题

`utils.ts:rewriteClaudePluginCommands` 和 `package-claude-plugin.mjs:rewritePluginArtifacts` 实现了相同的正则替换逻辑。

### 方案

`package-claude-plugin.mjs` 改为导入 `utils.ts` 的函数：

```javascript
// package-claude-plugin.mjs
import { rewriteClaudePluginCommands } from "../dist/src/utils.js";
```

注意：`package-claude-plugin.mjs` 是构建脚本，需要在构建完成后才能导入 `dist/` 产物。短期方案是保留一份精简版，长期应改为 `tsx` 直接执行 TypeScript 源文件。

### 效果

- 插件命令改写逻辑不再双写
- 改格式时只需改一处

---

## 优化十二：`build-state.d.ts` 自动生成替代手写

### 问题

`scripts/build-state.d.ts`（94 行）手写对应 `scripts/build-state.mjs`（375 行），签名漂移无检测。

### 方案

将 `build-state.mjs` 改为 `build-state.ts`，TypeScript 编译自动生成 `.d.ts`。或者对关键导出的函数签名增加运行时校验：

```typescript
// build-state.mjs 增加 JSDoc 类型注释
/** @type {(root: string) => Promise<BuildState>} */
export async function readBuildState(root) { ... }
```

配合 `tsconfig.json` 中的 `checkJs: true` 做校验。

### 效果

- 消除手写类型文件，签名漂移在编译期捕获

---

## 优化十三：配置合并逻辑统一

### 问题

Embedding 和 Memory LLM 的配置合并使用不同的覆盖策略，且嵌入配置接受 CLI 覆盖但 Memory LLM 不接受。

### 方案

抽取通用合并器：

```typescript
// managed-config.ts
export function mergeManagedConfig<T extends Record<string, unknown>>(
  persisted: T | null,
  envDefaults: Partial<T>,
  cliOverrides: Partial<T>,
): T {
  return {
    ...envDefaults,
    ...persisted,
    ...cliOverrides,
  } as T;
}
```

Embedding 和 Memory LLM 都走同一个合并路径。

### 效果

- 配置优先级一致：CLI > 持久化 > 环境变量 > 默认值
- 新增配置类型只需调用 `mergeManagedConfig`

---

## 优化十四：Docker 错误处理从字符串匹配改为 exit code 判断

### 问题

```typescript
message.includes("No such container")
```

Docker 本地化或版本变更后此字符串匹配会失效。

### 方案

捕获子进程的 exit code，Docker CLI 对"资源不存在"返回 code 1 且 stderr 置空是可靠的跨版本行为。更好的做法是用 Docker API (`dockerode` 或直接 HTTP 调用 `/containers/{id}/json`)，返回 404 时精确判断。

短期方案：同时检查 `stderr.includes("No such container") || stderr.includes("not found") || code === 1 && stderr.length === 0`。

### 效果

- 不再依赖 Docker CLI 英文措辞
- 本地化环境不误判

---

## 实施优先级

| 优先级 | 优化项 | 理由 |
|---|---|---|
| **P1** | 优化一（DB 密码随机化） | 安全漏洞 |
| **P1** | 优化二（JSON 解析保护） | 配置损坏即崩溃 |
| **P2** | 优化三（跨平台 spawn 统一） | 代码重复最严重 |
| **P2** | 优化四（合并 terminateProcess） | 消除三份拷贝 |
| **P2** | 优化五（拆分 start-command） | 可维护性 |
| **P2** | 优化十四（Docker 错误处理） | 本地化环境可靠性 |
| **P3** | 优化六（Docker 路径配置化） | 非默认安装用户 |
| **P3** | 优化七（host.docker.internal） | Linux 兼容性 |
| **P3** | 优化八（Boolean 归一化） | 代码整洁 |
| **P3** | 优化九（codex 子命令） | 用户体验 |
| **P3** | 优化十（waitForHealthy 合并） | 消除分叉 |
| **P3** | 优化十一（plugin 改写去重） | 可维护性 |
| **P3** | 优化十二（build-state 类型安全） | 编译期检测 |
| **P3** | 优化十三（配置合并统一） | 可维护性 |

每项优化独立可实施、独立可验证。
