# retrieval-runtime 改进建议（第二轮）

## 1. 文档目的

这份文档接续 `retrieval-runtime-improvement-proposals.md`。

和第一版不同，这一轮先做了一次**按当前仓库代码回看**，所以本文里的“现状”以现在已经落地的实现为准，不再沿用早期审视草稿里的旧判断。

- 现状详细描述见 `retrieval-runtime-internals.md`
- 第一轮建议清单见 `retrieval-runtime-improvement-proposals.md`
- 本文只保留两类内容：
  - 当前代码里**仍然存在**的问题
  - 已部分落地，但还有**后续优化空间**的问题
- 已被代码解决的旧问题，会在文中明确标成“已关闭”或“已部分落地”，避免误导后续实现

## 2. 审视依据

- 代码位置：`services/retrieval-runtime/src/`
- 联动实现：`services/storage/src/`、`services/visualization/src/`、`services/memory-native-agent/src/`
- 对齐契约：`docs/memory-module-contract.md`、`docs/architecture-independence.md`、`docs/current-phase-closure-plan.md`
- 当前宿主：`claude_code_plugin`、`codex_app_server`、`memory_native_agent` 都已在代码里接入；`mna` 不是纯设计态，而是已有可运行服务骨架和主链路实现

## 3. 状态总览

| 编号 | 标题 | 当前状态 | 优先级 | 类别 | 跨服务 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| R01 | `scope` 分类仲裁权统一 + 规则词表单一来源 | 待推进 | **P0** | 契约正确性 | ✓ storage |
| R02 | 写回候选引入本地 `outbox`（待发送队列）与重试 | 待推进 | **P0** | 数据不丢失 | — |
| R03 | `embedding`（向量）补刷机制的调度与观测收敛 | 已部分落地，仍可优化 | P2 | 召回质量 | ✓ storage |
| R04 | `recent_context_summary`（最近上下文摘要）的契约约束 | 待推进 | P1 | 召回稳定性 | ✓ 所有宿主 |
| R05 | 打分权重按 `phase`（阶段）配置 | 待推进 | P1 | 召回质量 | — |
| R06 | `LLM extractor`（大模型抽取器）质量门 + `finalize` 幂等 | 待推进 | P2 | 成本 / 抗抖动 | — |
| R07 | 轨迹页的多 `phase` 叙事与字段映射收敛 | 待推进 | P2 | 可观测性 | ✓ visualization |

补充说明：

- 旧稿里“`embedding` 失败后没有任何补刷机制”的判断，已不符合当前代码。
- 旧稿里“`runtime_turns` 仍然一条 `trace` 一行、会被 `after_response` 覆盖”的判断，也已不符合当前代码。

## 4. P0：优先修正的硬问题

### R01 - `scope` 分类仲裁权统一 + 规则词表单一来源

**当前现状**：

- `retrieval-runtime/src/writeback/writeback-engine.ts` 里的 `classifyScope()` 仍然会根据候选内容再次改写 `scope`。
- `storage/src/domain/normalizer.ts` 里的 `classifyCandidateScope()` 也会再次分类，而且规则集合和 runtime 不完全一致。
- 两边都在做“最终判断”，所以同一条候选从 runtime 发到 storage 后，`scope` 仍可能变化。
- `storage/src/domain/merge-engine.ts` 里的 `polarity()` 已经支持中文和英文极性词，所以“完全不识别中文正负偏好”这个问题已经关闭；但相关词表仍然散落在 runtime、storage normalizer、merge 规则里，没有单一来源。

**为什么仍然不合理**：

- `scope` 直接决定后续召回边界，仲裁权不清会导致“写入到哪个记忆空间”不稳定。
- 规则分散在多个服务里，后面继续补词表时很容易出现一边改了、另一边漏了。

**建议改动**：

1. 在契约里明确：`storage` 是 `scope` 的最终仲裁者，runtime 只允许提供“建议值”。
2. runtime 的 `classifyScope()` 保留为轻量提示逻辑，不再主动覆盖 LLM 或宿主已明确给出的 `scope`。
3. 把 `scope` / `polarity` 相关关键词整理成一份共享词表，至少做到文档单一来源；如果后续还会频繁调整，再抽成共享代码模块。
4. 补一组跨服务测试：同一批中文候选经过 runtime -> storage 后，验证最终 `scope`、冲突判定和 dedupe 行为一致。

