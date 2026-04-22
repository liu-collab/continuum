# 写入模型职责扩大 + 空闲整理 Worker 设计文档

> 对应实施：反转 writeback 提取流程 + 新增后台维护 worker。  
> 涉及服务：`services/retrieval-runtime`（单服务内部升级；`storage` / `memory-native-agent` 对外契约不变）。  
> 实施时间：2026-04-22。

---

## 目录

1. [背景与目标](#1-背景与目标)
2. [改造前后对比](#2-改造前后对比)
3. [总体设计](#3-总体设计)
4. [改动一：反转写回提取流程（rules-first → LLM refine）](#4-改动一反转写回提取流程rules-first--llm-refine)
5. [改动二：空闲整理 Worker（以新带旧）](#5-改动二空闲整理-worker以新带旧)
6. [配置项汇总](#6-配置项汇总)
7. [HTTP 端点变更](#7-http-端点变更)
8. [数据流与时序](#8-数据流与时序)
9. [向后兼容与降级策略](#9-向后兼容与降级策略)
10. [验证与测试](#10-验证与测试)
11. [后续演进建议](#11-后续演进建议)

---

## 1. 背景与目标

### 1.1 现状问题

`retrieval-runtime` 的写入模型（`WRITEBACK_LLM_*`，默认 `claude-haiku-4-5-20251001`）此前只承担一个很窄的职责：在 `finalizeTurn` 时从单轮对话里提取 ≤5 个写回候选（`src/writeback/llm-extractor.ts:86`）。存在三个问题：

- **规则路径形同死代码**：`extractCandidates` 在有 LLM 时先走 LLM，LLM 抛错才回退规则（`src/writeback/writeback-engine.ts:209-228`）。正常链路下 happy path 永远不执行规则，针对中文偏好/承诺/任务状态调过的 `PREFERENCE_PATTERNS`、`COMMITMENT_PATTERNS` 等被闲置。
- **部署差异明显**：配了 LLM 的部署和没配的部署产生的候选集差别很大，没有渐进过渡。
- **存入后无维护**：记录写入 `storage` 后没有任何机制做合并、降权、归档或冲突解决。老记录越堆越多，`pending_confirmation` 冲突无人处理，记忆质量随时间下降。

### 1.2 目标

1. **扩大写入模型职责**：同一个 `WRITEBACK_LLM` 除了参与单轮候选提取，还要在记忆系统里做持续治理（合并、降权、摘要、冲突裁决）。
2. **提取路径反转**：规则优先执行，LLM 对规则候选做二次精化（重打分、剔误报、补漏报、合并相似）。LLM 不可用时退化为纯规则，不影响现有部署。
3. **空闲时做后台整理**：在用户空闲/服务低负载时，通过快速模型（复用 WRITEBACK_LLM）对最近新增的记忆做"以新带旧"的增量治理，避免全局扫描压力。

### 1.3 非目标

- 不改 `memory-native-agent` 与 `retrieval-runtime` 的 HTTP 契约。mna 仍只通过 `POST /v1/runtime/finalize-turn` 提交写回。
- 不改 `storage` 服务。所需的 `GET /v1/storage/records` / `PATCH /records/:id` / `archive` / `resolve conflict` API 已全部就位。
- 不引入新的 LLM 模型配置。`WRITEBACK_LLM_*` 同一套端点被 extract、refine、maintenance 三个场景复用。

---

## 2. 改造前后对比

### 2.1 写回候选提取

**改造前**（`src/writeback/writeback-engine.ts` 原 209-228 行）：

```
finalizeTurn
  └─ extractCandidates
       ├─ 若 llmExtractor 存在:
       │    try  → LLM extract（整轮对话提取候选）→ postProcess
       │    catch → extractByRules（规则兜底）
       └─ 否则: extractByRules
```

规则逻辑只在 LLM 抛错时被激活，是兜底而非协作。

**改造后**：

```
finalizeTurn
  └─ extractCandidates
       ├─ runRulesOnly（始终执行，产出规则候选列表）
       ├─ 若 llmExtractor 存在 且 WRITEBACK_REFINE_ENABLED:
       │    try  → LLM refine（接收规则候选 + 原对话，返回精化指令）
       │            → applyRefineResult（keep / drop / merge / new 四类指令合并）
       │    catch → 保留规则候选，warn 日志
       └─ postProcess（阈值、jaccard、去重、裁剪）
```

规则和 LLM 从"兜底关系"变成"流水线协作"。

### 2.2 记忆治理

**改造前**：写入后无治理。记录生命周期只看 `storage` 的自动合并/冲突逻辑。

**改造后**：新增 `WritebackMaintenanceWorker`，按配置周期扫描最近新增记忆，调用 LLM 规划 5 种整理动作，通过 storage client 落盘：

```
MaintenanceWorker.runOnce
  ├─ selectWorkspaces         选 workspace（checkpoint 过期 / 最近有写入）
  ├─ fetchSeeds               取最近新增的记录作为 seed
  ├─ fetchRelated             按 scope+memory_type 分组拉历史，jaccard 过滤
  ├─ fetchConflicts           拉 open 冲突
  ├─ planner.plan(LLM)        规划动作
  └─ applyActions             merge / archive / downgrade / summarize / resolve_conflict
```

---

## 3. 总体设计

### 3.1 模块清单

| 文件 | 状态 | 说明 |
|---|---|---|
| `src/shared/types.ts` | 修改 | 新增 `MemoryRecordSnapshot` / `MemoryConflictSnapshot` / `MaintenanceCheckpointRecord` / `MaintenanceRunSummary` 4 个 DTO |
| `src/config.ts` | 修改 | 新增 15 个配置项（见第 6 节） |
| `src/writeback/llm-refiner-prompt.ts` | 新建 | 集中 refine + maintenance 两段 system prompt |
| `src/writeback/llm-extractor.ts` | 修改 | 抽 `callWritebackLlm` 公共 helper；`LlmExtractor` 接口新增 `refine` 方法 |
| `src/writeback/llm-maintenance-planner.ts` | 新建 | `LlmMaintenancePlanner` 接口 + `HttpLlmMaintenancePlanner` 实现 + Zod schema（含 id 白名单校验） |
| `src/writeback/storage-client.ts` | 修改 | 从 36 行扩展到 ~260 行，新增 `listRecords` / `patchRecord` / `archiveRecord` / `listConflicts` / `resolveConflict` 5 个方法 |
| `src/writeback/writeback-engine.ts` | 修改 | `extractCandidates` 流程反转；新增 `runRulesOnly` / `applyRefineResult` / `buildMergedDraft` / `buildDraftFromLlmNew` / `mergeLlmCorrections` / `toRuleDigest` / `parseRuleIndex`；构造函数新增可选 `logger` |
| `src/writeback/maintenance-worker.ts` | 新建 | `WritebackMaintenanceWorker` 类 |
| `src/observability/runtime-repository.ts` | 修改 | 接口新增 `getMaintenanceCheckpoints` / `upsertMaintenanceCheckpoint` / `listWorkspacesWithRecentWrites` |
| `src/observability/postgres-runtime-repository.ts` | 修改 | `initialize` DDL 追加 `runtime_maintenance_checkpoints` 表；实现三个新方法 |
| `src/observability/in-memory-runtime-repository.ts` | 修改 | 内存实现，`maintenanceCheckpoints: Map<workspace_id, record>` |
| `src/observability/fallback-runtime-repository.ts` | 修改 | 代理三个新方法 |
| `src/runtime-service.ts` | 修改 | `RetrievalRuntimeService` 构造函数新增可选 `maintenanceWorker`；新增 `runMaintenance` |
| `src/app.ts` | 修改 | 新增 `POST /v1/runtime/writeback-maintenance/run` |
| `src/index.ts` | 修改 | 装配 `HttpLlmMaintenancePlanner` + `WritebackMaintenanceWorker`，`onClose` hook 停 worker |
| `tests/writeback-engine.test.ts` | 预留 | 未新建，相关场景由现有 `runtime-service.test.ts` 覆盖 |
| `tests/maintenance-worker.test.ts` | 新建 | 5 个核心场景单测 |
| `tests/runtime-service.test.ts` | 修改 | 补全 baseConfig 新字段；stub 类补 `refine` / `listRecords` 等；3 处断言按新契约调整 |
| `tests/remediation.test.ts` | 修改 | baseConfig / stub 补齐；`llmExtractor.callCount` 断言改为 `refineCallCount` |
| `tests/embeddings-client.test.ts` | 修改 | baseConfig 补齐 |

### 3.2 设计原则

1. **新功能默认关闭**：`WRITEBACK_MAINTENANCE_ENABLED` 默认 `false`，现有部署不受影响。
2. **LLM 是辅助而非必需**：无 LLM 配置时，引擎完全等价于老的 rules-fallback 路径。
3. **每次 LLM 调用都有 schema 校验**：refine 和 maintenance 的输出都用 Zod 强校验，maintenance planner 额外校验 `record_id` / `conflict_id` 必须出现在输入集合里（防幻觉）。
4. **储存侧零改动**：所有 storage 交互都走已有 API。
5. **依赖健康共用桶**：不引入新的依赖名；refine 和 maintenance 都复用 `writeback_llm` 依赖状态。

---

## 4. 改动一：反转写回提取流程（rules-first → LLM refine）

### 4.1 新流程

`extractCandidates` 核心逻辑（`src/writeback/writeback-engine.ts:213`）：

```ts
async extractCandidates(input) {
  const ruleResult = this.runRulesOnly(input);

  if (!this.llmExtractor || !this.config.WRITEBACK_REFINE_ENABLED) {
    return this.postProcess(input, ruleResult.drafts, ruleResult.filtered_reasons);
  }

  try {
    const refined = await this.llmExtractor.refine({
      current_input: input.current_input,
      assistant_output: input.assistant_output,
      tool_results_summary: input.tool_results_summary,
      task_id: input.task_id,
      rule_candidates: ruleResult.drafts.map((draft, index) => toRuleDigest(draft, index)),
    });
    const merged = this.applyRefineResult(input, ruleResult.drafts, refined);
    return this.postProcess(
      input,
      merged.drafts,
      [...ruleResult.filtered_reasons, ...merged.filtered_reasons],
    );
  } catch (error) {
    this.logger?.warn?.({ err: error }, "writeback llm refine failed, using rule output");
    return this.postProcess(input, ruleResult.drafts, ruleResult.filtered_reasons);
  }
}
```

### 4.2 LLM Refine 契约

**请求体（user message）**：

```json
{
  "current_input": "...",
  "assistant_output": "...",
  "tool_results_summary": "...",
  "task_id": "...",
  "rule_candidates": [
    {
      "index": 0,
      "candidate_type": "fact_preference",
      "scope": "user",
      "summary": "偏好 4 空格缩进",
      "importance": 4,
      "confidence": 0.9,
      "write_reason": "user stated a stable preference"
    }
  ]
}
```

**响应契约（Zod 强校验，`src/writeback/llm-extractor.ts` 中的 `llmRefineResultSchema`）**：

```json
{
  "refined_candidates": [
    {
      "source": "rule_index:0" | "llm_new",
      "action": "keep" | "drop" | "merge" | "new",
      "summary": "...",
      "importance": 1-5,
      "confidence": 0-1,
      "scope": "workspace|user|task|session",
      "candidate_type": "fact_preference|task_state|episodic",
      "merge_with": ["rule_index:1", "rule_index:2"],
      "reason": "..."
    }
  ]
}
```

### 4.3 四种 action 语义

| action | 必填字段 | 引擎处理 |
|---|---|---|
| `keep` | `source=rule_index:N`, `reason` | 保留 rule 候选；`mergeLlmCorrections` 叠加 LLM 给的 summary/importance/confidence/scope 覆盖，`extraction_method` 标为 `llm` |
| `drop` | `source=rule_index:N`, `reason` | 从候选列表剔除，写入 `filtered_reasons: llm_drop:N` |
| `merge` | `source=rule_index:N`, `merge_with=[rule_index:M,...]`, `summary`, `reason` | 用 anchor 的 source_ref，基于 refine item 的 summary 构造合并 draft；涉及的 rule 索引全部消费 |
| `new` | `source=llm_new`, `summary`, `importance`, `confidence`, `scope`, `candidate_type`, `reason` | 构造纯 LLM draft；`fact_preference && scope=user` 自动标 `confirmed_by_user=true` |

未被 drop / merge / keep 覆盖的 rule drafts 原样保留。

### 4.4 Post-process 不变

`postProcess` 仍然执行原有检查：

- `importance >= 3` / `confidence >= 0.7`
- `extraction_method === "llm"` 的候选必须通过 `jaccardOverlap` 与原对话文本的重叠度校验（`WRITEBACK_INPUT_OVERLAP_THRESHOLD`，默认 0.2）
- 按 `idempotency_key` 去重
- 裁剪到 `WRITEBACK_MAX_CANDIDATES`（默认 3）

这一层保证 LLM refine 的产物仍然受到安全阈值约束，不会因 LLM 出奇怪答案就放行。

### 4.5 Prompt 设计

存放在 `src/writeback/llm-refiner-prompt.ts` 的 `WRITEBACK_REFINE_SYSTEM_PROMPT`，关键约束：

- 礼貌应答、文件路径复述、用户原问题回声 → `drop`
- 描述同一持久偏好的多条 → `merge`
- 规则漏掉的稳定偏好 → `new`
- 总数 ≤ `WRITEBACK_MAX_CANDIDATES * 3`（引擎侧还会再裁剪到 `WRITEBACK_MAX_CANDIDATES`）

### 4.6 `extract` 方法保留

老的 `LlmExtractor.extract()` 方法保留，支撑旧测试与任何只需要"整轮提取"而不需要规则上下文的场景。新实现中，`extractCandidates` 不再调用 `extract`，仅调用 `refine`。

---

## 5. 改动二：空闲整理 Worker（以新带旧）

### 5.1 生命周期

照搬 `WritebackOutboxFlusher` 的 `setInterval` + 重入保护模式（`src/writeback/maintenance-worker.ts`）：

```ts
start(): void;  // 读 WRITEBACK_MAINTENANCE_ENABLED；开启定时器
stop(): void;   // 清定时器
async runOnce(options?: { workspaceId?: string; forced?: boolean }): Promise<MaintenanceRunSummary>;
```

- **定时触发**：间隔由 `WRITEBACK_MAINTENANCE_INTERVAL_MS` 控制（默认 15min）
- **手动触发**：`POST /v1/runtime/writeback-maintenance/run`，可选 `workspace_id` 和 `force: true`
- **重入保护**：`running` 标记，防止长任务与下一次 tick 叠加

### 5.2 扫描策略："以新带旧"

用户的需求原话："最好是在处理最近新增的时候能回看一下以前的"。落地为：

**Step 1. 选 workspace**（`selectWorkspaces`）

优先级：
1. 显式指定 `workspaceId` → 直接返回
2. checkpoint 表里过期的 workspace（`WRITEBACK_MAINTENANCE_WORKSPACE_INTERVAL_MS` 默认 1h；`force=true` 时置 0 绕过）
3. 不足 batch 数时，补充"最近有写入但无 checkpoint"的 workspace（`listWorkspacesWithRecentWrites`，回看窗口 `WRITEBACK_MAINTENANCE_SEED_LOOKBACK_MS` 默认 24h）

batch 大小由 `WRITEBACK_MAINTENANCE_WORKSPACE_BATCH` 控制（默认 3）。

**Step 2. 拉 seed**（`fetchSeeds`）

每个 workspace 调 `storage.listRecords({ workspace_id, status: "active", page_size: SEED_LIMIT })`，客户端再按 `created_at >= now - SEED_LOOKBACK_MS` 过滤。

> 为什么客户端过滤：storage 的 `recordQuerySchema` 不接受 `created_after`（`services/storage/src/contracts.ts:168`），未来可扩展。

**Step 3. 拉 related**（`fetchRelated`）

把 seed 按 `(scope, memory_type)` 分组。每组调一次 `listRecords({ workspace_id, scope, memory_type, status: "active", page_size: RELATED_LIMIT })`，客户端按 `jaccardOverlap(seed.summary, candidate.summary) >= SIMILARITY_THRESHOLD`（默认 0.35）过滤。跨 seed 去重。

**Step 4. 拉冲突**（`fetchConflicts`）

`storage.listConflicts("open")`，过滤到当前 workspace，上限 10。

**Step 5. 剪枝**

若 `seeds + related < 2` 且 `conflicts == 0`，跳过 LLM 调用，直接更新 checkpoint 结束。

**Step 6. 规划 + 执行**

`dependencyGuard.run("writeback_llm", ...)` 包装 `planner.plan(...)`；成功则 `applyActions` 逐个落盘；失败则标 `degraded=true`，checkpoint 仍更新以避免反复扫同一个 workspace。

### 5.3 5 种 Action 的落盘映射

planner 输出 `MaintenancePlan`（`src/writeback/llm-maintenance-planner.ts`）：

| Action | Storage 调用 |
|---|---|
| `merge` | 首条 id：`patchRecord(id, { summary: merged_summary, importance: merged_importance, details_json: { merged_from: target_ids }, actor, reason })`；其余 ids：`archiveRecord(id, { actor, reason })` |
| `archive` | `archiveRecord(record_id, { actor, reason })` |
| `downgrade` | 若 `new_importance < WRITEBACK_MAINTENANCE_MIN_IMPORTANCE`（默认 2）→ `archiveRecord`；否则 `patchRecord(record_id, { importance, actor, reason })` |
| `summarize` | `submitCandidates([{ summary, importance, scope, candidate_type, source: { source_type: "writeback_maintenance", source_ref: source_ids.join(","), extraction_method: "llm" }, ... }])` + 逐个 `archiveRecord(source_id)` |
| `resolve_conflict` | `resolveConflict(conflict_id, { resolution_type, resolved_by: MAINTENANCE_ACTOR_ID, resolution_note, activate_record_id })` |

所有 storage 交互都走 `dependencyGuard.run("storage_writeback", WRITEBACK_MAINTENANCE_TIMEOUT_MS, ...)`。单个动作失败只影响当前 workspace 剩余动作，不中断整个 tick。

`actor.actor_id` 固定为 `WRITEBACK_MAINTENANCE_ACTOR_ID`（默认 `"retrieval-runtime-maintenance"`），满足 storage 侧 `governanceActionRequestSchema.reason.min(3)` 要求。

### 5.4 LLM Maintenance 契约

**请求体**：

```json
{
  "seed_records": [{ "id", "memory_type", "scope", "summary", "importance", "confidence", "created_at", "updated_at", "status" }],
  "related_records": [ ... 同上 ],
  "open_conflicts": [{ "id", "record_id", "conflict_with_record_id", "conflict_type", "conflict_summary", "created_at" }]
}
```

`HttpLlmMaintenancePlanner.plan` 调用前会用 `toCompactRecord` / `toCompactConflict` 精简字段，减少 token 消耗。

**响应契约**（`maintenancePlanSchema` 用 `z.discriminatedUnion("type", ...)` 校验）：

```json
{
  "actions": [
    { "type": "merge", "target_record_ids": ["id1", "id2"], "merged_summary": "...", "merged_importance": 5, "reason": "..." },
    { "type": "archive", "record_id": "id3", "reason": "..." },
    { "type": "downgrade", "record_id": "id4", "new_importance": 2, "reason": "..." },
    { "type": "summarize", "source_record_ids": ["id5","id6","id7"], "new_summary": "...", "new_importance": 4, "scope": "workspace", "candidate_type": "episodic", "reason": "..." },
    { "type": "resolve_conflict", "conflict_id": "c1", "resolution_type": "auto_merge", "activate_record_id": "id8", "resolution_note": "..." }
  ],
  "notes": "可选的说明"
}
```

**ID 白名单校验**（planner 侧）：

解析完 schema 后，`isActionReferencingKnownIds` 会检查：

- `merge` / `summarize`：`target_record_ids` / `source_record_ids` 必须全部在 seeds+related 的 id 集合里
- `archive` / `downgrade`：`record_id` 必须在集合里
- `resolve_conflict`：`conflict_id` 必须在 open_conflicts 里；`activate_record_id` 若给了也必须在 id 集合里

不满足的 action 被静默丢弃。最后再按 `WRITEBACK_MAINTENANCE_MAX_ACTIONS`（默认 10）裁剪。

### 5.5 Checkpoint 存储

新增表 `runtime_private.runtime_maintenance_checkpoints`：

```sql
CREATE TABLE IF NOT EXISTS runtime_private.runtime_maintenance_checkpoints (
  workspace_id TEXT PRIMARY KEY,
  last_scanned_at TIMESTAMPTZ NOT NULL
);
```

DDL 追加在 `PostgresRuntimeRepository.initialize` 末尾。`FallbackRuntimeRepository` / `InMemoryRuntimeRepository` 均提供等价实现。

### 5.6 可观测

本次改造没有新增观测表，维护行为通过：

1. 每次 tick 的 `logger.info({ maintenance: summary }, "writeback maintenance tick")` 结构化日志
2. 手动端点返回的 `MaintenanceRunSummary`
3. 复用 `writeback_llm` / `storage_writeback` 两个依赖桶的健康状态

未来若需要历史度量（actions_applied 累积、失败率等），可新增 `recordMaintenanceRun` 方法和对应 `runtime_maintenance_runs` 表。

---

## 6. 配置项汇总

所有新增配置在 `src/config.ts` 的 `envSchema` 里。`booleanCoerceSchema` 支持 `"true"/"false"/"1"/"0"/"yes"/"no"/"on"/"off"` 等字面量。

### 6.1 Refine 相关（默认启用）

| 变量 | 类型 | 默认 | 作用 |
|---|---|---|---|
| `WRITEBACK_REFINE_ENABLED` | boolean | `true` | 总开关；关闭后引擎跳过 refine 调用 |
| `WRITEBACK_LLM_REFINE_MAX_TOKENS` | int | `800` | Refine 场景的输出 token 预算 |

### 6.2 Maintenance 相关（默认关闭）

| 变量 | 类型 | 默认 | 作用 |
|---|---|---|---|
| `WRITEBACK_MAINTENANCE_ENABLED` | boolean | `false` | 是否开启定时维护；零配置部署不受影响 |
| `WRITEBACK_MAINTENANCE_INTERVAL_MS` | int | `900000`（15min） | 调度间隔 |
| `WRITEBACK_MAINTENANCE_WORKSPACE_INTERVAL_MS` | int | `3600000`（1h） | 同 workspace 最小复访间隔 |
| `WRITEBACK_MAINTENANCE_WORKSPACE_BATCH` | 1-20 | `3` | 每 tick 最多处理的 workspace 数 |
| `WRITEBACK_MAINTENANCE_SEED_LIMIT` | 1-100 | `20` | 每 workspace seed 记录上限 |
| `WRITEBACK_MAINTENANCE_RELATED_LIMIT` | 1-200 | `40` | 每组（scope×memory_type）related 记录上限 |
| `WRITEBACK_MAINTENANCE_SIMILARITY_THRESHOLD` | 0-1 | `0.35` | `jaccardOverlap` 纳入 related 的阈值 |
| `WRITEBACK_MAINTENANCE_SEED_LOOKBACK_MS` | int | `86400000`（24h） | 无 checkpoint 时的 seed 回溯窗口 |
| `WRITEBACK_MAINTENANCE_TIMEOUT_MS` | int | `10000` | Worker 内每次 storage/LLM 调用超时 |
| `WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS` | int | `1500` | Maintenance plan 输出 token 预算 |
| `WRITEBACK_MAINTENANCE_MAX_ACTIONS` | 1-100 | `10` | 每 tick × workspace 应用动作上限 |
| `WRITEBACK_MAINTENANCE_MIN_IMPORTANCE` | 1-5 | `2` | 低于此值的 downgrade 改为 archive |
| `WRITEBACK_MAINTENANCE_ACTOR_ID` | string | `"retrieval-runtime-maintenance"` | PATCH/archive 的 actor 标识 |

---

## 7. HTTP 端点变更

### 7.1 新增

**`POST /v1/runtime/writeback-maintenance/run`**

手动触发一次维护。

请求体（全部可选）：

```json
{ "workspace_id": "550e8400-...", "force": true }
```

- 省略 `workspace_id`：按 `selectWorkspaces` 策略选择 workspace（至多 `WORKSPACE_BATCH` 个）
- `force=true`：绕过 `WORKSPACE_INTERVAL_MS` 的冷却检查

响应 200（`MaintenanceRunSummary`）：

```json
{
  "workspace_ids_scanned": ["..."],
  "seeds_inspected": 12,
  "related_fetched": 34,
  "actions_proposed": 7,
  "actions_applied": 5,
  "actions_skipped": 2,
  "conflicts_resolved": 1,
  "degraded": false,
  "next_checkpoint": "2026-04-22T10:30:00.000Z"
}
```

降级响应示例：

```json
{
  "workspace_ids_scanned": ["..."],
  "seeds_inspected": 0,
  "related_fetched": 0,
  "actions_proposed": 0,
  "actions_applied": 0,
  "actions_skipped": 0,
  "conflicts_resolved": 0,
  "degraded": true,
  "degradation_reason": "writeback_llm_unavailable",
  "next_checkpoint": "..."
}
```

Worker 未装配（构造时 `maintenanceWorker` 为空，极端情况）会返回 `degradation_reason: "maintenance_worker_disabled"`。

### 7.2 未变

`POST /v1/runtime/finalize-turn` / `POST /v1/runtime/prepare-context` / `POST /v1/runtime/session-start-context` / `POST /v1/runtime/dependency-status/writeback-llm/check` 的请求响应契约保持不变。`mna` 不需要任何调整。

---

## 8. 数据流与时序

### 8.1 finalizeTurn 新流程

```
mna (client)
  │  POST /v1/runtime/finalize-turn
  ▼
retrieval-runtime.finalizeTurn
  │
  ├─ findFinalizeIdempotencyRecord（命中直接返回缓存）
  │
  ├─ writebackEngine.submit(input)
  │    └─ extractCandidates(input)
  │         ├─ runRulesOnly(input) ─────────────────── 规则候选列表
  │         ├─ [若 LLM 可用 & REFINE_ENABLED]
  │         │    llmExtractor.refine({
  │         │      current_input, assistant_output, tool_results_summary,
  │         │      task_id, rule_candidates                   ← 关键扩展
  │         │    })
  │         │    → applyRefineResult(ruleDrafts, refined)
  │         │         drop / keep / merge / new
  │         └─ postProcess(drafts, filtered_reasons)
  │              → jaccard / 阈值 / 去重 / 限额裁剪
  │
  ├─ enqueueWritebackOutbox（候选先入 outbox 表，保证重试）
  ├─ writebackEngine.submitCandidates(candidates)
  │    └─ storageClient.submitCandidates(...) ──────── 实际入 storage
  │
  ├─ markWritebackOutboxSubmitted
  ├─ recordWritebackSubmission（观测日志）
  └─ upsertFinalizeIdempotencyRecord（写缓存）
```

### 8.2 Maintenance 时序

```
定时器 interval fire  OR  POST /v1/runtime/writeback-maintenance/run
  │
  ▼
MaintenanceWorker.runOnce
  │
  ├─ selectWorkspaces(now)
  │    ├─ repository.getMaintenanceCheckpoints(now, MIN_INTERVAL, BATCH)
  │    └─ [不足则] repository.listWorkspacesWithRecentWrites(now - LOOKBACK, BATCH)
  │
  ├─ for each workspace:
  │    ├─ fetchSeeds
  │    │    └─ storageClient.listRecords({ workspace_id, status: "active", page_size: SEED_LIMIT })
  │    │        客户端按 created_at 过滤
  │    │
  │    ├─ fetchRelated
  │    │    └─ [group by (scope, memory_type)] storageClient.listRecords(...)
  │    │        客户端按 jaccard 过滤
  │    │
  │    ├─ fetchConflicts
  │    │    └─ storageClient.listConflicts("open")
  │    │
  │    ├─ [剪枝] seeds+related<2 && conflicts==0 → 直接更新 checkpoint 并返回
  │    │
  │    ├─ dependencyGuard.run("writeback_llm", TIMEOUT, () =>
  │    │    planner.plan({ seed_records, related_records, open_conflicts })
  │    │  )
  │    │    └─ HttpLlmMaintenancePlanner 调 WRITEBACK_LLM 端点
  │    │    └─ Zod 校验 + id 白名单过滤
  │    │
  │    ├─ applyActions(plan)
  │    │    └─ 5 种 action 分别映射到 storage API（见 5.3）
  │    │
  │    └─ repository.upsertMaintenanceCheckpoint({ workspace_id, last_scanned_at: now })
  │
  └─ logger.info({ maintenance: summary }, "writeback maintenance tick")
```

---

## 9. 向后兼容与降级策略

| 场景 | 表现 |
|---|---|
| 完全不配 LLM | `llmExtractor === undefined`；引擎走 `runRulesOnly → postProcess`，等价于改造前的 rules-fallback 路径 |
| 配了 LLM 但设 `WRITEBACK_REFINE_ENABLED=false` | 同上；提供给 ops 快速关闭 refine 的开关 |
| Refine 请求抛错 / schema 不符 | 引擎 catch，保留规则结果，`logger.warn` |
| Refine 返回超量候选 | 引擎裁剪到 `WRITEBACK_MAX_CANDIDATES * 3`；postProcess 再裁剪到 `WRITEBACK_MAX_CANDIDATES` |
| `WRITEBACK_MAINTENANCE_ENABLED=false` | `start()` 直接 return；没有定时器，手动端点仍可调用但 worker 自己不运行 |
| Worker 但 planner 未配置 | runOnce 返回 `degraded=true, degradation_reason="writeback_llm_unavailable"`，checkpoint 仍更新 |
| Planner 返回含不存在的 record_id | planner 层过滤掉该 action，剩余 action 正常执行 |
| storage 某次调用失败 | 当前 workspace 剩余 action 中断，`actions_skipped++`，tick 继续下一个 workspace |
| Outbox 行为 | 未改动；`WritebackOutboxFlusher` 继续独立跑 |
| mna 客户端 | 契约零变化；不需要任何代码调整 |

现有 storage 服务、memory-native-agent、visualization 服务均无需任何改动。

---

## 10. 验证与测试

### 10.1 自动化验证

```bash
cd services/retrieval-runtime
npm run check   # tsc --noEmit，零错误
npm run build   # tsc -p tsconfig.json，零错误
npm test        # 69/69 通过（原 64 + 新增 5）
```

`services/memory-native-agent` 侧 `npm run check` 同样零错误（契约未变）。

### 10.2 新增测试清单

`tests/maintenance-worker.test.ts`（5 个）：

1. **merge**：两条相似记录 → 首条 patch 含 `merged_from`，其余 archive
2. **downgrade below MIN_IMPORTANCE**：实际走 archive 而非 patch
3. **summarize**：先 submitCandidates 再 archive 源记录
4. **planner 缺失**：`degraded=true`，无任何落盘
5. **剪枝**：seeds+related<2 且无冲突时跳过 LLM

### 10.3 更新的测试

`tests/runtime-service.test.ts`：

- `StubStorageClient` / `StubLlmExtractor` / `SpyLlmExtractor` 补齐接口
- `baseConfig` 补齐 15 个新字段
- line 473-502 "uses configured llm extraction..."：断言 `llmCandidates.map(c => c.scope)` 而非整个候选列表（新契约下规则候选和 LLM 候选可同时出现）
- line 1056 / 1074：`llmExtractor.callCount` 改为 `refineCallCount`

`tests/remediation.test.ts`：

- 2 处匿名 storage stub 补齐 5 个方法
- `CountingLlmExtractor` 加 `refine` 并计数
- line 830：同上 `refineCallCount`

`tests/embeddings-client.test.ts`：

- 3 处 `AppConfig` 字面量补齐新字段

### 10.4 手动端到端验证建议

```bash
# 1. 环境配置
export WRITEBACK_LLM_BASE_URL=https://...
export WRITEBACK_LLM_API_KEY=...
export WRITEBACK_REFINE_ENABLED=true
export WRITEBACK_MAINTENANCE_ENABLED=true
export WRITEBACK_MAINTENANCE_INTERVAL_MS=60000

# 2. 启动
npm run dev

# 3. Refine 管线
curl -X POST http://localhost:3002/v1/runtime/finalize-turn \
  -H "content-type: application/json" \
  -d '{ "host":"claude_code_plugin", "workspace_id":"...", "user_id":"...", "session_id":"...", "current_input":"后续都用中文输出", "assistant_output":"收到，我会统一改成中文输出。" }'

# 预期：候选含 extraction_method: "llm"；submitted_jobs[].status="accepted_async"

# 4. 手动维护
curl -X POST http://localhost:3002/v1/runtime/writeback-maintenance/run \
  -H "content-type: application/json" \
  -d '{ "workspace_id":"...", "force":true }'

# 5. 健康检查
curl http://localhost:3002/v1/runtime/health/dependencies
curl -X POST http://localhost:3002/v1/runtime/dependency-status/writeback-llm/check
```

---

## 11. 后续演进建议

### 11.1 短期

1. **暴露维护度量**：新增 `runtime_maintenance_runs` 观测表 + `recordMaintenanceRun`，用于追踪合并率、降权率、冲突解决率。
2. **storage 端下推 `created_after`**：`recordQuerySchema` 加一个可选 `created_after` 参数，避免客户端过滤带来的无效拉取。
3. **并发 workspace**：目前单 tick 内串行处理 workspace，可改为 `Promise.allSettled` 并发（每个 workspace 独立）。
4. **Dry-run 模式**：`POST /v1/runtime/writeback-maintenance/run` 支持 `dry_run: true`，仅返回 `actions_proposed`，不落盘，供运维观察。

### 11.2 中期

1. **细化相似度**：`jaccardOverlap` 是 bigram 近似；可引入 summary embedding 余弦相似度。前提是 `embeddings_client` 在 maintenance 场景里也可用。
2. **用户空闲信号**：当前"空闲"是时间窗口近似。可让 mna 在会话静默一段时间后主动调 `writeback-maintenance/run?workspace_id=...`，实现真正"用户空闲"触发。
3. **多模型协作**：`refine` 与 `maintenance` 可拆分到不同的 `MAINTENANCE_LLM_*` 端点，让整理使用更便宜的模型。
4. **冲突解决的人工兜底**：当前 planner 对 `pending_confirmation` 冲突有裁决能力，但可以加"置信度阈值"，低于阈值时退回 `dismissed` 让人工处理。

### 11.3 与现有路线图的关系

- 本次改造是 `retrieval-runtime` 内部升级，不占用 `memory-injection` 或 `memory-retrieval` 的 product backlog。
- 维护 worker 暴露的 HTTP 端点遵循 `/v1/runtime/*` 前缀约定，后续接入 visualization 侧的运维面板可直接复用。
- `WRITEBACK_MAINTENANCE_ACTOR_ID` 作为 governance actor 出现在 storage 的 `record_versions` 和 `conflict_resolutions` 里，与 `storage-shared_v1` 的审计模型兼容。

---

## 附录 A：关键文件路径速查

| 角色 | 路径 |
|---|---|
| 配置 | `services/retrieval-runtime/src/config.ts` |
| Refine prompt | `services/retrieval-runtime/src/writeback/llm-refiner-prompt.ts` |
| LLM 客户端（提取+精化） | `services/retrieval-runtime/src/writeback/llm-extractor.ts` |
| LLM 客户端（维护） | `services/retrieval-runtime/src/writeback/llm-maintenance-planner.ts` |
| Storage HTTP 客户端 | `services/retrieval-runtime/src/writeback/storage-client.ts` |
| 写回引擎（反转后） | `services/retrieval-runtime/src/writeback/writeback-engine.ts` |
| 维护 Worker | `services/retrieval-runtime/src/writeback/maintenance-worker.ts` |
| 路由 | `services/retrieval-runtime/src/app.ts` |
| 装配 | `services/retrieval-runtime/src/index.ts` |
| Repository 接口 | `services/retrieval-runtime/src/observability/runtime-repository.ts` |
| Postgres 实现 + DDL | `services/retrieval-runtime/src/observability/postgres-runtime-repository.ts` |

## 附录 B：术语

- **Refine**：LLM 对规则候选的二次加工，输出 `keep/drop/merge/new` 四种指令之一
- **Seed**：维护 tick 中最近新增的记忆记录，作为"以新带旧"的入口
- **Related**：与 seed 同 scope、同 memory_type 且语义相似度达标的历史记录
- **Plan**：LLM 规划出的一组维护动作（`MaintenancePlan.actions`）
- **Checkpoint**：`runtime_maintenance_checkpoints` 表里每个 workspace 的 `last_scanned_at`，用于控制复访间隔
