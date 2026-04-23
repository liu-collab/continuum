# 记忆系统问题处理文档

## 1. 文档目的

这份文档基于当前仓库代码，回应一组跨 `retrieval-runtime`、`storage`、`memory-native-agent`、`visualization` 的问题清单。

目标不是重复描述问题，而是先确认：

- 现状在代码里是否属实
- 已有实现解决到了哪一步
- 剩下的问题该怎么处理
- 建议按什么顺序落地

本文覆盖的代码范围主要是：

- `services/retrieval-runtime/src/`
- `services/storage/src/`
- `services/memory-native-agent/src/`
- `services/visualization/src/`

## 1.1 执行约定

从这一版开始，文档同时作为整改执行清单使用。

- 状态只用三种：`未提交`、`进行中`、`已完成`
- 每完成一项，都回写：
  - 对应状态
  - 对应单测
  - 对应提交记录
- 若某一项依赖前置项，必须等前置项完成后再改

## 1.2 执行总表

| 编号 | 标题 | 状态 | 依赖前置 | 计划顺序 | 对应单测 | 提交记录 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | 读模型投影延迟，写后读不到 | 未提交 | 5 | 第 8 批 | 待补 | 待补 |
| 2 | `Embedding` 缺失，语义检索静默失败 | 已完成 | 无 | 第 5 批 | `services/retrieval-runtime/tests/runtime-service.test.ts` | `fix(retrieval-runtime): add lexical fallback for pending embeddings` |
| 3 | 冲突感知召回缺失 | 未提交 | 4 | 第 10 批 | 待补 | 待补 |
| 4 | 写回幂等键太脆弱，语义重复 | 未提交 | 无 | 第 9 批 | 待补 | 待补 |
| 5 | 会话级状态全在内存，进程重启归零 | 未提交 | 无 | 第 7 批 | 待补 | 待补 |
| 6 | `LLM + Embedding` 同时挂时宿主降级感知不足 | 未提交 | 2 | 第 6 批 | 待补 | 待补 |
| 7 | `Quality assessor` 失败后全量放行 | 已完成 | 无 | 第 1 批 | `services/retrieval-runtime/tests/runtime-service.test.ts`；`services/retrieval-runtime/tests/writeback-quality-assessor.test.ts` | `fix(retrieval-runtime): tighten quality assessor fallback` |
| 8 | `pending_confirmation` 缺少用户与运营闭环 | 未提交 | 3 | 第 11 批 | 待补 | 待补 |
| 9 | `session` 级 `episodic` 缺少生命周期管理 | 未提交 | 无 | 第 12 批 | 待补 | 待补 |
| 10 | 注入预算贪心导致类型饥饿 | 已完成 | 无 | 第 4 批 | `services/retrieval-runtime/tests/remediation.test.ts`；`services/retrieval-runtime/tests/runtime-service.test.ts` | `fix(retrieval-runtime): reserve injection slots for task state` |
| 11 | `episodic` 半衰期比 `task_state` 长 | 已完成 | 无 | 第 2 批 | `services/retrieval-runtime/tests/runtime-service.test.ts` | `fix(retrieval-runtime): rebalance memory recency decay` |
| 12 | 历史引用关键词太窄 | 已完成 | 无 | 第 3 批 | `services/retrieval-runtime/tests/runtime-service.test.ts` | `fix(retrieval-runtime): widen history reference matching` |
| 13 | 维护 worker 轮询导致冲突处理延迟不可控 | 未提交 | 8 | 第 13 批 | 待补 | 待补 |
| 14 | 治理 `verifier` 阻塞缺少升级和告警 | 未提交 | 8 | 第 14 批 | 待补 | 待补 |
| 15 | 记忆溯源信息不足 | 未提交 | 4 | 第 15 批 | 待补 | 待补 |

## 1.3 修复顺序说明

当前按下面顺序推进：

1. 先修低耦合、直接影响后续数据质量的项：`7 -> 11 -> 12 -> 10`
2. 再修检索降级与宿主联动：`2 -> 6`
3. 再修状态持久化与写后读一致性：`5 -> 1`
4. 再修语义去重和冲突链路：`4 -> 3 -> 8`
5. 最后补生命周期、运维与审计：`9 -> 13 -> 14 -> 15`

## 2. 先给总判断

这 15 个点里，可以分成三类：

### 2.1 已经部分处理，但还不够完整

- 读模型投影延迟后的会话常驻刷新
- `embedding`（向量）失败后的补刷
- `pending_confirmation`（待确认）状态本身
- 多轮重复注入去重
- 治理执行与 `verifier`（复核器）状态展示

