# retrieval-runtime 模块内部机制

## 1. 文档目的

这份文档用于**理解**当前 `services/retrieval-runtime/` 的运行机制：

- 模块做了什么事
- 记忆如何被召回（recall + injection）
- 记忆如何被写回（writeback）
- 内部子模块怎么协作
- 降级时会发生什么

只描述**现状**，不讨论改进建议。改进建议见 `retrieval-runtime-improvement-proposals.md`。

不是服务设计文档（那是 `retrieval-runtime-service-design.md`），也不是实现规范（那是 `retrieval-runtime-implementation-spec.md`）。这份文档的定位是**阅读向导**：帮第一次接触这个模块的人快速建立心智模型。

## 2. 模块在产品里的位置

```
┌─────────────────────────────────────────────────────────────┐
│  宿主（host）                                                 │
│  claude_code_plugin │ codex_app_server │ memory_native_agent │
│                                         （代码枚举值 custom_agent） │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP / JSON
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  retrieval-runtime                                          │
│                                                             │
│   trigger-engine  →  query-engine  →  packet-builder  →     │
│                                          injection-engine   │
│                                                             │
│                            ↕                                │
│                     writeback-engine                        │
│                            ↕                                │
│                     observability (runs log)                │
└────┬──────────────────────────────────────────────┬─────────┘
     │ 读：共享读模型（pg view）                      │ 写：writeback job
     ▼                                              ▼
┌─────────────────────────────┐          ┌─────────────────────┐
│  storage                     │          │  storage             │
│  memory_read_model_v1        │          │  writeback ingest    │
└─────────────────────────────┘          └─────────────────────┘
```

runtime 只做"查"和"整理"，不做"写表"。它：

- **读**：从 `storage` 发布的共享只读读模型里查候选记忆
- **排序**：用 semantic + importance + confidence + recency + scope 组合打分
- **裁剪**：按 token 预算和条数上限生成最终注入块
- **写回**：从一轮对话里抽取候选，交给 `storage` 的写回入口
- **观测**：把每一步写入 `runtime_private` 的运行轨迹表（供 `visualization` 消费）

> **宿主命名**：文档全篇用产品名 `memory_native_agent` 指代未来的 mna 宿主，但当前代码里的 `HostKind` 枚举值仍是 `custom_agent`（见 `src/shared/types.ts:1`）。两者是同一个宿主的"产品名 / 接口值"映射，首版契约里暂不改枚举值。

## 3. 核心数据对象

模块内流转的对象，从入到出依次是：

```
TriggerContext   →   TriggerDecision   →   RetrievalQuery   →   CandidateMemory[]
    宿主请求入参         这轮要不要查、查什么     给读模型的结构化查询       读模型返回的候选
                                                                       ↓
                                                              MemoryPacket
                                                                       ↓
                                                              InjectionBlock
                                                                     交给宿主
```

对应写回侧：

```
FinalizeTurnInput  →  CandidateDraft[]  →  WriteBackCandidate[]  →  SubmittedWriteBackJob[]
   宿主请求入参            规则/LLM 抽取        规范化 + 幂等键          storage 返回的受理状态
```

对象定义在 `services/retrieval-runtime/src/shared/types.ts`。

## 4. 内部子模块职责

| 目录 | 职责 | 入口 |
| :--- | :--- | :--- |
| `trigger/` | 决定本轮要不要召回、用什么范围 | `TriggerEngine.decide(context)` |
| `query/` | 读共享读模型、向量打分、rerank | `QueryEngine.query(context, decision)` |
| `injection/` | 组装记忆包、按预算裁剪、输出注入块 | `buildMemoryPacket()`、`InjectionEngine.build()` |
| `writeback/` | 抽取候选、幂等化、提交 storage | `WritebackEngine.submit(input)` |
| `observability/` | 写轨迹表（turn / trigger / recall / injection / writeback） | `RuntimeRepository.record*()` |
| `dependency/` | 所有外部依赖调用的统一超时 + 降级包装 | `DependencyGuard.run(name, ms, fn)` |
| `host-adapters/` | 把不同宿主的入参映射成统一 `TriggerContext` | `hostAdapters[host].toTriggerContext()` |
| `shared/` | 类型、工具函数（归一化、余弦相似度、token 估算） | — |

