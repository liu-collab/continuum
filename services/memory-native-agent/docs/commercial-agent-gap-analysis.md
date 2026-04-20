# 商用 Agent 基础模块差距分析

> 对标 Claude Code、Cursor、Devin、GitHub Copilot Workspace、Amazon Q Developer 等商用级 agent，
> 系统梳理 MNA 作为商用产品缺失的基础模块。
>
> 本文档与 `roadmap-v0.2.md` 互补：roadmap 聚焦现有代码的问题修复和 Skill 系统，
> 本文档聚焦"要成为商用产品还需要从零构建哪些模块"。

---

## 目录

- [一、模块全景对比](#一模块全景对比)
- [二、缺失模块详细设计](#二缺失模块详细设计)
  - [M1 — Guardrails 安全护栏](#m1--guardrails-安全护栏)
  - [M2 — 沙箱执行环境](#m2--沙箱执行环境)
  - [M3 — 代码索引与 RAG 管线](#m3--代码索引与-rag-管线)
  - [M4 — 多 Agent 编排](#m4--多-agent-编排)
  - [M5 — 用户管理与多租户](#m5--用户管理与多租户)
  - [M6 — 计费与用量管理](#m6--计费与用量管理)
  - [M7 — 缓存层](#m7--缓存层)
  - [M8 — 可观测性体系](#m8--可观测性体系)
  - [M9 — 评估与质量框架](#m9--评估与质量框架)
  - [M10 — 人机协作工作流](#m10--人机协作工作流)
  - [M11 — 配置热加载与特性开关](#m11--配置热加载与特性开关)
  - [M12 — Agent 测试框架](#m12--agent-测试框架)
  - [M13 — 上下文编排引擎](#m13--上下文编排引擎)
  - [M14 — 插件生态与市场](#m14--插件生态与市场)
- [三、模块依赖关系](#三模块依赖关系)
- [四、分阶段落地建议](#四分阶段落地建议)

---

## 一、模块全景对比

| 模块                 | MNA 现状    | 商用 Agent 标准            | 差距  |
| -------------------- | ----------- | -------------------------- | ----- |
| LLM Provider 抽象   | ✅ 多 provider 支持      | 多 provider + 路由 + 降级  | 小    |
| 工具系统             | ✅ 5 个内置 + MCP        | 工具 + Skill + 插件生态    | 中    |
| 记忆系统             | ✅ 依赖 retrieval-runtime | 内置 + 外部 + 多层         | 小    |
| 会话管理             | ✅ SQLite 持久化 + 中断恢复 + Prompt Inspector | 稳定持久化 + 恢复 + 审计 + 可扩展 | 小    |
| 流式传输             | ✅ WebSocket + SSE        | 标准化协议 + 断线恢复      | 小    |
| **安全护栏**         | ❌ 无                     | 输入/输出过滤 + 策略引擎   | **大** |
| **沙箱执行**         | ❌ 无                     | 容器化隔离 + 资源限制      | **大** |
| **代码索引/RAG**     | ❌ 无                     | AST 索引 + 语义搜索        | **大** |
| **多 Agent 编排**    | ❌ 无                     | 后续可选增强能力            | **暂缓** |
| **用户管理**         | ❌ 单 token               | 账户体系 + RBAC + 多租户   | **大** |
| **计费/用量**        | ❌ 无                     | Token 计量 + 配额 + 账单   | **大** |
| **缓存层**           | ❌ 无                     | 语义缓存 + 工具结果缓存    | **中** |
| **可观测性**         | ⚠️ 基础 metrics + 结构化日志 | OTel 链路追踪 + 告警 + 成本归因 | **中** |
| **评估框架**         | ❌ 无                     | 自动评分 + 回归检测 + A/B  | **大** |
| **人机协作**         | ⚠️ 工具确认 + session 级授权缓存 | 审批工作流 + 升级 + 队列   | **中** |
| **配置热加载**       | ❌ 无                     | 热更新 + Feature Flag      | **中** |
| **Agent 测试**       | ⚠️ 有 e2e + record-replay，但缺测试 DSL | 确定性测试 + 评估指标      | **中** |
| **上下文编排**       | ❌ 无                     | 智能上下文选择 + 压缩      | **大** |
| **插件生态**         | ⚠️ 仅 MCP                | 插件市场 + SDK + 审核      | **中** |

---

## 二、缺失模块详细设计

### M1 — Guardrails 安全护栏

#### 为什么需要

商用 agent 能执行代码、操作文件系统、调用外部 API。没有安全护栏意味着：
- LLM 幻觉导致执行危险命令
- Prompt injection 通过工具输出注入恶意指令
- 输出包含敏感信息（API key、密码、PII）
- 用户输入包含有害内容传递给 LLM

当前 MNA 的安全措施只有：shell deny patterns（易绕过）+ 工具确认（用户可能盲点 allow）。

#### 架构设计

```
用户输入
    │
    ▼
┌──────────────┐
│ Input Guard  │ ← 输入过滤层
│ • PII 检测   │
│ • 注入检测   │
│ • 内容分类   │
└──────┬───────┘
       │
       ▼
  AgentRunner / SkillExecutor
       │
       ▼
┌──────────────┐
│ Action Guard │ ← 行为过滤层
│ • 路径策略   │
│ • 命令策略   │
│ • 网络策略   │
│ • 资源预算   │
└──────┬───────┘
       │
       ▼
  Tool 执行结果
       │
       ▼
┌──────────────┐
│ Output Guard │ ← 输出过滤层
│ • 敏感信息   │
│ • 幻觉检测   │
│ • 格式验证   │
└──────┬───────┘
       │
       ▼
  返回用户
```

#### 核心接口

```typescript
// src/guardrails/types.ts

export type GuardPhase = "input" | "action" | "output";
export type GuardDecision = "pass" | "warn" | "block" | "redact";

export interface GuardResult {
  decision: GuardDecision;
  reason?: string;
  redacted_content?: string;     // decision=redact 时的脱敏内容
  violations: GuardViolation[];
}

export interface GuardViolation {
  rule_id: string;
  severity: "info" | "warning" | "critical";
  description: string;
  span?: { start: number; end: number };  // 违规内容位置
}

export interface GuardRule {
  id: string;
  phase: GuardPhase;
  description: string;
  enabled: boolean;
  evaluate(context: GuardContext): GuardResult;
}

export interface GuardContext {
  phase: GuardPhase;
  content: string;
  metadata: {
    session_id: string;
    turn_id: string;
    tool_name?: string;
    file_path?: string;
  };
}

export interface GuardrailEngine {
  evaluate(phase: GuardPhase, context: GuardContext): Promise<GuardResult>;
  addRule(rule: GuardRule): void;
  removeRule(ruleId: string): void;
}
```

#### 内置规则清单

| 规则 ID                  | 阶段   | 功能                              |
| ------------------------ | ------ | --------------------------------- |
| `input.pii_detection`    | input  | 检测用户输入中的 PII（邮箱/电话/身份证）|
| `input.injection_detect` | input  | 检测 prompt injection 模式        |
| `action.path_policy`     | action | 禁止访问 workspace 外路径 + 敏感路径（.ssh, .env）|
| `action.command_policy`  | action | 命令黑名单 + 变体归一化检测       |
| `action.network_policy`  | action | 限制对外网络请求的目标域名        |
| `action.cost_budget`     | action | 单次 turn 的 token 消耗上限      |
| `output.secret_scan`     | output | 扫描输出中的 API key / token / 密码模式 |
| `output.pii_redact`      | output | 脱敏输出中的 PII 信息            |
| `output.hallucination`   | output | 检测代码引用不存在的 API/文件     |

#### 配置

```yaml
# config.yaml 新增
guardrails:
  enabled: true
  fail_open: false              # true=规则异常时放行，false=规则异常时拦截
  rules:
    input.pii_detection:
      enabled: true
      action: warn              # pass / warn / block / redact
    action.path_policy:
      enabled: true
      action: block
      allow_paths: ["{{workspace_root}}/**"]
      deny_paths: ["**/.env", "**/.ssh/**", "**/credentials*"]
    action.cost_budget:
      enabled: true
      max_tokens_per_turn: 100000
    output.secret_scan:
      enabled: true
      action: redact
      patterns:
        - "(sk|pk)_[a-zA-Z0-9]{20,}"
        - "ghp_[a-zA-Z0-9]{36}"
        - "AKIA[0-9A-Z]{16}"
```

#### 涉及文件

```
新增：
  src/guardrails/
    types.ts
    engine.ts                   # GuardrailEngine 实现
    rules/
      input-pii.ts
      input-injection.ts
      action-path-policy.ts
      action-command-policy.ts
      action-cost-budget.ts
      output-secret-scan.ts
      output-pii-redact.ts
    index.ts

修改：
  src/runner/agent-runner.ts    # submit() 前后插入 guard 检查
  src/tools/dispatcher.ts       # invoke() 前插入 action guard
  src/config/schema.ts          # 新增 guardrails 配置段
```

---

### M2 — 沙箱执行环境

#### 为什么需要

当前 `shell_exec` 直接在宿主机上 `spawn` 子进程，无隔离：
- 命令可以访问整个文件系统
- 可以消耗无限 CPU/内存
- 可以发起任意网络请求
- deny patterns 只是字符串匹配，轻易绕过

商用 agent（Devin、GitHub Copilot Workspace）都在沙箱/容器中执行代码。

#### 架构设计

```
shell_exec / fs_write / fs_edit
           │
           ▼
   ┌───────────────┐
   │ SandboxRouter │ 根据配置选择执行策略
   └───────┬───────┘
           │
     ┌─────┼─────┐
     ▼     ▼     ▼
  Native  Docker  Firecracker
  (开发)  (标准)  (高安全)
```

#### 沙箱策略接口

```typescript
// src/sandbox/types.ts

export interface SandboxConfig {
  strategy: "native" | "docker" | "firecracker";
  docker?: {
    image: string;                 // 默认镜像
    memory_limit: string;          // "512m"
    cpu_limit: string;             // "1.0"
    network_mode: "none" | "host" | "bridge";
    timeout_ms: number;
    volume_mounts: Array<{
      host_path: string;
      container_path: string;
      readonly: boolean;
    }>;
  };
  resource_limits: {
    max_file_size_bytes: number;   // 单文件最大写入
    max_total_disk_bytes: number;  // 总磁盘用量
    max_process_count: number;     // 最大子进程数
    max_execution_time_ms: number; // 总执行时间
  };
}

export interface Sandbox {
  exec(command: string, options: ExecOptions): Promise<ExecResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  listFiles(path: string): Promise<string[]>;
  cleanup(): Promise<void>;
}

export interface ExecOptions {
  cwd: string;
  env?: Record<string, string>;
  timeout_ms: number;
  abort: AbortSignal;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  resource_usage: {
    cpu_ms: number;
    memory_peak_bytes: number;
    wall_time_ms: number;
  };
}
```

#### 实现分级

| 级别 | 策略         | 隔离度 | 性能     | 适用场景         |
| ---- | ------------ | ------ | -------- | ---------------- |
| L0   | native       | 无     | 最快     | 本地开发/受信环境 |
| L1   | docker       | 进程级 | 中等     | 标准商用部署      |
| L2   | firecracker  | VM 级  | 较慢     | 多租户 SaaS       |

---

### M3 — 代码索引与 RAG 管线

#### 为什么需要

当前 MNA 只有 `fs_read`（读单个文件）和 `shell_exec`（可以 grep），没有代码理解能力：
- 无法语义搜索（"找到所有鉴权相关的代码"）
- 无法理解代码结构（类继承、函数调用链）
- 无法高效处理大型代码库（每次读文件消耗 token）
- 记忆系统存储的是对话知识，不是代码知识

商用 agent（Cursor、Continue）都有代码索引层。

#### 架构设计

```
代码文件变更（fs watch / git hook）
           │
           ▼
   ┌───────────────┐
   │  Indexer       │ 增量索引
   │  • AST 解析    │
   │  • Chunk 切分  │
   │  • Embedding   │
   └───────┬───────┘
           │
           ▼
   ┌───────────────┐
   │ Vector Store  │ 本地向量数据库
   │ (SQLite-vec   │
   │  / lancedb)   │
   └───────┬───────┘
           │
           ▼
   ┌───────────────┐
   │ Retriever     │ 多路召回
   │ • 语义搜索    │
   │ • 关键词搜索  │
   │ • 符号搜索    │
   │ • 依赖图遍历  │
   └───────┬───────┘
           │
           ▼
   注入到 Agent 上下文
```

#### 核心接口

```typescript
// src/code-index/types.ts

export interface CodeIndex {
  /** 全量/增量索引 workspace */
  index(options: IndexOptions): Promise<IndexResult>;

  /** 语义搜索 */
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;

  /** 符号查找（函数、类、变量） */
  findSymbol(name: string, kind?: SymbolKind): Promise<SymbolInfo[]>;

  /** 获取文件的依赖关系图 */
  getDependencyGraph(filePath: string): Promise<DependencyNode[]>;

  /** 获取文件结构摘要（不读全文） */
  getFileSummary(filePath: string): Promise<FileSummary>;

  /** 索引状态 */
  status(): IndexStatus;
}

export interface SearchResult {
  file_path: string;
  chunk: string;
  line_range: { start: number; end: number };
  score: number;
  symbol?: string;
  language?: string;
}

export interface IndexOptions {
  workspace_root: string;
  include_patterns?: string[];     // ["**/*.ts", "**/*.py"]
  exclude_patterns?: string[];     // ["node_modules/**", "dist/**"]
  incremental?: boolean;           // 仅处理变更文件
  max_file_size_bytes?: number;
}

export interface IndexStatus {
  indexed_files: number;
  total_chunks: number;
  last_indexed_at: string;
  indexing_in_progress: boolean;
  languages: Record<string, number>;  // { "typescript": 142, "python": 38 }
}
```

#### 与 Agent 集成

代码索引作为新的内置工具暴露给 LLM：

```typescript
// 新增工具
tools:
  - name: "code_search"
    description: "语义搜索代码库，找到与查询最相关的代码片段"
    parameters: { query: string, top_k?: number, language?: string }

  - name: "find_symbol"
    description: "查找代码符号（函数、类、变量）的定义位置"
    parameters: { name: string, kind?: "function" | "class" | "variable" }

  - name: "get_file_outline"
    description: "获取文件的结构大纲（类、函数列表），不读取完整内容"
    parameters: { path: string }
```

---

### M4 — 多 Agent 编排

#### 为什么需要

当前 MNA 是单 agent 单线程模式，复杂任务只能串行处理：
- 无法将子任务委托给专门的 sub-agent
- 无法并行处理独立子任务
- 无法在多个 agent 之间共享发现
- 长任务阻塞整个 session

商用产品（Devin、Claude Code 的 Agent tool）都支持多 agent 协作。

> 当前阶段说明：这一模块不作为近期落地目标。现阶段优先把单 agent 的上下文质量、安全边界、代码理解和人机协作跑顺；多 agent 只保留为后续增强方向。

#### 架构设计

```
                    Supervisor Agent
                    (任务分解、结果聚合)
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
         Worker A    Worker B    Worker C
         (代码分析)  (测试编写)  (文档生成)
              │          │          │
              └──────────┼──────────┘
                         │
                    共享上下文池
                    (发现、文件变更、中间结果)
```

#### 核心接口

```typescript
// src/orchestration/types.ts

export interface AgentOrchestrator {
  /** 启动子 agent */
  spawn(config: SubAgentConfig): Promise<SubAgentHandle>;

  /** 向子 agent 发送消息 */
  send(agentId: string, message: string): Promise<void>;

  /** 等待子 agent 完成 */
  await(agentId: string): Promise<SubAgentResult>;

  /** 并行执行多个子任务 */
  parallel(tasks: SubAgentTask[]): Promise<SubAgentResult[]>;

  /** 取消子 agent */
  cancel(agentId: string): Promise<void>;
}

export interface SubAgentConfig {
  name: string;
  role: string;                    // 角色描述，注入到 sub-agent system prompt
  tools?: string[];                // 限制可用工具子集
  provider_override?: ProviderConfig;  // 可用更小/更快的模型
  max_turns?: number;
  timeout_ms?: number;
  shared_context?: string[];       // 从父 agent 传递的上下文 key
}

export interface SubAgentHandle {
  id: string;
  name: string;
  status: "running" | "completed" | "failed" | "cancelled";
  subscribe(callback: (event: SubAgentEvent) => void): void;
}

export interface SubAgentResult {
  agent_id: string;
  ok: boolean;
  output: string;
  artifacts?: Array<{ kind: string; ref: string }>;
  turns_used: number;
  tokens_used: { prompt: number; completion: number };
}

export type SubAgentEvent =
  | { type: "progress"; message: string }
  | { type: "tool_use"; tool: string; preview: string }
  | { type: "question"; question: string; agent_id: string }
  | { type: "complete"; result: SubAgentResult };
```

#### 编排模式

| 模式       | 描述                       | 适用场景                     |
| ---------- | -------------------------- | ---------------------------- |
| delegate   | 主 agent 委托子任务        | 明确的子任务拆分             |
| parallel   | 多个 sub-agent 并行执行    | 独立子任务（分析多个文件）   |
| pipeline   | sub-agent 串行，上游输出给下游 | 分析 → 生成 → 审查         |
| supervisor | 主 agent 监督、纠正 sub-agent | 复杂任务需要中间检查        |
| debate     | 多个 sub-agent 各自分析后对比 | 需要多角度评估              |

---

### M5 — 用户管理与多租户

#### 为什么需要

当前 MNA 只有一个静态 token，所有请求视为同一用户。商用产品必须：
- 区分不同用户
- 隔离不同租户的数据
- 基于角色控制权限
- 支持团队协作

#### 核心设计

```typescript
// src/auth/types.ts

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tenant_id: string;
  api_keys: ApiKey[];
  created_at: string;
  settings: UserSettings;
}

export type UserRole = "owner" | "admin" | "member" | "viewer";

export interface Tenant {
  id: string;
  name: string;
  plan: "free" | "pro" | "enterprise";
  settings: TenantSettings;
  quotas: TenantQuotas;
}

export interface TenantQuotas {
  max_tokens_per_day: number;
  max_sessions_concurrent: number;
  max_workspaces: number;
  max_users: number;
  allowed_providers: string[];
  allowed_tools: string[];
}

export interface AuthProvider {
  /** 验证 token/session，返回用户信息 */
  authenticate(token: string): Promise<AuthResult>;

  /** 检查用户是否有特定权限 */
  authorize(user: User, action: string, resource: string): boolean;
}

export interface AuthResult {
  authenticated: boolean;
  user?: User;
  tenant?: Tenant;
  scopes?: string[];
}
```

#### 数据隔离

```
Tenant A                          Tenant B
├── User A1                       ├── User B1
│   ├── Workspace W1              │   ├── Workspace W3
│   │   ├── Sessions              │   │   ├── Sessions
│   │   ├── Memories              │   │   ├── Memories
│   │   └── Code Index            │   │   └── Code Index
│   └── Global Memories           │   └── Global Memories
└── User A2                       └── User B2
    └── Workspace W2
        └── ...

所有数据查询自动附加 tenant_id + user_id 过滤
```

---

### M6 — 计费与用量管理

#### 为什么需要

LLM 调用是主要成本来源，商用产品必须精确计量。

#### 核心设计

```typescript
// src/billing/types.ts

export interface UsageMeter {
  /** 记录一次 LLM 调用的 token 用量 */
  recordLLMUsage(event: LLMUsageEvent): void;

  /** 记录一次工具调用的资源用量 */
  recordToolUsage(event: ToolUsageEvent): void;

  /** 检查是否超出配额（在 LLM 调用前检查） */
  checkQuota(userId: string, tenantId: string): Promise<QuotaCheckResult>;

  /** 查询用量统计 */
  getUsageSummary(filter: UsageFilter): Promise<UsageSummary>;
}

export interface LLMUsageEvent {
  user_id: string;
  tenant_id: string;
  session_id: string;
  provider_id: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens?: number;
  estimated_cost_usd: number;      // 基于模型定价计算
  latency_ms: number;
  timestamp: string;
}

export interface UsageSummary {
  period: { start: string; end: string };
  total_tokens: number;
  total_cost_usd: number;
  by_model: Record<string, { tokens: number; cost: number }>;
  by_user: Record<string, { tokens: number; cost: number }>;
  by_workspace: Record<string, { tokens: number; cost: number }>;
  daily_breakdown: Array<{
    date: string;
    tokens: number;
    cost: number;
  }>;
}

export interface QuotaCheckResult {
  allowed: boolean;
  remaining_tokens: number;
  quota_limit: number;
  reset_at: string;
  warning?: string;                // 接近配额时的警告
}
```

#### 计费集成点

```
AgentRunner.submit()
       │
       ├─ checkQuota() ← 调用前检查配额
       │
       ├─ Provider.chat()
       │       │
       │       └─ 收集 usage（prompt_tokens + completion_tokens）
       │
       ├─ recordLLMUsage() ← 调用后记录
       │
       ├─ ToolDispatcher.invoke()
       │       │
       │       └─ recordToolUsage() ← 工具调用记录
       │
       └─ 聚合计入 session / daily / monthly 统计
```

---

### M7 — 缓存层

#### 为什么需要

- 重复读取同一文件浪费 LLM token
- 相似问题的 LLM 响应可复用
- Embedding 计算开销大，应缓存
- 降低 API 成本，提升响应速度

#### 核心设计

```typescript
// src/cache/types.ts

export interface CacheLayer {
  /** 工具结果缓存（文件读取结果、命令输出） */
  toolResultCache: ToolResultCache;

  /** 语义缓存（相似 query → 缓存的 LLM 响应） */
  semanticCache: SemanticCache;

  /** Embedding 缓存 */
  embeddingCache: EmbeddingCache;
}

export interface ToolResultCache {
  get(key: ToolCacheKey): CachedToolResult | null;
  set(key: ToolCacheKey, result: CachedToolResult, ttl_ms: number): void;
  invalidate(pattern: string): void;   // 文件变更时失效
}

export interface ToolCacheKey {
  tool_name: string;
  args_hash: string;
  workspace_id: string;
}

export interface SemanticCache {
  /** 搜索语义相似的缓存条目 */
  search(query: string, threshold: number): CachedResponse | null;

  /** 写入缓存 */
  store(query: string, response: string, metadata: CacheMetadata): void;
}

export interface CacheMetadata {
  model: string;
  provider: string;
  token_saved: number;
  created_at: string;
  ttl_ms: number;
}
```

#### 缓存策略

| 缓存类型     | Key              | TTL       | 失效条件                |
| ------------ | ---------------- | --------- | ----------------------- |
| 文件读取     | path + mtime     | 60s       | 文件修改（fs watch）    |
| Shell 输出   | command + cwd    | 不缓存    | —（命令有副作用）        |
| 语义缓存     | query embedding  | 1h        | 代码库变更 / 记忆更新    |
| Embedding    | content hash     | 24h       | —                        |
| 文件结构     | path + mtime     | 5min      | 文件修改                 |

---

### M8 — 可观测性体系

#### 为什么需要

当前已经具备基础可观测性：
- `/v1/agent/metrics` 提供运行时 JSON 指标
- server 已启用结构化日志
- 已有 provider / tool / latency 等基础计数和分位统计

但离商用可观测性体系还差一层标准化基础设施。商用产品仍需要：
- 排查生产问题
- 监控 SLA
- 成本归因
- 性能优化依据

#### 三支柱设计

```
┌─────────────────────────────────────────────────┐
│                可观测性体系                       │
│                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐    │
│  │  Traces  │  │   Logs   │  │   Metrics    │    │
│  │ (链路)   │  │ (日志)   │  │ (指标)       │    │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘    │
│       │             │               │              │
│       └─────────────┼───────────────┘              │
│                     │                              │
│              OpenTelemetry SDK                      │
│                     │                              │
│       ┌─────────────┼───────────────┐              │
│       ▼             ▼               ▼              │
│   Jaeger/Tempo   Loki/ELK    Prometheus/Grafana   │
└─────────────────────────────────────────────────┘
```

#### Tracing

每个 turn 生成完整链路：

```
[Turn span]
├── [PrepareContext span]
│   ├── phase: before_response
│   ├── latency_ms: 120
│   └── memory_records_count: 3
├── [LLM span]
│   ├── provider: anthropic
│   ├── model: claude-3.5-sonnet
│   ├── prompt_tokens: 4200
│   ├── completion_tokens: 890
│   └── first_token_ms: 340
├── [ToolCall span: fs_read]
│   ├── path: src/index.ts
│   ├── duration_ms: 12
│   └── output_bytes: 2400
├── [LLM span] (第 2 轮)
│   └── ...
└── [FinalizeTurn span]
    ├── writeback_candidates: 2
    └── submitted: true
```

#### 关键指标

```
# LLM
mna_llm_requests_total{provider, model, status}
mna_llm_tokens_total{provider, model, direction="prompt|completion"}
mna_llm_first_token_seconds{provider, model}         # histogram
mna_llm_request_duration_seconds{provider, model}     # histogram

# Tools
mna_tool_invocations_total{tool, status}
mna_tool_duration_seconds{tool}                        # histogram
mna_tool_denials_total{tool, reason}

# Memory
mna_memory_prepare_context_seconds{phase}              # histogram
mna_memory_writeback_total{status="success|failed|skipped"}
mna_memory_injection_records_total{phase, scope}

# Sessions
mna_sessions_active
mna_turns_total{finish_reason}
mna_websocket_connections_active

# Guardrails
mna_guard_evaluations_total{phase, rule, decision}

# Cost
mna_estimated_cost_usd_total{provider, model}
```

---

### M9 — 评估与质量框架

#### 为什么需要

Agent 输出质量无法仅靠单元测试验证。商用产品需要持续评估：
- 新 prompt / 新 model 上线前的回归检测
- 不同 provider 的质量对比
- Skill 效果评估
- 记忆注入是否真的提升了回答质量

#### 核心设计

```typescript
// src/evaluation/types.ts

export interface EvalSuite {
  name: string;
  description: string;
  cases: EvalCase[];
}

export interface EvalCase {
  id: string;
  input: string;                     // 用户输入
  context?: {                        // 可选的预设上下文
    workspace_files?: Record<string, string>;
    memory_records?: Array<{ summary: string; scope: string }>;
  };
  expected: {
    contains?: string[];             // 输出必须包含
    not_contains?: string[];         // 输出不能包含
    tool_calls?: Array<{             // 期望的工具调用
      tool: string;
      args_match?: Record<string, unknown>;
    }>;
    quality_criteria?: string[];     // LLM-as-judge 评估标准
  };
  metadata?: {
    category: string;                // "code_review" | "bug_fix" | ...
    difficulty: "easy" | "medium" | "hard";
  };
}

export interface EvalResult {
  case_id: string;
  passed: boolean;
  scores: Record<string, number>;    // { correctness: 0.9, helpfulness: 0.8 }
  actual_output: string;
  actual_tool_calls: string[];
  latency_ms: number;
  tokens_used: number;
  failure_reasons?: string[];
}

export interface EvalRunner {
  run(suite: EvalSuite, config: EvalConfig): Promise<EvalReport>;
}

export interface EvalReport {
  suite_name: string;
  timestamp: string;
  config: EvalConfig;
  results: EvalResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    pass_rate: number;
    avg_latency_ms: number;
    avg_tokens: number;
    scores_avg: Record<string, number>;
  };
  regression?: {                     // 与上次运行对比
    new_failures: string[];
    new_passes: string[];
    score_delta: Record<string, number>;
  };
}
```

#### 评估维度

| 维度       | 评估方法                 | 自动化程度 |
| ---------- | ------------------------ | ---------- |
| 正确性     | 关键词匹配 + 代码可编译 | 全自动     |
| 完整性     | 检查点覆盖              | 全自动     |
| 安全性     | 输出不含危险操作        | 全自动     |
| 工具使用   | 调用了正确的工具 + 参数 | 全自动     |
| 帮助度     | LLM-as-judge 打分       | 半自动     |
| 记忆利用   | 输出引用了注入的记忆    | 全自动     |

---

### M10 — 人机协作工作流

#### 为什么需要

当前已经有工具级别的 confirm/deny 和 session 级授权缓存，但缺少任务级别的人机协作：
- Agent 不确定时应该主动升级给人类
- 复杂操作需要多步审批
- 团队场景需要审批队列
- 需要支持异步审批（人类不在线时挂起）

#### 核心设计

```typescript
// src/collaboration/types.ts

export interface HumanInTheLoop {
  /** Agent 主动请求人类介入 */
  escalate(request: EscalationRequest): Promise<EscalationResult>;

  /** 提交审批请求 */
  requestApproval(request: ApprovalRequest): Promise<ApprovalResult>;

  /** 获取审批队列 */
  getPendingApprovals(filter: ApprovalFilter): Promise<ApprovalItem[]>;
}

export interface EscalationRequest {
  session_id: string;
  turn_id: string;
  reason: EscalationReason;
  context: string;                   // 为什么需要人类介入
  suggested_options?: string[];      // 建议的选择项
  timeout_ms?: number;
}

export type EscalationReason =
  | "low_confidence"                 // Agent 不确定如何处理
  | "destructive_operation"          // 高风险操作需要确认
  | "ambiguous_requirement"          // 需求不明确
  | "scope_exceeded"                 // 超出 agent 能力范围
  | "approval_required";             // 需要人工审批

export interface ApprovalRequest {
  type: "deploy" | "delete" | "external_api" | "cost_exceeds_threshold";
  description: string;
  details: Record<string, unknown>;
  approvers?: string[];              // 指定审批人
  expires_at?: string;
}

export type ApprovalResult =
  | { decision: "approved"; approver: string; comment?: string }
  | { decision: "rejected"; approver: string; reason: string }
  | { decision: "timeout" }
  | { decision: "cancelled" };
```

---

### M11 — 配置热加载与特性开关

#### 为什么需要

当前配置修改需要重启服务。商用产品需要：
- 运行时切换 provider / model 不中断服务
- Feature flag 灰度发布新功能
- A/B 测试不同 prompt / skill 版本
- 紧急情况下快速禁用某项功能

#### 核心设计

```typescript
// src/config/hot-reload.ts

export interface ConfigWatcher {
  /** 开始监听配置文件变更 */
  start(): void;

  /** 注册配置变更回调 */
  onChange(path: string, callback: (newValue: unknown, oldValue: unknown) => void): void;

  stop(): void;
}

// src/feature-flags/types.ts

export interface FeatureFlagProvider {
  /** 检查特性是否启用 */
  isEnabled(flag: string, context?: FlagContext): boolean;

  /** 获取特性的变体值 */
  getVariant<T>(flag: string, defaultValue: T, context?: FlagContext): T;

  /** 所有特性清单 */
  listFlags(): FeatureFlag[];
}

export interface FlagContext {
  user_id?: string;
  tenant_id?: string;
  workspace_id?: string;
  session_id?: string;
  environment?: string;
}

export interface FeatureFlag {
  name: string;
  description: string;
  enabled: boolean;
  rollout_percentage?: number;       // 0-100，灰度比例
  overrides?: Array<{
    match: Partial<FlagContext>;
    enabled: boolean;
  }>;
}
```

#### 内置 Feature Flag

```yaml
feature_flags:
  skill_system:
    enabled: true
    rollout_percentage: 100

  multi_agent:
    enabled: false
    rollout_percentage: 0

  semantic_cache:
    enabled: true
    rollout_percentage: 50
    overrides:
      - match: { tenant_id: "enterprise-001" }
        enabled: true

  new_system_prompt_v2:
    enabled: false
    rollout_percentage: 10            # 10% 用户灰度
```

---

### M12 — Agent 测试框架

#### 为什么需要

当前已经有完整的 e2e、record-replay provider 和确定性回放能力。

这里缺的不是“能不能测”，而是一个面向开发流程的统一测试框架。区别于 M9 评估框架（面向质量度量），这里的测试框架更面向开发流程：
- 开发新 skill 时的快速验证
- CI/CD 中的回归测试
- Provider 切换前的兼容性测试
- 记忆系统变更的影响测试

#### 核心设计

```typescript
// src/testing/types.ts

export interface AgentTestRunner {
  /** 使用 record-replay provider 运行确定性测试 */
  runDeterministic(test: AgentTest): Promise<TestResult>;

  /** 使用真实 provider 运行端到端测试 */
  runLive(test: AgentTest): Promise<TestResult>;

  /** 批量运行测试套件 */
  runSuite(suite: AgentTestSuite): Promise<TestSuiteResult>;
}

export interface AgentTest {
  name: string;
  description: string;
  setup?: {
    workspace_files?: Record<string, string>;
    config_overrides?: Partial<AgentConfig>;
    fixture_name?: string;           // record-replay fixture
    memory_seed?: Array<{            // 预置记忆
      summary: string;
      scope: string;
      importance: number;
    }>;
  };
  steps: TestStep[];
  assertions: TestAssertion[];
}

export interface TestStep {
  action: "user_input" | "wait_turn_end" | "confirm_tool" | "check_state";
  input?: string;
  turn_id?: string;
  decision?: "allow" | "deny";
  timeout_ms?: number;
}

export interface TestAssertion {
  type: "output_contains"
      | "output_not_contains"
      | "tool_called"
      | "tool_not_called"
      | "memory_written"
      | "file_exists"
      | "file_contains"
      | "exit_code";
  params: Record<string, unknown>;
}
```

#### 与 CI/CD 集成

```bash
# 确定性测试（使用 record-replay fixture，不调用真实 LLM）
npm run test:agent -- --suite=core --mode=deterministic

# 端到端测试（使用真实 LLM，运行耗时较长）
npm run test:agent -- --suite=smoke --mode=live --provider=anthropic

# 回归对比（对比两个 provider 的输出差异）
npm run test:agent -- --suite=regression --compare=anthropic,openai
```

---

### M13 — 上下文编排引擎

#### 为什么需要

roadmap-v0.2 中的 P0-1（上下文窗口管理）只解决了"不超限"，但没有解决"上下文质量"：
- 应该选择哪些历史消息保留？
- 工具输出中哪些部分对当前问题有价值？
- 记忆注入占多少 budget？
- 代码索引结果如何与对话历史混合排序？

#### 核心设计

```typescript
// src/context/types.ts

export interface ContextOrchestrator {
  /**
   * 给定 token budget，智能组装最终发送给 LLM 的消息列表。
   * 输入：所有可用的上下文源
   * 输出：在 budget 内的最优消息组合
   */
  assemble(input: ContextAssemblyInput): ContextAssemblyResult;
}

export interface ContextAssemblyInput {
  budget_tokens: number;
  system_prompt: string;
  memory_injections: InjectionBlock[];
  conversation_history: ChatMessage[];
  current_user_input: string;
  tool_definitions: ToolSchema[];
  code_search_results?: SearchResult[];    // 来自代码索引
  active_skill?: { prompt: string; step_context: string };
}

export interface ContextAssemblyResult {
  messages: ChatMessage[];
  token_usage: {
    system_prompt: number;
    memory_injection: number;
    conversation_history: number;
    current_input: number;
    tool_definitions: number;
    code_context: number;
    total: number;
    remaining: number;
  };
  trimmed: {
    messages_dropped: number;
    memory_records_dropped: number;
    code_results_dropped: number;
  };
}
```

#### 优先级排序

```
固定区（不可削减）:
  1. System prompt
  2. 当前轮用户输入
  3. 工具定义

高优先级区:
  4. 最近 1 轮的完整对话（含工具结果）
  5. 当前 skill 的 step 上下文
  6. 高重要性记忆注入（importance > 0.8）

中优先级区:
  7. 最近 2-4 轮的对话
  8. 代码搜索结果
  9. 中等重要性记忆注入

低优先级区（budget 不足时首先削减）:
  10. 更早的对话历史
  11. 低重要性记忆
  12. 工具输出的完整内容（替换为摘要）
```

---

### M14 — 插件生态与市场

#### 为什么需要

MCP 解决了工具扩展，但商用生态还需要：
- Skill 的共享与发现
- Guardrail 规则的共享
- 代码索引策略的扩展
- 第三方集成（Jira、Slack、Linear 等）
- 版本管理和安全审核

#### 核心设计

```typescript
// src/plugins/types.ts

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  license: string;
  type: "skill" | "guardrail" | "indexer" | "integration" | "theme";
  entry_point: string;             // 主文件路径
  dependencies?: string[];         // 依赖的其他插件
  permissions?: string[];          // 需要的权限
  config_schema?: Record<string, unknown>;  // JSON Schema
}

export interface PluginRegistry {
  /** 安装插件 */
  install(source: string): Promise<InstalledPlugin>;  // source: npm包 / git url / 本地路径

  /** 卸载 */
  uninstall(name: string): Promise<void>;

  /** 列出已安装 */
  list(): InstalledPlugin[];

  /** 启用/禁用 */
  setEnabled(name: string, enabled: boolean): void;

  /** 从远程市场搜索 */
  search(query: string): Promise<MarketplacePlugin[]>;
}

export interface InstalledPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  installed_at: string;
  source: string;
}
```

#### 插件目录结构

```
~/.mna/plugins/
├── mna-plugin-jira/
│   ├── manifest.json
│   ├── skills/
│   │   └── jira-create-issue.yaml
│   ├── tools/
│   │   └── jira-api.ts
│   └── README.md
├── mna-plugin-eslint-guard/
│   ├── manifest.json
│   └── rules/
│       └── eslint-check.ts
└── mna-plugin-python-indexer/
    ├── manifest.json
    └── indexers/
        └── python-ast.ts
```

---

## 三、模块依赖关系

```
                    ┌──────────────────┐
                    │  M14 插件生态     │
                    └────────┬─────────┘
                             │ 扩展
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
   ┌─────────────┐  ┌──────────────┐  ┌──────────────┐
   │ Skill 系统   │  │ M1 Guardrails │  │ M3 代码索引  │
   │ (roadmap)    │  └──────┬───────┘  └──────┬───────┘
   └──────┬──────┘         │                  │
          │                │                  │
          ▼                ▼                  ▼
   ┌──────────────────────────────────────────────┐
   │              M13 上下文编排引擎                │
   └──────────────────────┬───────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
   ┌────────────┐  ┌────────────┐  ┌────────────┐
   │ M4 多Agent │  │ M7 缓存层  │  │ M2 沙箱    │
   └─────┬──────┘  └─────┬──────┘  └─────┬──────┘
         │               │               │
         └───────────────┼───────────────┘
                         │
   ┌─────────────────────┼─────────────────────┐
   ▼                     ▼                     ▼
┌──────────┐      ┌────────────┐        ┌──────────┐
│ M5 用户  │      │ M8 可观测性 │        │ M6 计费  │
│ 管理     │      │ 体系       │        │ 用量     │
└──────────┘      └────────────┘        └──────────┘
      │                  │                    │
      └──────────────────┼────────────────────┘
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
       ┌──────────┐ ┌────────┐ ┌──────────┐
       │ M9 评估  │ │M10 人机│ │M11 配置  │
       │ 框架     │ │ 协作   │ │ 热加载   │
       └──────────┘ └────────┘ └──────────┘
              │          │
              ▼          ▼
       ┌───────────────────┐
       │ M12 Agent 测试    │
       └───────────────────┘
```

**关键依赖路径（必须按序构建）**：

```
M8 可观测性 → M1 Guardrails → M2 沙箱 → M13 上下文编排 → M3 代码索引
                    ↓
              M5 用户管理 → M6 计费
```

---

## 四、分阶段落地建议

### Phase 0：基础设施层（第 1-2 月）

> 不面向用户，但为后续所有模块提供地基

| 模块                  | 理由                                     | 工作量 |
| --------------------- | ---------------------------------------- | ------ |
| M8 可观测性体系       | 现有基础可观测性还不够支撑生产排障和告警 | 1-2 周 |
| M11 配置热加载        | 后续模块都需要运行时配置能力             | 1 周   |
| M13 上下文编排（基础）| P0 级问题，不解决无法上生产              | 2 周   |
| roadmap P0 问题修复   | 阻塞生产使用的 3 个问题                  | 1 周   |

**交付物**：agent 具备基本的可观测性、上下文不会爆、配置可热更新

### Phase 1：安全与隔离（第 2-3 月）

> 商用产品的安全底线

| 模块               | 理由                                      | 工作量 |
| ------------------ | ----------------------------------------- | ------ |
| M1 Guardrails      | 安全护栏是商用产品的必要条件              | 3 周   |
| M2 沙箱执行        | Shell exec 不隔离不能上生产               | 2 周   |
| M5 用户管理（基础）| 至少支持多 API key + 基本 RBAC            | 2 周   |
| roadmap P1 问题修复 | 工具并行、记忆回写、任务持久化            | 2 周   |

**交付物**：安全可控的 agent，支持多用户访问

### Phase 2：智能与效率（第 3-5 月）

> 产品差异化能力

| 模块                  | 理由                                     | 工作量 |
| --------------------- | ---------------------------------------- | ------ |
| Skill 系统（roadmap） | 从"能聊天"到"能做事"                      | 3 周   |
| M3 代码索引           | 大型代码库的核心能力                     | 4 周   |
| M7 缓存层             | 降低成本、提升速度                       | 2 周   |
| M13 上下文编排（完整）| 智能上下文选择                           | 2 周   |
| 会话管理增强          | 在单机持久化基础上补恢复、审计和稳定性，而不是先做分布式 | 1-2 周 |

**交付物**：具备代码理解、Skill 编排、智能上下文的编码助手

### Phase 3：协作与规模化（第 5-7 月）

> 团队和企业级能力

| 模块            | 理由                                       | 工作量 |
| --------------- | ------------------------------------------ | ------ |
| M5 多租户（完整）| 企业客户隔离需求                          | 3 周   |
| M6 计费用量     | 商业化基础                                 | 2 周   |
| M10 人机协作    | 企业审批工作流                             | 2 周   |

**交付物**：支持企业级多租户、计费、审批的单 agent 商用能力

### Phase 4：生态与运营（第 7-9 月）

> 建立飞轮效应

| 模块            | 理由                                       | 工作量 |
| --------------- | ------------------------------------------ | ------ |
| M9 评估框架     | 持续质量保证                               | 2 周   |
| M12 测试框架    | 开发效率和回归保障                         | 2 周   |
| M14 插件生态    | 社区贡献和生态扩展                         | 4 周   |
| M4 多 Agent（可选） | 在单 agent 主链路成熟后，再评估是否值得引入复杂编排 | 3-4 周 |

**交付物**：完整的商用 agent 平台

---

### 工作量估算汇总

| 阶段    | 时间跨度 | 核心交付                     | 预计人力 |
| ------- | -------- | ---------------------------- | -------- |
| Phase 0 | 6 周     | 可观测性 + 上下文 + 配置     | 1-2 人   |
| Phase 1 | 8 周     | 安全护栏 + 沙箱 + 用户管理  | 2-3 人   |
| Phase 2 | 10-12 周 | Skill + 代码索引 + 缓存 + 单机会话增强 | 2-3 人   |
| Phase 3 | 8-10 周  | 多租户 + 计费 + 审批        | 3-4 人   |
| Phase 4 | 8-12 周  | 评估 + 测试 + 插件生态 + 可选多 Agent | 2-3 人   |
| **合计** | **~9 月** |                            | **峰值 4 人** |
