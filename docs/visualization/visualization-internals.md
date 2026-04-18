# visualization 模块内部机制

## 1. 文档目的

这份文档用于**理解**当前 `services/visualization/` 的运行机制，并描述**规划中**的 agent 功能如何嵌入这个服务：

- 模块现在做了什么事
- 页面和 API 的分层结构
- 数据来源
- 降级与独立性保证
- 规划中的 agent IDE 页面（T11）如何接入

只描述**现状 + 已规划但未实现的结构**，不讨论改进建议。改进建议见 `visualization-improvement-proposals.md`。

不是服务设计文档（那是 `visualization/visualization-service-design.md`），也不是实现规范（那是 `visualization/visualization-implementation-spec.md`）。定位是**阅读向导**。

## 2. 模块在产品里的位置

```
浏览器
  ▲
  │ HTTP + 将来的 WebSocket
  ▼
┌─────────────────────────────────────────────────────────────┐
│  visualization (Next.js 15 单进程)                           │
│                                                             │
│   ┌─── RSC Pages ───┐    ┌─── API Routes ───┐              │
│   │  /               │    │  /api/memories    │              │
│   │  /memories       │    │  /api/runs        │              │
│   │  /memories/[id]  │    │  /api/dashboard   │              │
│   │  /runs           │    │  /api/sources     │              │
│   │  /dashboard      │    │  /api/health      │              │
│   │  /agent/*  🔜   │    │  /api/agent/* 🔜 │              │
│   └─────────────────┘    └──────────────────┘              │
│            │                      │                         │
│            ▼                      ▼                         │
│   ┌─────────────────────────────────────┐                  │
│   │  features/*/service.ts              │                  │
│   │  （聚合层，server-only）              │                  │
│   └─────────────────────────────────────┘                  │
│            │                                                │
│            ▼                                                │
│   ┌─────────────────────────────────────┐                  │
│   │  lib/server/*.ts                    │                  │
│   │  - storage-read-model-client (直连 PG)│                │
│   │  - storage-observe-client  (HTTP)   │                  │
│   │  - storage-governance-client (HTTP) │                  │
│   │  - runtime-observe-client  (HTTP)   │                  │
│   └─────────────────────────────────────┘                  │
│                                                             │
│   ┌─────────────────────────────────────┐                  │
│   │  app/agent/_lib/*.ts 🔜             │                  │
│   │  - mna-client (浏览器端 HTTP + WS)  │                  │
│   │  - event-reducer                    │                  │
│   └─────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
        │              │                  │               │
        ▼              ▼                  ▼               ▼
  storage(PG)   storage HTTP       runtime HTTP       mna HTTP/WS 🔜
  shared schema
```

🔜 = 规划中未实现。其余为现状。

visualization 做四件事：

- **读取**：查 storage 的共享读模型（直连 PG）和 observe 接口（HTTP），runtime 的 observe 接口（HTTP）
- **治理**：通过 storage 的 HTTP 接口代理用户操作（archive / confirm / invalidate / delete / restore / edit / resolve-conflict）
- **聚合**：把多源数据在服务端组装成页面所需的结构化响应
- **降级独立**：任何上游不可达时，对应页面显示"数据源不可用"说明，而不是整个服务挂掉

## 3. 技术栈

| 层 | 选型 |
| :--- | :--- |
| 框架 | Next.js 15（App Router + RSC） |
| UI | React 19 + tailwind v3 + lucide-react 图标 |
| 数据请求 | `@tanstack/react-query` v5（客户端） + `fetch` + RSC fetch（服务端） |
| 表格 | `@tanstack/react-table` |
| 图表 | `echarts` + `echarts-for-react` |
| 表单/校验 | zod |
| 数据库访问 | 原生 `pg`（仅服务端读共享 schema） |
| 测试 | vitest + `@testing-library/react` |
| 日期 | `date-fns` |

**与其他服务对比**：`storage` / `retrieval-runtime` 用 Fastify，visualization 用 Next.js。这是**故意**的——visualization 承担前端渲染职责，Next.js 的 RSC + 客户端水合模型契合"SSR 数据聚合 + 交互组件"。

