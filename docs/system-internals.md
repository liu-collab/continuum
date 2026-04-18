# 系统模块全景与协作

## 1. 文档目的

这份文档用于**从系统视角**理解四个模块如何协作：

- 四个模块各自在产品里扮演什么角色
- 它们的代码边界在哪里
- 一条典型请求在四个模块之间怎么流转
- 哪些通信路径是允许的、哪些是被契约禁止的
- 任一模块不可达时，其他模块会怎么表现

只描述**现状**和**已规划但未实现的结构**，不讨论改进建议。各模块的改进建议见各自 `xxx-improvement-proposals.md`。

不是单模块阅读向导（那是 `storage/storage-internals.md`、`retrieval/retrieval-runtime-internals.md`、`visualization/visualization-internals.md`），也不是契约文档（那是 `memory-module-contract.md` 和 `architecture-independence.md`）。这份文档的定位是**跨模块全景**：帮第一次接触这个产品的人理解"谁在什么时候调用谁"。

## 2. 四个模块与它们的关系

### 2.1 角色速查

| 模块 | 类型 | 进程形态 | 当前状态 |
| :--- | :--- | :--- | :--- |
| `storage` | 业务服务 | Fastify HTTP (`server.ts`) + 独立 worker (`worker.ts`) | 已实现 |
| `retrieval-runtime` | 业务服务 | Fastify HTTP 单进程 | 已实现 |
| `visualization` | 业务服务 | Next.js 15 单进程（RSC + API Routes） | 已实现 |
| `memory-native-agent`（mna） | 业务服务 | Node 本地常驻，HTTP + WebSocket | 规划中（T01–T14）🔜 |

另外两个不属于"四个业务模块"但会出现在图里的角色：

| 角色 | 说明 |
| :--- | :--- |
| 浏览器 | 访问 `visualization` 前端的终端用户 |
| 其他宿主 | `claude_code_plugin`、`codex_app_server` 等调用 `retrieval-runtime` 的外部宿主，与 mna **并列**、不被 mna 取代 |
| PostgreSQL | 仅属于 `storage` 的持久层；它发布的 `storage_shared_v1` 读模型是**允许跨服务共享**的唯一数据面 |
| embedding 服务 | 外部依赖（可选）。`storage` 的读模型投影 和 `retrieval-runtime` 的语义打分都用它，但各自独立调用 |

### 2.2 部署拓扑