**更稳的设计取向**：

- 这里不建议把 runtime 和 storage 的分类逻辑做成“双向完全一致”的共享函数。
- 首版明确走：**文档单一来源 + 跨服务复用同一组测试 fixture（测试样例）**，不开共享代码模块。
- 更好的做法是：runtime 只做“弱建议”，storage 做“强仲裁”；同步靠契约文档和跨服务测试锁住，不靠共享实现。

### R02 - 写回候选引入本地 `outbox`（待发送队列）与重试

**当前现状**：

- `finalizeTurn` 现在还是同步调用 storage 写回接口。
- 如果 storage 超时、网络异常或返回错误，runtime 会给宿主返回 `dependency_unavailable`（依赖不可用），并把整次结果标记为 `degraded=true`。
- 但这些候选不会在 runtime 本地持久化，也没有后续重试，所以这批候选会直接丢失。

**为什么不合理**：

- 这属于“瞬时依赖故障导致永久数据丢失”。
- 对记忆系统来说，这个损失比一次响应慢更严重。

**建议改动**：

1. 在 `runtime_private` 增加 `writeback_outbox` 表，按 `idempotency_key` 去重存候选。
2. `finalizeTurn` 改成两段：
   - 先把候选写入本地 `outbox`
   - 再走一次同步快路径提交 storage
3. 快路径成功后把本地项标为 `submitted`；失败则保持 `pending`，由后台 `flusher`（刷新器）重试。
4. 暴露最少三项指标：
   - `outbox_pending_count`
   - `outbox_dead_letter_count`
   - `outbox_submit_latency_ms`

**更稳的设计取向**：

- 这里建议先做“本地表 + 同进程后台轮询”的朴素方案，不要一上来拆独立 worker。
- 当前吞吐不高，先把“不丢数据”解决，比追求编排复杂度更重要。

## 5. P1：召回质量与契约收敛

### R03 - `embedding` 补刷机制的调度与观测收敛

**当前现状**：

- `storage/src/db/read-model-projector.ts` 在 `embedding` 失败时，不是单纯留下永久 `null`，而是会把读模型项标成 `embedding_status = 'pending'`。
- `storage/src/jobs/job-worker.ts` 每次 worker 循环都会调用 `refreshPendingEmbeddings()`，对 `pending` 记录继续补刷。
- `storage/src/db/repositories.ts` 的指标里已经有 `pending_embedding_records`。

所以，“失败后没有任何补刷机制”这个说法已经不成立。

**现在真正剩下的问题**：

- 当前补刷和主写入共用同一个 worker 批次，没有独立节流策略。
- 补刷虽然存在，但观测语义还不够清楚，页面上不一定能直接看出“当前是历史补刷积压，还是实时投影失败”。

**建议改动**：

1. 保留现有 `pending -> worker 补刷` 的简单模型，不再额外引入第二套刷新链路。
2. 只补两类能力：
   - 独立配置：如 `EMBEDDING_BACKFILL_BATCH_SIZE`
   - 更明确的指标展示，至少拆成：
     - `new_pending_embedding_records`：首次失败后进入 `pending` 的记录数
     - `retry_pending_embedding_records`：多次补刷仍处于 `pending` 的记录数
     - `oldest_pending_embedding_age_seconds`：当前最老一条 `pending` 记录的等待时长
3. 如果后续数据量上来，再考虑把补刷从主 worker 中拆出来。

**更稳的设计取向**：

- 这一项不建议回退到“新增 `embedding_only` refresh job 类型”再走第二套队列。
- 当前代码已经有一条更简单的 `pending embedding`（待补刷向量）路径，继续沿着这条路补观测和节流，复杂度更低。

### R04 - `recent_context_summary`（最近上下文摘要）的契约约束

**当前现状**：