补充一点：虽然已经接入了 `@tanstack/react-query` provider，但当前已落地的数据主链路仍然以 RSC 取数和 `router.refresh()` 为主，`react-query` 还没有成为列表/详情页的正式查询层。

## 4. 页面与路由清单

### 4.1 现状

```
services/visualization/src/app/
├── page.tsx                      # "/" 概览页（source health + 快速入口）
├── layout.tsx                    # 顶部导航 + 全局样式
├── providers.tsx                 # React Query / Theme provider
├── memories/
│   ├── page.tsx                  # 记忆目录列表
│   └── [id]/
│       └── page.tsx              # 单条记忆详情 + 治理面板
├── runs/
│   └── page.tsx                  # 运行轨迹页
├── dashboard/
│   └── page.tsx                  # 指标看板
└── api/
    ├── memories/
    │   ├── route.ts              # GET 列表
    │   └── [id]/
    │       ├── route.ts          # PATCH 编辑
    │       ├── archive/          # POST 归档
    │       ├── confirm/          # POST 确认
    │       ├── invalidate/       # POST 标记失效
    │       ├── delete/           # POST 软删除
    │       └── restore-version/  # POST 恢复版本
    ├── runs/route.ts             # GET 运行轨迹
    ├── dashboard/route.ts        # GET 指标
    ├── sources/health/           # GET 数据源健康
    └── health/                   # GET 自身 liveness / readiness
        ├── liveness/
        └── readiness/
```

### 4.2 规划中（T11，尚未实现）

```
services/visualization/src/app/
├── agent/                        # 🔜 新增：agent IDE 主页
│   ├── layout.tsx                # agent 外壳（三栏布局）
│   ├── page.tsx                  # 入口重定向到最近 session
│   └── [sessionId]/
│       └── page.tsx              # 对话主视图
└── api/
    └── agent/
        ├── token/route.ts        # 🔜 返回 ~/.mna/token.txt（SSR 读文件）
        └── proxy/[...path]/      # 🔜（可选）对 mna 的透传代理
```

T11 文档要求（见 `docs/memory-native-agent/T11-visualization-frontend.md`）：浏览器直接调 mna 的 HTTP/WebSocket（`http://127.0.0.1:4193/v1/agent/*`），visualization 的 Next.js 端只负责：
- 通过 server-only API route 下发 mna token 给浏览器
- 可选：解决 CORS 的透传代理（如果浏览器直连遇到问题）

visualization 自身**后端进程不承接 agent 主链路业务逻辑**——这是和 `architecture-independence.md` 保持一致的前提。

## 5. 分层架构

整套代码严格分三层，依赖只能从上往下：

```
┌──────────────────────────────────────────────────┐
│ 1. RSC Pages + Client Components                 │
│    app/*/page.tsx, app/*/layout.tsx              │
│    components/*.tsx                              │
└────────────────────────┬─────────────────────────┘
                         │  调用（服务端 RSC 直调、客户端走 API route）
                         ▼
┌──────────────────────────────────────────────────┐
│ 2. API Routes + Feature Services                 │
│    app/api/*/route.ts     ← HTTP 入口              │
│    features/*/service.ts  ← 聚合逻辑（server-only） │
└────────────────────────┬─────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────┐
│ 3. Lib Clients                                   │
│    lib/server/*.ts                               │
│    - runtime-observe-client                      │
│    - storage-read-model-client                   │
│    - storage-observe-client                      │
│    - storage-governance-client                   │
└──────────────────────────────────────────────────┘
```

**关键约束**：`features/*` 和 `lib/server/*` 都标 `import "server-only"`，防止客户端代码意外 import——避免 DB 连接/API key 暴露到浏览器 bundle。

### 5.1 Feature 目录

| 目录 | 职责 | 核心函数 |
| :--- | :--- | :--- |
| `features/memory-catalog/` | 列表查询、详情组装、治理面板 | `getMemoryCatalog(filters)` / `getMemoryDetail(id)` |
| `features/run-trace/` | 按 trace_id 聚合 5 段运行轨迹 + 叙事生成 | `getRunTrace(filters)` / `buildPhaseNarratives` |
| `features/dashboard/` | 多源指标合并 + 趋势卡片 | `getDashboard()` |
| `features/source-health/` | 三数据源健康检查 | `getSourceHealth()` |