```
┌────────────────────────────────────────────────────────────────────────────┐
│  浏览器（终端用户）                                                          │
│                                                                            │
│   visualization 前端页面：                                                  │
│     /  /memories  /memories/:id  /runs  /dashboard   ← 现状                │
│     /agent/:sessionId                                 ← T11 规划中 🔜      │
└───────────────┬──────────────────────────────────────┬─────────────────────┘
                │ HTTP (同源)                           │ HTTP + WebSocket 🔜
                │ /api/*                                │ 浏览器直连 mna
                ▼                                       ▼
┌───────────────────────────────┐       ┌────────────────────────────────────┐
│  visualization                │       │  memory-native-agent (mna) 🔜       │
│  Next.js 单进程                │       │  Node 本地常驻                      │
│                               │       │                                    │
│  RSC Pages + API Routes       │       │  http/ + ws/  agent 主链路入口      │
│  features/*                   │       │  runner/      对话主循环             │
│  lib/server/* (server-only)   │       │  providers/   多模型适配             │
│                               │       │  tools/       fs/shell/mcp 分发     │
│  角色：观测 + 治理代理 + 壳     │       │  mcp-client/  MCP stdio/http        │
│                               │       │  memory-client/ → retrieval-runtime │
│  不参与记忆主链路              │       │  session store (SQLite, T14)       │
└────┬─────┬──────────┬─────────┘       └──────┬─────────────────────────────┘
     │     │          │                        │
     │     │          │                        │ HTTP
     │     │          │                        │ host="memory_native_agent"
     │     │          │                        │ sessionStart / prepare / finalize
     │     │          │                        ▼
     │     │          │        ┌───────────────────────────────────┐
     │     │          │        │  retrieval-runtime                │
     │     │          │        │  Fastify 单进程                    │
     │     │          │        │                                   │
     │     │          │        │  host-adapters → trigger → query  │
     │     │          │        │  → injection → writeback          │
     │     │          │        │  observability + dependency-guard │
     │     │          │        └───────┬───────────────────┬───────┘
     │     │          │                │ 只读              │ HTTP
     │     │          │                │ 共享读模型         │ writeback
     │     │          │                │                   │ candidates
     │     │          │                ▼                   ▼
     │     │          │        ┌──────────────────┐   ┌─────────────────────┐
     │     │          │        │ PostgreSQL       │◄──┤ storage             │
     │     │          ▼        │ storage_shared_v1│   │ server.ts (Fastify) │
     │     │  /v1/runtime/     │  memory_read_    │   │   • 写回入队          │
     │     │  observe/*        │  model_v1        │   │   • 治理同步执行       │
     │     │  (HTTP)           │                  │   │   • 观测 + 健康       │
     │     │                   │ storage_private  │◄──┤                     │
     │     │                   │  records         │   │ worker.ts (循环)     │
     │     │                   │  versions        │   │   • 写回 processor   │
     │     │                   │  write_jobs      │   │   • 读模型 projector │
     │     │                   │  conflicts       │   │                     │
     │     │                   │  governance_acts │   │ 外部依赖：embedding  │
     │     │                   │  refresh_jobs    │   └─────────────────────┘
     │     │                   └──────────────────┘
     │     │                            ▲
     │     │                            │ 直连 PG（只读共享 schema）
     │     │                            │ storage-read-model-client.ts
     │     │                            │
     │     └────────────────────────────┤
     │                                  │
     │    /v1/storage/observe/*         │
     │    + /v1/storage/records/:id/*   │
     │    (HTTP)                        │
     └──────────────────────────────────┘
            visualization 的其他 lib/server/* 客户端
```

🔜 = 规划中未实现。图里所有虚线涉及 mna 的路径都对应 `docs/memory-native-agent/T01–T14` 规划。

### 2.3 通信方式一览

| 源 → 目标 | 方式 | 用途 | 参考 |
| :--- | :--- | :--- | :--- |
| 浏览器 → visualization | HTTP（Next.js API） | 页面渲染 + 治理按钮 | 见本文 §4.3 |
| 浏览器 → mna 🔜 | HTTP + WebSocket | agent 对话 + 工具权限确认 + 事件流 | `memory-native-agent/T08` |
| mna → retrieval-runtime 🔜 | HTTP | `sessionStartContext` / `prepareContext` / `finalizeTurn` | `memory-native-agent/T02` |
| 其他宿主 → retrieval-runtime | HTTP | 同上（host 字段区分） | `retrieval/retrieval-runtime-service-design.md` |
| retrieval-runtime → PG | 直连 pg（**只读** `storage_shared_v1`） | 查候选记忆 | `retrieval/retrieval-runtime-internals.md` §3 |
| retrieval-runtime → storage | HTTP（写回入口） | `POST /v1/storage/write-back-candidates` | `storage/storage-internals.md` §7 |
| retrieval-runtime → embedding | HTTP | trigger 语义兜底 + query 向量打分 | `retrieval/retrieval-runtime-internals.md` §8 |
| visualization → PG | 直连 pg（**只读** `storage_shared_v1`） | `/memories` 列表与详情 | `visualization/visualization-internals.md` §5.2 |
| visualization → storage | HTTP（observe + governance） | 看板指标 + 治理动作 | `visualization/visualization-internals.md` §6 |
| visualization → retrieval-runtime | HTTP（observe） | 运行轨迹 + 指标 | `visualization/visualization-internals.md` §6 |
| storage worker → PG | 直连 pg（读写 `storage_private` + 写 `storage_shared_v1`） | 真正入库、投影读模型 | `storage/storage-internals.md` §3.2 |
| storage → embedding | HTTP | 读模型投影时算 `summary_embedding` | `storage/storage-internals.md` §7.9 |

