# Memory-Native-Agent v0.2 Roadmap

> 基于 v0.1 全模块源码审查，本文档汇总现有问题、优化方案及 Skill 系统设计。
> 审查范围：config / providers / runner / tools / http / mcp-client / memory-client / session-store

---

## 目录

- [一、现状总览](#一现状总览)
- [二、问题清单与优化方案](#二问题清单与优化方案)
  - [P0 — 阻塞生产使用](#p0--阻塞生产使用)
  - [P1 — 显著影响体验](#p1--显著影响体验)
  - [P2 — 运维与安全](#p2--运维与安全)
  - [P3 — 产品完善](#p3--产品完善)
- [三、Skill 系统设计](#三skill-系统设计)
  - [3.1 问题背景](#31-问题背景)
  - [3.2 架构设计](#32-架构设计)
  - [3.3 Skill 定义规范](#33-skill-定义规范)
  - [3.4 Skill 生命周期](#34-skill-生命周期)
  - [3.5 与记忆系统的集成](#35-与记忆系统的集成)
  - [3.6 内置 Skill 清单](#36-内置-skill-清单)
  - [3.7 实现计划](#37-实现计划)
- [四、实施路线](#四实施路线)

---

## 一、现状总览

### 架构

```
用户 ──WebSocket──▶ Fastify HTTP Server (auth middleware)
                        │
            ┌───────────┼───────────┐
            ▼           ▼           ▼
      AgentRunner   SessionStore  McpRegistry
         │ │         (SQLite)     (stdio/http)
         │ └──▶ ToolDispatcher
         │       ├─ fs_read
         │       ├─ fs_write
         │       ├─ fs_edit
         │       ├─ shell_exec
         │       └─ mcp_call
         │
    ┌────┴────┐
    ▼         ▼
 Provider   MemoryClient ──HTTP──▶ retrieval-runtime
(LLM API)                         (记忆检索/回写)
```

### v0.1 做得好的部分

| 维度           | 说明                                                         |
| -------------- | ------------------------------------------------------------ |
| 降级容错       | retrieval-runtime 不可用时自动 degraded mode，不阻塞对话     |
| Record-Replay  | 录制回放 provider，可用于确定性测试                          |
| Workspace 隔离 | UUIDv5 基于路径派生 workspace_id，跨项目记忆天然隔离         |
| 权限门控       | shell_exec 等危险操作需用户确认，支持 session 级授权缓存     |
| 工具审计链     | 每次工具调用记录到 SQLite（args_hash, duration_ms, decision）|
| 流式桥接       | StreamBridge 实现 flush 合并 + abort 处理，减少 WebSocket 碎片|

### v0.1 核心缺失

| 缺失           | 影响                                     |
| -------------- | ---------------------------------------- |
| 上下文窗口管理 | 长会话必超 LLM token 限制，无法生产使用  |
| Skill 系统     | 只有原子工具，无复合工作流编排能力       |
| 任务状态持久化 | turn 已记录 `task_id`，但任务元数据与最近任务列表重启后无法恢复 |
| 记忆回写可靠性 | 仍是 fire-and-forget；失败会报错，但无本地重试与补偿机制 |

---

## 二、问题清单与优化方案

### P0 — 阻塞生产使用

#### P0-1 无上下文窗口管理

**现状**

`Conversation.messages` 只增不减，`buildMessages()` 始终返回全量消息。

```typescript
// src/runner/conversation.ts
buildMessages(input: BuildMessagesInput): ChatMessage[] {
  built.push(...this.messages);  // 无限增长
  return built;
}
```

**风险**

- 长会话超出 LLM context window → 请求失败或截断
- 工具输出虽已有截断与 artifact 落盘，但缺少会话级 token budget 管理，仍可能快速挤占上下文

**方案**

1. 引入 `TokenBudgetManager`：
   - 配置项：`context.max_tokens`（默认按 provider/model 自动设置）
   - 预留区：system prompt + 记忆注入 + 当前轮用户输入 + 工具定义
   - 历史区：从最新向最旧填充，超出 budget 时截断
2. 工具输出截断：
   - 配置项：`tools.max_output_chars`（默认 8192）
   - 超长输出自动写入 artifact 文件，消息中只保留摘要 + 引用
3. 可选历史压缩：
   - 被截断的历史调用 LLM 生成摘要，作为 system message 注入
   - 配置项：`context.compaction_strategy: "truncate" | "summarize"`

**涉及文件**

- 新增：`src/runner/token-budget.ts`
- 修改：`src/runner/conversation.ts`、`src/runner/agent-runner.ts`
- 修改：`src/tools/helpers.ts`（输出截断）
- 修改：`src/config/schema.ts`（新增 context 配置段）

---

#### P0-2 工具输出无大小限制

**现状**

当前已经有统一的输出截断与 artifact 落盘机制，超出阈值的内容不会原样内联到对话里。

但这层控制仍然比较粗：

- 阈值固定在 tool helper，缺少配置项
- `fs_read` 还没有 `max_lines` / `byte_limit` 这类显式预算参数
- `shell_exec` 也没有按场景调整输出上限的能力
- 截断发生在 tool 输出阶段，还没有和 conversation token budget 统一联动

**方案**

- 在 `ToolDispatcher.invoke()` 返回后、写入 conversation 前截断：
  ```
  output.length > MAX_INLINE_CHARS
    → 写入 artifact 文件
    → 替换为 "[输出已保存到 artifact] 前 N 行: ..."
  ```
- `fs_read` 增加 `max_lines` / `byte_limit` 参数
- `shell_exec` 增加 `max_output_bytes` 参数（默认 32KB）

**涉及文件**

- 修改：`src/runner/agent-runner.ts`（截断逻辑）
- 修改：`src/tools/builtin/fs-read.ts`、`src/tools/builtin/shell-exec.ts`

---

#### P0-3 Anthropic max_tokens 默认值过低

**现状**

```typescript
// src/providers/anthropic.ts:303
max_tokens: options.request.max_tokens ?? 1024
```

代码生成场景 1024 tokens 严重不足，频繁触发 `length` 截断。

**方案**

- 默认值提升到 8192
- 在 `ProviderConfig` 中新增 `max_tokens` 可配置字段
- 按 model 设置合理默认值（Claude 3.5 Sonnet → 8192，GPT-4o → 4096 等）

**涉及文件**

- 修改：`src/providers/anthropic.ts`、`src/providers/openai-compatible.ts`
- 修改：`src/config/schema.ts`（provider 新增 max_tokens 字段）

---

### P1 — 显著影响体验

#### P1-1 工具串行执行

**现状**

```typescript
// src/runner/agent-runner.ts:228
if (chunk.type === "tool_call") {
  const toolResult = await this.runTool(turnId, chunk.call, ...);
  // 下一个 tool_call 等上一个完成后才处理
}
```

LLM 返回多个 tool_calls 时逐个执行。

**方案**

- 收集同一轮所有 tool_calls（在收到 `end` chunk 且 `finish_reason === "tool_use"` 后）
- 使用 `Promise.allSettled()` 并行执行
- 保留顺序将结果写入 conversation（维持 tool_call_id 对应关系）
- 配置项：`tools.parallel_execution: true`（默认开启）

**涉及文件**

- 修改：`src/runner/agent-runner.ts`（核心循环重构）

---

#### P1-2 记忆回写不可靠

**现状**

```typescript
// src/runner/agent-runner.ts:321
void this.deps.memoryClient.finalizeTurn({...}).catch((error) => {
  this.deps.io.emitError("session", ...);
});
```

fire-and-forget，失败只记日志，不重试。

**方案**

1. 引入本地回写队列：
   - SQLite 新增 `writeback_queue` 表
   - `finalizeTurn` 失败时写入队列
   - 后台定时器每 30s 重试队列中的条目（最多 3 次，指数退避）
2. 对显式记忆请求增加反馈：
   - 检测用户输入中的"记住"/"remember" 关键词
   - 回写成功/失败后通过 WebSocket 事件通知
3. turn_end 事件新增 `writeback_status` 字段

**涉及文件**

- 新增：`src/runner/writeback-queue.ts`
- 修改：`src/runner/agent-runner.ts`、`src/runner/writeback-decider.ts`
- 修改：`src/session-store/types.ts`（新增 writeback_queue 表）

---

#### P1-3 任务状态不持久化

**现状**

`AgentRunner` 中的 `currentTask` 和 `recentTasks` 纯内存，重启归零。

```typescript
// src/runner/agent-runner.ts
private currentTask: TaskState | null = null;
private recentTasks: TaskState[] = [];
```

**方案**

- SQLite 新增 `tasks` 表：`id, session_id, label, created_at, last_active_at`
- `createTaskState` / `touchTask` 同步写入 SQLite
- `AgentRunner` 构造时从 store 恢复最近任务列表
- session 恢复时自动关联上次的 active task

**涉及文件**

- 修改：`src/runner/task-state.ts`
- 修改：`src/runner/agent-runner.ts`
- 修改：`src/session-store/sqlite-store.ts`（新增 tasks 表和 migration）

---

#### P1-4 触发器检测过于脆弱

**现状**

```typescript
// src/runner/trigger-detector.ts
const TASK_START_PATTERNS = [
  /^(帮我|help me|let's|let me|我要|我想|请帮)/i,
];
// Jaccard < 0.15 → task switch（过于激进）
```

**问题**

- 正则只覆盖中英文，粒度太粗
- Jaccard 阈值 0.15 导致几乎任何话题变化都触发 task switch
- task label 截取 40 字符丢失关键信息
- 用户无法显式控制任务边界

**方案**

1. 提高 Jaccard 阈值到 0.3
2. task label 扩展到 80 字符
3. 新增显式任务 API：
   - WebSocket 事件：`{ kind: "task_start", label: "..." }`
   - HTTP 端点：`POST /v1/agent/sessions/:id/task`
4. 长期：可选 LLM 意图检测（作为 skill 实现）

**涉及文件**

- 修改：`src/runner/trigger-detector.ts`、`src/runner/task-state.ts`
- 修改：`src/http/ws/session-ws.ts`（新增 task 事件处理）
- 新增：session routes 中的 task 端点

---

#### P1-5 writeback 时机判断粗糙

**现状**

```typescript
// src/runner/writeback-decider.ts
export function shouldFinalizeTurn(userInput: string, assistantOutput: string): boolean {
  return userInput.trim().length > 0 && assistantOutput.trim().length > 0;
}
```

只要 input/output 非空就触发回写，每轮都调用 `finalizeTurn`，噪声极高。

**方案**

- 引入启发式过滤：
  - 跳过纯问候、确认类短回复（< 20 字符且无实质内容）
  - 跳过工具输出为主的轮次（助手输出中 tool_output 占比 > 80%）
  - 保留显式记忆请求（"记住"/"remember"）
- 配置项：`memory.writeback_filter: "aggressive" | "moderate" | "all"`

**涉及文件**

- 修改：`src/runner/writeback-decider.ts`

---

### P2 — 运维与安全

#### P2-1 日志系统缺失

**现状**

```typescript
// src/server.ts
const app = Fastify({ logger: false });
```

Fastify logger 被禁用，依赖 pino 但未使用。

**方案**

- 启用 Fastify 内置 pino logger
- 配置结构化 JSON 输出
- 按模块设置 log level（`provider: "info"`, `tools: "warn"`, `http: "info"`）
- 配置项：`logging.level`、`logging.format: "json" | "pretty"`

**涉及文件**

- 修改：`src/server.ts`
- 修改：`src/config/schema.ts`（新增 logging 配置段）
- 各模块注入 logger 实例替换空 `logger ?? {}`

---

#### P2-2 SQLite 未优化

**现状**

- 未启用 WAL 模式，读写互锁
- 迁移系统仍以 `0001-init.sql` + `ensureColumn` 为主，缺少版本化迁移管理
- 已有基础索引，但还没有围绕 WAL、迁移版本和更高频查询路径继续优化

**方案**

```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA busy_timeout=5000;
```

- 引入版本化迁移系统（`migrations/0001-init.sql`, `0002-wal.sql`, ...）
- 在 `schema_version` 表中记录已执行的迁移
- 为 `messages.session_id`、`turns.session_id` 等高频查询列添加索引

**涉及文件**

- 修改：`src/session-store/sqlite-store.ts`
- 新增：`src/session-store/migrations/0002-wal-and-indexes.sql`

---

#### P2-3 认证机制简陋

**现状**

- 单个静态 token，无用户区分
- WebSocket token 在 URL query 参数中明文传递
- HTTP 请求支持 Bearer token，但整体仍是单 token 模式
- 无 rate limiting

**方案**

阶段一（短期）：
- WebSocket 连接改用首条消息传递 token（而非 URL query）
- 增加基于 IP 的 rate limiting（Fastify 插件 `@fastify/rate-limit`）
- token 支持定期轮转（`token.max_age_hours`）

阶段二（中期）：
- 支持多 token（per-client token）
- token 绑定 workspace scope

**涉及文件**

- 修改：`src/http/middleware/auth.ts`
- 修改：`src/http/ws/session-ws.ts`
- 修改：`src/shared/token.ts`

---

#### P2-4 Shell deny patterns 容易绕过

**现状**

简单通配符匹配，`bash -c 'rm -rf /'` 等变体可绕过。

**方案**

短期：
- 对命令做 shell 展开归一化后再匹配
- 增加更多变体 pattern（`bash -c`, `sh -c`, `eval`, `$()`）
- 增加路径级别保护（禁止操作 workspace 外路径）

长期：
- 引入轻量沙箱（如 Linux namespace / Windows Job Object）
- 或对接容器化执行环境

**涉及文件**

- 修改：`src/tools/builtin/shell-exec.ts`
- 修改：`src/config/defaults.ts`

---

#### P2-5 Metrics 缺少标准导出

**现状**

当前已经提供 `/v1/agent/metrics` JSON 接口，便于查看运行时计数器和延迟分位。

但仍存在几个明显缺口：

- 无 Prometheus 文本格式导出
- 无 OTLP 等标准监控集成
- 延迟统计仍基于内存采样与手动 percentile 计算，采样上限 512

**方案**

- 新增 `/metrics` 端点输出 Prometheus 文本格式
- 使用 histogram 替代手动 percentile 计算
- 关键指标：`mna_turns_total`, `mna_provider_latency_seconds`, `mna_tool_duration_seconds`, `mna_memory_writeback_total`

**涉及文件**

- 新增：`src/http/routes/prometheus.ts`
- 修改：`src/http/state.ts`（metrics 结构升级）

---

### P3 — 产品完善

#### P3-1 System Prompt 缺乏项目感知

**现状**

静态模板，仅替换 workspace_root / platform / memory_mode 三个变量。

**方案**

- 首次启动时扫描 workspace：
  - 检测 `package.json` / `Cargo.toml` / `go.mod` / `requirements.txt` 等
  - 推断主要语言和框架
  - 检测 `.git` 判断版本控制状态
- 将项目上下文注入 system prompt 的 `[Project]` 段
- 支持 `system_prompt_template` 配置（允许用户自定义模板变量）

**涉及文件**

- 新增：`src/runner/prompts/workspace-scanner.ts`
- 修改：`src/runner/prompts/default-system.ts`

---

#### P3-2 无多模态支持

**现状**

```typescript
export interface ChatMessage {
  content: string;  // 仅 string
}
```

**方案**

- `ChatMessage.content` 扩展为 `string | ContentPart[]`
- `ContentPart = { type: "text", text: string } | { type: "image_url", image_url: { url: string } }`
- Provider 层各自适配消息格式

**涉及文件**

- 修改：`src/providers/types.ts`
- 修改：`src/providers/openai-compatible.ts`、`src/providers/anthropic.ts`
- 修改：`src/runner/conversation.ts`

---

#### P3-3 无 Prompt Caching

**现状**

每轮对话将完整的 system prompt + 记忆注入 + 全量历史发给 LLM，未利用 Anthropic prompt caching / OpenAI prefix caching。

**方案**

- Anthropic provider：system prompt 标记 `cache_control: { type: "ephemeral" }`
- OpenAI provider：确保 system prompt 在 messages 头部不变以命中 prefix cache
- 记忆注入放在 system messages 末尾（变化部分后置）

**涉及文件**

- 修改：`src/providers/anthropic.ts`、`src/providers/openai-compatible.ts`
- 修改：`src/runner/conversation.ts`（消息排序策略）

---

#### P3-4 Provider 切换影响全局

**现状**

`updateProviderSelection` 重建所有活跃 session 的 runner。

**方案**

- Provider 切换改为 session 级别，不影响其他会话
- 全局切换仅影响新建 session
- 已有 session 保持创建时的 provider 直到显式切换

**涉及文件**

- 修改：`src/http/state.ts`（`updateProviderSelection` 逻辑）
- 修改：`src/http/routes/sessions.ts`

---

#### P3-5 缺少 CLI 交互客户端

**现状**

只有 HTTP/WebSocket API，无终端交互界面。

**方案**

- 新增 `bin/mna-chat.mjs` CLI 客户端
- 基于 readline + WebSocket 的轻量 REPL
- 支持 `/task`、`/mode`、`/skill` 等斜杠命令
- 支持工具确认交互（`[y/n/always]`）

**涉及文件**

- 新增：`src/cli/` 目录
- 新增：`bin/mna-chat.mjs`

---

## 三、Skill 系统设计

### 3.1 问题背景

**当前工具体系只有原子层，缺少编排层：**

```
当前：用户输入 → LLM 自行规划 → 逐个调用原子 tool → 拼接输出

期望：用户输入 → Skill 路由 → 预定义步骤编排 → 调用原子 tool → 结构化输出
                                   ↑
                           记忆系统注入领域上下文
```

| 维度       | 现状（仅 Tool）             | 目标（Tool + Skill）              |
| ---------- | --------------------------- | --------------------------------- |
| 粒度       | 原子操作                    | 复合工作流                        |
| 编排       | LLM 每次重新规划            | 预定义步骤 + LLM 填充细节        |
| 发现       | 5 个硬编码工具              | 动态加载、按名调用                |
| 用户扩展   | 仅 MCP                      | YAML 定义 + 共享                  |
| 专家提示   | 通用 system prompt          | skill 自带领域 prompt             |
| 记忆联动   | 记忆仅注入到通用对话        | skill 拉取特定领域记忆            |
| 质量稳定性 | 完全依赖 LLM 规划，波动大  | 预定义骨架，LLM 负责填充，稳定   |

### 3.2 架构设计

#### 3.2.1 整体分层

```
┌──────────────────────────────────────────────────┐
│                   用户入口                        │
│         WebSocket / HTTP / CLI（/skill xxx）      │
└──────────────────────┬───────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────┐
│                 SkillRouter                        │
│  ┌─────────────────────────────────────────────┐  │
│  │  1. 显式匹配：/review → code-review skill   │  │
│  │  2. 意图匹配：LLM 判断是否适合某个 skill    │  │
│  │  3. 降级：无匹配 → 走原有 AgentRunner 通路  │  │
│  └─────────────────────────────────────────────┘  │
└──────────────────────┬───────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────┐
│               SkillExecutor                        │
│  ┌───────────┐ ┌───────────┐ ┌────────────────┐  │
│  │ skill 定义 │ │ step 编排 │ │ 记忆上下文注入  │  │
│  │ (YAML)    │ │ (顺序/并行)│ │ (按 skill 域)  │  │
│  └───────────┘ └───────────┘ └────────────────┘  │
└──────────────────────┬───────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────┐
│            ToolDispatcher（复用现有）              │
│     fs_read / fs_write / fs_edit / shell_exec    │
│              mcp_call / 未来新增工具              │
└──────────────────────────────────────────────────┘
```

#### 3.2.2 核心组件

```typescript
// src/skills/types.ts

export interface SkillDefinition {
  name: string;
  version: string;
  description: string;
  trigger: SkillTrigger;
  parameters: SkillParameter[];
  steps: SkillStep[];
  system_prompt: string;
  memory_scopes?: string[];       // 拉取哪些领域的记忆
  output_format?: "text" | "markdown" | "json";
  timeout_ms?: number;
  required_tools?: string[];      // 依赖的工具，缺失时 skill 不可用
}

export interface SkillTrigger {
  commands: string[];             // 显式命令 ["/review", "/code-review"]
  intent_patterns?: string[];     // 意图匹配关键词
  auto_detect?: boolean;          // 是否启用 LLM 意图检测
}

export interface SkillParameter {
  name: string;
  type: "string" | "number" | "boolean" | "file_path" | "glob";
  required: boolean;
  default?: unknown;
  description: string;
}

export interface SkillStep {
  id: string;
  action: "llm_generate" | "tool_call" | "conditional" | "parallel";
  description: string;
  depends_on?: string[];          // 依赖的前置 step id
  tool?: string;                  // action=tool_call 时指定工具名
  tool_args_template?: Record<string, string>;  // 参数模板，支持 {{var}} 引用
  prompt_template?: string;       // action=llm_generate 时的 prompt 模板
  condition?: string;             // action=conditional 时的条件表达式
  children?: SkillStep[];         // action=parallel 时的子步骤
  output_key?: string;            // 结果写入上下文的 key
  max_retries?: number;
}

export interface SkillContext {
  parameters: Record<string, unknown>;
  step_outputs: Record<string, unknown>;
  memory_injection: InjectionBlock | null;
  workspace_root: string;
  session_id: string;
  turn_id: string;
}

export interface SkillResult {
  ok: boolean;
  output: string;
  artifacts?: Array<{ kind: string; ref: string }>;
  steps_completed: number;
  steps_total: number;
  error?: { code: string; message: string; failed_step?: string };
}
```

#### 3.2.3 SkillRouter

```typescript
// src/skills/router.ts

export interface SkillRouterDeps {
  registry: SkillRegistry;
  provider: IModelProvider;       // 用于意图检测
}

export class SkillRouter {
  /**
   * 路由决策：
   * 1. 输入以 / 开头 → 显式命令匹配
   * 2. registry 中存在 auto_detect=true 的 skill → LLM 意图分类
   * 3. 无匹配 → 返回 null，走 AgentRunner 原有通路
   */
  async route(userInput: string): Promise<SkillMatch | null>;
}

export interface SkillMatch {
  skill: SkillDefinition;
  parameters: Record<string, unknown>;
  confidence: number;             // 0-1，显式命令=1.0
}
```

#### 3.2.4 SkillExecutor

```typescript
// src/skills/executor.ts

export class SkillExecutor {
  constructor(private deps: {
    tools: ToolDispatcher;
    provider: IModelProvider;
    memoryClient: MemoryClient;
    io: RunnerIO;
  }) {}

  /**
   * 执行 skill：
   * 1. 解析参数 + 注入记忆上下文
   * 2. 按 DAG 顺序执行 steps
   * 3. parallel step 并行执行子步骤
   * 4. conditional step 评估条件后决定分支
   * 5. 每个 step 完成后通过 io 发送进度事件
   * 6. 最终输出 SkillResult
   */
  async execute(
    skill: SkillDefinition,
    context: SkillContext,
    signal: AbortSignal,
  ): Promise<SkillResult>;
}
```

### 3.3 Skill 定义规范

Skill 定义文件放置位置：

```
~/.mna/skills/          # 全局 skill（用户自定义）
.mna/skills/            # workspace 级 skill（项目自定义）
src/skills/builtin/     # 内置 skill（代码内）
```

加载优先级：workspace > global > builtin（同名覆盖）。

#### YAML 示例：code-review skill

```yaml
# .mna/skills/code-review.yaml
name: code-review
version: "1.0"
description: 对指定文件或 git diff 进行代码审查
trigger:
  commands: ["/review", "/code-review"]
  intent_patterns: ["审查", "review", "看看代码", "check.*code"]
  auto_detect: true

parameters:
  - name: target
    type: string
    required: false
    default: "HEAD~1"
    description: "审查目标：文件路径、glob 或 git ref"
  - name: focus
    type: string
    required: false
    description: "重点关注的方面（安全/性能/可读性）"

memory_scopes: ["workspace", "user"]
output_format: markdown
timeout_ms: 120000
required_tools: ["shell_exec", "fs_read"]

system_prompt: |
  你正在执行代码审查任务。基于记忆系统中的项目偏好和编码规范进行审查。
  重点关注：{{focus}}
  输出格式：按严重程度分级（Critical / High / Medium / Low）。

steps:
  - id: gather_diff
    action: tool_call
    description: 获取变更内容
    tool: shell_exec
    tool_args_template:
      command: "git diff {{target}}"
    output_key: diff_content

  - id: list_changed_files
    action: tool_call
    description: 获取变更文件列表
    tool: shell_exec
    tool_args_template:
      command: "git diff --name-only {{target}}"
    output_key: changed_files

  - id: read_full_files
    action: parallel
    description: 并行读取所有变更文件的完整内容
    depends_on: [list_changed_files]
    children:
      - id: read_file_batch
        action: tool_call
        tool: fs_read
        tool_args_template:
          path: "{{file}}"
    output_key: file_contents

  - id: analyze
    action: llm_generate
    description: 执行代码审查分析
    depends_on: [gather_diff, read_full_files]
    prompt_template: |
      ## 变更 Diff
      {{diff_content}}

      ## 完整文件内容
      {{file_contents}}

      请按以下维度审查：
      1. 正确性：逻辑错误、边界条件
      2. 安全性：注入、权限、敏感数据
      3. 性能：N+1 查询、内存泄漏
      4. 可维护性：命名、复杂度、重复代码
      {{#if focus}}
      重点关注：{{focus}}
      {{/if}}

      输出 Markdown 格式的审查报告。
    output_key: review_report

  - id: output
    action: llm_generate
    description: 生成最终审查总结
    depends_on: [analyze]
    prompt_template: |
      基于审查报告，生成一份简明总结：
      - 问题总数及严重程度分布
      - Top 3 最重要的问题
      - 整体评价

      审查报告：
      {{review_report}}
    output_key: final_summary
```

### 3.4 Skill 生命周期

```
1. Discovery（发现）
   │  SkillRegistry 扫描 builtin/ + ~/.mna/skills/ + .mna/skills/
   │  解析 YAML → SkillDefinition → 注册到 registry
   ▼
2. Routing（路由）
   │  SkillRouter 接收用户输入
   │  显式命令 → 精确匹配
   │  自然语言 → intent_patterns 匹配 → 可选 LLM 确认
   ▼
3. Parameter Resolution（参数解析）
   │  从用户输入中提取参数
   │  缺失必要参数 → 通过 WebSocket 向用户追问
   │  应用默认值
   ▼
4. Memory Injection（记忆注入）
   │  根据 skill.memory_scopes 调用 memoryClient.prepareContext
   │  注入领域特定记忆到 SkillContext
   ▼
5. Step Execution（步骤执行）
   │  按 DAG 依赖顺序执行 steps
   │  tool_call → ToolDispatcher
   │  llm_generate → Provider
   │  parallel → Promise.allSettled
   │  conditional → 评估表达式
   │  每步完成 → 发送 skill_step_complete 事件
   ▼
6. Output（输出）
   │  聚合所有 step 输出 → SkillResult
   │  通过 io.emitAssistantDelta 流式返回
   │  可选：写入 artifact 文件
   ▼
7. Writeback（回写）
   │  skill 执行结果和上下文触发 finalizeTurn
   │  记忆系统提取可写回的知识
```

### 3.5 与记忆系统的集成

```
                    SkillExecutor
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
    memory_scopes   step 输出      skill 结果
    ["workspace",   (中间数据)     (最终输出)
     "user"]             │              │
          │              │              │
          ▼              │              ▼
   prepareContext        │        finalizeTurn
   (按 scope 检索)      │        (提取可写回知识)
          │              │              │
          ▼              │              ▼
   记忆注入到            │        写回到记忆存储
   skill prompt          │        (编码规范、审查偏好等)
                         │
                         ▼
                  skill 内 step 间
                  共享中间结果
```

**关键设计点：**

1. **Skill 级别的记忆 scope** —— `code-review` skill 拉取 workspace + user scope 的记忆（编码规范、审查偏好），而不是全量记忆
2. **Skill 结果驱动的记忆写回** —— 审查发现的项目模式可作为 `fact_preference` 写回
3. **记忆影响 skill 行为** —— 如果记忆中有"该项目禁止使用 any"，则 code-review skill 将此作为审查规则

### 3.6 内置 Skill 清单

| Skill 名称        | 触发命令             | 功能描述                             | 依赖工具                |
| ----------------- | -------------------- | ------------------------------------ | ----------------------- |
| `code-review`     | `/review`            | 代码审查，按严重程度分级             | shell_exec, fs_read     |
| `explain`         | `/explain`           | 解释代码段/文件/模块的工作原理       | fs_read                 |
| `refactor`        | `/refactor`          | 代码重构建议 + 实施                  | fs_read, fs_edit        |
| `test-gen`        | `/test`              | 为指定代码生成测试                   | fs_read, fs_write       |
| `fix-bug`         | `/fix`               | 诊断并修复 bug                       | shell_exec, fs_read, fs_edit |
| `git-commit`      | `/commit`            | 分析变更并生成 commit message        | shell_exec              |
| `search-codebase` | `/search`            | 语义搜索代码库                       | shell_exec, fs_read     |
| `project-summary` | `/summary`           | 项目结构和技术栈概览                 | shell_exec, fs_read     |
| `memory-manage`   | `/memory`            | 查看/编辑/删除已存储的记忆           | （直接调用 MemoryClient）|

### 3.7 实现计划

#### Phase 1：基础设施（预计 3-5 天）

```
新增文件：
  src/skills/
    types.ts          # SkillDefinition, SkillContext, SkillResult 类型
    registry.ts       # SkillRegistry — 加载、注册、查找 skill
    router.ts         # SkillRouter — 显式命令 + intent 匹配
    executor.ts       # SkillExecutor — step 编排引擎
    template.ts       # 模板渲染（{{var}} 替换 + 条件块）
    index.ts          # 统一导出

修改文件：
  src/runner/agent-runner.ts    # submit() 中集成 SkillRouter
  src/http/state.ts             # createRuntimeState 中初始化 SkillRegistry
  src/config/schema.ts          # 新增 skills 配置段
  src/config/defaults.ts        # skills 默认配置
```

#### Phase 2：核心 Skill 实现（预计 3-5 天）

```
新增文件：
  src/skills/builtin/
    code-review.yaml
    explain.yaml
    test-gen.yaml
    fix-bug.yaml
    git-commit.yaml

修改文件：
  src/skills/registry.ts    # 内置 skill 自动加载
```

#### Phase 3：记忆集成 + 用户扩展（预计 2-3 天）

```
修改文件：
  src/skills/executor.ts    # 记忆注入 + 回写集成
  src/skills/registry.ts    # 用户自定义 skill 加载（~/.mna/skills/）

新增文件：
  src/skills/builtin/
    memory-manage.yaml      # 记忆管理 skill
```

#### Phase 4：WebSocket 协议扩展（预计 1-2 天）

```
新增 WebSocket 事件：
  client → server:
    { kind: "skill_invoke", skill: "code-review", params: {...} }

  server → client:
    { kind: "skill_started", skill: "code-review", steps_total: 5 }
    { kind: "skill_step_complete", step_id: "gather_diff", output_preview: "..." }
    { kind: "skill_complete", ok: true, output: "..." }
    { kind: "skill_error", code: "step_failed", message: "...", failed_step: "..." }

修改文件：
  src/http/ws/session-ws.ts     # 新增 skill_invoke 事件处理
  src/http/ws/event-codec.ts    # 新增事件编解码
```

---

## 四、实施路线

```
v0.2.0-alpha（第 1-2 周）
  ├─ [done] P0-1  上下文窗口管理
  ├─ [done] P0-2  工具输出大小限制
  ├─ [done] P0-3  Anthropic max_tokens 调整
  └─ [done] P2-1  启用结构化日志（当前为 Fastify JSON 结构化日志）

v0.2.0-beta（第 3-4 周）
  ├─ P1-1  工具并行执行
  ├─ P1-2  记忆回写重试队列
  ├─ P1-3  任务状态持久化
  ├─ P1-4  触发器检测改进
  └─ P2-2  SQLite WAL + 迁移系统

v0.2.0-rc（第 5-7 周）
  ├─ Skill Phase 1  基础设施
  ├─ Skill Phase 2  核心 Skill 实现
  ├─ Skill Phase 3  记忆集成
  └─ Skill Phase 4  WebSocket 协议扩展

v0.2.0（第 8 周）
  ├─ P2-3  认证增强
  ├─ P1-5  writeback 时机优化
  ├─ P3-1  System prompt 项目感知
  └─ 集成测试 + e2e 覆盖

v0.3.0（后续规划）
  ├─ P3-2  多模态支持
  ├─ P3-3  Prompt caching
  ├─ P3-5  CLI 客户端
  └─ P2-5  Prometheus metrics 导出
```

### 当前状态（2026-04-20）

- 已完成 `v0.2.0-alpha` 范围内的四项开发：
  - `P0-1`：新增 `context.max_tokens`、`context.reserve_tokens`、`context.compaction_strategy` 配置；`Conversation.buildMessages()` 已接入基于 token 估算的历史裁剪
  - `P0-2`：新增 `tools.max_output_chars` 配置；`fs_read` 支持 `max_lines` / `byte_limit`，`shell_exec` 支持 `max_output_bytes`
  - `P0-3`：Anthropic provider 默认 `max_tokens` 已从 `1024` 调整到 `4096`，并优先使用 runner 传入的预算值
  - `P2-1`：server 已启用 Fastify 结构化日志，支持 `logging.level` 配置；当前运行态默认输出 JSON
- 尚未开始 `v0.2.0-beta` 及之后阶段的功能开发

文档已写入 `services/memory-native-agent/docs/roadmap-v0.2.md`。涵盖了 15 个已识别问题（按 P0-P3 分级）的具体方案 + Skill 系统完整设计（类型定义、架构分层、YAML 规范、记忆集成、实现计划），以及 8 周交付路线。