### 5.2 Lib/server 客户端

| 文件 | 连接方式 | 目标 |
| :--- | :--- | :--- |
| `runtime-observe-client.ts` | HTTP | `retrieval-runtime` 的 `/v1/runtime/observe/*` |
| `storage-observe-client.ts` | HTTP | `storage` 的 `/v1/storage/observe/*` |
| `storage-governance-client.ts` | HTTP | `storage` 的 `/v1/storage/records/:id/*` 治理端点 |
| `storage-read-model-client.ts` | **直连 PG** | `memory_read_model_v1` 表 |
| `http-client.ts` | 共享 HTTP fetch 封装 | — |
| `api-errors.ts` | Next.js API route 错误响应辅助 | — |

**特殊点**：`storage-read-model-client.ts` 直连 PostgreSQL——这是 `memory-module-contract.md` 第 11.1 节明确允许的路径（读共享读模型）。其他三个 client 走 HTTP。

## 6. 数据来源

```
visualization 读数据的四条路径：

A. memory_read_model_v1（PG 共享读模型）
   ├─ 用于：/memories 列表、/memories/[id] 详情
   └─ 走 storage-read-model-client.ts

B. storage HTTP observe
   ├─ GET /v1/storage/observe/metrics
   ├─ GET /v1/storage/observe/write-jobs
   └─ 用于：/dashboard 指标、source-health

C. runtime HTTP observe
   ├─ GET /v1/runtime/observe/metrics
   ├─ GET /v1/runtime/observe/runs
   └─ 用于：/runs 轨迹、/dashboard 指标

D. storage HTTP governance（写）
   ├─ PATCH /v1/storage/records/:id
   ├─ POST   /v1/storage/records/:id/{archive|confirm|invalidate|delete|restore-version}
   ├─ POST   /v1/storage/conflicts/:id/resolve
   └─ 用于：/memories/[id] 治理面板
```

所有四条路径在**上游不可达时**返回结构化的 `sourceStatus`（`healthy | unavailable | timeout | misconfigured`），页面据此渲染降级提示。

## 7. 页面数据流

### 7.1 /memories 列表

```
用户访问 /memories?workspace=...&mode=workspace_only
      │
      ▼
app/memories/page.tsx (RSC)
      │ SSR 阶段：
      ├─ parseMemoryCatalogFilters(searchParams)
      ├─ getMemoryCatalog(filters)                          (features/memory-catalog)
      │     │
      │     └─ queryCatalogView(filters)                    (lib/server/storage-read-model-client)
      │           │ SELECT FROM storage_shared_v1.memory_read_model_v1
      │           │ WHERE workspace_id = $1 AND status != 'deleted' ...
      │           │ ORDER BY updated_at DESC LIMIT/OFFSET
      │           └─ 返回 { rows, total, status, warnings }
      │
      ├─ 把 row 映射为 MemoryCatalogItem（补 label/explanation 文案）
      │
      ▼
客户端渲染：表格 + 过滤栏 + 空状态/错误状态组件
      │
      ▼ 用户改筛选（由 URL 参数驱动，不走客户端 state）
      │
      ▼ 页面重新 RSC 请求
```

### 7.2 /memories/[id] 详情 + 治理

```
用户访问 /memories/<uuid>
      │
      ▼
app/memories/[id]/page.tsx (RSC)
      │
      ├─ getMemoryDetail(id)
      │     └─ fetchMemoryById(id) (SELECT FROM memory_read_model_v1 WHERE id = $1)
      │
      ▼
客户端渲染：基本信息 + GovernancePanel
      │
      ▼ 用户点"归档" 按钮
      │
      ▼
GovernancePanel 发 POST /api/memories/<id>/archive
      │
      ▼
app/api/memories/[id]/archive/route.ts
      │
      ├─ zod 校验 body
      ├─ archiveMemory(id, payload) (lib/server/storage-governance-client)
      │     └─ POST storage http /v1/storage/records/:id/archive
      ├─ 返回 { ok, ... }
      │
      ▼
客户端 `router.refresh()` → 重新请求当前 RSC 页面
```

