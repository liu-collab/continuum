# visualization 下一阶段开发提示词

## 1. 这份提示词给谁

给负责把 `services/visualization` 推进到"数据源契约对齐、排查体验完整、健康语义准确"的开发 agent。

## 2. 先读什么

读代码前先通读下面文档（冲突时按此顺序优先）：

1. `docs/api-contract.md`（特别注意第 2.4 节 observe/runs 返回结构和第 4 节共享读模型字段）
2. `docs/architecture-independence.md`
3. `docs/visualization/visualization-implementation-spec.md`

然后读当前实现：

- `src/lib/server/runtime-observe-client.ts` — runtime 观测数据解析（第 130-156 行 `normalizeRuntimeRunsPayload` 是核心）
- `src/lib/server/storage-read-model-client.ts` — 共享读模型查询
- `src/features/run-trace/service.ts` — 五段聚合 + narrative 解释
- `src/features/dashboard/service.ts` — 看板聚合（第 147-189 行 `computeRuntimeWindowTrend` + 第 223-252 行 `estimateStorageTrend`）
- `src/features/source-health/service.ts` — 健康检查
- `src/features/memory-catalog/service.ts` — 记忆目录
- `src/lib/contracts.ts` — 页面 DTO 类型
- `src/app/runs/page.tsx` — 运行轨迹页面
- `src/app/dashboard/page.tsx` — 看板页面

## 3. 当前已有什么（不需要重做）

- **runtime 观测客户端**已经完整实现了 snake_case → camelCase 映射，同时支持两种命名（`runtime-observe-client.ts:145-155`）：`turns`、`trigger_runs/triggerRuns`、`recall_runs/recallRuns`、`injection_runs/injectionRuns`、`writeback_submissions/writeBackRuns`。
- **五段轨迹聚合**已经在 `run-trace/service.ts:26-62` 的 `groupByTrace()` 中按 traceId 正确聚合 5 段。
- **narrative 解释**已经在 `buildNarrative()` 中区分 7 种 outcome。
- **看板已有时间窗口**：`dashboard/service.ts:50-61` 的 `parseWindow()` 支持 `15m/30m/1h/6h/24h`，`computeRuntimeWindowTrend()` 和 `estimateStorageTrend()` 已经做了半窗口对比。
- **健康检查**已经把 liveness/readiness/dependencies 分开返回。readiness 逻辑在 `source-health/service.ts:30-35` 是 `"ready"`，降级依赖只影响 summary 文案。
- **测试**已有 6 个文件覆盖查询参数 / runtime 客户端 / 各 service 层。

## 4. 要做的事（5 项）

### 4.1 端到端验证 runtime 观测契约映射

**涉及文件**：`src/lib/server/runtime-observe-client.ts`、`tests/runtime-observe-client.test.ts`

**当前状态**：`normalizeRuntimeRunsPayload()` (第 130-156 行) 已经做了字段映射。但当前测试是否用了 runtime 的**真实返回结构**（`PostgresRuntimeRepository.getRuns()` 的输出）作为 mock 输入，需要验证。

**具体做法**：

1. 从 `services/retrieval-runtime/src/observability/postgres-runtime-repository.ts` 第 411-481 行的 `getRuns()` 返回结构中，构造一个完整的 mock JSON。特别注意：
   - runtime 返回的 dependency_status 是 `{ read_model: {...}, embeddings: {...}, storage_writeback: {...} }`（对象，不是数组）
   - `mapDependencyStatus()` (runtime-observe-client.ts:280-303) 用 `Object.entries(record)` 处理——这和 runtime 的对象结构**是对齐的**

2. 在 `tests/runtime-observe-client.test.ts` 新增测试用例，用来自 `PostgresRuntimeRepository.getRuns()` 的完整 mock 输出作为输入：
```ts
const mockRuntimeResponse = {
  turns: [{ trace_id: "t1", host: "claude_code_plugin", workspace_id: "ws1", user_id: "u1", session_id: "s1", phase: "before_response", task_id: null, thread_id: null, turn_id: "turn-1", current_input: "hello", assistant_output: null, created_at: "2026-04-16T00:00:00Z" }],
  trigger_runs: [{ trace_id: "t1", trigger_hit: true, trigger_type: "phase", trigger_reason: "before_response is mandatory", requested_memory_types: ["fact_preference"], requested_scopes: ["user"], importance_threshold: 3, cooldown_applied: false, semantic_score: null, degraded: null, degradation_reason: null, duration_ms: 12, created_at: "2026-04-16T00:00:00Z" }],
  recall_runs: [{ trace_id: "t1", trigger_hit: true, trigger_type: "phase", trigger_reason: "...", query_scope: "user", requested_memory_types: ["fact_preference"], candidate_count: 5, selected_count: 2, result_state: "matched", degraded: false, degradation_reason: null, duration_ms: 45, created_at: "2026-04-16T00:00:00Z" }],
  injection_runs: [{ trace_id: "t1", injected: true, injected_count: 2, token_estimate: 120, trimmed_record_ids: [], trim_reasons: [], result_state: "injected", duration_ms: 3, created_at: "2026-04-16T00:00:00Z" }],
  writeback_submissions: [{ trace_id: "t1", candidate_count: 1, submitted_count: 1, filtered_count: 0, filtered_reasons: [], result_state: "submitted", degraded: false, degradation_reason: null, duration_ms: 80, created_at: "2026-04-16T00:00:00Z" }],
  dependency_status: {
    read_model: { name: "read_model", status: "healthy", detail: "ok", last_checked_at: "2026-04-16T00:00:00Z" },
    embeddings: { name: "embeddings", status: "healthy", detail: "ok", last_checked_at: "2026-04-16T00:00:00Z" },
    storage_writeback: { name: "storage_writeback", status: "healthy", detail: "ok", last_checked_at: "2026-04-16T00:00:00Z" }
  }
};
```