总调度者是 `src/runtime-service.ts` 的 `RetrievalRuntimeService`，对应三条对外方法：
`prepareContext` / `sessionStartContext` / `finalizeTurn`。

## 5. 召回链路（prepareContext）

### 5.1 时序图

```
宿主          app.ts              runtime-service         trigger      query       packet     injection    repository
  │               │                     │                    │            │            │          │            │
  │ POST /v1/...  │                     │                    │            │            │          │            │
  ├──────────────►│                     │                    │            │            │          │            │
  │               │ zod parse + host    │                    │            │            │          │            │
  │               │ adapter             │                    │            │            │          │            │
  │               ├────────────────────►│                    │            │            │          │            │
  │               │                     │ resolveMemoryMode  │            │            │          │            │
  │               │                     │ + trace_id = uuid  │            │            │          │            │
  │               │                     ├──────────────────────────────── recordTurn ──────────────────────────►│
  │               │                     │                    │            │            │          │            │
  │               │                     ├───── decide ──────►│            │            │          │            │
  │               │                     │                    │ phase rule │            │          │            │
  │               │                     │                    │ + cooldown │            │          │            │
  │               │                     │                    │ + keyword  │            │          │            │
  │               │                     │                    │ + semantic │            │          │            │
  │               │                     │                    │   fallback │            │          │            │
  │               │                     │◄─── decision ──────┤            │            │          │            │
  │               │                     ├────────────── recordTriggerRun ───────────────────────────────────────►│
  │               │                     │                    │            │            │          │            │
  │               │                     │  if !hit: record empty runs, return injection_block=null              │
  │               │                     │                    │            │            │          │            │
  │               │                     ├─────────── query(context, decision) ────────►│            │          │            │
  │               │                     │                    │            │ searchCandidates (read│model)     │            │
  │               │                     │                    │            │ + embed  query         │          │            │
  │               │                     │                    │            │ + rerank               │          │            │
  │               │                     │◄──── { candidates, degraded } ──┤            │          │            │
  │               │                     ├─────────── buildMemoryPacket ──────────────►│          │            │
  │               │                     │◄──── MemoryPacket ──────────────────────────┤          │            │
  │               │                     ├────────────── recordRecallRun ──────────────────────────────────────►│
  │               │                     ├─────────── injectionEngine.build ───────────────────────►│            │
  │               │                     │◄──── InjectionBlock ──────────────────────────────────────┤            │
  │               │                     ├────────────── recordInjectionRun ──────────────────────────────────────►│
  │               │                     │                    │            │            │          │            │
  │               │◄─ PrepareContext    │                    │            │            │          │            │
  │               │   Response          │                    │            │            │          │            │
  │◄──── 200 ─────┤                     │                    │            │            │          │            │
```

### 5.2 trigger-engine 决策表

`TriggerEngine.decide(context)` 按下面顺序判断（先命中先返回）：

```
phase == after_response ────► hit=false（公开 schema 允许宿主用这个 phase 调 prepareContext，但实际会直接返回不召回）

cooldown 命中 ────► hit=false, trigger_type=cooldown_skip
  （key = session_id:phase，命中条件：同 key + normalizedInput 完全相等 + 2 分钟内）

phase ∈ {session_start, task_start, task_switch, before_plan}
  ────► hit=true, trigger_type=phase（强制触发）

phase == before_response:
  input 含历史关键词（上次 / 之前 / prefer / last time / previously / ...）
    ────► hit=true, trigger_type=history_reference
  input 过短（< 8 字符且无历史词）
    ────► hit=false, trigger_type=no_trigger
  语义兜底（embed query + sample 8 条对比）
    ────► 分数 ≥ 0.85 → hit=true, trigger_type=semantic_fallback
    ────► 否则 hit=false
```

