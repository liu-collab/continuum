# retrieval-runtime 下一阶段开发提示词

## 1. 这份提示词给谁

给负责把 `services/retrieval-runtime` 推进到"可正式部署、宿主工具面可用、写回提取达标"的开发 agent。

## 2. 先读什么

读代码前先通读下面文档（冲突时按此顺序优先）：

1. `docs/api-contract.md`
2. `docs/architecture-independence.md`
3. `docs/retrieval/retrieval-runtime-implementation-spec.md`（特别注意第 10.5 节写回提取技术方案）

然后读当前实现：

- `src/app.ts` — 路由注册（6 个路由 + healthz）
- `src/runtime-service.ts` — 主服务（prepareContext / finalizeTurn / getRuns / getMetrics）
- `src/trigger/trigger-engine.ts` — 触发引擎（硬触发 + 历史关键词 + 语义兜底）
- `src/writeback/writeback-engine.ts` — 写回引擎（当前纯正则提取）
- `src/writeback/storage-client.ts` — storage HTTP 客户端
- `src/observability/postgres-runtime-repository.ts` — 五段轨迹持久化 + 查询 + 指标
- `src/shared/types.ts` — 所有类型定义
- `src/config.ts` — AppConfig（zod schema）
- `host-adapters/memory-codex-adapter/mcp/memory-mcp-server.mjs` — Codex MCP
- `host-adapters/memory-claude-plugin/bin/memory-bridge.mjs` — Claude 桥接

## 3. 当前已有什么（不需要重做）

- 完整的 trigger-engine（phase 硬触发 + `HISTORY_PATTERNS` 关键词匹配 + semanticFallbackScore 走 dependencyGuard）
- 完整的 query-engine（硬过滤 → 软排序，权重 0.45/0.25/0.15/0.10/0.05）
- 完整的 injection-engine（优先级排序 + token 预算裁剪）
- 完整的 packet-builder
- 完整的 dependency-guard（统一超时 + 取消 + 降级）
- PostgresRuntimeRepository（五段建表 + 五段记录 + 指标聚合）+ FallbackRuntimeRepository
- 宿主适配器（claude-code / codex / custom）
- 宿主桥接产物（Claude plugin + Codex adapter 目录完整）
- 两个测试文件（runtime-service + remediation）

## 4. 要做的事（6 项）

### 4.1 把 `GET /healthz` 拆成三个独立端点

**改什么文件**：`src/app.ts`

**当前问题**：`app.ts:34-38` 注册了 `GET /healthz`，内部调用 `runtimeService.getRuns()` 获取 dependency_status。这有两个问题：
1. getRuns() 是业务查询，空数据库时查 runtime_turns 返回空列表导致 dependency_status 也是默认值
2. 没有按架构约束拆成三端点

**具体做法**：

1. 在 `src/runtime-service.ts` 新增方法：
```ts
async getLiveness(): Promise<{ status: "alive" }> {
  return { status: "alive" };
}

async getReadiness(): Promise<{ status: "ready" }> {
  // retrieval-runtime 只要 HTTP 在监听就是 ready
  // 外部依赖（storage / embedding / read_model）不影响 readiness
  return { status: "ready" };
}

async getDependencies(): Promise<DependencyStatusSnapshot> {
  return this.dependencyGuard.snapshot();
}
```

2. 在 `src/app.ts` 新增三个路由：
```
GET /v1/runtime/health/liveness     → runtimeService.getLiveness()
GET /v1/runtime/health/readiness    → runtimeService.getReadiness()
GET /v1/runtime/health/dependencies → runtimeService.getDependencies()
```

3. 保留 `GET /healthz` 做兼容。

### 4.2 实现 LLM 写回提取路径

**改什么文件**：`src/writeback/writeback-engine.ts`、`src/config.ts`、`.env.example`

**当前状态**：`writeback-engine.ts:83-228` 的 `extractCandidates()` 完全基于正则：
- 第 90 行：`preferenceMatch = normalizedUser.match(/(?:我一般|我喜欢|我偏好|prefer)\s*[:：]?\s*(.+)$/i)`
- 第 111 行：`factMatch = normalizedAssistant.match(/(?:已确认|确定|confirmed)\s*[:：]?\s*(.+)$/i)`
- 第 131 行：`taskMatch = normalizedAssistant.match(/(?:下一步|todo|plan|任务状态)\s*[:：]?\s*(.+)$/i)`
- 第 151 行：承诺检测 `normalizedAssistant.includes("我会")`

文档 `retrieval-runtime-implementation-spec.md` 第 10.5 节已要求"轻量 LLM 调用 + 规则兜底"。

**具体做法**：

1. 在 `src/config.ts` 的 `envSchema` 新增：
```ts
WRITEBACK_LLM_BASE_URL: z.string().url().optional(),
WRITEBACK_LLM_MODEL: z.string().default("claude-haiku-4-5-20251001"),
WRITEBACK_LLM_API_KEY: z.string().optional(),
WRITEBACK_LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
WRITEBACK_MAX_CANDIDATES: z.coerce.number().int().positive().max(5).default(3),
```