注意：列表页可能仍显示**旧状态**（read-model 刷新有异步延迟）。这是当前行为。

### 7.3 /runs 运行轨迹

```
用户访问 /runs?turn_id=xxx
      │
      ▼
app/runs/page.tsx (RSC)
      │
      ├─ getRunTrace(filters)                                  (features/run-trace)
      │     │
      │     ├─ fetchRuntimeRuns(query)                         (lib/server/runtime-observe-client)
      │     │     └─ GET runtime http /v1/runtime/observe/runs
      │     │          { turns, triggerRuns, recallRuns, injectionRuns, writeBackRuns, dependencyStatus }
      │     │
      │     ├─ groupByTrace(data): 按 trace_id 聚合成 5 段
      │     │
      │     ├─ 按 turnId / traceId 选 selected
      │     │
      │     ├─ buildNarrative(selected): 生成整体 outcome
      │     │     ├─ 没 trigger   → "no_trigger"
      │     │     ├─ 空 recall    → "empty_recall"
      │     │     ├─ 被裁剪完     → "found_but_not_injected"
      │     │     ├─ 部分裁剪     → "injection_trimmed"
      │     │     ├─ writeback 失败 → "writeback_failed"
      │     │     ├─ 没候选       → "no_writeback"
      │     │     ├─ 依赖降级     → "dependency_unavailable"
      │     │     └─ 默认        → "completed"
      │     │
      │     ├─ buildPhaseNarratives(selected): 5 段详情
      │     │     turn → trigger → recall → injection → writeback
      │     │
      │     └─ 返回 RunTraceResponse
      │
      ▼
客户端渲染：
  - 左侧列表（最近 traces）
  - 右侧详情（5 段 narrative + dependency 快照 + 原始数据 JSON）
```

### 7.4 /dashboard 指标看板

```
getDashboard()
  │
  ├─ fetchStorageMetrics()    (GET storage /v1/storage/observe/metrics)
  ├─ fetchStorageWriteJobs()  (GET storage /v1/storage/observe/write-jobs)
  ├─ fetchRuntimeMetrics()    (GET runtime /v1/runtime/observe/metrics)
  ├─ fetchRuntimeRuns()       (GET runtime /v1/runtime/observe/runs)
  │
  └─ 汇总成 { metrics[], trends[], diagnoses[] }
        ├─ metrics：数值卡片（当前值 + severity）
        ├─ trends：带 sparkline 的趋势卡片
        └─ diagnoses：基于阈值的诊断卡（比如"写回失败率偏高"）
```

### 7.5 source-health 独立探活

```
getSourceHealth()
  │
  ├─ 并行三个 ping：
  │   - pingMemoryReadModel() (PG SELECT 1 FROM shared schema)
  │   - fetchStorageMetrics().status
  │   - fetchRuntimeMetrics().status
  │
  └─ 合成 ServiceHealthResponse {
       liveness, readiness, dependencies[3],
       degraded: dependencies.some(status !== 'healthy')
     }
```

带缓存（`SOURCE_HEALTH_CACHE_MS`）防止每次请求都压测一遍上游。

## 8. 治理动作链路（写路径）

```
浏览器
  │ 用户在 GovernancePanel 点按钮
  ▼
POST /api/memories/<id>/<action>  (Next.js API route)
  │
  ├─ zod 校验 request body
  ├─ 调用 storage-governance-client 对应方法
  │     │
  │     └─ HTTP 到 storage：
  │         PATCH  /v1/storage/records/:id
  │         POST   /v1/storage/records/:id/archive
  │         POST   /v1/storage/records/:id/confirm
  │         POST   /v1/storage/records/:id/invalidate
  │         POST   /v1/storage/records/:id/delete
  │         POST   /v1/storage/records/:id/restore-version
  │
  │   storage 侧：
  │     GovernanceEngine 事务内 updateRecord + appendVersion + appendGovernanceAction + enqueueRefresh
  │     返回 { ok, record }
  │
  ├─ 包装成 { ok, data } 或 { ok: false, error }
  │
  ▼
浏览器收到响应后通过 `router.refresh()` 刷新当前页面；这也是当前实现里真正生效的刷新方式
```