### 5.3 scope 规划（scopePlanByPhase）

每个 phase 会规划本次该查哪些 scope：

| phase | 有 task_id | workspace_plus_global | workspace_only |
| :--- | :---: | :--- | :--- |
| session_start | — | `workspace, user` | `workspace` |
| task_start / task_switch / before_plan | 是 | `workspace, task, user` | `workspace, task` |
| task_start / task_switch / before_plan | 否 | `workspace, user` | `workspace` |
| before_response | 是 | `workspace, task, session, user` | `workspace, task, session` |
| before_response | 否 | `workspace, session, user` | `workspace, session` |
| after_response | — | `[]`（不召回） | `[]`（不召回） |

`memory_mode=workspace_only` 时**永远不召回 `scope=user`**，确保工作区隔离。

### 5.4 requested_memory_types

每个 phase 优先召回的记忆类型：

| phase | memory_type 列表 |
| :--- | :--- |
| session_start | `fact_preference`, `task_state` |
| task_start / task_switch | `task_state`, `episodic`, `fact_preference` |
| before_plan | `fact_preference`, `task_state` |
| before_response | `fact_preference`, `task_state`, `episodic` |
| after_response | `[]` |

### 5.5 query-engine 打分公式

`query-engine.ts` 对读模型返回的每一条候选打分：

```
rerank_score = semantic_score  × 0.45
             + importance/5    × 0.25
             + confidence      × 0.15
             + recency         × 0.10     # 30 天线性衰减，超出为 0
             + scope_boost     × 0.05
```

`scope_boost`：

```
task      1.00  （且 context.task_id 存在）
workspace 0.90
user      0.80
其他      0.60  （含 session，参见改进建议 #2）
```

embedding 失败时 `semantic_score=0` 但不中断——其他分量照常加权，结果标记 `degraded=true`。

### 5.6 packet-builder 生成记忆包

`buildMemoryPacket()` 的产出：

```
MemoryPacket {
  packet_id,              # 新 UUID
  trigger,                # 从 decision 复制的 trigger_reason
  memory_mode,
  requested_scopes,       # trigger 规划要查的
  selected_scopes,        # 实际命中的
  scope_reason,
  query_scope,            # 可读字符串，供 observability 展示
  records: CandidateMemory[],     # 原样保留 query 输出
  packet_summary,                  # 英文拼装："fact_preference: ...; task_state: ..."
  injection_hint,                  # 固定三选一：current task continuation / background constraints / historical reference
  ttl_ms: 300000,                  # 5 分钟
  priority_breakdown: {fact_preference:N, task_state:N, episodic:N}
}
```

### 5.7 injection-engine 最终裁剪

```
输入：MemoryPacket.records
按优先级排序：
  memory_type 优先（fact_preference=0 < task_state=1 < episodic=2）
  同类型内：importance 降序 → confidence 降序

遍历排序结果，带入预算：
  used_tokens = estimateTokens(packet_summary)
  for record in sorted_records:
    recordTokens = estimateTokens(record.summary)
    if kept.length >= INJECTION_RECORD_LIMIT（默认 3）:  trim_reason=record_limit
    elif used_tokens + recordTokens > INJECTION_TOKEN_BUDGET（默认 450）: trim_reason=token_budget
    else: keep, used_tokens += recordTokens

输出：InjectionBlock {
  injection_reason,     # = packet.trigger
  memory_summary,       # = packet.packet_summary
  memory_records[],     # 保留下来的
  token_estimate,
  memory_mode,
  requested_scopes,
  selected_scopes,      # 注入后实际的 scope 集合
  trimmed_record_ids,
  trim_reasons          # ["record_limit", "token_budget", ...]
}

空包特判：records 为空 → 返回 null（上层体现为 injection_block: null）
```

