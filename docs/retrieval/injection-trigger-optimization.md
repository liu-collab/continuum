# 记忆召回前置网关与注入触发优化方案

## 概述

当前系统并不是简单地把"搜索"和"注入"绑在一起，而是存在三层决策：

1. `triggerEngine.decide()` 判断是否需要召回，`before_response` 阶段可能先调用 memory LLM 做搜索计划。
2. `queryEngine.query()` 执行读模型查询，并且当前会先调用 embedding 服务生成查询向量。
3. `injectionEngine.build()` 根据候选记录生成最终注入块，空记录时已直接返回 `null`。

本次优化的重点应从"注入触发优化"升级为"召回前置网关"：在触发 LLM 判断、embedding 和读模型查询前，先用低成本规则判断本轮是否值得进入召回链路。

## 调研结论

文档中的降本方向基本成立，但场景还不够完整，需要和现有实现对齐：

- 必须优先挡在 `triggerEngine.decide()` 的 LLM 搜索计划之前，否则只能省 embedding，省不了 memory LLM。
- 空库判断必须基于 `storage_shared_v1.memory_read_model_v1` 的可见候选，而不是写模型里的原始记录；写入成功后还要等读模型投影刷新。
- `workspace_only` 模式下排除 `user` scope 已经实现，空记录时 `InjectionEngine.build()` 返回 `null` 也已实现，不应作为主收益项重复设计。
- 现有已有 embedding 缓存、finalize 幂等缓存、同 session prepare 串行、最近注入去重；如果再做缓存，应该缓存底层候选或计划，不要缓存整个 `PrepareContextResponse`。

## 当前链路对照

### 写入链路

MNA 在回合结束后先用 `shouldFinalizeTurn()` 判断是否有稳定偏好、任务状态、重要工具事件等写回信号。满足条件后调用 runtime 的 `finalizeTurn()`：

```text
MNA after response
  -> shouldFinalizeTurn
  -> runtime finalizeTurn
  -> writebackEngine.extractCandidates
  -> storage submit write-back candidates
  -> storage merge / conflict / insert
  -> enqueue read model refresh
  -> read model projector writes memory_read_model_v1
```

因此，"有写入记录"不等于"可召回"。召回前置检查应查询读模型中当前 scope、type、status、importance 下实际可见的候选数量。

### 召回链路

`prepareContext()` 当前大致流程是：

```text
record turn
  -> triggerEngine.decide
  -> queryEngine.query
     -> embedding query text
     -> read model search
     -> rank candidates
  -> annotate open conflicts
  -> relation expansion
  -> recent injection dedup
  -> optional recall injection planner
  -> build memory packet
  -> injectionEngine.build
  -> record observability
```

高成本点主要有三个：memory LLM 搜索计划、embedding 请求、读模型搜索。前置网关应尽量在这三者之前完成。

## 推荐主方案：RecallPreflight

新增一个独立的 `RecallPreflight`，放在 `prepareContextInternal()` 记录 turn 之后、`triggerEngine.decide()` 调用之前。

它做三类廉价判断：

1. 输入级跳过：纯命令、极短确认、slash 命令、显式"不用记忆/从头开始"。
2. phase/scope/type 预估：基于 phase、task_id、memory_mode 得到默认 scope/type 计划。
3. 读模型可用性统计：按 workspace/user/session/task、scope、memory_type、status、importance 统计候选数量和 type 分布。

推荐形态：

```typescript
type RecallPreflightResult =
  | {
      should_continue: false;
      reason:
        | "short_or_command_input"
        | "memory_suppressed_by_user"
        | "no_visible_candidates"
        | "no_matching_memory_types";
      requested_scopes: ScopeType[];
      requested_memory_types: MemoryType[];
    }
  | {
      should_continue: true;
      requested_scopes: ScopeType[];
      requested_memory_types: MemoryType[];
      available_candidate_count: number;
      type_distribution: Record<MemoryType, number>;
    };
```

推荐流程：

```typescript
const preflight = await this.recallPreflight.evaluate(normalizedContext);

if (!preflight.should_continue) {
  return this.returnSkippedPrepareContext({
    reason: preflight.reason,
    requested_scopes: preflight.requested_scopes,
    requested_memory_types: preflight.requested_memory_types,
  });
}

const decision = await this.triggerEngine.decide({
  ...normalizedContext,
  preflight_scopes: preflight.requested_scopes,
  preflight_memory_types: preflight.requested_memory_types,
});
```

关键点：`triggerEngine` 里现有的 `scopePlanByPhase()` 和 `requestedTypesByPhase()` 需要抽到共享 helper，避免 preflight 和 trigger 各维护一套 phase 规则。

## 融合版落地方案