3. 断言 `normalizeRuntimeRunsPayload(mockRuntimeResponse)` 返回的每个字段都正确映射。特别验证：
   - `triggerRuns` 数组非空（不是从 recallRuns 取代）
   - `dependencyStatus` 正确解析为数组

### 4.2 补记忆详情展开

**改什么文件**：`src/app/memories/page.tsx`、`src/features/memory-catalog/service.ts`、`src/lib/server/storage-read-model-client.ts`

**当前状态**：记忆目录页有列表和筛选，但没有点击某条记忆查看完整 details / source / 状态历史的功能。

**具体做法**：

1. 在 `storage-read-model-client.ts` 确认是否已有按 `id` 查询单条记忆的方法。如果没有，新增：
```ts
export async function fetchMemoryById(id: string): Promise<MemoryRecord | null> {
  // 查 storage_shared_v1.memory_read_model_v1 WHERE id = $1
}
```

2. 在 `memory-catalog/service.ts` 新增 `getMemoryDetail(id: string)` 方法：
```ts
export async function getMemoryDetail(id: string) {
  const record = await fetchMemoryById(id);
  if (!record) return null;
  return {
    ...record,
    statusExplanation: explainStatus(record.status),
    detailsFormatted: JSON.stringify(record.details, null, 2),
    sourceFormatted: record.source ? `${record.source.source_type} / ${record.source.source_ref}` : "Unknown",
  };
}
```

3. 在页面层实现详情展开。两种方案选其一：
   - **方案 A**（推荐）：在表格行点击后展开一个 drawer/panel 显示完整信息
   - **方案 B**：新建 `/memories/[id]/page.tsx` 详情页

详情面板至少展示：
- `summary`（完整内容）
- `details`（格式化 JSON）
- `source`（source_type + source_ref + service_name）
- `status` + 状态解释
- `importance` / `confidence`
- `last_confirmed_at`
- `created_at` / `updated_at`

### 4.3 补健康面板的"最近成功时间"

**改什么文件**：`src/features/source-health/service.ts`、`src/lib/server/http-client.ts`、`src/components/source-health-panel.tsx`

**当前状态**：`source-health/service.ts` 返回 `SourceStatus` 对象，包含 `status`、`label`、`sourceName`、`detail`。当前 `SourceStatus` 类型里**没有 `lastOkAt` 字段**。

**具体做法**：

1. 在 `src/lib/contracts.ts` 的 `SourceStatus` 类型新增：
```ts
lastOkAt: string | null;  // 最近一次成功响应时间
lastCheckedAt: string;     // 最近检查时间
```

2. 在 `src/lib/server/http-client.ts` 的 `fetchJsonFromSource` 返回的 status 里记录成功时间：
```ts
// 成功时
lastOkAt: new Date().toISOString(),
lastCheckedAt: new Date().toISOString(),

// 失败时
lastOkAt: cachedLastOkAt ?? null,  // 从缓存读上次成功时间
lastCheckedAt: new Date().toISOString(),
```

需要一个简单的内存缓存记住每个数据源最近一次成功的时间戳。

3. 在 `source-health-panel.tsx` 展示：
   - "最近成功：3 秒前" / "最近成功：2 小时前"（用 `date-fns` 的 `formatDistanceToNow`）
   - 如果 `lastOkAt === null`，显示 "从未成功连接"

### 4.4 补看板前端时间窗口切换控件

**改什么文件**：`src/app/dashboard/page.tsx`

**当前状态**：后端 `getDashboard(window)` 已经支持 `15m/30m/1h/6h/24h` 时间窗口参数。`src/app/api/dashboard/route.ts` 应该已经接受 `window` 查询参数。

**需要验证的是**：前端页面是否有切换控件。

**具体做法**：

1. 检查 `src/app/dashboard/page.tsx` 是否已有时间窗口选择器。如果没有，新增一组按钮/tabs：
```tsx
const windows = ["15m", "30m", "1h", "6h", "24h"] as const;
const [activeWindow, setActiveWindow] = useState("30m");
```

2. 点击切换时重新请求 `/api/dashboard?window=${activeWindow}`。

3. 如果已有选择器，验证它是否真的传参到 API 调用。

### 4.5 补测试

**新建或扩展文件**：`tests/runtime-observe-client.test.ts`、`tests/memory-catalog-service.test.ts`、`tests/source-health-service.test.ts`

1. **runtime 契约验证**（4.1）：用真实 runtime 返回结构的 mock，断言五段映射正确、dependency_status 解析正确。

2. **记忆详情**（4.2）：mock `fetchMemoryById` 返回一条完整记录 → 断言 `getMemoryDetail` 返回的 `statusExplanation`、`detailsFormatted`、`sourceFormatted` 正确。

3. **健康面板**（4.3）：mock 一个数据源成功 → 断言 `lastOkAt` 非 null。mock 失败 → 断言 `lastOkAt` 保持上次值。

4. **看板时间窗口**（4.4）：调 `getDashboard("1h")` 和 `getDashboard("24h")` → 断言 `trendWindow` 字段正确。

## 5. 不要做的事

- 不要改 storage 或 retrieval-runtime 的代码
- 不要重做 UI 框架（保持 Next.js + Tailwind）
- 不要把上游私有表直接引入查询
- 不要做复杂 BI 分析

## 6. 完成标准

- runtime 观测契约映射有用真实结构的 mock 测试验证
- 记忆详情可展开查看（details / source / status 解释）
- 健康面板显示"最近成功时间"
- 看板前端有时间窗口切换控件
- 上游不可用时页面仍可启动，显示降级状态
- `npm run lint && npm run typecheck && npm run build && npm test` 全部通过
