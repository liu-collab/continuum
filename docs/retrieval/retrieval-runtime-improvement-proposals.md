# retrieval-runtime 改进建议

## 1. 文档目的

这份文档记录对 `services/retrieval-runtime/` **现状实现**的审视结论，按优先级列出建议改动。

- 现状详细描述见 `retrieval-runtime-internals.md`
- 这里只讨论**哪里不合理、怎么改**
- 每条建议独立成一段，可以单独拆成一个修复任务

## 2. 审视依据

- 代码位置：`services/retrieval-runtime/src/`（当前版本）
- 对齐契约：`docs/memory-module-contract.md`、`docs/architecture-independence.md`、`docs/current-phase-closure-plan.md`
- 使用场景：三个宿主按 `memory-module-contract.md` 第 6.1 节调用所有 6 个触发点
  - 当前接口取值（`HostKind`）：`claude_code_plugin` / `codex_app_server` / `custom_agent` / `memory_native_agent`

## 3. 优先级总览

| 编号 | 标题 | 优先级 | 类别 |
| :--- | :--- | :--- | :--- |
| I01 | `finalize-turn` 的 trace_id 关联脆弱 | **P0** | 正确性 |
| I02 | `scope=session` 的 scopeBoost 偏低 | P1 | 召回质量 |
| I03 | `packet_summary` 硬编码英文 | **P0** | 产品体验 |
| I04 | `sessionStartContext` 丢失结构化信息 | **P0** | 宿主能力 |
| I05 | Trigger cooldown 机制几乎不生效 | P2 | 代码整洁 |
| I06 | 注入排序与召回排序打架 | 待定 | 产品策略 |
| I07 | 默认配置过于保守 | P1 | 召回质量 |
| I08 | `after_response` 在 trigger-engine 里是死分支 | ~~P2~~ 撤回 | — |
| I09 | `semantic_query_text` 没有长度上限 | P1 | 性能 / 召回质量 |
| I10 | `importance_threshold` 散落硬编码 | P2 | 可配置性 |
| I11 | 多 phase 串行导致轨迹页记录暴增 | P1 | 可观测性 |
| I12 | Cooldown key 不含 task_id | P2 | 边界正确性 |

## 4. P0：mna 开工前必须修

### I01 — `finalize-turn` 的 trace_id 关联脆弱

**现状**（`runtime-service.ts:227-232`、`postgres-runtime-repository.ts:371-405`）：
```ts
const traceId = (await this.repository.findTraceIdForFinalize({
  session_id, turn_id, thread_id, current_input
})) ?? randomUUID();
```
`findTraceIdForFinalize` 采用**优先级分支**匹配：优先 `(session_id, turn_id)`，缺 turn_id 再退到 `thread_id`，都没有才落到 `current_input`；四个字段并非同时参与匹配。找不到匹配时直接生成新 trace_id；落到 `current_input` 分支时，任何 trim/normalize 差异就会匹配失败。

**为什么不合理**：
- 同一轮 prepare 和 finalize 的 trace 可能分裂
- mna 首版每轮串行发 4 次 prepareContext（`task_switch / task_start / before_plan / before_response`），**每次都走 `randomUUID()`**，finalize 顶多匹配到最后一次
- 运行轨迹页按 trace_id 聚合的"turn / trigger / recall / injection / writeback 五段视图"会错乱

**建议改动**：
1. `runtime-service.prepareContext` 改成：先按 `(session_id, turn_id)` 查已有 trace_id，找到复用，找不到再生成
2. repository 新增 `findTraceIdByTurn(session_id, turn_id): Promise<string | null>`
3. finalize 走同样的查找路径，去掉 `current_input` 作为 fallback key
4. **可选但需先评估**：把 `turn_id` 在 `prepareContextInputSchema` 里设为**必填**。现状 `turn_id` 是 optional，`session_start` 路径（`SessionStartRequest`，不走 schema）以及现役两个宿主是否都能稳定提供 turn_id 需要先确认——`claude_code_plugin` 的 hooks 通道不一定有 turn_id，首版可以先**只在 `prepare/finalize` 走 schema 的路径**要求必填，`session_start` 继续例外。