5 个动作 + 1 个编辑 + 冲突解决，形成 `current-phase-closure-plan.md` 第 7 节要求的治理闭环。

## 9. 降级与独立性

遵守 `architecture-independence.md` 第 5 节的硬约束：

| 上游失败场景 | visualization 行为 |
| :--- | :--- |
| `memory_read_model_v1` PG 连接超时 | `/memories` 页显示 "Memory source unavailable" 空状态 + 错误详情；其他页面不受影响 |
| storage HTTP observe 500 | `/dashboard` 的 storage metrics 卡片显示 `data_unavailable`；runtime 的卡片仍正常 |
| runtime HTTP observe 500 | `/runs` 页显示 "Runtime source unavailable"；`/memories` 仍然工作 |
| storage 治理 endpoint 500 | 按钮返回错误提示，记录状态保持原样，用户可重试 |
| 全部上游都挂 | visualization 自己还能启动，`/api/health/liveness` 返回 ok，所有页面显示降级说明 |

实现关键：所有 `lib/server/*` 客户端都返回 `{ data, status: 'healthy' | 'unavailable' | 'timeout' | 'misconfigured', detail }` 形状，**不抛异常到 feature 层**。

## 10. 规划：agent 功能（T11）

### 10.1 定位

T11 要把 `memory-native-agent` 的 agent IDE 嵌入 visualization 的 Next.js 页面。visualization 升级为"观测 + agent IDE"双角色，但**后端不承接 agent 主链路**——所有主链路调用由浏览器直接发到 mna（或通过 Next.js 轻薄代理）。

### 10.2 数据流（计划）

```
浏览器访问 /agent/<sessionId>
      │
      ▼
app/agent/[sessionId]/page.tsx (RSC)
      │
      ├─ 浏览器先调用 /api/agent/token：
      │     └─ app/api/agent/token/route.ts (server-only, 🔜)
      │           └─ fs.readFile("~/.mna/token.txt")
      │           └─ 返回 { status, token?, reason?, mnaBaseUrl }
      │
      ▼
客户端（use client 组件）
      │
      ├─ 初始化 mna-client（mna-client.ts，浏览器端）
      │     │
      │     ├─ 调 REST：POST http://127.0.0.1:4193/v1/agent/sessions
      │     │       Header: Authorization: Bearer <token>
      │     │       → 创建/获取会话
      │     │
      │     └─ 建 WebSocket：ws://127.0.0.1:4193/v1/agent/sessions/<id>/ws?token=...
      │           │
      │           └─ 持续接收 ServerEvent 流：
      │               session_started / phase_result / task_change /
      │               injection_banner / assistant_delta / tool_call_* /
      │               tool_confirm_needed / turn_end / error / pong
      │
      ├─ event-reducer.ts 把事件流归并到 React state
      │
      ▼
UI 渲染：
  - ChatPanel（对话流）
  - FileTree（工作区文件树）
  - ToolConsole（工具调用日志）
  - MemoryPanel（本轮注入 + 任务面包屑 + phase 轨迹）
  - ConfirmDialog（工具权限确认）
```

### 10.3 visualization 后端**不**做什么

为了保持架构独立性，visualization 的 Node 进程**不会**：

- 调 `retrieval-runtime` 的 `prepare-context` / `finalize-turn`（那是 mna 的活）
- 替代 mna 提供 HTTP/WS 服务
- 持有 model provider 的 API key（mna 持有）
- 执行 fs / shell 工具（mna 执行）

它只做：
- 通过轻量 `/api/agent/token` 路由从磁盘读 mna token 转交给浏览器
- 可选：透传代理 mna 的 HTTP（解决 CORS 时用）
- 渲染 UI

### 10.4 对现有结构的影响

- **新增依赖**：`@monaco-editor/react`（文件预览）+ `openapi-typescript`（从 mna 的 openapi.json 生成类型）
- **新增 route-local lib**：`app/agent/_lib/mna-client.ts`（浏览器端，不在 `server-only` 锁定范围内）；若未来跨 feature 复用，再上提到全局 `src/lib/`
- **不影响**：现有 `/memories` `/runs` `/dashboard` 四条路径完全保持不变