### 2.2 问题判断方向是对的，但要修正口径

- “冲突记录可能同时被注入”这条，在默认主链路里并不完全成立，因为 `query-engine` 只查 `status=active`，而当前自动冲突路径会把旧记录改成 `pending_confirmation` 或 `superseded`，新记录要么是 `pending_confirmation`，要么新旧只保留一条 `active`
- 真正要补的是“冲突感知召回”和“关系扩展不要把弱冲突重新带回”
- “LLM + Embedding 同时挂完全静默”也要修正成：runtime 会返回 `degraded`，但宿主目前没有把这种降级明确升格成用户可见的告警

### 2.3 仍然是实质缺口

- 写后读一致性没有闭环
- 无 `embedding` 时缺少召回兜底
- 幂等键和语义去重不稳
- 关键去重状态只放 runtime 内存
- 质量门失败直接放行
- `session scope` 的 `episodic`（会话级事件记忆）缺少生命周期管理
- 注入预算仍是单路贪心
- 触发词覆盖面不够
- 维护轮询和治理阻塞缺少更强运营闭环
- 记忆溯源信息不够

## 3. 逐条处理

## 3.1 数据一致性

### 1. 读模型投影延迟，写后读不到

**现状确认**

- 这个问题属实。
- `storage` 写回先入私有表，再通过 `memory_read_model_refresh_jobs` 异步投影到读模型。
- `retrieval-runtime` 的 `query-engine` 只查读模型。
- `memory-native-agent` 已经有 `residentMemoryDirty` 机制：一轮里如果写回候选包含 `fact_preference` 或 `task_state`，会把常驻层标脏，并在下一轮开始前重新做一次 `session_start` 召回。
- 但这次刷新并不等待读模型投影完成，所以确实可能刷新到旧快照。

**怎么处理**

建议分两步做，不要一步做成强同步写读模型。

第一步，补“投影完成确认”：

- `storage` 在写回响应里继续返回 `job_id`，同时让 `retrieval-runtime` 记录“哪些候选会影响常驻层”
- `memory-native-agent` 标脏后，不是下一轮无条件立刻刷新，而是先查询这些 `job_id` 对应的写回状态和读模型刷新状态
- 只有当对应记录已经 `write job succeeded + refresh job succeeded`，才替换常驻层
- 若未完成，继续沿用旧常驻层，但把会话状态保留在 `dirty_pending_projection`

第二步，补“短窗读写一致性兜底”：

- 在 runtime 增加一个 `recent_write_overlay`（近期写入覆盖层）
- 数据来源不是宿主内存，而是 `storage` 的写回结果或本地 `outbox`
- 查询阶段如果检测到“本轮刚写入但读模型未 ready”，在注入前把这批记录作为覆盖候选并入排序
- 这层只保留短 TTL，比如 2 到 5 分钟，避免变成第二套事实来源

**落地建议**

- 优先做第一步，因为这能直接修正当前常驻层脏刷新拿旧值的问题
- 第二步只覆盖“写后立刻问”的短窗，不承担长期查询职责

### 2. `Embedding` 缺失，语义检索静默失败

**现状确认**

- 问题成立。
- `storage` 的 `ReadModelProjector` 在生成向量失败时，会把读模型条目标成 `embedding_status = pending`，并且 worker 会继续 `refreshPendingEmbeddings()` 补刷。
- 但 `retrieval-runtime` 查询侧目前不读取 `embedding_status`，也没有“无向量时改走关键词匹配”的兜底。
- `query-engine` 现在的行为是：`summary_embedding` 为空时，`semantic_score = 0`，其余分数照常算。
- 这不是完全不可见，但对依赖语义相似度的召回，确实会显著吃亏。

**怎么处理**

这里不要只改 storage，要同时改 query。

建议这样收：

- 在读模型查询结果里显式带回 `embedding_status`
- `query-engine` 对 `embedding_status != ok` 的记录启用降级检索分支：
  - 先做轻量词项匹配，至少比纯 0 分更合理
  - 词项来源只用 `summary`，首版不展开到 `details`
- 词项匹配分可以作为 `fallback_semantic_score`
- 最终排序改成：
  - 有向量就用向量分
  - 无向量但命中词项就用 fallback 分
  - 两者都没有才是 0

同时补可观测性：

- `prepareContext` 返回里增加“本次命中的候选里多少条 `embedding pending`”
- visualization 增加“可读但不可语义搜”的积压指标