### 5.8 返回给宿主

```
PrepareContextResponse {
  trace_id,
  trigger: true|false,
  trigger_reason,
  memory_packet: MemoryPacket | null,
  injection_block: InjectionBlock | null,
  degraded: boolean,
  dependency_status: DependencyStatusSnapshot,
  budget_used: token_estimate,
  memory_packet_ids: [packet_id]
}
```

## 6. sessionStartContext 特殊路径

`sessionStartContext` 是 `prepareContext` 的薄封装：

```
sessionStartContext(context)
  ↓
prepareContext({...context, phase: "session_start"})
  ↓
取 result.injection_block.injection_reason + memory_summary 拼成字符串
取第一条 memory_type=task_state 的 record.summary 作为 active_task_summary
  ↓
SessionStartResponse {
  trace_id,
  additional_context: string,     # 给 Claude Code hooks 直接塞入 prompt
  active_task_summary: string|null,
  memory_mode,
  dependency_status,
  degraded
}
```

**注意**：这个形状是为 Claude Code hooks 这种"只能塞一段文本"的宿主设计的。结构化字段（memory_records）被丢弃。对 mna 这种自己管 prompt 的宿主信息损失，参见改进建议 #4。

## 7. 写回链路（finalizeTurn）

### 7.1 时序图

```
宿主            app.ts          runtime-service       writeback           storage           repository
  │               │                     │                 │                   │                │
  │ POST /v1/...  │                     │                 │                   │                │
  ├──────────────►│                     │                 │                   │                │
  │               │ zod parse + adapter │                 │                   │                │
  │               ├────────────────────►│                 │                   │                │
  │               │                     │ findTraceId     │                   │                │
  │               │                     │ ForFinalize     │                   │                │
  │               │                     │ （优先级分支：先 turn_id，否则 thread_id，  │                │
  │               │                     │   否则 current_input，四者非同时匹配）     │                │
  │               │                     │ 找不到 → new uuid                     │                │
  │               │                     ├────────── recordTurn(after_response) ────────────────►│
  │               │                     ├────── submit ──►│                   │                │
  │               │                     │                 │ extractCandidates:│                │
  │               │                     │                 │   有 llmExtractor → LLM 抽取     │                │
  │               │                     │                 │   失败或无 → 规则抽取（正则）     │                │
  │               │                     │                 │ classifyScope（关键词分类）        │                │
  │               │                     │                 │ filter（importance≥3, conf≥0.7,   │                │
  │               │                     │                 │         summary≥4 字符,          │                │
  │               │                     │                 │         idempotency_key 去重）    │                │
  │               │                     │                 │ limit 到 WRITEBACK_MAX_CANDIDATES │                │
  │               │                     │                 ├── storageClient ──►│                │
  │               │                     │                 │                   │ ingest         │
  │               │                     │                 │◄── jobs[] ────────┤                │
  │               │                     │◄── result ──────┤                   │                │
  │               │                     ├── recordWritebackSubmission ──────────────────────────►│
  │               │◄─ FinalizeTurn      │                 │                   │                │
  │               │   Response          │                 │                   │                │
  │◄──── 200 ─────┤                     │                 │                   │                │
```

### 7.2 候选抽取：LLM 与规则双路径

```
if (llmExtractor 存在)
  try: 调 LLM 抽取
  fail / 异常 → 退回规则抽取

规则抽取（正则匹配）：
  用户输入 "我一般/我喜欢/我偏好/prefer X" → fact_preference(workspace, importance=4, conf=0.9)
  助手输出 "已确认/确定/confirmed X"       → fact_preference(workspace, importance=4, conf=0.8)
  助手输出 "下一步/todo/plan/任务状态 X"    → task_state(task, importance=4, conf=0.82)  [需要 task_id]
  助手输出含 "我会 / I will"              → episodic(task|session, importance=3, conf=0.75)
  tool_results_summary 长度 > 24          → episodic(task|session, importance=3, conf=0.72)
```