- `TriggerContext.recent_context_summary` 仍然是宿主自由传入。
- runtime 已经在 `query-engine.ts` 里做了长度截断：`current_input` 保尾部 512、`recent_context_summary` 保尾部 512、总长再限制到 1024。
- 但契约没有规定“这个字段到底该怎么构造”，三个宿主现在也没有共享构造逻辑。

**为什么不合理**：

- 同一句用户输入，在不同宿主里可能得到不同的 `semantic_query_text`（语义查询文本），召回效果就没法稳定比较。
- 轨迹页也难以解释“到底是宿主传错了，还是 runtime 算错了”。

**建议改动**：

1. 在契约里明确：
   - 只拼最近 N 轮用户发言
   - 不包含 assistant 输出
   - 不包含工具输出
   - 时间正序
   - 总长度上限明确
2. 共享的是**契约规则和测试 fixture（测试样例）**，不是共享代码：
   - 规则写在 `memory-module-contract.md`
   - 每个宿主各自实现自己的摘要构造
   - 复用同一组 fixture 验证输出一致
3. 轨迹页补展示：
   - `semantic_query_text`
   - 长度统计
   - 来源拆分（`current_input` / `recent_context_summary`）

**更稳的设计取向**：

- 这里不建议让 runtime 反向替宿主“重建摘要”。
- 首版不放共享构造函数，避免形成新的跨服务代码耦合。
- 更好的边界是：宿主负责按契约生成，runtime 负责截断、使用和观测；共享的是契约文本和测试样例，不是实现代码。

### R05 - 打分权重按 `phase`（阶段）配置

**当前现状**：

- `query-engine.ts` 仍然使用固定权重：

```text
semantic_score * 0.45
+ importance     * 0.25
+ confidence     * 0.15
+ recency        * 0.10
+ scope_boost    * 0.05
```

- 现在只有 `session` 的 `scopeBoost` 已经在第一轮里提升到了 `0.95`，但整套权重还没有按阶段区分。

**为什么不合理**：

- `session_start` 和 `before_response` 的信号强度根本不同，用同一组权重不够合理。

**建议改动**：

1. 先在代码里引入一份**固定的按阶段权重表**，种子值先明确写死，后续再按轨迹验证：

```text
session_start:   semantic 0.10 / importance 0.35 / confidence 0.20 / recency 0.05 / scope 0.30
task_start:      semantic 0.30 / importance 0.30 / confidence 0.15 / recency 0.10 / scope 0.15
task_switch:     semantic 0.30 / importance 0.30 / confidence 0.15 / recency 0.10 / scope 0.15
before_plan:     semantic 0.35 / importance 0.25 / confidence 0.15 / recency 0.15 / scope 0.10
before_response: semantic 0.50 / importance 0.20 / confidence 0.15 / recency 0.10 / scope 0.05
```

2. 默认值先放代码常量，不要一开始就做成环境变量里的大 JSON。
3. 等线上轨迹积累后，再决定是否开放外部配置。

**更稳的设计取向**：

- 这里我更倾向于“代码常量 + 单测锁定”。
- 不建议第一版就把任意浮点权重直接暴露成自由配置，否则排障成本会很高。

## 6. P2：质量、成本与可观测性

### R06 - `LLM extractor`（大模型抽取器）质量门 + `finalize` 幂等

**当前现状**：

- `writeback-engine.ts` 现在是：
  - 有 LLM 就先走 LLM 抽取
  - LLM 失败再回退规则抽取
- 但“LLM 成功返回了不靠谱内容”这条路径，还没有质量门。
- `finalizeTurn` 也没有按 `turn_id` 做幂等缓存，所以同一轮重复提交时，LLM 调用成本会重复发生。

**为什么不合理**：

- 这会同时带来两种损失：
  - 伪记忆入库
  - 弱网重放下的重复计费

**建议改动**：

1. 给 LLM 抽取结果加一个轻量质量门：
   - 只校验“候选摘要”和输入上下文是否有基本重叠
   - 规则抽取路径豁免
2. 给 `finalizeTurn` 加短期幂等缓存：
   - key 可以基于 `session_id + turn_id + user_input hash`
   - value 直接缓存 `FinalizeTurnResponse`
   - 首版正选方案明确走**进程内 LRU + TTL**