**验收**：
- 同一 `(session_id, turn_id)` 发 4 次 prepare + 1 次 finalize，`trace_id` 全部一致
- 运行轨迹页按 trace_id 聚合，5 段完整对齐
- 历史宿主（Claude Code / Codex）在不传 turn_id 的路径上仍能工作，不因 schema 必填而 400

### I03 — `packet_summary` 硬编码英文

**现状**：
- `packet-builder.ts:7`：`"No active memory matched this trigger."`
- `summarizeRecords` 里 `${type}: ${snippets}` 中 `type` 是 `fact_preference` / `task_state` / `episodic` 的英文 key
- `injectionHint` 返回 `"current task continuation"` / `"background constraints"` / `"historical reference"`

**为什么不合理**：
- 这些字符串会直接进入 agent 的 system prompt（通过 `InjectionBlock.memory_summary / injection_reason`）
- 产品面向中文用户，英文 token 会污染模型输出语言风格

**建议改动**：
方案 A（最小修改）：把所有对外可见字符串抽到 `src/shared/messages.ts`，一次性中文化。
方案 B（更结构化）：`packet_summary` 改为结构化 JSON 字符串（如 `{"fact_preference":["..."], "task_state":[...]}`），由宿主在 system prompt 里自行渲染为母语。

首版建议方案 A，方案 B 作为 I06 附带讨论。

**验收**：
- `prepareContext` 返回的 `injection_block.memory_summary` 与 `injection_reason` 全部是中文
- 既有测试用例对英文字符串的断言同步更新

### I04 — `sessionStartContext` 丢失结构化信息

**现状**（`runtime-service.ts:205-207`）：
```ts
const additionalContext = prepared.injection_block
  ? `${prepared.injection_block.injection_reason}\n${prepared.injection_block.memory_summary}`
  : "";
```
`SessionStartResponse` 里把 `injection_block` 拍扁成一个字符串 + 挖了一个 `active_task_summary`，**不暴露 `injection_block` 本身**。

**为什么不合理**：
- 对 Claude Code hooks 合理（它只能接受 stdout 一段文本）
- 对 mna 这种自己装配 prompt 的宿主是信息损失——拿不到 `memory_records[]`、`selected_scopes`、`trim_reasons` 等
- mna 无法知道 session_start 这轮到底注入了哪些记录

**建议改动**：
- `SessionStartResponse` 加上可选字段 `injection_block: InjectionBlock | null`（与 `PrepareContextResponse` 同构）
- 既有 `additional_context` / `active_task_summary` 保留，仅作为兼容字段
- 宿主可按需用其中任一字段

**验收**：
- `mna` 通过 `sessionStartContext` 能拿到完整 `injection_block`
- Claude Code / Codex 的既有集成用原来的 `additional_context` 仍然工作
- 契约快照测试更新

## 5. P1：首版调优（建议随 mna 一起发布）

### I02 — `scope=session` 的 scopeBoost 偏低

**现状**（`query-engine.ts:23-34`）：
```
task       1.00
workspace  0.90
user       0.80
其他（含 session）  0.60
```

**为什么不合理**：session 是本轮最新鲜的记忆，在 `before_response` 场景下本应高优先级。当前却比 user scope 低。

**建议改动**：
```
task       1.00
session    0.95   # 新增分支
workspace  0.90
user       0.80
其他       0.60
```

**验收**：固定一组包含 session / task / workspace / user 同等 semantic_score 的候选，注入排序 session 先于 workspace / user。

### I07 — 默认配置过于保守

**现状**：
```
INJECTION_RECORD_LIMIT = 3          # memory-module-contract 第 8 节允许 3-7，取了下限
INJECTION_TOKEN_BUDGET = 450        # 在 128k 上下文下极紧
SEMANTIC_TRIGGER_THRESHOLD = 0.85   # 非常高，语义兜底几乎不触发
```

**为什么不合理**：
- 3 条 + 450 token 的预算，`before_response` 实际注入的记忆常常不够用
- 0.85 的阈值让语义兜底路径接近于没有——意味着大多数"非硬规则"轮次直接无注入

**建议改动**：
```
INJECTION_RECORD_LIMIT       3 → 5
INJECTION_TOKEN_BUDGET     450 → 1500
SEMANTIC_TRIGGER_THRESHOLD 0.85 → 0.72
```
数值可调，这里给首版起步值。