## 3. 各模块一句话职责

### 3.1 storage —— "记忆内容本身"

负责**写**与**长久保存**：

- 接收写回候选 → 入队 → 异步规范化、去重、合并、冲突判断 → 落 `memory_records` → 投影到共享读模型 `memory_read_model_v1`
- 同步执行 6 个治理动作（patch / archive / confirm / invalidate / delete / restore-version）+ 冲突解决
- 维护私有表（`storage_private.*`）+ 对外公开的读模型（`storage_shared_v1.memory_read_model_v1`）
- 观测：`/v1/storage/observe/*` 暴露 job 状态与指标

**不做**：运行时是否触发召回、当前轮如何注入、页面展示逻辑。

细节：`docs/storage/storage-internals.md`

### 3.2 retrieval-runtime —— "记忆在什么时机、以什么形式进入上下文"

负责**查**与**整理**：

- 接收宿主请求（Claude Code hooks / Codex adapter / mna 🔜）→ `host-adapters` 统一成 `TriggerContext`
- `prepareContext`：trigger 决定是否召回 → query 读共享读模型 + 语义打分 → packet-builder 组装 → injection-engine 按 token 预算裁剪 → 返回 `InjectionBlock`
- `sessionStartContext`：`prepareContext` 的 session_start phase 薄封装，返回字符串形式 `additional_context`
- `finalizeTurn`：从一轮对话里抽取候选（LLM 或规则）→ classifyScope → 幂等化 → 交 `storage` 写回入口
- 观测：把每一步写入 `runtime_private` 轨迹表（供 visualization 按 trace_id 聚合）

**不做**：直接管理底层存储、持有 model provider API key、执行 fs/shell 工具。

细节：`docs/retrieval/retrieval-runtime-internals.md`

### 3.3 visualization —— "库里有什么、刚才为什么这么做、当前指标"

负责**展示 + 治理代理**：

- 四条读数据路径（直连 PG 读共享读模型、storage 的 observe HTTP、runtime 的 observe HTTP、storage 的治理 HTTP）
- 五个页面：`/`（概览）/ `/memories`（目录）/ `/memories/:id`（详情 + 治理面板）/ `/runs`（按 trace_id 聚合的 5 段运行轨迹）/ `/dashboard`（指标看板）
- 严格分层：`app/*` RSC/客户端组件 → `features/*` 聚合层（`server-only`）→ `lib/server/*` 各来源客户端
- 任一上游不可达时，对应页面返回 `sourceStatus` 降级提示，进程不挂
- **规划中（T11）🔜**：新增 `/agent/*` 路由作为 mna 的 UI 壳，浏览器直连 mna 的 HTTP/WS；Next.js 后端**不承接** agent 主链路业务逻辑

**不做**：直接参与运行时召回决策、绕过契约直接写记忆内容、承担模型推理。

细节：`docs/visualization/visualization-internals.md`

### 3.4 memory-native-agent（mna）—— "自主记忆 agent 宿主"🔜

规划中独立的 agent 宿主进程，与 `claude_code_plugin` / `codex_app_server` **并列**：

- 对浏览器暴露 HTTP + WebSocket（`/v1/agent/sessions`、`/v1/agent/turns`、ws 事件流）
- `runner/`：agent 主循环，协调 session_start → prepare-context → 模型推理 → 工具调用 → finalize-turn
- `providers/`：OpenAI 兼容 / Anthropic / Ollama 三类 provider
- `tools/`：内置文件工具（fs_read / fs_write / fs_edit）、白名单 shell、MCP 工具分发
- `mcp-client/`：stdio / http MCP 客户端
- `memory-client/`：封装 `retrieval-runtime` 的三个主链路接口，固定 `host="memory_native_agent"`
- `session-store` (T14)：SQLite 本地落盘（对话历史 + 工具审计 + prompt snapshot）
- 运行时管理：token 下发、workspace 路径、memory_mode 切换、provider 切换、prompt inspector