原方案里可取的部分主要有五类：输入快速跳过、空候选预检查、memory type 匹配、重复搜索复用、embedding 故障降级。融合后不把它们拆成互相独立的补丁，而是按召回链路分层落地。

### 第一层：输入与用户意图网关

合并原方案的"短输入和命令式输入跳过搜索"、"显式不用记忆信号检测"。

这一层只看当前输入，不访问数据库，不调用 LLM，不调用 embedding。命中后直接返回跳过结果，并写入完整观测记录。

```text
输入为空 / 极短确认 / 纯命令 / slash 命令
  -> 跳过召回

显式不用记忆 / 从头开始 / ignore previous context
  -> 跳过召回

历史引用 / 上次 / 之前 / 偏好 / 继续这个任务
  -> 不跳过，继续后续 preflight
```

### 第二层：读模型 availability 预检查

合并原方案的"搜索前廉价预检查"和"memory type 与实际存储内容匹配"。

这一层访问读模型，但只做 count 和 type distribution，不生成 embedding。它解决两个问题：

- 当前 scope 下没有任何可见 active 记忆：跳过后续 LLM、embedding、query。
- 请求的 memory type 在读模型中不存在：收窄 requested memory types；收窄后为空则跳过。

```text
phase + memory_mode + task_id
  -> 得到默认 scopes/types/importance
  -> estimateAvailability()
  -> count = 0: skip
  -> type distribution 收窄 types
  -> 继续 trigger decision
```

### 第三层：触发决策与搜索计划

保留现有 `triggerEngine.decide()` 的职责，但让它接收 preflight 后的 scopes/types，避免 LLM 计划一个实际没有候选的类型或范围。

这样原方案的"搜索前预检查"就不只是省 embedding，还能省掉 `before_response` 阶段的 memory LLM 搜索计划调用。

### 第四层：查询层缓存与降级

合并原方案的"同 session 重复输入复用搜索结果"、"同 turn 多阶段搜索去重"、"embedding 服务熔断"。

这里不缓存最终 `PrepareContextResponse`，只缓存底层结果：

- availability cache：同 session、同 workspace、同 scopes/types/threshold，TTL 10-30 秒。
- query candidate cache：同 session、同 query text、同 scopes/types/threshold，TTL 10-30 秒。
- embedding circuit breaker：连续失败后短时间跳过 embedding，直接走关键词候选和 fallback semantic score。

这样既能复用原方案的降本点，又不会复用旧 trace、旧 packet id 或旧注入状态。

### 第五层：注入侧保持轻量

原方案的"搜索结果为空时跳过注入构建"可以作为微优化保留，但不是主收益点。当前 `InjectionEngine.build()` 已经对空 records 返回 `null`，后续可以在 runtime-service 中提前记录 no_records，少构建一次 packet。

### 融合后主流程

```text
prepareContextInternal
  -> record turn
  -> RecallPreflight.inputGate
  -> RecallPreflight.estimateAvailability
  -> triggerEngine.decide(preflight scopes/types)
  -> query cache lookup
  -> queryEngine.query
     -> embedding circuit breaker / embedding cache
     -> read model search
  -> relation expansion
  -> recent injection dedup
  -> optional injection planner
  -> injection build
  -> record recall/injection observability
```

这个融合版保留了原方案里的有效优化点，但把执行顺序改成"先挡高成本，再做精细召回"，并且避免缓存最终响应导致观测链路失真。

## 优化项评估

### P1：输入级跳过

适合放在 `RecallPreflight` 最前面，且要早于 memory LLM 搜索计划。

建议跳过：

- slash 命令：`/skill smoke-check`
- 纯工具命令：`ls`、`pwd`、`cd foo`、`cat file`
- 短确认：`ok`、`好`、`嗯`、`是`、`否`
- 明确抑制记忆：`不用管之前的，从头来`、`ignore previous context`

不建议跳过：

- `继续这个任务`
- `按上次的方案继续`
- `之前那个接口结构沿用`
- `偏好还按之前的来`

这些输入虽然短，但它们明确依赖历史上下文。

### P1：读模型候选统计

新增 `ReadModelRepository.estimateAvailability()`，不要放在 `QueryEngine.query()` 里作为事后优化，而要放在 `triggerEngine.decide()` 之前。

统计条件应和正式查询一致：

- `status = active`
- `scope` 按 phase + memory mode + task_id 计算
- `memory_type` 按 phase 计算
- `importance >= threshold`
- workspace / user / task / session 可见性边界一致

推荐 SQL 形态：