2. 在 `src/writeback/` 新建 `llm-extractor.ts`：
```ts
export interface LlmExtractor {
  extract(input: {
    current_input: string;
    assistant_output: string;
    tool_results_summary?: string;
    task_id?: string;
  }): Promise<LlmExtractionResult>;
}

export interface LlmExtractionResult {
  candidates: Array<{
    candidate_type: "fact_preference" | "task_state" | "episodic";
    scope: "user" | "task" | "session";
    summary: string;
    importance: number;
    confidence: number;
    write_reason: string;
  }>;
}
```

实现类 `HttpLlmExtractor`：
- 调用 `WRITEBACK_LLM_BASE_URL` 的 `/v1/messages` 接口
- system prompt 固定为结构化提取指令，要求输出 JSON 数组
- 超时 `WRITEBACK_LLM_TIMEOUT_MS`（默认 5 秒）
- 返回的 candidates 限制在 `WRITEBACK_MAX_CANDIDATES` 条

3. 改造 `writeback-engine.ts` 的 `extractCandidates()` 为 `async`：
```ts
async extractCandidates(input: FinalizeTurnInput): Promise<ExtractionResult> {
  // 优先尝试 LLM 提取
  if (this.llmExtractor) {
    try {
      const llmResult = await this.llmExtractor.extract({
        current_input: input.current_input,
        assistant_output: input.assistant_output,
        tool_results_summary: input.tool_results_summary,
        task_id: input.task_id,
      });
      // 把 llmResult.candidates 转成 WriteBackCandidate[]
      // 仍然走 uniqueCandidates + 价值过滤
      return this.postProcess(input, llmResult.candidates);
    } catch {
      // LLM 失败，回退规则
    }
  }
  // 当前正则逻辑作为回退
  return this.extractByRules(input);
}
```

4. 把当前正则逻辑抽成 `private extractByRules(input: FinalizeTurnInput)` 方法，保持不变。

5. `WritebackEngine` 构造函数新增可选参数 `llmExtractor?: LlmExtractor`。

6. 在 `src/index.ts` 中根据 `config.WRITEBACK_LLM_BASE_URL` 是否配置决定是否创建 `HttpLlmExtractor`。

7. 在 `.env.example` 新增：
```
# 写回提取 LLM 配置（可选，未配置时走纯规则提取）
WRITEBACK_LLM_BASE_URL=
WRITEBACK_LLM_MODEL=claude-haiku-4-5-20251001
WRITEBACK_LLM_API_KEY=
WRITEBACK_LLM_TIMEOUT_MS=5000
WRITEBACK_MAX_CANDIDATES=3
```

### 4.3 补齐 Codex MCP 的 `memory_search` 和 `memory_explain_hit`

**改什么文件**：`host-adapters/memory-codex-adapter/mcp/memory-mcp-server.mjs`

**当前状态**：
- `memory_search`（第 55-71 行）返回固定桥接说明，不做真实搜索
- 缺少 `memory_explain_hit` 工具

**具体做法**：

1. 改 `memory_search` 的 `run` 为真实调用：
```js
run: async (input) => {
  // 调 prepare-context 做一次搜索
  const response = await fetch(new URL("/v1/runtime/prepare-context", runtimeBaseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      host: "codex_app_server",
      workspace_id: input.workspace_id ?? process.env.MEMORY_WORKSPACE_ID,
      user_id: input.user_id ?? process.env.MEMORY_USER_ID,
      session_id: input.session_id ?? "mcp-search-session",
      phase: "before_response",
      current_input: input.query,
    }),
  });
  if (!response.ok) throw new Error(`search failed: ${response.status}`);
  const result = await response.json();
  return {
    trigger: result.trigger,
    trigger_reason: result.trigger_reason,
    memory_packet: result.memory_packet,
    injection_block: result.injection_block,
    degraded: result.degraded,
  };
}
```

inputSchema 改为：
```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string", "description": "The search query text" },
    "workspace_id": { "type": "string" },
    "user_id": { "type": "string" },
    "session_id": { "type": "string" }
  },
  "required": ["query"]
}
```

2. 新增 `memory_explain_hit` 工具：
```js
memory_explain_hit: {
  description: "Explain why a specific trace produced its recall and injection result.",
  inputSchema: {
    type: "object",
    properties: {
      trace_id: { type: "string", description: "The trace_id to explain" }
    },
    required: ["trace_id"]
  },
  run: async (input) => {
    const runs = await callRuntime(`/v1/runtime/observe/runs?trace_id=${input.trace_id}`);
    // 从 runs 中提取 trigger / recall / injection 信息
    // 组成人类可读的解释
    const trigger = runs.trigger_runs?.[0];
    const recall = runs.recall_runs?.[0];
    const injection = runs.injection_runs?.[0];
    return {
      trace_id: input.trace_id,
      trigger: trigger ? {
        hit: trigger.trigger_hit,
        type: trigger.trigger_type,
        reason: trigger.trigger_reason,
      } : "no trigger record",
      recall: recall ? {
        state: recall.result_state,
        candidate_count: recall.candidate_count,
        selected_count: recall.selected_count,
        degraded: recall.degraded,
      } : "no recall record",
      injection: injection ? {
        injected: injection.injected,
        count: injection.injected_count,
        trimmed: injection.trimmed_record_ids?.length ?? 0,
        state: injection.result_state,
      } : "no injection record",
    };
  }
}
```