**不做**：任务编排 / subagent / 多 agent 协作（首版不做）、替代现有 Claude Code 或 Codex 宿主、自研 embedding。

规划细节：`docs/memory-native-agent/README.md` + `T01–T14`。

## 4. 端到端链路

下面四条链路是四个模块之间的主要协作路径。每条链路都以"哪个动作由谁发起 → 到哪个模块落地"的方式展开。

### 4.1 召回链路（一轮对话开始时）

```
浏览器 ── 用户输入 ──►  mna 🔜       ── POST /v1/runtime/prepare-context ──►  retrieval-runtime
                        │                host="memory_native_agent"
                        │                (也可以是其他宿主)
                        │                                                    │
                        │                                       host-adapter → TriggerContext
                        │                                                    │
                        │                                       trigger-engine.decide
                        │                                           phase / cooldown / keyword
                        │                                           / semantic fallback
                        │                                                    │
                        │                                       query-engine ──► PostgreSQL
                        │                                           SELECT FROM storage_shared_v1
                        │                                           .memory_read_model_v1
                        │                                                    │
                        │                                       query-engine ──► embedding 外部服务
                        │                                           （semantic_score，失败降级）
                        │                                                    │
                        │                                       packet-builder → MemoryPacket
                        │                                       injection-engine → InjectionBlock
                        │                                       （按 token 预算 + 条数上限裁剪）
                        │                                                    │
                        │                                       observability：trigger_run /
                        │                                       recall_run / injection_run 入库
                        │                                       （runtime_private，按 trace_id 聚合）
                        │                                                    │
                        │◄──── PrepareContextResponse ────────────────────────┤
                        │      { trace_id, injection_block, degraded, ... }  │
                        │                                                    │
                 把 injection_block 放进系统提示词 → 调模型 → 推理
```

关键边界：

- `retrieval-runtime` **只读** `storage_shared_v1.memory_read_model_v1`，绝不访问 `storage_private.*`
- `mna` 不直接访问 PG；所有记忆读取都通过 `retrieval-runtime` 的 HTTP 接口
- `visualization` 不在这条链路上

### 4.2 写回链路（一轮对话结束时）

```
浏览器 ◄── 流式输出 ──  mna 🔜       ── POST /v1/runtime/finalize-turn ──►  retrieval-runtime
                        │                { user_input, assistant_output,
                        │                  tool_results_summary, task_id, ... }
                        │                                                    │
                        │                                       writeback-engine.submit
                        │                                           extractCandidates
                        │                                           （LLM extractor 优先 → 失败回退规则抽取）
                        │                                           classifyScope（本地启发式）
                        │                                           filter（importance/confidence/长度）
                        │                                           uniqueCandidates（幂等键去重）
                        │                                                    │
                        │                                       storage-client ── HTTP ──►  storage (server.ts)
                        │                                           POST /v1/storage/        │
                        │                                           write-back-candidates    │
                        │                                                                   │
                        │                                                            normalizeCandidate
                        │                                                            （再次算 dedupe_key
                        │                                                              + candidate_hash）
                        │                                                            enqueue 到 memory_write_jobs
                        │                                                                   │
                        │                                            ◄──── { job_id, status: "accepted_async" }
                        │                                                                   │
                        │                                       observability：writeback_run 入库
                        │                                                                   │
                        │◄──── FinalizeTurnResponse ────────────────────────────────────────┤
                        │
                 ... 时间流逝 ...

         storage worker (worker.ts) 轮询 (默认 1s 一次)
            └─ claimQueuedJobs (FOR UPDATE SKIP LOCKED)
            └─ WritebackProcessor.processJob
                ├─ findByDedupeScope (storage_private.memory_records)
                ├─ decideMerge (insert_new / update_existing / merge / ignore / conflict)
                ├─ 事务内：
                │     insertRecord / updateRecord
                │     appendVersion
                │     （若冲突）insert pending + openConflict
                │     enqueueRefresh (memory_read_model_refresh_jobs)
            └─ processRefreshJobs
                ├─ ReadModelProjector.project
                │     embedding 外部服务（失败时 summary_embedding=null）
                └─ upsert 到 storage_shared_v1.memory_read_model_v1
```