### 10.5 实现状态

- 当前：**未实现**，路由与文件不存在
- 实现计划：`docs/memory-native-agent/T11-visualization-frontend.md`
- 依赖前置：mna T01-T08 完成（HTTP/WS API 可用）

### 10.6 契约说明

即使 visualization 页面"看起来承载了 agent 功能"，从契约视角它只是一个**UI 渲染壳**。浏览器与 mna 的 HTTP/WS 通信路径和 visualization 自身后端没有关系。因此：

- `memory-module-contract.md` 第 11.1 节的"visualization 不调 prepare-context / finalize-turn"约束**仍然成立**
- `architecture-independence.md` 第 3.2 节的"visualization 不依赖前两部分的内部实现"**仍然成立**
- 三服务独立启停、独立治理的特性**不变**

T11 文档末尾要求为这个设计追加一条"允许跨服务前端嵌入"的契约澄清。

## 11. 配置速查

| 环境变量 | 必需性 | 用途 |
| :--- | :---: | :--- |
| `DATABASE_URL` | 必需 | 连 PG 读共享读模型 |
| `STORAGE_API_BASE_URL` | 可选 | 调 storage HTTP（observe + governance） |
| `RUNTIME_API_BASE_URL` | 可选 | 调 runtime HTTP（observe） |
| `SOURCE_HEALTH_CACHE_MS` | 可选 | source-health 探活结果缓存时长 |
| `NEXT_PUBLIC_APP_NAME` | 可选 | 浏览器可见应用名 |
| `NEXT_PUBLIC_APP_DESCRIPTION` | 可选 | 浏览器可见描述 |
| `NEXT_PUBLIC_MNA_BASE_URL` 🔜 | 可选（T11） | 浏览器端 mna HTTP 基址，默认 `http://127.0.0.1:4193` |
| `MNA_TOKEN_PATH` 🔜 | 可选（T11） | server-only 读 token 的文件路径 |

## 12. 文件索引

| 内容 | 文件 |
| :--- | :--- |
| 根布局 & 导航 | `src/app/layout.tsx` |
| 概览页 | `src/app/page.tsx` |
| 记忆目录 | `src/app/memories/page.tsx` + `src/features/memory-catalog/service.ts` |
| 记忆详情 + 治理 | `src/app/memories/[id]/page.tsx` + `features/memory-catalog/governance-panel.tsx` |
| 运行轨迹 | `src/app/runs/page.tsx` + `src/features/run-trace/service.ts` |
| 看板 | `src/app/dashboard/page.tsx` + `src/features/dashboard/service.ts` |
| 数据源健康 | `src/features/source-health/service.ts` |
| API routes | `src/app/api/*/route.ts` |
| 环境变量 | `src/lib/env.ts` |
| 契约类型 | `src/lib/contracts.ts` |
| 运行时 observe 客户端 | `src/lib/server/runtime-observe-client.ts` |
| Storage observe 客户端 | `src/lib/server/storage-observe-client.ts` |
| Storage 读模型客户端（PG） | `src/lib/server/storage-read-model-client.ts` |
| Storage 治理客户端 | `src/lib/server/storage-governance-client.ts` |
| Next.js API 错误工具 | `src/lib/server/api-errors.ts` |
| 通用组件 | `src/components/*.tsx` |
| 缓存工具 | `src/lib/cache.ts` |
| Query 参数解析 | `src/lib/query-params.ts` |

## 13. 与外部契约的对齐

- `docs/memory-module-contract.md` 第 11.1 节：visualization 允许消费的数据源 / 禁止调用的接口
- `docs/architecture-independence.md` 第 3.2 / 5 节：数据解耦 / 降级
- `docs/current-phase-closure-plan.md` 第 5.4 / 7.4 节：正式轨迹筛选 / 治理入口
- `docs/visualization/visualization-service-design.md` / `visualization-implementation-spec.md`：服务设计与规范

若代码与上述契约存在偏差，以**契约为准**。T11 的 agent 功能落地时按 `docs/memory-native-agent/T11-visualization-frontend.md` 第 7 节做契约回写。