**落地建议**

- 这是 P0 到 P1 之间的问题，优先级高于“继续优化补刷速率”
- 因为当前补刷链路已经存在，真正缺的是查询端兜底

### 3. 冲突记录可能同时被注入

**现状确认**

- 按当前默认主链路，这个问题不完全成立。
- `query-engine` 构造查询时固定 `status_filter = ["active"]`。
- `storage` 当前冲突处理：
  - 自动可覆盖时：旧记录改 `superseded`，新记录插成 `active`
  - 不能自动覆盖时：旧记录改 `pending_confirmation`，新记录也进 `pending_confirmation`
- 所以默认查询不会把两条冲突记录一起查出来。

**真实风险**

真实缺口有两个：

- runtime 不理解“某条 `active` 记录当前处于开放冲突环境里”
- `expandCandidatesWithRelations()` 会从 relation 扩展相关记录，虽然它也过滤 `status=active`，但没有 relation 级别的冲突降权或禁止注入策略

**怎么处理**

建议补“冲突感知召回”，不是补一层简单过滤。

- 在 `storage` 提供一个按 `record_id` 回看开放冲突的能力，或直接把 `has_open_conflict` 投影进读模型
- `query-engine` 对 `has_open_conflict=true` 的候选降权
- `injection-engine` 默认不注入冲突中的偏好类记忆，除非本轮触发原因就是“冲突提醒”或用户明确在问这类历史偏好
- relation 扩展得到的记录也要带同样的冲突标记，不然会绕开主查询过滤

**落地建议**

- 这项不需要改写现有冲突写回逻辑，主要是补读取侧元数据
- 常驻层恢复时同样要尊重冲突标记，避免把“开放冲突中的偏好”放成 session 常驻

### 4. 写回幂等键太脆弱，语义重复

**现状确认**

- 问题成立。
- runtime 的 `idempotency_key` 现在主要由 `workspace_id + user_id + session_id/task_id + candidate_type + scope + normalized summary + source_ref` 组成。
- 这能挡住“同一轮同一句被重复提交”，但挡不住“说法稍微改了但语义一样”。
- storage 虽然还有 `dedupe_key`，其中 `fact_preference` 已经按 `subject + predicate_semantic` 做了一层语义规整，但这个提取依赖规则字段，稳定性有限。

**怎么处理**

这里要明确两层职责：

- `idempotency_key` 负责请求级幂等
- `dedupe_key` 负责语义归并

不要再试图让 `idempotency_key` 同时承担两件事。

建议调整：

- 保留现有 `idempotency_key` 作为请求幂等键，不再增强语义含义
- 把 `dedupe_key` 升级成显式字段治理对象
- 对 `fact_preference` 单独引入稳定的规范化结构：
  - `subject`
  - `predicate_canonical`
  - `polarity`
  - `object` 或 `value`
- `storage normalizer` 以这组结构为准生成 `dedupe_key`
- runtime 规则抽取和 LLM 抽取都向这组结构对齐

在此基础上再补一层维护治理：

- 对老数据跑一次“重复偏好聚合”维护任务
- 相同 `canonical key` 的记录自动提 `merge` 或 `summarize`

**落地建议**

- 先统一 `fact_preference` 的 canonical 结构，再谈更复杂的语义去重
- 不建议直接上向量去重主导写入，这会让写入变得不可解释

## 3.2 并发与故障

### 5. 会话级状态全在内存，进程重启归零

**现状确认**

- 问题成立，但要分层看。
- `retrieval-runtime` 里的 `sessionPrepareQueues`、`inflightPrepareContexts`、`recentInjectionContexts`、`recentInjections`、`relatedMemoryCache` 都是进程内 `Map`
- `multi-turn dedup` 方案落地后，最近注入状态也在这套内存里
- `memory-native-agent` 的常驻记忆则在 runner 实例内存里

**怎么处理**

不要把所有内存状态都持久化，应该按用途拆。

建议分成三类：

- 必须持久化的正确性状态
  - `recentInjections`
  - 宿主常驻层的 `dirty` 状态
  - 可选地包括常驻层当前快照版本
- 可以继续仅内存的性能状态
  - `relatedMemoryCache`
  - `inflightPrepareContexts`
- 可以跨实例但不必持久化历史的串行控制状态
  - `sessionPrepareQueues`

具体做法：

- 在 runtime 新增小表，例如 `runtime_recent_injections`
- 主键至少包含 `session_id + record_id`
- 存 `memory_type / injected_at / turn_index / trace_id / source_phase`
- 用 TTL 清理