```sql
select memory_type, count(*)::int as count
from storage_shared_v1.memory_read_model_v1
where status = any($1::text[])
  and scope = any($2::text[])
  and memory_type = any($3::text[])
  and importance >= $4
  and (
    (scope = 'workspace' and workspace_id = $5::uuid)
    or (scope = 'user' and user_id = $6::uuid)
    or (scope = 'task' and workspace_id = $5::uuid and $7::uuid is not null and task_id = $7::uuid)
    or (scope = 'session' and workspace_id = $5::uuid and session_id = $8::uuid)
  )
group by memory_type;
```

返回为空时直接跳过召回；只存在部分类型时，把后续 requested memory types 收窄到有数据的类型。

索引需要一起补，否则 count 预检可能把成本从 embedding 转移到数据库扫描上。现有 `memory_read_model_scope_idx` 是 `(workspace_id, user_id, scope, memory_type, status)`，对 workspace/task/session 类查询有帮助，但对 `scope = 'user' and user_id = ?` 这种不带 workspace_id 的全局用户记忆查询不够理想。

建议二选一：

- 查询拆成 `UNION ALL`，按 scope 分支分别命中不同索引。
- 增加 partial index，例如 `scope = 'user'` 用 `(user_id, status, memory_type, importance)`，workspace/task/session 用 `(workspace_id, status, scope, memory_type, importance)`。

如果只建 `(workspace_id, user_id, status, scope, memory_type, importance)`，user scope 查询仍可能因为最左列没有过滤而扫较多数据。

### P1：观测记录保持完整

即使 preflight 跳过，也要继续写入 `trigger_runs`、`recall_runs`、`injection_runs`，否则 dashboard 会把"主动跳过"误看成链路缺失。

建议新增明确结果：

- trigger reason：`recall_preflight_skipped:<reason>`
- recall result：`not_triggered` 或 `empty`
- injection result：`not_triggered`

### P2：同 turn 多阶段去重

可以做，但不要缓存整个 `PrepareContextResponse`。原因是 response 内含 `trace_id`、packet id、依赖状态和观测副作用，直接复用会让追踪和最近注入状态不准确。

建议只缓存这两类：

- preflight availability：同 session、同 workspace、同 scope/type/threshold 下的 count/type 分布，TTL 10-30 秒。
- query candidates：同 session、同 normalized query、同 scope/type/threshold 下的候选列表，TTL 10-30 秒。

缓存命中后仍然要生成当前 phase 自己的 `trace_id` 和观测记录。

### P2：显式不用记忆

这一项应该并入输入级 preflight，而不是放在注入阶段。用户明确说不用历史上下文时，应跳过搜索和注入，而不是搜完后再丢弃。

建议规则：

```typescript
const SUPPRESS_RECALL_PATTERNS = [
  /不用.*(之前|记忆|历史|上下文)/,
  /从头.*(来|开始|做)/,
  /重新开始/,
  /ignore.*(previous|past|memory|context)/i,
  /start.*(fresh|over|from scratch)/i,
  /forget.*(everything|all|it)/i,
];
```

### P2：embedding 熔断

现有 `DependencyGuard` 只对 memory LLM 做了冷却窗口，embedding 失败时仍会按请求尝试。可以把同样的 circuit breaker 能力扩展到 embeddings。

不过 QueryEngine 已支持 embedding 失败后降级为关键词/规则排序，因此熔断目标不是保证可用性，而是减少连续超时等待。

### P3：token 预算感知

这项拆成两步。

第一步可以先做低风险版本：MNA 把当前配置里的 `INJECTION_TOKEN_BUDGET` 或本轮可用注入预算传给 runtime，runtime 再把预算传给 `InjectionEngine.build()` 做裁剪。这不改变 MNA 侧预算计算顺序，也不影响当前先召回、后组 prompt 的流程，可以独立作为 P2。

第二步才是完整预算感知：在 MNA 调用 `prepareContext()` 前提前估算 system prompt、tools、历史消息和当前输入成本；如果剩余窗口过小，直接跳过召回。这一步会调整现有预算顺序，风险更高，放 P3。

### 不建议作为独立优化

这些点已经由现有实现覆盖，或者收益不如前置网关：

- 空候选时跳过 `InjectionEngine.build()`：当前 `build()` 已经在空 records 时返回 `null`，剩余浪费很小。
- `workspace_only` scope 剪枝：现有 `scopePlanByPhase()` 已经排除 `user`，测试也覆盖了。
- 新 workspace 前 N 轮提高门槛：容易误伤已有全局用户记忆。读模型候选统计已经能覆盖空 workspace 场景。
- 缓存整个 prepare 结果：会污染 trace、观测记录和最近注入状态。

## 原始方案保留

下面保留原方案中的优化项，作为后续拆任务时的对照。当前推荐不是删除这些方向，而是把它们重新归类到 `RecallPreflight`、查询层缓存和依赖降级里。