关键边界：

- `retrieval-runtime` **不直接写** `storage_private.*`；写入的唯一入口是 storage 的 HTTP 写回接口
- `storage` 写回是**异步**的：HTTP 即时响应 `accepted_async`，真正入库由 worker 完成
- 读模型刷新也走队列（`memory_read_model_refresh_jobs`），**不保证秒级一致性**——这也是为什么 `/memories` 列表刷新会有轻微延迟

### 4.3 治理链路（用户在页面上点按钮）

```
浏览器 ──（用户在 GovernancePanel 点"归档"）
      ──► POST /api/memories/:id/archive
          │
          ▼
visualization API Route (app/api/memories/[id]/archive/route.ts)
          │ zod 校验
          ▼
lib/server/storage-governance-client.ts
          │
          ▼── HTTP ──►  storage (server.ts)
                         POST /v1/storage/records/:id/archive
                                │
                         GovernanceEngine.archiveRecord（同步事务）
                                ├─ records.updateRecord (status=archived, archived_at=now)
                                ├─ records.appendVersion (change_type=archive)
                                ├─ governance.appendAction (action_type=archive, actor)
                                └─ readModel.enqueueRefresh (refresh_type=update)
                                │
                                ▼
                                等待 worker 异步刷新 memory_read_model_v1
                                │
                    ◄──── { ok, data: updatedRecord }
          │
          ▼
浏览器收到响应 → router.refresh() → RSC 重新请求 → 列表显示更新后的状态
（注意：read model 异步刷新，可能存在短暂延迟）
```

6 个治理动作 + 冲突解决都走这条路径。`visualization` 在这里只是一个**透传代理**：接收点击、校验、转成 storage 的正式 HTTP 请求、把结果包回浏览器。它**不自己改数据库**。

### 4.4 观测链路（看"刚才为什么这么做"）

```
浏览器 ──（访问 /runs?turn_id=xxx）
      ──► visualization RSC 页面 (app/runs/page.tsx)
          │
          ▼
features/run-trace/service.ts
          │
          ├─ lib/server/runtime-observe-client.ts ── HTTP ──►  retrieval-runtime
          │      GET /v1/runtime/observe/runs
          │        返回 { turns, triggerRuns, recallRuns,
          │                 injectionRuns, writeBackRuns,
          │                 dependencyStatus }
          │      （数据来源：runtime_private 的 5 张轨迹表）
          │
          ├─ groupByTrace: 按 trace_id 把 5 段聚合到一起
          ├─ buildNarrative: 生成整体 outcome
          │       no_trigger / empty_recall / found_but_not_injected /
          │       injection_trimmed / writeback_failed / no_writeback /
          │       dependency_unavailable / completed
          ├─ buildPhaseNarratives: 5 段详情（turn → trigger → recall → injection → writeback）
          │
          ▼
渲染：左侧最近 traces 列表 + 右侧 5 段 narrative + dependency 快照 + 原始 JSON

同理，/dashboard 汇聚的数据：
  storage observe：fetchStorageMetrics / fetchStorageWriteJobs
  runtime observe：fetchRuntimeMetrics / fetchRuntimeRuns
/memories 直接走 PG（lib/server/storage-read-model-client.ts）
```

关键边界：

- `visualization` 读 **runtime 的** observe HTTP 和 **storage 的** observe HTTP，但**不**读任何一方的私有表
- runtime 和 storage 各自维护自己的 `*_private` 轨迹／审计表；跨模块不互相可见
- `storage_shared_v1.memory_read_model_v1` 是唯一允许被其他两个服务**直接读**的表