### 7.3 scope 分类（classifyScope）

即使候选本身有 scope，`classifyScope` 还会**二次纠正**：

```
task_state 类型 → 有 task_id 用 task，否则 fallback 到 workspace
fact_preference + 文本含"偏好/习惯/风格/prefer/usually/always/默认" → user
文本含"仓库/项目/repo/workspace/目录/convention/约束/规则" → workspace
episodic + 文本含"这轮/本轮/当前会话/just now/this turn/temporary" → session
文本含"任务/todo/next step/plan/progress" → 有 task_id 用 task，否则 workspace
都不命中 → workspace（保守默认，避免把不确定内容写成全局 user 记忆）
```

### 7.4 幂等键

```
idempotency_key = sha256(JSON.stringify({
  workspace_id, user_id, session_id,
  task_id|null,
  candidate_type,
  scope,
  summary.toLowerCase(),
  source_ref
}))
```

`uniqueCandidates` 按 key 去重，重复条目被标 `duplicate_candidate`。

### 7.5 过滤与限量

```
summary.length < 4             → filtered: summary_too_short
importance < 3                 → filtered: importance_below_threshold
confidence < 0.7               → filtered: confidence_below_threshold
重复 key                       → filtered: duplicate_candidate
超 WRITEBACK_MAX_CANDIDATES（默认 3）→ filtered: candidate_limit_exceeded
scope=task 但 input 没 task_id → filtered: missing_task_id:<type>
```

### 7.6 交 storage

通过 `StorageWritebackClient.submitCandidates()` 提交，走 `DependencyGuard`（800ms 超时）。

runtime 对外返回 `SubmittedWriteBackJob[]`。其中：

- `storage` 正常响应时，runtime 直接透传 `submitted_jobs`，当前正式来源状态是 `accepted` / `accepted_async` / `merged` / `rejected`
- `storage` 不可达或超时时，runtime **本地合成**一批 `dependency_unavailable` 状态的 job 条目，并把整次结果标成 `degraded=true`

也就是说，`dependency_unavailable` 是 runtime 的降级输出状态，不是 `storage` 成功响应里的正式状态。这个降级不会阻塞下一轮对话。

## 8. 降级矩阵

| 外部依赖 | 不可达时的行为 |
| :--- | :--- |
| embedding 服务（trigger 语义兜底） | 返回 `degraded=true`，该 trigger 不命中，但 phase 硬规则仍能触发 |
| embedding 服务（query 语义打分） | `semantic_score=0`，其他分量照加，`degraded=true` |
| 共享读模型（query 候选） | 返回空候选，`degraded=true`，`injection_block=null` |
| 共享读模型（trigger 语义兜底的 sample） | 同 embedding 失败路径 |
| storage 写回入口 | runtime 本地把全部 job 标成 `dependency_unavailable`，并返回 `degraded=true` |

所有降级都由 `DependencyGuard.run(name, timeoutMs, fn)` 统一包装：
- 超时 `DependencyGuard` 主动 abort 返回
- 抛错也返回 `{ok: false, error: {...}}` 而不是传递异常
- 会把依赖的可用状态更新到 `DependencyGuard.snapshot()`，通过 `/v1/runtime/health/dependencies` 暴露

## 9. 观测（observability）

每次 `prepareContext` / `finalizeTurn` 都会尝试写入 `runtime_private` 下的轨迹表。当前实现需要留意两点"按 trace_id 合并"的行为：

```
recordTurn                prepareContext 和 finalizeTurn 都会调用；
                          PG 实现走 INSERT ... ON CONFLICT (trace_id) DO UPDATE
                          （in-memory 实现也是同 trace_id 更新而不是新增），
                          所以同一 trace 下只保留一行 turn。

recordTriggerRun          仅 prepareContext 调用；
recordRecallRun           （Recall 和 Injection 记录包含 hit=false / injected=false 的空行）
recordInjectionRun        三张表当前都是 trace_id PRIMARY KEY（无 ON CONFLICT 处理），
                          同一 trace 里只落得下第一次写入，后续同 trace 的 insert 会冲突。
                          → 这也是为什么多 phase 复用 trace_id（见改进建议 I01/I11）
                            必须配套把主键改成 (trace_id, phase) 或独立 run_id。

recordWritebackSubmission 仅 finalizeTurn 调用；同样每个 trace 一行。
```