3. 如果未来 R02 的 `outbox` 落地，可以让 `finalize` 幂等和 `outbox` 共用一部分键设计。

**更稳的设计取向**：

- 这一项先做“5 分钟短 TTL 缓存”就够了。
- 不建议第一步就引入 Redis 这类新依赖。
- 当前默认假设 runtime 单实例，所以首版走进程内 LRU 最省事；如果后续进入多实例部署，再评估是否迁到 PG 小表或别的共享存储。

### R07 - 轨迹页的多 `phase` 叙事与字段映射收敛

**当前现状**：

- runtime 后端已经能按 `(trace_id, phase)` 保存多阶段数据，这部分旧问题已经解决。
- 但 `visualization/src/features/run-trace/service.ts` 现在生成叙事时，仍然大量使用每类数组的第 1 条记录（`[0]`）做摘要。
- 具体位置已经能直接看到：`summarizeScopes()` 的 54-56 行、`groupByTrace()` 的 79 行、`buildNarrative()` 的 107-110 行、`buildPhaseNarratives()` 的 201-204 行、列表摘要处的 275-278 行。
- `visualization/src/lib/server/runtime-observe-client.ts` 对 `recall` 阶段的字段映射也还不够准确，当前更偏向读 `selected_scopes`，而 runtime 实际返回的是 `matched_scopes`。

**为什么不合理**：

- 后端已经 phase-aware（按阶段区分），前端叙事还是单阶段视角，会把多阶段 trace 压平。
- 这会让“明明已经按阶段记录了”这一层收益打折。

**建议改动**：

1. 不再改 runtime 表结构，后端这一层先保持现状。
2. 重点改 visualization：
   - DTO 映射修正为真实字段
   - 叙事层按 `phase` 分组
   - 列表摘要只选一个“主 phase”，详情页展示全部 phase
3. 主 phase 的默认选择建议：
   - 优先 `before_response`
   - 没有再退到 `before_plan`
   - 最后才退到最新一条

**更稳的设计取向**：

- 这个问题现在更像前端叙事层问题，不建议再回头改 runtime 底层 schema。

## 7. 已关闭或已部分关闭的旧判断

下面两条是旧稿里出现过、但现在已经不应再按“待修问题”处理的内容：

### 7.1 `embedding` 失败后“没有任何补刷机制”

当前代码里已经有：

- `embedding_status = 'pending'`
- worker 循环里的 `refreshPendingEmbeddings()`
- `pending_embedding_records` 指标

所以这一条应从“真假问题”修正为“已部分落地，后续优化调度与观测”。

### 7.2 `runtime_turns` 会被 `after_response` 覆盖成单行

当前代码和迁移里，`runtime_turns` 与其他几张运行表都已经是 `(trace_id, phase)` 主键。

所以这一条应从“runtime 数据层问题”修正为“visualization 对多 phase 的消费还没完全跟上”。

## 8. 改进顺序建议

1. 先做 `R01 / R02`
   - 一个解决边界正确性
   - 一个解决数据不丢失
2. 再做 `R04 / R05`
   - 一个收契约
   - 一个调召回质量
3. `R06 / R07` 放到稳定期
   - 一个偏成本和抗抖动
   - 一个偏观测解释质量
4. `R03` 作为穿插优化项，不抢前两批优先级

## 9. 契约回写清单

按本文档后续实施时，需要同步检查：

- `docs/memory-module-contract.md`
  - 补 `scope` 仲裁条款
  - 补 `recent_context_summary` 构造规则
- `docs/retrieval/retrieval-runtime-service-design.md`
  - 补 `outbox` 机制
  - 补按 `phase` 的打分口径
- `docs/retrieval/retrieval-runtime-internals.md`
  - 把“已落地”的现状写回
  - 删除已经过时的旧判断
- `docs/storage/storage-internals.md`
  - 明确 `pending embedding`（待补刷向量）的现状
- `docs/visualization/visualization-internals.md`
  - 补多 `phase` 轨迹消费规则
  - 补 `semantic_query_text` 的展示方案