宿主侧：

- `memory-native-agent` 的常驻快照不要只留在 runner 内存
- 当前仓库已有 `session-store`（SQLite），可以把 `resident_memory` 和 `resident_memory_dirty` 落进去
- 这样单进程重启后，至少同宿主实例可以恢复会话常驻层

多实例场景：

- runtime 的最近注入状态查共享库
- 宿主若未来横向扩展，再决定是否把 session-store 继续本地化还是迁共享存储

**落地建议**

- P0 只持久化 `recentInjections`
- 宿主常驻层持久化放 P1，因为它只影响体验，不像注入去重那样直接影响正确性

### 6. `LLM + Embedding` 同时挂，触发引擎瘫痪

**现状确认**

- 问题方向成立。
- 当前 `before_response` 先走 `recallSearchPlanner`，失败会退到 `semanticFallbackDecision`
- 如果语义触发也因为 `embeddings` 或 `read_model` 降级，最终返回的是 `hit=false, trigger_type=no_trigger, degraded=true`
- 所以不是完全无信号，而是这个降级只体现在 runtime 返回里，宿主不会把它转成明确的用户可见提示

**怎么处理**

这里要补的是“强降级策略”，不是简单再多加一些触发词。

建议：

- 当 `before_response` 因依赖不可用而 `degraded=true` 且 `trigger=false` 时，新增一种明确结果类型，比如 `degraded_skip`
- 宿主收到这个状态后，至少做两件事：
  - 记录 UI 或 trace 级别的告警
  - 对显式历史引用输入，给出“记忆查询当前降级”的提示，而不是像普通 `no_trigger` 一样沉默

同时补一个最小兜底：

- 如果输入命中“强历史引用词”或“继续上次任务”这类规则，但依赖降级，仍允许发出一次低成本的关键词查询
- 关键词查询只走 `summary ilike` 或简化匹配，不依赖 embedding

**落地建议**

- 先补状态区分和宿主告警
- 再补关键词级兜底查询

### 7. `Quality assessor` 失败，垃圾记忆直接入库

**现状确认**

- 问题属实。
- `writeback-engine.applyQualityAssessment()` 现在是：
  - 若 `qualityAssessor` 成功，按分数过滤或改状态
  - 若失败，直接 `return result`
- 也就是质量门失败时，未评估候选全量放行

**怎么处理**

这里不应该继续“失败即放行”，而应该改成分级降级。

建议改成：

- 规则抽取候选和 LLM 新增候选分开处理
- 当质量门失败时：
  - 规则抽取候选可以放行，但仍要经过更严格的固定规则过滤
  - LLM 新增候选默认不放行，或最多只允许 `fact_preference` 且满足高重叠度和高置信度

也可以更简单：

- 给每个候选打 `extraction_method`
- `quality assessor` 失败时：
  - `rules` 通过
  - `llm` 只保留 `keep/merge` 修正已有规则候选
  - `llm_new` 直接丢弃

**落地建议**

- 这是 P0
- 因为脏数据一旦入库，会长期污染后续召回

## 3.3 产品逻辑

### 8. `pending_confirmation` 是死状态

**现状确认**

- 这条现在是“部分成立”。
- 当前仓库已经有：
  - storage 的 `confirmRecord` 和 `resolveConflict`
  - visualization 的记忆详情页治理面板，能手工确认、失效、归档、删除
  - 治理执行页也能看到 `proposed/verified/executed` 等状态
- 但你说的核心问题仍然存在：没有面向最终用户的“待确认记忆队列”与提示流程，系统不会主动把“这条新偏好还没被接受”讲出来

**怎么处理**

建议分成两条线：

- 运营线
  - visualization 增加 `pending_confirmation` 的专门视图和数量告警
  - 冲突页直接展示“旧记录 / 新记录 / 建议操作”
- 交互线
  - 宿主在检测到本轮产生了 `pending_confirmation` 的偏好冲突时，返回一条简短系统提示
  - 比如“检测到偏好冲突，新偏好已暂存待确认”

更进一步：

- 对用户明确改口的场景，可以在 runtime 写回候选里带更强的 `confirmed_by_user` 或“replace previous preference”信号
- 这样很多冲突可以直接自动 supersede，而不是进入待确认

**落地建议**

- 先把 visualization 的待确认队列补出来
- 再决定是否把确认流程前移到宿主交互层

### 9. `Session scope` 的 `episodic` 没有生命周期管理

**现状确认**