关联 key 是 `trace_id`。`visualization` 的运行轨迹页按 trace_id 聚合后展示 5 段视图。在"多 phase 复用 trace_id"的能力落地之前，mna 串行发多次 prepareContext 会让后几次的 trigger/recall/injection 写入失败（或被新 trace 分裂），这是当前结构的既定限制，不是 observability 代码的 bug。

## 10. 配置速查（`src/config.ts`）

| 键 | 默认 | 用途 |
| :--- | :---: | :--- |
| `QUERY_TIMEOUT_MS` | 800 | 读模型查询超时 |
| `EMBEDDING_TIMEOUT_MS` | 800 | embedding 调用超时 |
| `STORAGE_TIMEOUT_MS` | 800 | storage 写回调用超时 |
| `QUERY_CANDIDATE_LIMIT` | 30 | 读模型返回候选上限 |
| `PACKET_RECORD_LIMIT` | 10 | 记忆包（rerank 后）保留上限 |
| `INJECTION_RECORD_LIMIT` | 3 | 注入块最终条数上限 |
| `INJECTION_TOKEN_BUDGET` | 450 | 注入块 token 预算 |
| `TRIGGER_COOLDOWN_MS` | 120000 | trigger 冷却窗口（2 分钟） |
| `SEMANTIC_TRIGGER_THRESHOLD` | 0.85 | 语义兜底触发阈值（余弦相似度） |
| `WRITEBACK_MAX_CANDIDATES` | 3 | 单轮写回候选数上限（≤ 5） |

## 11. 文件索引

对应本文档中引用的主要实现文件：

| 内容 | 文件 |
| :--- | :--- |
| 总调度 | `src/runtime-service.ts` |
| HTTP 路由 | `src/app.ts` |
| 类型定义 | `src/shared/types.ts` |
| 宿主适配 | `src/host-adapters/*.ts` |
| 触发决策 | `src/trigger/trigger-engine.ts` |
| 查询打分 | `src/query/query-engine.ts` |
| 读模型仓库 | `src/query/read-model-repository.ts` + `postgres-read-model-repository.ts` |
| Embedding 客户端 | `src/query/embeddings-client.ts` |
| 记忆包构建 | `src/injection/packet-builder.ts` |
| 注入块构建 | `src/injection/injection-engine.ts` |
| 写回抽取 | `src/writeback/writeback-engine.ts` + `llm-extractor.ts` |
| storage 客户端 | `src/writeback/storage-client.ts` |
| 依赖守护 | `src/dependency/dependency-guard.ts` |
| 轨迹记录 | `src/observability/*.ts` |
| 配置 | `src/config.ts` |

## 12. 与外部契约的对齐

本模块的行为在下述文档里有**正式契约约束**，代码修改必须同步检查：

- `docs/memory-module-contract.md` 第 4 节：记忆记录/记忆包/写回候选字段
- `docs/memory-module-contract.md` 第 5 节：检索/注入/写回接口
- `docs/memory-module-contract.md` 第 6 / 7 / 8 / 10 节：触发规则 / 写回规则 / 上下文预算 / 冲突覆盖
- `docs/architecture-independence.md` 第 3.2 / 4 / 5 节：数据解耦 / 通信方式 / 降级
- `docs/current-phase-closure-plan.md` 第 6.2 节：phase → scope 映射与 memory_mode

如果发现实现与上述契约存在偏差，以**契约为准**：要么改代码，要么按文档回写流程（`current-phase-closure-plan.md` 第 11 节）更新契约。