### 4.4 补迁移脚本

**新建文件**：`migrations/0001_runtime_init.sql`

**当前状态**：`PostgresRuntimeRepository.initialize()` (postgres-runtime-repository.ts:112-200) 用 `CREATE TABLE IF NOT EXISTS` 建了 6 张表。没有独立的 SQL 迁移文件。

**具体做法**：

1. 把 `initialize()` 中的 6 个 `CREATE TABLE` 语句提取到 `migrations/0001_runtime_init.sql`，使用和 storage 一样的 schema 占位符 `__RUNTIME_SCHEMA_IDENT__`。

2. 新建 `src/db/migration-runner.ts`，参考 storage 的实现，读取 `migrations/` 目录，做占位符替换，记录到 `public.service_migrations` 表。

3. 在 `package.json` 新增 script：`"migrate": "tsx src/db/migrate.ts"`

4. 新建 `src/db/migrate.ts` 入口。

5. `PostgresRuntimeRepository.initialize()` 保留 `CREATE TABLE IF NOT EXISTS` 作为开发兜底。

### 4.5 给 observe/runs 加分页

**改什么文件**：`src/observability/postgres-runtime-repository.ts`、`src/api/schemas.ts`、`src/app.ts`

**当前状态**：`PostgresRuntimeRepository.getRuns()` (第 356-481 行) 查所有匹配的 turns 不分页。`observeRunsQuerySchema` (schemas.ts) 有 `session_id`、`turn_id`、`trace_id` 筛选但没有分页。

**具体做法**：

1. 在 `src/api/schemas.ts` 的 `observeRunsQuerySchema` 新增：
```ts
page: z.coerce.number().int().min(1).default(1).optional(),
page_size: z.coerce.number().int().min(1).max(100).default(20).optional(),
```

2. 在 `PostgresRuntimeRepository.getRuns()` 中：
   - 先查 `SELECT COUNT(*)` 得到 total
   - 加 `LIMIT $N OFFSET $M`
   - 返回 `{ ...原有字段, total, page, page_size }`

3. 更新 `ObserveRunsResponse` 类型新增 `total`、`page`、`page_size`。

4. `InMemoryRuntimeRepository` 也要对应支持分页（slice 即可）。

### 4.6 补宿主桥接脚本的身份字段配置

**改什么文件**：`host-adapters/memory-claude-plugin/bin/memory-bridge.mjs`

**当前状态**：`memory-bridge.mjs:34` 的 `requireField()` 在字段缺失时直接抛错。但 Claude Code hooks 的事件结构里可能没有 `user_id` 和 `workspace_id`（这取决于 Claude Code 的 hook 传入什么字段）。

**具体做法**：

1. 在 `requireField` 前先检查环境变量：
```js
function resolveField(event, keys, envKey, label) {
  for (const key of keys) {
    const value = event?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const envValue = process.env[envKey];
  if (typeof envValue === "string" && envValue.trim()) return envValue.trim();
  throw new Error(`missing required identity field: ${label}. Set ${envKey} in environment or provide it in the hook event.`);
}
```

2. 把 `buildSessionStartPayload` / `buildPreparePayload` / `buildFinalizePayload` 中的 `requireField` 调用改为 `resolveField`，新增 `envKey` 参数：
   - `user_id` → `MEMORY_USER_ID`
   - `workspace_id` → `MEMORY_WORKSPACE_ID`
   - `session_id` → `MEMORY_SESSION_ID`

3. 在 `memory-claude-plugin/settings.json` 中补注释说明这些环境变量。

## 5. 不要做的事

- 不要改 storage 或 visualization
- 不要重写 trigger-engine 或 query-engine
- 不要把 MCP server 做成独立的 npm 包（保持 .mjs 脚本形式）
- 不要引入新的记忆类型

## 6. 完成标准

- 三个健康端点可用
- LLM 写回提取可配置，`WRITEBACK_LLM_BASE_URL` 为空时走纯规则
- Codex MCP 的 `memory_search` 做真实搜索、`memory_explain_hit` 可用
- `migrations/0001_runtime_init.sql` 存在、`npm run migrate` 可用
- observe/runs 支持分页，返回 `total / page / page_size`
- 桥接脚本支持 `MEMORY_USER_ID` / `MEMORY_WORKSPACE_ID` 环境变量
- `npm run check && npm run build && npm test` 全部通过

## 7. 补什么测试

- 健康三端点返回正确结构
- LLM 提取（mock LLM 返回 → 验证 candidates 结构正确）
- LLM 超时回退到规则提取
- `WRITEBACK_MAX_CANDIDATES` 截断生效
- `memory_search` 工具返回真实数据结构（mock runtime HTTP）
- `memory_explain_hit` 返回结构化解释
- 分页查询 page=1/page_size=5 返回正确切片
- 桥接脚本环境变量兜底（`resolveField` 单元测试）