### 4.5 agent IDE 链路（T11 规划中）🔜

```
浏览器 ──（访问 /agent/:sessionId）
      ──► visualization RSC 页面 (app/agent/[sessionId]/page.tsx) 🔜
          │
          ├─ 浏览器先 fetch /api/agent/token
          │     └─ app/api/agent/token/route.ts (server-only) 🔜
          │            └─ fs.readFile("~/.mna/token.txt")
          │            └─ 返回 { token, mnaBaseUrl }
          │
          ▼
客户端（use client 组件）
          │
          ├─ mna-client（浏览器端）
          │     │
          │     ├─ REST: POST http://127.0.0.1:4193/v1/agent/sessions
          │     │       Authorization: Bearer <token>
          │     │
          │     └─ WebSocket: ws://127.0.0.1:4193/v1/agent/sessions/:id/ws
          │           持续接收事件：
          │             session_started / phase_result / task_change /
          │             injection_banner / assistant_delta /
          │             tool_call_* / tool_confirm_needed /
          │             turn_end / error / pong
          │
          │     （visualization 的 Node 后端进程不在这条路径上）
          │
          ▼
UI：ChatPanel / FileTree / ToolConsole / MemoryPanel / ConfirmDialog

mna 内部（T07 runner 主循环）:
  接收 user_input
    → memory-client.prepareContext (→ retrieval-runtime → storage 读模型)
    → 拼系统提示 + 注入块
    → provider 流式调模型
    → 工具调用（fs / shell / mcp）
    → ws 推送 assistant_delta / tool_call_* / tool_confirm_needed
    → memory-client.finalizeTurn (→ retrieval-runtime → storage 写回)
    → ws 推 turn_end
    → 落 session-store（T14 SQLite）
```

关键边界（见 `docs/memory-native-agent/README.md` §3）：

- `visualization` 的 **Node 进程**不承接 agent 主链路业务逻辑，它只做两件事：(a) 通过 server-only 路由把 mna token 转给浏览器；(b) 可选的 CORS 透传代理
- 所有记忆主链路调用都由 `mna` 发起，**不**直接由 `visualization` 后端调 `prepare-context` / `finalize-turn`
- 因此 `memory-module-contract.md` §11.1 关于"visualization 不调记忆主链路"的约束**仍然成立**——T11 只是在契约末尾加一条"允许跨服务前端嵌入"的澄清

## 5. 通信路径总表

### 5.1 允许的路径

| 源 | 目标 | 通道 | 说明 |
| :--- | :--- | :--- | :--- |
| 任意宿主（mna / claude_code_plugin / codex_app_server） | retrieval-runtime | HTTP | 记忆主链路的正式入口 |
| retrieval-runtime | storage | HTTP（写回） | 唯一的写回入口 |
| retrieval-runtime | `storage_shared_v1.memory_read_model_v1` | 直连 PG（**只读**） | 契约允许的共享读模型 |
| visualization | `storage_shared_v1.memory_read_model_v1` | 直连 PG（**只读**） | 契约允许的共享读模型 |
| visualization | storage 的 observe / governance HTTP | HTTP | 治理动作 + 观测数据 |
| visualization | retrieval-runtime 的 observe HTTP | HTTP | 运行轨迹 + 指标 |
| 浏览器 | visualization（同源） | HTTP | 页面 + API route |
| 浏览器 🔜 | mna | HTTP + WebSocket | agent IDE 主链路（T11） |

### 5.2 禁止的路径

下列任一都会打破架构独立性：