**验收**：
- 既有单测用"3 条" / "450" 硬编码的断言更新
- 人工跑一组对话：涉及历史偏好的轮次平均注入 ≥ 3 条

### I09 — `semantic_query_text` 没有长度上限

**现状**（`query-engine.ts:52-54`）：
```ts
semantic_query_text: normalizeText(
  [context.current_input, context.recent_context_summary].filter(Boolean).join("\n"),
)
```
`recent_context_summary` 由宿主传来，契约没有长度约束。

**为什么不合理**：
- 长文本稀释 embedding 信号，匹配效果反而变差
- embedding API 成本与长度线性相关
- 超过模型上限会 500

**建议改动**：
- `buildRetrievalQuery` 前对各组件单独截断：`current_input` 限 512、`recent_context_summary` 限 512，拼接后再限 1024
- 截断时优先保留句尾（用户最新意图）

**验收**：
- 传入一段 10KB `recent_context_summary`，embedding 请求体长度 ≤ 配置上限
- 召回结果不受"尾部意图被截断"影响（保留的是尾部而非头部）

### I11 — 多 phase 串行导致轨迹页记录暴增

**现状**：mna 单轮最多发 4 次 `prepareContext`，runtime 每次都写 `turn / trigger / recall / injection` 四条。加 finalize 的 2 条，**单轮观测条目 = 4×4 + 2 = 18 条**。

**为什么不合理**：
- `visualization` 的轨迹页按 trace_id 聚合成 5 段视图，一轮出现多 trace 就无法聚合
- 改 I01 复用 trace_id 后，**当前表结构（`runtime_trigger_runs` / `runtime_recall_runs` / `runtime_injection_runs` 三张表都是 `trace_id PRIMARY KEY`，见 `postgres-runtime-repository.ts:148 / 167 / 189`）只允许每张表每个 trace 一条记录**，多次 prepare 的后三次 insert 会直接冲突。视图要按 phase 再分组，前提是这几张表先具备"同 trace 下多行"的能力。

**建议改动**（结合 I01，分两步）：
1. runtime 数据层：
   - 方案 A：把三张表的主键从 `trace_id` 改为 `(trace_id, phase)`，并给每条 run 记录加 `phase` 字段（当前仅 `runtime_turns` 有）
   - 方案 B：给每条 run 记录新增独立 `run_id`（UUID）作主键，`trace_id` 退化成索引字段，phase 作为普通列
   - 首版建议方案 A（迁移最小，`(trace_id, phase)` 天然去重；方案 B 留给后续扩展）
   - 需要写一条迁移：加列 → 回填 phase（现有行全部按对应 turn.phase 填）→ 改 PK
2. runtime 写入侧：`recordTriggerRun / recordRecallRun / recordInjectionRun` 的 insert 改成 `ON CONFLICT (trace_id, phase) DO UPDATE`（和 `recordTurn` 对齐）
3. visualization 侧：轨迹详情页按 `phase` 分组渲染（`before_response` 一栏、`task_start` 一栏 ...）

**验收**：
- 一轮发 4 次 prepare 后，数据库里每张表都能查到 4 行，`(trace_id, phase)` 唯一
- 轨迹页能展示 4 个 phase 的分段注入结果
- 每个 phase 内部 `trigger / recall / injection` 三段仍然对应

## 6. P2：代码整洁与配置化

### I05 — Trigger cooldown 机制几乎不生效

**现状**（`trigger-engine.ts:117`）：
```ts
const cooldownApplied = Boolean(
  cooldownEntry && cooldownEntry.expires_at > Date.now() && cooldownEntry.input === normalizedInput
);
```
命中条件是输入**严格等值**。实际同一 session 内两次输入完全相等的概率极低。

**建议改动**：
- 简化为"同 session+phase 在 X 秒内不重触发"（去掉 input 匹配），或
- 按"是否成功注入过记忆"做门（成功注入后 X 秒内不再重触发相同 phase），或
- 直接删除 cooldown 相关代码

首版建议直接删除，把 `TRIGGER_COOLDOWN_MS` 配置也一起清理。运行轨迹里的 `cooldown_applied` 字段改为永远 false（保留字段避免打破契约快照）。