| 原优化项 | 原始目标 | 当前判断 |
|---|---|---|
| 搜索前廉价预检查 | 空库或无候选时跳过 embedding 和注入 | 保留，升级为读模型 availability 统计，并前移到 trigger LLM 前 |
| 短输入和命令式输入跳过搜索 | 跳过 `ls`、`ok`、slash 命令等无效召回 | 保留，合并进输入级 preflight |
| 同一 session 内重复输入复用搜索结果 | 30 秒内相同输入不重复搜索 | 调整，不缓存最终 response，只缓存 availability 或 query candidates |
| embedding 服务熔断 | 连续失败时快速降级 | 保留，建议扩展 `DependencyGuard` 对 embeddings 的冷却窗口 |
| 搜索结果为空时跳过注入构建 | 避免空包构建和 token 估算 | 已基本实现，仅作为低优先级微优化 |
| 同 turn 多阶段搜索去重 | 避免 task_start / before_plan / before_response 重复查同一批候选 | 保留，但只复用底层候选或 count，不复用 trace response |
| 新 workspace 前 N 轮提高搜索门槛 | 新用户空库阶段降本 | 不建议独立实现，容易误伤已有全局记忆，由 availability 统计覆盖 |
| 显式“不用记忆”信号检测 | 尊重用户从头开始或不用历史的意图 | 保留，合并进输入级 preflight |
| token 预算感知 | 预算不足时跳过搜索 | 暂缓，当前 MNA 是先召回后预算，需要先调整预算顺序或传入注入预算 |
| memory mode 范围剪枝 | `workspace_only` 不查 user scope | 已实现，保留测试即可 |
| memory type 与实际存储匹配 | 请求类型不存在时跳过 | 保留，合并进 availability 的 type distribution |

原方案中最有价值的部分是：空候选预检查、短输入跳过、显式不用记忆、type 分布匹配和 embedding 熔断。需要调整的部分主要是缓存边界和新 workspace 策略。

## 建议实施优先级

| 优先级 | 项目 | 位置 | 说明 |
|---|---|---|---|
| P1 | 抽出 phase scope/type helper | runtime shared helper | 让 preflight 和 trigger 共用规则 |
| P1 | 输入级 preflight | `prepareContextInternal()` 早期 | 跳过短确认、纯命令、显式不用记忆 |
| P1 | 读模型 availability 统计 | `ReadModelRepository` | count + type distribution，挡在 LLM/embedding 前 |
| P1 | 预检查询索引 | storage migration | 为 user scope 和 workspace scope 补适配索引 |
| P1 | preflight 观测记录 | runtime observability | 主动跳过也要有完整 trace |
| P2 | availability 短 TTL 缓存 | runtime service | 避免多阶段重复 count |
| P2 | 注入预算透传 | MNA + runtime contract | 先把 injection token budget 传给 runtime 裁剪 |
| P2 | embedding 熔断 | `DependencyGuard` | 连续失败时快速降级关键词搜索 |
| P2 | query 候选缓存 | query layer | 缓存候选，不缓存最终 response |
| P3 | 完整 token 预算感知 | MNA context budget | 调整 prepare 前预算估算，窗口不足时跳过召回 |

## 需求状态

| 项目 | 状态 | 验证 |
|---|---|---|
| 抽出 phase scope/type helper | done | `npm run check` in `services/retrieval-runtime` |
| 输入级 preflight | done | `npx vitest run tests/runtime-service.test.ts` |
| 读模型 availability 统计 | done | `npx vitest run tests/runtime-service.test.ts` |
| 预检查询索引 | done | `npm run check` in `services/storage` |
| preflight 观测记录 | done | `npx vitest run tests/runtime-service.test.ts` |
| availability 短 TTL 缓存 | pending | - |
| 注入预算透传 | done | `npm run check` + targeted vitest in `services/retrieval-runtime` and `services/memory-native-agent` |
| embedding 熔断 | pending | - |
| query 候选缓存 | pending | - |
| 完整 token 预算感知 | pending | - |

## 验证用例

建议至少补这些测试：

1. 空读模型时，`session_start` 不调用 embedding，也不调用 memory LLM。
2. `before_response` 输入 `ls` 时跳过召回，但输入 `继续这个任务` 不跳过。
3. `workspace_only` + 只有 user 记忆时，preflight 返回 `no_visible_candidates`。
4. `workspace_plus_global` + 只有 user 记忆时，preflight 允许继续。
5. 只有 `episodic` 记忆时，`before_plan` 因 type 不匹配跳过。
6. preflight 跳过时仍写入 trigger/recall/injection 观测记录。
7. 连续相同 availability 查询命中缓存，但两次 prepare 仍有不同 trace。