- ❌ `retrieval-runtime` 读或写 `storage_private.*` 任何表
- ❌ `retrieval-runtime` 跨过 storage HTTP 直接 `INSERT INTO memory_records`
- ❌ `visualization` 调 `retrieval-runtime` 的 `/v1/runtime/prepare-context` 或 `/v1/runtime/finalize-turn`
- ❌ `visualization` 读或写 `storage_private.*` / `runtime_private.*` 任何表
- ❌ 任意模块 import 另一模块的内部类、内部目录（只能通过 HTTP 契约或共享读模型）
- ❌ mna 🔜 替代 visualization 承担 `/memories` `/runs` `/dashboard` 的职责，或承担 embedding 服务
- ❌ 把三个业务服务合并成一个共享进程后用目录假装独立

契约来源：`docs/memory-module-contract.md` §3 / §11.1、`docs/architecture-independence.md` §3 / §4。

## 6. 独立性与降级矩阵

架构约束要求：任一服务未启动、启动失败或暂时不可达，都不能把其他服务拖成不可运行状态（`architecture-independence.md` §1）。下表列出每种不可达场景的实际行为：

| 失败场景 | storage | retrieval-runtime | visualization | mna 🔜 |
| :--- | :--- | :--- | :--- | :--- |
| storage server 挂 | — | 写回在 runtime 本地合成 `dependency_unavailable` job，`degraded=true`，不阻塞下一轮 | `/dashboard` 的 storage 卡片 / `/memories` 治理按钮报 `data_unavailable`；`/runs` 仍可用 | agent 对话本身不受影响（除非恰好要召回或写回） |
| storage worker 挂（但 server 活着） | 写入只入队不落地；读模型越来越滞后 | 不感知（HTTP 仍 202 `accepted_async`） | 轻微滞后，页面显示的仍是读模型旧态 | 不感知 |
| retrieval-runtime 挂 | — | 挂 | `/runs` / `/dashboard` 的 runtime 部分报 `data_unavailable`；`/memories` / 治理按钮不受影响 | `session_start` / `prepareContext` / `finalizeTurn` 走 `DependencyGuard` 超时降级；agent 本身在"无记忆"模式下仍可对话 |
| embedding 服务挂 | 读模型投影 `summary_embedding=null`，记录仍入库 | trigger 语义兜底失效（phase 硬规则照常）；query 语义打分 0 分，其他维度照算 | 只看到 `degraded=true` 标记 | 不直接感知 |
| PG 挂 | readiness 转 `not_ready`，任何需要 DB 的业务接口 500 | 读模型查询失败，`injection_block=null` + `degraded=true` | `/memories` 报不可用，`/dashboard` 部分卡片可能降级 | 同 retrieval-runtime 不可达 |
| mna 挂 🔜 | — | — | `/agent/*` 页面显示"agent 离线"；`/memories` / `/runs` / `/dashboard` 不受影响 | — |
| visualization 挂 | — | — | — | mna 的 HTTP/WS 直接给浏览器，不依赖 visualization 后端 |

通用实现点：

- `retrieval-runtime` 的 `DependencyGuard.run(name, timeoutMs, fn)` 统一包装所有外部依赖调用，超时 abort + 异常转降级，状态通过 `/v1/runtime/health/dependencies` 暴露
- `visualization` 的所有 `lib/server/*` 客户端返回 `{ data, status: 'healthy' | 'unavailable' | 'timeout' | 'misconfigured', detail }`，不抛异常到 feature 层
- `storage` 的健康端点分层：`/v1/storage/health/liveness`（进程活）→ `/readiness`（DB ping 通）→ `/dependencies`（embedding/redis 状态）

## 7. 一条数据的完整生命周期（示例）

用一条"用户喜欢 TypeScript 严格模式"的偏好记忆，走一遍四个模块：