- 问题成立。
- 当前 `session` 作用域的 `episodic` 写入后默认长期保留，只有人工治理才会退出默认活跃状态。
- 注入去重方案只控制“近期别重复注入”，不处理“历史上已经没价值的会话事件”。

**怎么处理**

这里最好不要给所有记忆统一 TTL，而是按类型和 scope 处理。

建议：

- 只给 `scope=session + memory_type=episodic` 引入默认 TTL
- 例如：
  - 7 天后自动转 `archived`
  - 或 session 结束后若超过 N 天未使用，转 `archived`
- `task_state` 不走同样规则，因为它应由任务关闭、替代或治理来结束

实现路径：

- storage 增加 `expires_at` 字段，先只对 session episodic 填充
- maintenance worker 扫到过期记录时自动归档

**落地建议**

- 这是 P1
- 因为它更多影响检索质量和存量膨胀，不像前面几项那样会直接造成写后读错觉

### 10. `Token` 预算贪心分配，类型饥饿

**现状确认**

- 问题成立。
- `injection-engine` 现在先按 `fact_preference > task_state > episodic` 排序，再按总 token 和条数上限贪心填充。
- 虽然 `memory-native-agent` 已经把注入内容分成 `high / medium / summary` 三层显示，但底层被送进 `injection_block` 的记录还是先由 runtime 单路贪心选出来。

**怎么处理**

建议改成“先分桶，再桶内排序”。

- 对 `before_response`：
  - `fact_preference`
  - `task_state`
  - `episodic`
  三个桶各自有最小保底预算
- 例如首版可先按记录数保底：
  - 至少 1 条 `task_state`
  - 至少 1 条高价值 `fact_preference`
  - `episodic` 只在还有预算时补

如果要和常驻层联动：

- 常驻层单独预算，不与增量预算共吃一个上限
- 否则“常驻 + 增量共享预算”仍然会把问题带回来

**落地建议**

- 先做“按记录数的分桶保底”
- 不必第一步就把 token 预算做成很复杂的线性规划

### 11. `Episodic` 的衰减半衰期比 `task_state` 长

**现状确认**

- 问题属实。
- 当前 `query-engine` 里：
  - `task_state = 14 天`
  - `episodic = 30 天`
- 这意味着较旧的事件记忆会比略旧的任务状态掉得更慢。

**怎么处理**

这里建议直接改，不需要再长时间讨论。

- `task_state` 应该比 `episodic` 更耐用，至少在任务仍可能恢复的时间窗内如此
- 比较稳的首版：
  - `task_state = 30 天`
  - `episodic = 7 到 14 天`
- 或者更严格一点：
  - `task_state` 看是否存在 `task_id`，有任务时半衰期更长

**落地建议**

- 这是一个低成本高收益改动
- 先改常量，再观察轨迹

### 12. 触发引擎的历史引用关键词太窄

**现状确认**

- 问题成立。
- 当前硬编码词只有少量中文和英文短语，比如“上次、之前、你还记得、偏好、last time、previously”。
- `allow_recent_replay` 的破窗条件也复用了这套窄词表。

**怎么处理**

不要继续在代码里堆散词，建议收成一处单一配置。

- 抽一个 `history_reference_patterns` 常量模块
- 至少补：
  - 中文：`上周`、`前几天`、`之前提过`、`我们讨论过`、`还记得吗`、`沿用之前`
  - 英文：`earlier`、`we discussed`、`as before`、`remember when`
- 同时把“继续上次任务”“延续刚才那个”这类任务恢复词单列成一组，不完全依赖历史词表

更重要的是：

- 让 `replay escape` 和 `history trigger` 共用同一来源词表
- 不要一边扩触发，一边忘了扩重放破窗

**落地建议**

- 这是 P1
- 改动很小，但对体验很敏感

## 3.4 可运营性

### 13. 维护 worker 是轮询制，冲突处理延迟不可控

**现状确认**

- 问题成立。
- `WritebackMaintenanceWorker` 现在按 workspace checkpoint 和时间间隔轮询。
- 这对存量治理没问题，但对新冲突的处理延迟确实不可控。

**怎么处理**

建议把“治理扫描”和“冲突优先处理”拆开。

- 保留现有轮询 worker 负责存量维护
- 新增一条轻量优先通道：
  - 一旦写回产生 `open conflict` 或 `pending_confirmation`
  - 立刻把对应 workspace 或 conflict id 放进高优先队列
  - maintenance worker 下一轮优先处理这批

如果不想上新队列，最小实现也可以是：