### I08 — `after_response` 在 trigger-engine 里是死分支（已撤回）

**原说法**：`after_response` 分支不可达，建议删除或直接抛错。

**撤回原因**：公开接口（`host-adapters/types.ts:15`）和 zod schema 现在**明确允许** `prepareContext` 的 `phase` 取 `after_response`，`trigger-engine.ts:100` 的分支也真的会被这种请求走到。这不是死代码，只是非主流路径。

**新结论**：保留现状，不在本轮清理。如果未来想收紧接口，应当从 schema 一侧下手（`prepareContextInputSchema` 不再允许 `after_response`），同时 `finalizeTurn` 内部 `recordTurn({phase: "after_response"})` 的用法与此无关、不需要联动。

### I10 — `importance_threshold` 散落硬编码

**现状**：
- `trigger-engine.ts`：`session_start` 用 4，其他 3，`semantic_fallback` 用 4
- 不统一，改起来要跳多处

**建议改动**：
```ts
// config.ts
IMPORTANCE_THRESHOLD_SESSION_START: z.coerce.number().default(4),
IMPORTANCE_THRESHOLD_DEFAULT:       z.coerce.number().default(3),
IMPORTANCE_THRESHOLD_SEMANTIC:      z.coerce.number().default(4),
```

### I12 — Cooldown key 不含 task_id

**现状**：`cooldownKey = session_id:phase`。同 session 切 task 后，前 2 分钟内 `task_start` 的 cooldown key 仍然相同。

**建议改动**：`cooldownKey = session_id:phase:(task_id||"-")`。

配合 I05：如果首版直接删除 cooldown，该问题消失。

## 7. 待产品决策

### I06 — 注入排序与召回排序打架

**现状**：
- `query-engine.ts` 用 `rerank_score` 综合打分取 top-N
- `injection-engine.ts` 拿到后**按 memory_type 重排**：`fact_preference → task_state → episodic`

**后果**：query 认为最相关的 episodic 可能被一个低分的 fact_preference 挤掉注入位。

**两种解释**：

**A. 稳定事实优先（当前）**：
产品原则上"用户偏好和固定规则"比"当前任务状态"、"具体情节"更重要，应该首先让模型知道。episodic 只在预算有富余时才进入。
→ 保留现状。

**B. 当前最相关优先**：
既然 query 阶段已经用 semantic + importance + recency 综合打分，应该尊重这个顺序。注入只在预算不够时按 type 兜底。
→ 改 injection-engine：保留 query 给的排序，type 只用于"预算不够时先丢 episodic"。

**建议**：产品侧决定。如果需要实际效果对比，可以做一轮 A/B 测试（同一组对话，分别用两种策略，看注入命中率）。

决定后更新 `memory-module-contract.md` 第 10 节"冲突与覆盖规则"。

## 8. 改进顺序建议

1. **先做 P0 三条**（I01 / I03 / I04），作为 mna 开工的前置依赖。
2. 做 P1 四条（I02 / I07 / I09 / I11），与 mna 首版一起发布。
3. P2 清理（I05 / I10 / I12）可以在 mna 稳定后再合一批 PR 一起改。I08 已撤回。
4. I06 产品决策后单独起一个 spike，不在上述任一批次里。

## 9. 契约回写清单

按本文档建议实施后，需要同步更新的契约文档：

- `docs/api-contract.md`：`SessionStartResponse` schema 新增 `injection_block`（I04）
- `docs/memory-module-contract.md` 第 8 节：若 I07 落地，更新 token 预算与条数的参考值
- `docs/memory-module-contract.md` 第 10 节：若 I06 选择方案 B，重新描述"新近且高可信"的适用边界
- `docs/retrieval/retrieval-runtime-service-design.md`：更新 trace_id 关联机制的说明（I01 / I11）
- `docs/retrieval/retrieval-runtime-implementation-spec.md`：I11 落地时需要新增 runtime 观测表的迁移步骤（加 `phase` 列、改 PK、`ON CONFLICT` 更新）
- `docs/retrieval/retrieval-runtime-internals.md`（本系列文档）：每条改动合并后同步更新"现状"描述