```
T0  浏览器 /agent 🔜  用户输入："我 TS 项目一律开 strict"
T1  mna      prepareContext → retrieval-runtime
T2  retrieval-runtime
        trigger: phase=before_response, keyword "一律" 不命中历史词 →
                 语义兜底 embed(query) vs sample 8 → 低于 0.85 → hit=false
        → 不召回，injection_block=null，记 trace_id
T3  mna  调模型推理 → 流式回答
T4  mna      finalizeTurn → retrieval-runtime
T5  retrieval-runtime
        writeback-engine 规则抽取命中 "我.*一律" →
          fact_preference, workspace, importance=4, confidence=0.9
        classifyScope: 含"TS 项目" → workspace
        filter 通过
        idempotency_key = sha256({...})
        → POST /v1/storage/write-back-candidates
T6  storage server.ts
        normalizeCandidate
          dedupe_key = fact_preference:workspace:ts:strict-mode (示意)
          candidate_hash = sha256(...)
        jobs.enqueue → memory_write_jobs (queued)
        → 202 accepted_async
T7  mna   给浏览器推 turn_end

T8  storage worker.ts (~1s 后)
        claimQueuedJobs → WritebackProcessor.processJob
        findByDedupeScope 没找到同 key 记录 → decideMerge = insert_new
        事务内：
          insert memory_records (status=active)
          appendVersion (change_type=create)
          enqueueRefresh
        markSucceeded

T9  storage worker.ts processRefreshJobs
        ReadModelProjector.project
          embedding("I always enable strict mode in TS projects")
          upsert memory_read_model_v1 (含 summary_embedding)

T10 下一轮 mna prepareContext → retrieval-runtime
        query-engine SELECT FROM memory_read_model_v1
          → 命中这条，rerank_score 靠前
        → InjectionBlock 里带上这条，注入到系统提示
        → 本次回答自动参考偏好

T11 visualization /memories
        storage-read-model-client 直连 PG → 列表出现这条
        点进去 → 可以归档 / 编辑 / 标失效
        修改触发 storage governance HTTP → 同步事务 + refresh job
        → 下次 mna 召回时看到新版
```

这个例子覆盖了全部四条链路（召回 → 写回 → 观测 → 治理），也展示了**读模型异步一致性**的实际影响：T5 的写回到 T9 的读模型可见之间存在秒级延迟。

## 8. 参考索引

### 8.1 单模块阅读向导（按深度读）

- `docs/storage/storage-internals.md` — storage 内部子模块、写入链路、治理链路、读模型
- `docs/retrieval/retrieval-runtime-internals.md` — trigger / query / injection / writeback 机制与降级
- `docs/visualization/visualization-internals.md` — 页面分层、四条数据路径、T11 规划
- `docs/memory-native-agent/README.md` — mna 整体定位与 T01–T14 任务索引

### 8.2 契约（跨模块规则）

- `docs/memory-module-contract.md` — 记忆记录字段、召回/写回接口、触发规则、治理接口、跨服务通信约束（§11.1）
- `docs/architecture-independence.md` — 解耦约束、通信方式、降级硬约束
- `docs/api-contract.md` — 三个服务所有对外 HTTP 接口的正式定义
- `docs/current-phase-closure-plan.md` — 当前首版收口方案，含 phase → scope 映射、memory_mode 定义

### 8.3 产品视角

- `docs/product-baseline.md` — 整体产品基线
- `docs/product-readiness.md` — 场景边界 / 治理闭环 / 验收机制
- `docs/memory-native-agent/T01-scaffold.md` 起至 `T14-session-store.md` — mna 各任务拆解

## 9. 文档维护约束

这份文档是**跨模块视角的现状快照**。改动时请注意：

- 单模块内部机制变化 → 修改对应的 `xxx-internals.md`，然后**同步**检查本文档的 §4 链路描述是否还成立
- 新的通信路径（例如 mna T01–T14 陆续落地）→ 更新 §2.2 拓扑图 + §5 通信表
- 契约变化（例如 §5.2 的禁止路径调整）→ **先改契约文档**（`memory-module-contract.md` / `architecture-independence.md`），再把本文档的描述对齐到契约
- 降级行为变化 → 同步更新 §6 降级矩阵

若本文档与代码或契约出现偏差，以**契约文档为准**，按 `current-phase-closure-plan.md` §11 的回写流程处理。