- 维护 `urgent_since` 字段
- `selectWorkspaces()` 时优先取最近产生开放冲突的 workspace

**落地建议**

- 首版不必做复杂事件总线
- 只要把“新冲突优先于普通轮询”做出来，体验就会明显改善

### 14. 治理验证器是阻塞式的，`LLM` 不可用时冲突永远不解决

**现状确认**

- 问题方向成立。
- 当前高影响治理动作要求 `verifier approve`
- `maintenance-worker` 在 `verifier` 不可用时会跳过高影响动作，不会误执行
- 但后续确实缺少：
  - 超时升级
  - 人工处理告警
  - 自动降级流转

**怎么处理**

这里要坚持“安全优先”，不能因为 verifier 挂了就自动执行高影响动作。

建议：

- 维持当前“不误执行”的底线
- 但给 `proposed` 状态加 SLA
- 超过阈值的 proposal：
  - 进入 `stalled_verification`
  - 或保留 `proposed`，但单独打 `verification_overdue=true`
- visualization 治理页补筛选和告警
- metrics 补：
  - `governance_proposed_age_p95`
  - `verification_blocked_count`

如果业务上必须推进：

- 只允许低影响动作在 verifier 不可用时继续
- 高影响动作仍必须人工或模型复核

**落地建议**

- 先补观测和告警
- 不建议把高影响动作改成自动降级执行

### 15. 没有记忆溯源，无法排查“为什么记了这个”

**现状确认**

- 问题成立，而且当前契约还有限制。
- 现在记录里主要只有：
  - `source_type`
  - `source_ref`
  - `created_by_service`
- `details` 和 `evidence` 被 schema 明确限制为不能存原始 transcript 类内容。

这说明当前系统是有意避免把整段对话原文直接塞进记忆记录里的。

**怎么处理**

这里不要直接把“原始对话全文”塞回 `memory_records.details_json`。

建议走引用式溯源：

- 在写回候选里新增一组轻量溯源字段，例如：
  - `source_turn_id`
  - `source_message_role`
  - `source_excerpt`
  - `extraction_basis`
- `source_excerpt` 只保留最小必要片段，长度严格受限，比如 120 到 200 字
- 如果担心把对话内容写进 storage 正式记录，可以把 excerpt 放在单独的审计表，不进读模型

更稳的方案是：

- 记忆正式表只保留 `source_ref`
- 新增 `memory_record_origins` 或 `memory_extraction_audit` 表
- 存：
  - `record_id`
  - `turn_id`
  - `message_role`
  - `excerpt`
  - `extractor_version`
  - `extraction_method`

这样既能追溯，也不污染读模型契约。

**落地建议**

- 首版先做“最小 excerpt + turn_id + extractor 元信息”
- 不建议直接存完整原始对话

## 4. 建议优先级

### P0

- 写后读一致性闭环
- 无向量召回兜底
- 幂等键与语义去重职责拆分
- 最近注入状态持久化
- 质量门失败不再全量放行

### P1

- `pending_confirmation` 运营与交互闭环
- `session episodic` 生命周期
- 注入预算分桶
- 半衰期调整
- 历史引用词表扩充
- 新冲突优先处理
- 治理阻塞告警
- 轻量溯源审计

### P2

- 宿主常驻层持久化
- 更复杂的近期写入覆盖层
- 更精细的 verifier 流转状态

## 5. 推荐落地顺序

建议按四批做，不要把所有改动混成一次大重构。

### 第一批：先修“用户立刻能感知到错”的问题

- 写后读一致性闭环
- 无向量召回兜底
- 质量门失败降级收紧
- 最近注入状态持久化

### 第二批：再修“长期会越来越脏”的问题

- `fact_preference` canonical key
- `session episodic` TTL
- 半衰期调整
- 注入预算分桶

### 第三批：补产品闭环

- `pending_confirmation` 列表与提示
- 历史引用词表扩充
- 冲突感知召回
- 新冲突优先治理

### 第四批：补运营和审计

- verifier 阻塞告警
- 治理超时视图
- 记忆溯源审计表

## 6. 最后结论

这批问题里，最核心的不是某一个规则写错，而是当前系统还缺三条真正的闭环：

- 写回成功以后，什么时候算“可读可用”
- 降级发生以后，怎么让宿主和用户知道系统正在降级
- 记忆产生以后，怎么避免脏数据长期留存和无法追溯

按当前仓库状态，优先把这三条闭环补上，收益会高于继续堆更多召回和治理策略。
