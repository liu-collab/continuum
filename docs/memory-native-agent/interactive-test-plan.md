# memory-native-agent 交互测试文档

## 0. 文档定位

本文档是 `memory-native-agent`（以下简称 mna）首版交付的**交互级测试清单**，
落到每一个可观察、可断言的交互点，用于指导后续开发与补测试代码。

### 0.1 与其他文档的关系

- 功能边界：以 `docs/memory-native-agent/README.md` 第 4 节、`T01~T14` 各任务文档为准
- 对外契约：以 `docs/api-contract.md` 与 `docs/memory-module-contract.md` 为准
- 独立性与降级：以 `docs/architecture-independence.md` 第 3.3 / 5 节为准
- 人工验收：与 `docs/memory-native-agent/acceptance-checklist.md` 互相呼应
- 自动化集合：`services/memory-native-agent/tests/`、`services/memory-native-agent/src/**/__tests__/`、`services/visualization/tests/`、`services/visualization/tests/agent-e2e/`、`packages/continuum-cli/tests/`

### 0.2 状态标记约定

| 标记 | 含义 |
| :--- | :--- |
| `[✅ 已完成]` | 已有自动化覆盖且在主库跑通 |
| `[⚙️ 部分完成]` | 已有部分基座 / 桩代码，但断言不全或不稳定，未形成回归闭环 |
| `[⏳ 待开始]` | 目前完全无自动化覆盖，需要本轮补 |
| `[👤 人工复核]` | 只能人工执行的验收项（通常与真实硬件 / 浏览器 / 外部账号绑定） |

每个小节遵守这个状态；在"**文件位置 / 已有引用**"字段里写出目前对应代码入口，便于后续开发直接落笔。

### 0.3 测试分层

| 层 | 覆盖对象 | 典型目录 | 备注 |
| :--- | :--- | :--- | :--- |
| L0 单元测试 | 纯函数、schema、小模块 | `services/memory-native-agent/src/**/__tests__/` | 不起进程 / 不依赖外部服务 |
| L1 组件集成 | 单服务内多模块协作 | 同上 + Fastify `app.inject` / mock runtime | 走 Fastify 或 mock HTTP |
| L2 跨服务集成 | mna × runtime × storage | `services/memory-native-agent/tests/e2e/` | 本地端口真启停 |
| L3 UI E2E | 浏览器 × visualization × mna | `services/visualization/tests/agent-e2e/` | Playwright，跑真实 mna |
| L4 交付 E2E | continuum-cli × 全服务 | `packages/continuum-cli/tests/` + 人工 | 目前只覆盖 CLI 参数解析 |

### 0.4 如何使用本文档写测试代码

- 每个小节末尾有一段**断言要点**，明确哪些字段、事件、状态必须被断言。未来新增断言时要回写到对应小节。
- 同一小节内若需要多 case（正向 / 负向 / 边界），分条列出；每条一行一测试函数。
- `run_in_background: false` 的单测按自动化口径跑；真服务类 E2E 按 `tests/e2e/setup.ts` 里的约束跑。
- 新增测试文件时建议以本文档小节编号命名：例如 `turn_loop_A03.test.ts`。

---

## 1. 启动与进程治理（T01 / T09 / T12）

### 1.1 HTTP 服务最小启动

- **交互**：`node bin/mna-server.mjs`（或 test 直接 `start()`）应在 `127.0.0.1:4193` 监听
- **断言**：`GET /healthz` 返回 200 + `{status:"ok", api_version:"v1", dependencies: {...}}`
- **状态**：`[✅ 已完成]`
- **文件位置 / 已有引用**：`services/memory-native-agent/tests/smoke.test.ts`、`src/http/__tests__/sessions.test.ts` (`serves health and openapi endpoints`)

### 1.2 `healthz` 响应结构（API 版本握手）

- **交互**：`GET /healthz` 必返 `api_version`、`runtime_min_version`、`dependencies.retrieval_runtime`
- **断言**：字段存在；`runtime_min_version` ≤ 当前 runtime `version`；runtime fail 时 `dependencies.retrieval_runtime !== "reachable"`
- **状态**：`[⚙️ 部分完成]`（`reachable` 正向与 `unreachable` 负向已覆盖，版本字段存在且格式已断言；当前实现里的 `runtime_min_version` 仍高于 `MNA_VERSION`，版本高低关系尚未收口）
- **文件位置 / 已有引用**：`src/http/__tests__/sessions.test.ts`、`src/http/__tests__/health-routes.test.ts`
- **新增建议**：补版本协商断言

### 1.3 `/readyz` 与三段状态

- **交互**：`GET /readyz` 必返 `liveness / readiness / dependencies`（遵守 `architecture-independence.md` 3.3.1）
- **断言**：runtime 不可达时 readiness 仍 200，`dependencies.retrieval_runtime.status` 为显式错误；liveness 不受影响
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/http/__tests__/health-routes.test.ts`

### 1.4 `GET /v1/agent/dependency-status`

- **交互**：返回 `{runtime:{status}, provider:{kind,model}, mcp:[{name,state}]}`
- **断言**：runtime 不可达时 `runtime.status = "unavailable"`；mcp 未配置时返回空数组；provider 切换后下一轮响应
- **状态**：`[✅ 已完成]`
- **文件位置**：`tests/e2e/degrade-runtime-down.e2e.test.ts`、`src/http/__tests__/health-routes.test.ts`

### 1.5 SIGINT / SIGTERM 优雅退出

- **交互**：`bin/mna-server.mjs` 收到信号 → 关闭 HTTP / WS / MCP 子进程 / SessionStore
- **断言**：1s 内进程退出；MCP stdio 子进程 ps 无残留；`sessions.db` 无占用锁
- **状态**：`[👤 人工复核]`（交付 E2E 才能覆盖真进程；CI 里缺真实信号测试）
- **对应人工项**：`acceptance-checklist.md` §1、§4

### 1.6 端口占用失败退出

- **交互**：`MNA_PORT=4193` 已被占用时启动 → 退出码 3
- **断言**：stderr 里出现占用提示；`~/.continuum/managed/mna.json` 无 pid
- **状态**：`[⏳ 待开始]`
- **新增建议**：`tests/port-conflict.test.ts`（mock `listen` 抛 `EADDRINUSE`）

### 1.7 Token 引导（`~/.mna/token.txt`）

- **交互**：首次启动自动生成 64 字符 hex token；已存在时复用
- **断言**：
  - 不存在 → 生成新 token，写入 `~/.mna/token.txt`
  - 存在 → 读取已有 token
  - 支持 `MNA_HOME` 环境变量覆盖路径
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/shared/__tests__/token.test.ts`

### 1.8 Artifact 启动清理（T12 §4）

- **交互**：启动时删除 `~/.mna/artifacts/` 下超过 7 天的子目录
- **断言**：过期目录删除；新鲜目录保留
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/http/__tests__/sessions.test.ts` (`cleans expired artifact directories on startup`)

### 1.9 配置加载与合并（T09）

#### 1.9.1 无配置时走 defaults
- **断言**：`runtime.baseUrl=http://127.0.0.1:3002`、`provider.kind=demo`、`memory.mode=workspace_plus_global`
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/config/__tests__/config.test.ts` (`loads defaults when no config files exist`)

#### 1.9.2 global + local 字段级合并
- **断言**：home `config.yaml` 与 workspace `config.yaml` 按字段覆盖，不整段替换
- **状态**：`[✅ 已完成]`
- **文件位置**：同上 (`merges global and local config by field precedence`)

#### 1.9.3 `--config` 显式覆盖
- **状态**：`[✅ 已完成]`
- **文件位置**：同上 (`lets explicit config override local and global config`)

#### 1.9.4 `identity.json` user_id 持久化
- **状态**：`[✅ 已完成]`
- **文件位置**：同上 (`persists identity and reuses the same user id`)

#### 1.9.5 `workspace_id` 基于 cwd 幂等
- **状态**：`[✅ 已完成]`
- **文件位置**：同上 (`keeps workspace id stable for the same path`)

#### 1.9.6 `workspaces.json` 调试映射
- **状态**：`[✅ 已完成]`
- **文件位置**：同上 (`writes workspace mapping for debugging`)

#### 1.9.7 `memoryModeOverride` 覆盖
- **状态**：`[✅ 已完成]`
- **文件位置**：同上 (`lets memoryModeOverride replace config value`)

#### 1.9.8 自定义 system prompt 追加
- **状态**：`[✅ 已完成]`
- **文件位置**：同上 (`loads system prompt files relative to the config file`)

#### 1.9.9 `api_key_env` 不存在时报错
- **状态**：`[✅ 已完成]`
- **文件位置**：同上 (`throws a clear error when provider api key env is missing`)

#### 1.9.10 非法 memory_mode 报错
- **状态**：`[✅ 已完成]`
- **文件位置**：同上 (`throws when memory mode is invalid`)

#### 1.9.11 locale 覆盖优先级
- **状态**：`[✅ 已完成]`
- **文件位置**：同上 (`prefers config locale over env locale`)

#### 1.9.12 `MNA_HOME` / `MNA_PROVIDER_*` env 覆盖
- **状态**：`[✅ 已完成]`
- **文件位置**：同上 (`prefers MNA_HOME over HOME and USERPROFILE`、`allows provider env overrides for managed startup`)

### 1.10 Windows 路径归一化

- **交互**：`cwd="c:\\workspace"` 与 `"C:/workspace/"` → 同一 `workspace_id`
- **断言**：两次 `loadConfig` 返回同一 UUID；内部 `normalize(cwd)` 统一大写盘符 + 正斜杠
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/config/__tests__/config.test.ts`

---

## 2. Token 鉴权与 CORS（T08 / T12 §2）

### 2.1 Bearer token 校验通过

- **交互**：`GET /v1/agent/sessions` with `Authorization: Bearer <正确token>` → 200
- **断言**：token 匹配；无 token 返回 401 `{error:{code:"token_invalid"}}`
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/http/__tests__/sessions.test.ts`

### 2.2 WS token 通过查询参数

- **交互**：`ws://.../ws?token=<token>` → 连接成功发出 `session_started`
- **断言**：token 错误 → HTTP 401 / close code 1008；正确 → `session_started` 事件
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/http/__tests__/session-ws.test.ts`

### 2.3 token 轮换（手动）

- **交互**：删除 `~/.mna/token.txt` + 重启 mna → 新 token
- **断言**：重启后新 token 写入；旧 token 请求 401
- **状态**：`[👤 人工复核]`（交付阶段由 continuum 单独跑；自动化当前没有模拟重启）
- **对应人工项**：`acceptance-checklist.md` §6 未自动化项

### 2.4 CORS 允许 visualization 回环 origin

- **交互**：`OPTIONS /v1/agent/sessions` with `Origin: http://127.0.0.1:3003`
- **断言**：204 + `Access-Control-Allow-Origin: http://127.0.0.1:3003` + `Allow-Methods` 含 GET
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/http/__tests__/cors.test.ts`

### 2.5 CORS 拒绝非 allowed origin

- **交互**：`OPTIONS /v1/agent/sessions` with `Origin: http://evil.example.com`
- **断言**：不带 `Access-Control-Allow-Origin` 头；浏览器侧被拒
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/http/__tests__/cors.test.ts`

### 2.6 visualization token 路由

- **交互**：浏览器请求 `/api/agent/token` → 读取 `~/.mna/token.txt` 返回 `{status:"ok", token, mnaBaseUrl}`
- **断言**：
  - 文件存在 → `status: "ok"` + token 字段
  - `ENOENT` → `status: "mna_not_running"`
- **状态**：`[✅ 已完成]`
- **文件位置**：`services/visualization/tests/agent-token-route.test.ts`

---

## 3. 会话生命周期（T08 / T14）

### 3.1 创建会话

- **交互**：`POST /v1/agent/sessions`，body `{workspace_id, memory_mode?, locale?}`
- **断言**：
  - 201 + 返回 `{session_id, ws_url, memory_mode, workspace_id, locale}`
  - 未传 `memory_mode` 时沿用 `AgentConfig.memory.mode`
  - 未传 `locale` 时沿用解析后的 `AgentConfig.locale`
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/http/__tests__/sessions.test.ts` (`creates a session and exposes session metadata`)

### 3.2 获取会话详情 + 消息历史

- **交互**：`GET /v1/agent/sessions/:id`
- **断言**：
  - 存在 → 返回 session 元数据 + `messages[]`
  - 不存在 → 404 `{error:{code:"session_not_found"}}`
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/http/__tests__/sessions.test.ts`

### 3.3 按工作区列出会话

- **交互**：`GET /v1/agent/sessions?workspace_id=...` + 分页游标
- **断言**：
  - 仅返回同 workspace 下 session
  - 按 `last_active_at DESC` 排序
  - `next_cursor` 在分页尽头为 `null`
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/http/__tests__/sessions.test.ts`

### 3.4 更新会话 title（PATCH）

- **交互**：`PATCH /v1/agent/sessions/:id` body `{title: "..."}`
- **断言**：
  - 成功后 `GET` 返回新 title
  - 传非白名单字段（如 `memory_mode`）应被忽略或 400
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/http/__tests__/sessions.test.ts`

### 3.5 关闭会话（软关闭）

- **交互**：`DELETE /v1/agent/sessions/:id`
- **断言**：`sessions.closed_at` 被置位；消息与 tool_invocations 仍可查
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/session-store/__tests__/session-crud.test.ts`、`src/http/__tests__/sessions.test.ts`

### 3.6 purge 物理清理（`?purge=all`）

- **交互**：`DELETE /v1/agent/sessions/:id?purge=all`
- **断言**：
  - DB 里 session/turns/messages/tool_invocations 全部被 CASCADE 删
  - `~/.mna/artifacts/<session_id>/` 目录被删
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/session-store/__tests__/purge.test.ts`、`src/http/__tests__/sessions.test.ts`

### 3.7 切换 `memory_mode`

- **交互**：`POST /v1/agent/sessions/:id/mode` body `{memory_mode}`
- **断言**：
  - 成功后下一轮 `prepareContext` 请求体 `memory_mode` 变更
  - `injection_banner` 对应字段改变
- **状态**：`[✅ 已完成]`
- **文件位置**：`tests/e2e/memory-mode-switch.e2e.test.ts`

### 3.8 运行时切换 provider（下一轮生效）

- **交互**：`POST /v1/agent/sessions/:id/provider` body `{provider_id, model, temperature?}`
- **断言**：
  - 注册的 provider → 200
  - 未注册 → 400 `provider_not_registered`
  - 变更只对下一轮 turn 生效，不中断进行中 turn
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/http/__tests__/sessions.test.ts`

### 3.9 崩溃恢复（`finish_reason=crashed`）

- **交互**：kill -9 mna → 重启后 `GET /v1/agent/sessions/:id` 显示中断 turn
- **断言**：`markInterruptedTurnsAsCrashed()` 把未完成 turn 标为 `crashed`
- **状态**：`[✅ 已完成]`（store 层）
- **文件位置**：`src/session-store/__tests__/purge.test.ts` (`marks unfinished turns as crashed on startup recovery`)
- **待补**：交付层人工验收 `kill -9` 链路

---

## 4. WebSocket 事件通道（T07 / T08 / T12 §9）

### 4.1 WS 首个事件 `session_started`

- **交互**：WS 连接后服务端立即发 `session_started`
- **断言**：`{kind:"session_started", session_id, workspace_id, memory_mode}`
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/http/__tests__/session-ws.test.ts`

### 4.2 单轮对话事件顺序（纯文本）

- **交互**：客户端发 `user_input` → 服务端依次发：
  1. `phase_result(before_response)`
  2. `injection_banner`
  3. `assistant_delta` 0..n
  4. `turn_end(stop)`
- **断言**：事件按上述顺序抵达；`assistant_delta` 合批后总文本等于 provider 流
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/http/__tests__/session-ws.test.ts`、`src/runner/__tests__/runner.test.ts`

### 4.3 多 phase 顺序（任务切换 + 规划）

- **交互**：输入含"换成..."+"规划..."关键词
- **断言**：依次发出 `task_switch → task_start → before_plan → before_response` 四个 `phase_result`；`task_change` 早于对应 `phase_result`
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/runner/__tests__/trigger-detector.test.ts`、`src/runner/__tests__/runner.test.ts`

### 4.4 `assistant_delta` 合批策略

- **交互**：provider 快速吐字符 → `StreamBridge` 按 `flush_chars=32 / interval=30ms` 合批
- **断言**：
  - 文本累积到达阈值立即发一条
  - 遇到 `tool_call` 强制 flush 已缓冲文本
  - 合批后总长度 = 原始长度
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/runner/__tests__/stream-bridge.test.ts`

### 4.5 Abort 后续 chunk 丢弃

- **交互**：`bridge.abort()` 后再 `handle()` 一条 chunk
- **断言**：`metrics().dropped_after_abort_total` +1；不触发 `emitAssistantDelta`
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/runner/__tests__/stream-bridge.test.ts`

### 4.6 Mid-stream 错误顺序（`error` 先于 `turn_end`）

- **交互**：provider 流中途抛错
- **断言**：服务端先发 `error` 事件再发 `turn_end(finish_reason="error")`；前端 reducer 在 `turn_end` 才 finalize
- **状态**：`[⚙️ 部分完成]`（后端顺序已由 `runner.test.ts` 覆盖；前端 reducer finalize 时机已由 `agent-event-reducer.test.ts` 覆盖，但还没有跨端到同一条真实流场景）
- **文件位置**：`src/runner/__tests__/runner.test.ts`、`services/visualization/tests/agent-event-reducer.test.ts`

### 4.7 客户端 abort → `turn_end(abort)`

- **交互**：WS 发 `{kind:"abort", turn_id}`
- **断言**：
  - AbortController abort 传到 provider.chat(signal) 与 tools
  - shell_exec 子进程收 SIGTERM
  - `turn_end.finish_reason = "abort"`
- **状态**：`[⚙️ 部分完成]`（WS abort、provider abort 传播、late chunk 丢弃与 `turn_end(abort)` 已覆盖；tools / shell_exec 子进程信号传播仍未补）
- **文件位置**：`src/http/__tests__/session-ws.test.ts`

### 4.8 断线重连 + 事件缓冲 replay

- **交互**：断线后带 `?last_event_id=<n>` 重连
- **断言**：缓存内事件按顺序补发；超出缓冲或 10 分钟 TTL 丢弃
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/http/__tests__/session-ws.test.ts`、`services/visualization/tests/agent-e2e/agent-extra-ui.spec.ts`

### 4.9 心跳 ping/pong

- **交互**：客户端发 `{kind:"ping"}` → 服务端回 `{kind:"pong"}`
- **断言**：ping 后 100ms 内收到 pong
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/http/__tests__/session-ws.test.ts`

### 4.10 事件缓冲内存上限（200 条 / 10min）

- **交互**：制造超过 200 条事件再重连
- **断言**：最早事件被丢弃；客户端收到 `event_id` 跳号提示
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/http/__tests__/session-ws.test.ts`

---

## 5. Runner 主循环与触发检测（T07）

### 5.1 `detectTriggers` 识别 task_start + before_plan

- **交互**：输入"帮我规划一下这次重构"
- **断言**：`taskStart.label` 包含用户输入；`beforePlan = true`
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/runner/__tests__/trigger-detector.test.ts`

### 5.2 `detectTriggers` 识别 task_switch

- **交互**：当前 `currentTask="支付链路"`，输入"换成修复登录接口"
- **断言**：`taskSwitch` 非空；Jaccard 相似度检测命中
- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 5.3 task_switch 恢复到历史 task

- **交互**：输入与 `recentTasks[i]` 相似度 > 0.4
- **断言**：`currentTask = recentTasks[i]`（resume）；`task_change.change = "resume"`
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/runner/__tests__/task-state.test.ts`、`src/runner/__tests__/runner.test.ts`、`services/visualization/tests/agent-event-reducer.test.ts`

### 5.4 task_id 生命周期

- **交互**：task_start → currentTask 指向新 TaskState；LRU 上限 10
- **断言**：`recentTasks` 头部是最新 task；超 10 条后最旧被挤出
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/runner/__tests__/task-state.test.ts`

### 5.5 多 phase 串行顺序调用 runtime

- **交互**：同轮命中 task_switch + task_start + before_plan + before_response
- **断言**：`memoryClient.prepareContext` 被调 4 次；`phase` 依次为 `task_switch, task_start, before_plan, before_response`
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/runner/__tests__/runner.test.ts`

### 5.6 单 phase 失败不阻断后续 phase

- **交互**：`task_start` 阶段 runtime 抛 Timeout，其他 phase 正常
- **断言**：仍能收到 `before_response` 的 injection；对话继续
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/runner/__tests__/runner.test.ts`

### 5.7 runtime 完全不可达下的对话继续

- **交互**：`memoryClient.prepareContext` 全部抛 `MemoryUnavailableError`
- **断言**：
  - `submit()` 完成
  - `emitInjectionBanner` 带 `degraded=true` 且 `injection=null`
  - `emitAssistantDelta` / `emitTurnEnd` 正常发出
  - `finalizeTurn` 失败不阻塞
- **状态**：`[✅ 已完成]`（e2e 层）
- **文件位置**：`tests/e2e/degrade-runtime-down.e2e.test.ts`
- **新增建议**：补 runner 单测级别的同场景

### 5.8 普通 happy path（纯文本 + 单 phase）

- **交互**：普通输入 `"继续这个任务"`
- **断言**：调 `before_response` 一次；`turn_end.finish_reason = "stop"`
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/runner/__tests__/runner.test.ts`

### 5.9 工具循环（单轮内多次 dispatch）

- **交互**：provider 流出 `tool_call` → tool 返回 → provider 继续 → `end(stop)`
- **断言**：
  - `tool_call_start / tool_call_result` 事件按序发出
  - tool 输出按 `conversation.wrapToolOutput` 包裹
  - round=2 的 `dispatched_messages` 被写库
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/runner/__tests__/turn-loop.test.ts` + `src/runner/__tests__/runner.test.ts`

### 5.10 `shortSummary` 截断到 500 字符

- **交互**：历史对话很长
- **断言**：`conversation.shortSummary()` ≤ 500 字符；传给 `prepareContext.recent_context_summary`
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/runner/__tests__/conversation.test.ts`

### 5.11 writeback 规则

- **交互**：一轮结束 → 自动发 `finalize-turn`
- **断言**：
  - 至少一次 user + assistant 交互 → 发 finalize
  - 只要 runner 能调用 → 即使 store 挂掉也不阻塞
  - 非 `builtin_read` trust 的 tool summary 前置"以下摘要来自外部工具输出..."
- **状态**：`[✅ 已完成]`（trust 前置 + finalize 触发条件）
- **文件位置**：`src/runner/__tests__/turn-loop.test.ts` + `src/runner/__tests__/runner.test.ts`

### 5.12 Store 写入失败转 session error

- **交互**：store 设为只读文件系统 → runner 写入失败
- **断言**：WS 发出 `error{scope:"session", code:"session_store_unavailable"}`；对话继续
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/runner/__tests__/runner.test.ts`

---

## 6. Memory Client（T02）

### 6.1 注入 `host: "memory_native_agent"`

- **交互**：所有 runtime 请求 body 必带 `host="memory_native_agent"`
- **断言**：服务端收到的 body.host 值准确
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/memory-client/__tests__/client.test.ts`

### 6.2 `prepareContext` 成功解析

- **断言**：schema 校验通过；`injection_block.memory_summary` 字段可读
- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 6.3 `sessionStartContext` 503 降级

- **断言**：服务端返回 `dependency_unavailable` → 客户端返回 `{degraded:true, injection_block:null}`，不抛错
- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 6.4 `finalizeTurn` 超时抛 `MemoryTimeoutError`

- **断言**：超过 `finalizeTimeoutMs` → 抛对应类型；调用方按降级处理
- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 6.5 5xx 抛 `MemoryUnavailableError`

- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 6.6 4xx 抛 `MemoryBadRequestError`

- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 6.7 `healthz` / `dependencyStatus` schema 校验

- **断言**：服务端字段形状变化时，客户端能用 zod 检出来
- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 6.8 trace_id 贯穿

- **交互**：同一 turn 的四次 `prepareContext` + `finalizeTurn` 日志 / WS 事件都能关联同一 `trace_id`
- **断言**：`phase_result.trace_id` 串起同一轮所有 phase；可在 `/v1/runtime/observe/runs` 查到
- **状态**：`[⚙️ 部分完成]`（当前实现下 `task_start / before_response / after_response` 共用同一 turn trace；`session_start` 仍单独生成 trace）
- **文件位置**：`tests/e2e/happy-path.e2e.test.ts`

---

## 7. 模型 Provider（T04）

### 7.1 OpenAI 兼容：纯文本流式

- **断言**：`text_delta` 正常；`end.usage` 必返
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/providers/__tests__/openai-compatible.test.ts`

### 7.2 OpenAI 兼容：工具调用 args 拼接

- **断言**：跨 chunk 的 `tool_calls.arguments` 被 buffer 成完整 JSON；yield 一条完整 `tool_call`
- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 7.3 OpenAI 兼容：流失败 → 非流降级

- **断言**：流 payload 无法解析时自动 POST 非流式；seenStreams 先 true 后 false
- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 7.4 OpenAI 兼容：429 单次重试后抛 `ProviderRateLimitedError`

- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 7.5 OpenAI 兼容：5xx 重试耗尽抛 `ProviderUnavailableError`

- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 7.6 OpenAI 兼容：401 不重试抛 `ProviderAuthError`

- **状态**：`[✅ 已完成]`
- **文件位置**：`src/providers/__tests__/openai-compatible.test.ts`

### 7.7 Anthropic：system 拆分 + tools schema 映射

- **状态**：`[✅ 已完成]`
- **文件位置**：`src/providers/__tests__/anthropic.test.ts`

### 7.8 Ollama：NDJSON 解析 + 工具调用

- **状态**：`[✅ 已完成]`
- **文件位置**：`src/providers/__tests__/ollama.test.ts`

### 7.9 SSE 行缓冲

- **断言**：chunk 被切在字节中间时不丢事件；半条 JSON 挂到下次
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/providers/__tests__/sse-line-buffer.test.ts`

### 7.10 Record / Replay provider

#### 7.10.1 record 模式录制 JSONL
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/providers/__tests__/record-replay.test.ts`

#### 7.10.2 replay 模式回放
- **状态**：`[✅ 已完成]`
- **文件位置**：同上

#### 7.10.3 fixture 缺失抛 `FixtureMissingError`
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/providers/__tests__/record-replay.test.ts`

### 7.11 Provider abort 传播

- **交互**：`signal.abort()` 后流立即停止；fetch 被 cancel
- **断言**：abort 后不再 yield chunk；不泄漏连接
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/http/__tests__/session-ws.test.ts`、`src/providers/__tests__/openai-compatible.test.ts`

---

## 8. 内置工具（T05）

### 8.1 `fs_read` 正常路径

- **断言**：读文件返回内容；读目录返回 `ls` 格式
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/tools/__tests__/fs.test.ts` (`reads files and directories inside the workspace`)

### 8.2 `fs_read` 越权拒绝（不进入 confirm）

- **断言**：`path="../secret.txt"` → `ok=false`、`error.code="tool_denied_path"`
- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 8.3 `fs_write` 首次 confirm 后写入

- **断言**：确认通过后文件写入；返回 diff 预览
- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 8.4 `fs_edit` 唯一匹配替换

- **断言**：old_string 唯一 → 替换成功
- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 8.5 `fs_edit` 多处匹配报错

- **断言**：old_string 匹配多处 → `tool_edit_match_not_unique`
- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 8.6 `shell_exec` 正常执行

- **断言**：cross-platform echo 成功返回
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/tools/__tests__/shell.test.ts`

### 8.7 `shell_exec` 黑名单拦截

- **断言**：deny pattern 命中 → `tool_denied_pattern`
- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 8.8 `shell_exec` 超时

- **断言**：超时命令 → `tool_timeout`
- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 8.9 `shell_exec` 超时信号升级

- **交互**：POSIX 发 SIGTERM，2s 后 SIGKILL
- **断言**：进程被终止；无僵尸进程
- **状态**：`[👤 人工复核]`（跨平台信号行为，CI 难稳定测）
- **新增建议**：加平台 gated 测试

### 8.10 `shell_exec` Symlink 逃逸

- **交互**：workspace 内 symlink 指向外部 → 调用时拒绝
- **断言**：`fs.realpath` 解开后判边界；越界 → `tool_denied_path`
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/tools/__tests__/fs.test.ts`

### 8.11 `mcp_call` 成功转发

- **断言**：`ToolDispatcher` 调用注入的 McpRegistry；结果转成 `ToolResult`
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/tools/__tests__/dispatcher.test.ts` (`denies confirmed tools and forwards MCP calls`)

### 8.12 `mcp_call` 服务离线映射 `mcp_disconnected`

- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 8.13 `allow_session` 缓存

- **交互**：一次选 `allow_session` 后同 session 内同 tool 自动放行
- **断言**：第二次调用 decision=`allowed_session`；audit 记 permission_decision
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/tools/__tests__/dispatcher.test.ts` (`caches allow_session decisions and records audits`)

### 8.14 `deny` 决策

- **断言**：返回 `ok=false, error.code="tool_denied"`
- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 8.15 confirm 60s 超时退化为 deny

- **断言**：前端 60s 未回 → `RunnerIO.requestConfirm` reject / timeout；audit `permission_decision=timeout`
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/tools/__tests__/dispatcher.test.ts`

### 8.16 工具输出超限写 artifact

- **交互**：输出 > 10KB
- **断言**：output 被截断（头 5KB + "..." + 尾 2KB）；artifact 写入 `~/.mna/artifacts/<session>/<call>.txt`；`artifact_ref` 回传
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/tools/__tests__/fs.test.ts`、`src/session-store/__tests__/audit-write.test.ts`

### 8.17 工具输出 > 5MB 直接拒绝

- **断言**：返回 `{ok:false, error.code:"tool_output_too_large"}`
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/tools/__tests__/fs.test.ts`

### 8.18 Tool schema 暴露给 provider

- **断言**：`dispatcher.listTools()` 返回的 schema 数组 = provider.chat 传入 tools
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/tools/__tests__/dispatcher.test.ts` (`maps MCP disconnection errors to tool results and exposes tool schema`)

### 8.19 Tool output 信任边界包裹

- **断言**：`conversation.wrapToolOutput("fs_read", call_id, trust, body)` 生成 `<tool_output tool="fs_read" call_id="..." trust="builtin_read">body</tool_output>`；body 内 `</tool_output>` 被转义
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/runner/__tests__/turn-loop.test.ts`

---

## 9. MCP Client（T06）

### 9.1 stdio transport 启动 + 工具发现

- **断言**：`listTools()` 返回聚合工具清单（server+name）
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/mcp-client/__tests__/stdio.test.ts`

### 9.2 stdio 调用工具

- **断言**：`callTool("stdio-fixture", "echo_text", {text:"hello"})` 返回 `stdio:hello`
- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 9.3 无效 stdio server → `unavailable`

- **断言**：不可执行命令 → `getServerStatus().state = "unavailable"`；不阻塞 registry
- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 9.4 未知 server → `McpServerNotFoundError`

- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 9.5 streamable-http transport 基础

- **断言**：add → list → call 一条链路跑通
- **状态**：`[⚙️ 部分完成]`（文件已存在；HTTP 测试细节需代码侧核对）
- **文件位置**：`src/mcp-client/__tests__/http.test.ts`

### 9.6 http server crash 后立即失败、其他 server 不受影响

- **状态**：`[⏳ 待开始]`
- **新增建议**：扩 `http.test.ts`

### 9.7 `restartServer(name)` 运行时重启

- **交互**：标记 disabled 的 server → restart → 状态回 ok + 工具重新出现
- **状态**：`[⏳ 待开始]`
- **新增建议**：`src/mcp-client/__tests__/restart.test.ts`

### 9.8 `disableServer(name)`

- **断言**：disable 后 `listTools()` 过滤；`mcp_call` 返回 `mcp_disconnected`；下次进程启动按 config 恢复
- **状态**：`[⏳ 待开始]`

### 9.9 `shutdown()` 回收 stdio 子进程

- **断言**：`ps` 无残留 mcp 子进程
- **状态**：`[👤 人工复核]`（进程树检测难 CI）

### 9.10 HTTP MCP 管理路由

- **交互**：`GET /v1/agent/mcp/servers`、`POST .../restart`、`POST .../disable`
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/http/__tests__/mcp-routes.test.ts`

---

## 10. Session Store（T14）

### 10.1 session CRUD

- **状态**：`[✅ 已完成]`
- **文件位置**：`src/session-store/__tests__/session-crud.test.ts`

### 10.2 turn + message append + dispatched_messages

- **状态**：`[✅ 已完成]`
- **文件位置**：`src/session-store/__tests__/message-append.test.ts`

### 10.3 tool_invocation audit + args_preview 截断 512

- **状态**：`[✅ 已完成]`
- **文件位置**：`src/session-store/__tests__/audit-write.test.ts`

### 10.4 purge + artifacts 目录删除

- **状态**：`[✅ 已完成]`
- **文件位置**：`src/session-store/__tests__/purge.test.ts`

### 10.5 重启后 `markInterruptedTurnsAsCrashed()`

- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 10.6 CASCADE 删除（turns/messages/tool_invocations）

- **断言**：删除 session 后所有外键表都清
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/session-store/__tests__/purge.test.ts`

### 10.7 args_hash 不存 args 原文

- **断言**：DB 里 `args_hash` 是 sha256；不包含明文路径 / 明文命令
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/session-store/__tests__/audit-write.test.ts`

### 10.8 Migration 启动自动执行

- **断言**：新目录启动 → 0001-init.sql 跑完 → 表都在
- **状态**：`[✅ 已完成]`（隐式，各测试能开始说明 migration 成功）

### 10.9 `dispatched_messages` 持久化 + 读取

- **断言**：`getDispatchedMessages(turn_id)` 能取回 `{messages_json, tools_json, provider_id, model}`
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/session-store/__tests__/message-append.test.ts`

### 10.10 prompt inspector HTTP 路由

- **交互**：`GET /v1/agent/turns/:turn_id/dispatched-messages`
- **断言**：
  - 存在 → 返回完整 messages + tools
  - 不存在 → 404 `turn_not_found`
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/http/__tests__/sessions.test.ts`

### 10.11 Session 列表游标分页

- **断言**：`listSessions({ limit, cursor })` 按 last_active_at DESC；`next_cursor` 正确
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/session-store/__tests__/session-crud.test.ts`

---

## 11. Prompt 与信任边界（T12 §3 / §8）

### 11.1 中文 system prompt 渲染

- **断言**：`buildSystemPrompt({locale:"zh-CN"})` 含 "你是 memory-native-agent"、`workspaceRoot` 变量替换
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/runner/prompts/__tests__/default-system.test.ts`

### 11.2 英文 system prompt + 用户追加段

- **断言**：`locale:"en-US"` + `appendedPrompt` → 含 "You are memory-native-agent" + 追加段
- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 11.3 system prompt 含 `<tool_output>` 规则段

- **断言**：prompt 末尾含"工具输出的信任边界"段
- **状态**：`[✅ 已完成]`（通过断言 `<tool_output>` 间接覆盖）
- **文件位置**：同上

### 11.4 非 builtin_read trust 的 writeback 前置说明

- **断言**：`summarizeToolResults` 对 shell/mcp output 前置"以下摘要来自外部工具输出"
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/runner/__tests__/turn-loop.test.ts`

### 11.5 Trust level 枚举全覆盖

- **状态**：`[✅ 已完成]`
- **文件位置**：`src/runner/__tests__/turn-loop.test.ts`

---

## 12. 跨服务端到端（T10，L2）

### 12.1 Happy Path：写 → 召回

- **交互**：两轮 session：第一轮写偏好，第二轮新 session 中命中 injection
- **断言**：
  - 第二轮 `injection_banner.injection.memory_summary` 含 "TypeScript"
  - `runtimeRepository.getRuns()` 里有 `writeback_submissions.submitted_count > 0`
  - `storageService.listRecords()` 里能查到写入的记忆
- **状态**：`[✅ 已完成]`
- **文件位置**：`tests/e2e/happy-path.e2e.test.ts`

### 12.2 Runtime 不可达降级

- **断言**：
  - `injection_banner.degraded = true`
  - `turn_end` 正常到达
  - `GET /dependency-status` 返回 `runtime.status="unavailable"`
- **状态**：`[✅ 已完成]`
- **文件位置**：`tests/e2e/degrade-runtime-down.e2e.test.ts`

### 12.3 Storage 不可达降级 + 恢复

- **断言**：
  - storage down 时 `injection_banner.degraded=true`；writeback_submissions 记 `failed + dependency_unavailable`
  - storage restart 后下一轮 injection 恢复，能召回写入前的偏好
- **状态**：`[✅ 已完成]`
- **文件位置**：`tests/e2e/degrade-storage-down.e2e.test.ts`

### 12.4 memory_mode 切 workspace_only

- **断言**：切到 `workspace_only` 后 user scope 记忆不被召回；assistant 输出"当前没有恢复到相关偏好"
- **状态**：`[✅ 已完成]`
- **文件位置**：`tests/e2e/memory-mode-switch.e2e.test.ts`

### 12.5 治理闭环（`invalidate` 后不再注入）

- **断言**：
  - `invalidate` 调用后 record 状态转 `archived`
  - 下一轮 injection 不含该记忆
- **状态**：`[✅ 已完成]`
- **文件位置**：`tests/e2e/governance-roundtrip.e2e.test.ts`

### 12.6 mna 重启恢复

- **交互**：中途 stopMna → restartMna → 继续轮
- **断言**：session 列表保留；crashed turn 标记正确
- **状态**：`[✅ 已完成]`
- **文件位置**：`tests/e2e/mna-restart.e2e.test.ts` + `services/visualization/tests/agent-e2e/agent-recovery.spec.ts`

### 12.7 同一轮 trace_id 贯穿 runtime observe

- **断言**：`phase_result` 各 phase trace_id 一致；`observe/runs` 能按此 trace_id 查到同一 run
- **状态**：`[⚙️ 部分完成]`（happy-path 已补 `phase_result + observe/runs` 断言；当前仅 turn 内 phase 共享 trace，`session_start` 仍单独 trace）
- **文件位置**：`tests/e2e/happy-path.e2e.test.ts`

### 12.8 MCP echo（http fixture）

- **断言**：通过 `with_mcp=true` 启动 stack，`mcp_call` 成功返回 `mcp:<text>`
- **状态**：`[✅ 已完成]`
- **文件位置**：`tests/e2e/setup.ts` + `tests/e2e/mcp-call.e2e.test.ts`

---

## 13. 前端 Agent IDE（T11，L0/L1）

### 13.1 Event reducer：hydrate session

- **断言**：`hydrate_session` 事件将历史 messages 组装成 turns（user + assistant 成对）
- **状态**：`[✅ 已完成]`
- **文件位置**：`services/visualization/tests/agent-event-reducer.test.ts`

### 13.2 Event reducer：流式 turn 状态机

- **断言**：
  - `user_turn_submitted` → `pending`
  - `phase_result` 追加 phases
  - `tool_confirm_needed` → `pendingConfirm`
  - `assistant_delta` 累积 assistantOutput
  - `turn_end` → `complete`
- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 13.3 Event reducer：mid-stream 错误顺序

- **交互**：`error` → `turn_end`
- **断言**：reducer 不在 `error` 时清 pending，只在 `turn_end` finalize
- **状态**：`[✅ 已完成]`
- **文件位置**：`services/visualization/tests/agent-event-reducer.test.ts`

### 13.4 MnaClient DELETE 请求不带 JSON content-type

- **断言**：purge 请求 headers 无 Content-Type，有 Bearer
- **状态**：`[✅ 已完成]`
- **文件位置**：`services/visualization/tests/mna-client.test.ts`

### 13.5 Token route 正向

- **状态**：`[✅ 已完成]`
- **文件位置**：`services/visualization/tests/agent-token-route.test.ts`

### 13.6 Token route `ENOENT` → `mna_not_running`

- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 13.7 Token route 空文件 / 读取超时 → `token_missing`

- **交互**：token 文件存在但为空，或读取 token 超时
- **断言**：返回 `status="token_missing"`；reason 明确区分"文件为空"或"读取超时"
- **状态**：`[✅ 已完成]`
- **文件位置**：`services/visualization/tests/agent-token-route.test.ts`

### 13.8 Token route 非法格式 / 无权限 → `token_invalid`

- **交互**：token 文件内容非法，或读取时抛 `EACCES`
- **断言**：返回 `status="token_invalid"`；reason 明确指向 token 不可用
- **状态**：`[✅ 已完成]`
- **文件位置**：`services/visualization/tests/agent-token-route.test.ts`

### 13.9 AgentWorkspace 离线原因映射

- **交互**：bootstrap 分别返回 `mna_not_running`、`token_missing`、`token_invalid`
- **断言**：页面离线态文案与状态一一对应，不退化成同一条泛化错误
- **状态**：`[✅ 已完成]`
- **文件位置**：`services/visualization/tests/agent-workspace.bootstrap.test.tsx`

### 13.10 i18n provider 切换

- **交互**：顶部栏切换 zh-CN ⇄ en-US
- **断言**：按钮 / 错误提示立即切换；历史消息不变
- **状态**：`[✅ 已完成]`（reducer + i18n test）
- **文件位置**：`services/visualization/tests/agent-i18n.test.tsx`

### 13.11 Session list 渲染

- **状态**：`[✅ 已完成]`（至少组件级）
- **文件位置**：`services/visualization/tests/session-list.test.tsx`

### 13.12 error code → i18n 展示表

- **断言**：T08 §3.12 所有 code 都有 `errors.<code>.title` + `description`
- **状态**：`[✅ 已完成]`
- **文件位置**：`services/visualization/tests/agent-i18n-error-codes.test.tsx`

### 13.13 Tool confirm dialog 结构化 payload

- **交互**：接 `tool_confirm_needed` 后展示脱敏 `params_preview` + risk 对应文案
- **状态**：`[⚙️ 部分完成]`（UI E2E 覆盖；reducer 层 pendingConfirm 已测）
- **文件位置**：`agent-event-reducer.test.ts` + `agent-e2e/agent-tools-mcp.spec.ts`

### 13.14 Event reducer：`session_started` 同步 session 元数据

- **交互**：收到 `session_started`
- **断言**：`sessionId`、`memory_mode`、`workspace_id`、`locale` 同步到当前 state；不丢已有 turns
- **状态**：`[✅ 已完成]`
- **文件位置**：`services/visualization/tests/agent-event-reducer.test.ts`

### 13.15 Event reducer：`task_change` 驱动 activeTask / recentTasks

- **交互**：连续收到 `task_change(start/switch/resume)`
- **断言**：`activeTask` 更新；`recentTasks` 去重、保序、最多保留 8 条；当前 turn 带上 `taskLabel`
- **状态**：`[✅ 已完成]`
- **文件位置**：`services/visualization/tests/agent-event-reducer.test.ts`

### 13.16 Event reducer：`replay_gap`

- **交互**：收到 `replay_gap`
- **断言**：`replayGapDetected=true`；已有会话内容不被清空；后续事件仍可继续累积
- **状态**：`[✅ 已完成]`
- **文件位置**：`services/visualization/tests/agent-event-reducer.test.ts`

### 13.17 Event reducer：session scope error

- **交互**：收到 `error(scope="session")`
- **断言**：`sessionError` 被写入；当前 turns 保留；不误把最后一轮 turn 标成失败
- **状态**：`[✅ 已完成]`
- **文件位置**：`services/visualization/tests/agent-event-reducer.test.ts`

### 13.18 Event reducer：保留 `artifact_ref`

- **交互**：`tool_call_start` 后收到带 `artifact_ref` 的 `tool_call_result`
- **断言**：tool call state 记录 `artifactRef`，为后续 artifact 下载入口保留契约
- **状态**：`[✅ 已完成]`
- **文件位置**：`services/visualization/tests/agent-event-reducer.test.ts`

### 13.19 `MnaClient` 401 后重新 bootstrap 一次

- **交互**：首次 REST 请求返回 401，客户端重新拉 `/api/agent/token` 后重试一次
- **断言**：只重试一次；第二次请求带新 token；仍失败时向上抛清晰错误
- **状态**：`[✅ 已完成]`
- **文件位置**：`services/visualization/tests/mna-client.test.ts`

### 13.20 `MnaClient` WebSocket 重连携带 `last_event_id`

- **交互**：WS 正常收过事件后断线重连
- **断言**：重连 URL 带最新 `last_event_id`；连接恢复后继续发心跳；超过重试上限后进入 `closed`
- **状态**：`[✅ 已完成]`
- **文件位置**：`services/visualization/tests/mna-client.websocket.test.ts`

---

## 14. 前端 UI E2E（Playwright，L3）

> 所有 Playwright 用例共享 `global-setup.mjs` 启动的真实 mna + runtime + storage + provider stub。本节只保留当前仍未闭环、需要重写、或尚未补齐的页面交互项；已经完成的页面用例统一移到 14.0 归档，避免和现状混淆。

### 14.0 已完成归档（不纳入当前缺口）

- `UI-01 会话启动 + 流式回复`：已完成，覆盖连接态、发送消息、流式回复、首轮 injection / 空态；文件位置 `services/visualization/tests/agent-e2e/agent-core.spec.ts`
- `UI-02 Memory mode 切换 + 再问偏好`：已完成，覆盖切换 `workspace_only` 后再次追问偏好；文件位置 `services/visualization/tests/agent-e2e/agent-core.spec.ts`
- `UI-03 Prompt Inspector 打开`：已完成，覆盖打开弹框并查看 `Tool count`；文件位置 `services/visualization/tests/agent-e2e/agent-core.spec.ts`
- `UI-04 文件预览（Monaco）`：已完成，覆盖打开 `README.md` 并渲染 `file-preview`；文件位置 `services/visualization/tests/agent-e2e/agent-core.spec.ts`
- `UI-05 Session 改标题 + 删除`：已完成，覆盖创建会话、改标题、删除；文件位置 `services/visualization/tests/agent-e2e/agent-core.spec.ts`
- `UI-06 工具调用 + 确认弹窗 + deny / allow_session`：已完成，覆盖 `fs_read`、`fs_write`、`mcp_call`、MCP restart / disable；文件位置 `services/visualization/tests/agent-e2e/agent-tools-mcp.spec.ts`
- `UI-09 /runs trace_id 联动`：已完成，覆盖消息发送后在 `/runs` 页面按 `trace_id` 回查；文件位置 `services/visualization/tests/agent-e2e/agent-runs.spec.ts`
- `UI-10 其他 visualization 页面不受影响`：已完成，覆盖 `/memories`、`/dashboard` 正常访问；文件位置 `services/visualization/tests/agent-e2e/agent-runs.spec.ts`

### 14.1 UI-07 Runtime down 降级（需重写断言）

- **交互**：`stopRuntime` → 页面 reload → 继续发送消息；`restartRuntime` 后再次 reload 并继续发送消息
- **断言**：
  - runtime 停止后页面 `agent-degraded-banner` 可见
  - dependency card 中 runtime 状态应落到 `unavailable / degraded / unknown`
  - runtime 重启后页面仍可恢复连接并继续发送消息
  - 当前不要把“dependency card 必回 `healthy`”写成必过断言，因为现有自动化并没有覆盖这一点
- **状态**：`[⚙️ 部分完成]`（runtime down 降级与恢复后继续对话已覆盖；“恢复后依赖卡片回 healthy”这一断言需要重写）
- **文件位置**：`services/visualization/tests/agent-e2e/agent-recovery.spec.ts`

### 14.2 UI-08 Mna down 页面离线态

- **交互**：`stopMna` → 页面 reload
- **断言**：
  - 页面显示 `agent-offline-state`
  - 不再展示可交互的在线工作区
  - 离线描述明确指向 mna 不可用，而不是泛化成未知错误
- **状态**：`[✅ 已完成]`（已纳入 Playwright 回归并验证离线态）
- **文件位置**：`services/visualization/tests/agent-e2e/agent-recovery.spec.ts`

### 14.3 UI-09 Mna restart 后自动恢复连接

- **交互**：`stopMna` → 页面进入离线态 → `restartMna` → 页面自动恢复连接
- **断言**：
  - 不需要手工重建会话
  - 连接态回到 `open / connecting / reconnecting`
  - 恢复连接后可以继续在当前页面发送消息
- **状态**：`[✅ 已完成]`（已补前端 bootstrap 自动重试、WS 重连强制刷新 token、测试栈固定 mna 重启端口，`agent-recovery.spec.ts` 已真实通过）
- **文件位置**：`services/visualization/tests/agent-e2e/agent-recovery.spec.ts`

### 14.4 UI-10 Record / Replay provider 驱动的确定性 UI 用例

- **交互**：使用固定 provider 输出脚本驱动同一轮 UI 交互，确保页面断言不依赖随机模型输出
- **断言**：
  - 固定输入对应固定 phase、固定 assistant 输出、固定工具调用序列
  - 可以作为后续 UI 回归的稳定基线
- **状态**：`[✅ 已完成]`
- **文件位置**：
  - `services/visualization/tests/agent-e2e/agent-record-replay.spec.ts`
  - `services/memory-native-agent/tests/e2e/record-replay-provider.e2e.test.ts`

### 14.5 UI-11 语言切换（Locale Switch）

- **交互**：在页面顶部切换 `zh-CN ⇄ en-US`
- **断言**：
  - 标题、按钮、空态、离线态文案立即切换
  - 已有会话内容和历史消息不被清空
  - 刷新页面后沿用用户刚刚选择的 locale
- **状态**：`[✅ 已完成]`
- **文件位置**：`services/visualization/tests/agent-e2e/agent-extra-ui.spec.ts`
- **新增建议**：新增 `services/visualization/tests/agent-e2e/agent-locale.spec.ts`

### 14.6 UI-12 Provider Switch（模型切换与刷新状态）

- **交互**：修改 `model` 输入框 → 点击“应用模型 / Apply”；再点击“刷新状态 / Refresh status”
- **断言**：
  - 点击应用后 provider 标签或依赖状态中的 model 展示发生更新
  - 再发起一轮对话时，Prompt Inspector 或依赖信息体现新 model 已生效
  - 点击刷新后会重新拉取 provider / dependency / metrics，不要求用户刷新整页
- **状态**：`[✅ 已完成]`
- **文件位置**：`services/visualization/tests/agent-e2e/agent-extra-ui.spec.ts`
- **新增建议**：新增 `services/visualization/tests/agent-e2e/agent-provider.spec.ts`

### 14.7 UI-13 顶部刷新按钮

- **交互**：点击左侧会话区顶部刷新按钮
- **断言**：
  - 会重新拉取 metrics、dependency status、MCP state
  - 当 runtime / mcp 状态发生变化时，页面对应卡片同步更新
  - 不影响当前 session、消息历史和输入框内容
- **状态**：`[✅ 已完成]`
- **文件位置**：`services/visualization/tests/agent-e2e/agent-refresh.spec.ts`
- **新增建议**：新增 `services/visualization/tests/agent-e2e/agent-refresh.spec.ts`

### 14.8 UI-14 中止当前轮次（Abort）

- **交互**：发送一个可持续输出的请求，在流式回复过程中点击“中止 / Abort”或按 `Escape`
- **断言**：
  - 当前轮次进入 `abort` 收敛态
  - 页面不再继续追加新的 `assistant_delta`
  - 中止按钮在轮次结束后恢复禁用
- **状态**：`[✅ 已完成]`（`Escape` 中止和流式中断已覆盖；“中止按钮恢复禁用”这条仍作为后续细化断言）
- **文件位置**：`services/visualization/tests/agent-e2e/agent-extra-ui.spec.ts`
- **新增建议**：新增 `services/visualization/tests/agent-e2e/agent-abort.spec.ts`

### 14.9 UI-15 已有会话切换与历史恢复

- **交互**：创建两个会话，分别发送不同消息，再切换左侧 session card
- **断言**：
  - 切换会话后当前消息历史、Prompt Inspector、Memory Panel 都跟着切换
  - 返回之前的会话时，原消息历史保持不变
  - 当前选中态和 URL 中的 `sessionId` 一致
- **状态**：`[✅ 已完成]`
- **文件位置**：`services/visualization/tests/agent-e2e/agent-extra-ui.spec.ts`
- **新增建议**：新增 `services/visualization/tests/agent-e2e/agent-session-switch.spec.ts`

### 14.10 UI-16 `/agent/[sessionId]` 深链恢复

- **交互**：直接打开已有会话的 `/agent/<sessionId>`，或在该页面手工刷新
- **断言**：
  - 页面能直接 hydrate 到对应 session
  - 不会误跳到别的 session，也不会重新创建新 session
  - 连接建立后可以继续在该 session 上发送消息
- **状态**：`[✅ 已完成]`
- **文件位置**：`services/visualization/tests/agent-e2e/agent-extra-ui.spec.ts`
- **新增建议**：新增 `services/visualization/tests/agent-e2e/agent-deeplink.spec.ts`

### 14.11 UI-17 文件树目录导航

- **交互**：先打开目录，再打开子目录中的文件
- **断言**：
  - 文件树当前 path 会更新
  - 目录展开后可以继续进入下一层
  - 打开文件后 `file-preview` 显示正确路径和内容，不局限于根目录 `README.md`
- **状态**：`[✅ 已完成]`
- **文件位置**：`services/visualization/tests/agent-e2e/agent-extra-ui.spec.ts`
- **新增建议**：新增 `services/visualization/tests/agent-e2e/agent-file-tree.spec.ts`

### 14.12 UI-18 shell 黑名单前端反馈

- **交互**：发送会触发危险 `shell_exec` 的请求
- **断言**：
  - 工具控制台出现 `shell_exec`
  - 页面显示 `blocked_pattern / tool_denied_pattern` 对应拒绝结果
  - 这类黑名单拒绝不会被伪装成普通执行失败
- **状态**：`[✅ 已完成]`
- **文件位置**：`services/visualization/tests/agent-e2e/agent-shell-deny.spec.ts`
- **新增建议**：新增 `services/visualization/tests/agent-e2e/agent-shell-deny.spec.ts`

### 14.13 UI-19 replay gap 提示

- **交互**：断线后用过旧的 `last_event_id` 恢复，触发 `replay_gap`
- **断言**：
  - 页面明确提示"连接恢复但部分事件丢失"
  - 已有消息不被清空
  - 后续继续发送新消息仍可正常完成
- **状态**：`[✅ 已完成]`
- **文件位置**：`services/visualization/tests/agent-e2e/agent-extra-ui.spec.ts`
- **新增建议**：新增 `services/visualization/tests/agent-e2e/agent-replay-gap.spec.ts`

### 14.14 UI-20 session 级错误提示

- **交互**：后端发出 `error(scope="session", code="session_store_unavailable")`
- **断言**：
  - 页面出现非阻塞错误提示
  - 当前 turns 和输入区保留
  - 用户仍可继续发起下一轮对话
- **状态**：`[✅ 已完成]`
- **文件位置**：`services/visualization/tests/agent-e2e/agent-extra-ui.spec.ts`
- **新增建议**：新增 `services/visualization/tests/agent-e2e/agent-session-error.spec.ts`

### 14.15 UI-21 输入框键盘交互

- **交互**：输入框分别按 `Enter`、`Shift+Enter`、流式期间按 `Escape`
- **断言**：
  - `Enter` 提交当前消息
  - `Shift+Enter` 只换行，不提交
  - 流式期间 `Escape` 等价于点击 `Abort`
- **状态**：`[✅ 已完成]`
- **文件位置**：`services/visualization/tests/agent-e2e/agent-extra-ui.spec.ts`
- **新增建议**：新增 `services/visualization/tests/agent-e2e/agent-input-shortcuts.spec.ts`

---

## 15. Continuum CLI（T13）

### 15.1 `parseArgs` 解析 start / status / stop

- **状态**：`[✅ 已完成]`
- **文件位置**：`packages/continuum-cli/tests/cli.test.ts`

### 15.2 `parseArgs` 解析 `continuum mna <...>` 子命令

- **断言**：`mna start --mna-port 4193 --mna-home C:/tmp/.mna` 正确切段；help 文本含 `<install|start|stop|logs|token>`
- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 15.3 `runStatusCommand --strict` 失败返回非零

- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 15.4 `resolveManagedMnaProviderConfig` 回退 demo provider

- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 15.5 `resolveManagedMnaProviderConfig` 偏好 DeepSeek env

- **状态**：`[✅ 已完成]`
- **文件位置**：同上

### 15.6 `continuum start` 起 mna 后 `/healthz` 可达

- **交互**：`continuum start --open` → 轮询 /healthz 10s 内 ok
- **状态**：`[👤 人工复核]`
- **对应人工项**：`acceptance-checklist.md` §1

### 15.7 `continuum status` 显示 mna 行

- **状态**：`[👤 人工复核]`

### 15.8 `continuum stop` 反向回收所有服务

- **断言**：SIGINT 3s 内退；3s 后 SIGKILL；无端口占用
- **状态**：`[👤 人工复核]`

### 15.9 `continuum mna install` vendor 打包

- **状态**：`[✅ 已完成]`
- **文件位置**：`packages/continuum-cli/tests/mna-install.test.ts`

### 15.10 `continuum mna token --rotate` 生效

- **状态**：`[👤 人工复核]`（`acceptance-checklist.md` 明确尚需轮换引导）

### 15.11 `continuum mna logs` 拉日志

- **断言**：`--tail N` 目前未实现，输出完整文件
- **状态**：`[⚙️ 部分完成]`（当前已覆盖完整日志输出与未托管报错；`--tail N` 仍未实现）
- **文件位置**：`packages/continuum-cli/tests/mna-command.test.ts`
- **新增建议**：补 `--tail` 行为或显式去掉该预期

### 15.12 端口冲突时启动失败

- **断言**：mna 默认端口已占用 → start 流程整体失败，不留半启动
- **状态**：`[⏳ 待开始]`

### 15.13 `continuum status --json` 输出 `mna` 详情

- **交互**：执行 `continuum status --json`
- **断言**：JSON 中包含 `mna.url`、`mna.tokenPath`、`mna.artifactsPath`、`mna.dependency`
- **状态**：`[✅ 已完成]`
- **文件位置**：`packages/continuum-cli/tests/cli.test.ts`

### 15.14 `continuum mna token` 打印当前 token

- **交互**：执行 `continuum mna token`
- **断言**：读取并输出 token 文件内容；无 token 时输出空串或明确提示，不抛未处理异常
- **状态**：`[✅ 已完成]`
- **文件位置**：`packages/continuum-cli/tests/mna-command.test.ts`

### 15.15 `continuum mna logs` 未托管时明确报错

- **交互**：在未通过 continuum 托管启动 mna 的情况下执行 `continuum mna logs`
- **断言**：返回明确错误，不输出误导性空内容
- **状态**：`[✅ 已完成]`
- **文件位置**：`packages/continuum-cli/tests/mna-command.test.ts`

### 15.16 `continuum mna stop` 幂等

- **交互**：mna 未运行时执行 `continuum mna stop`
- **断言**：命令返回成功；输出"当前未运行"之类的 no-op 结果；不会误删其他 managed state
- **状态**：`[✅ 已完成]`
- **文件位置**：`packages/continuum-cli/tests/mna-command.test.ts`

### 15.17 `continuum mna start` 缺 vendor 时明确失败

- **交互**：vendor 目录或入口文件缺失时执行 `continuum mna start`
- **断言**：给出明确错误提示；不写入伪 managed record
- **状态**：`[✅ 已完成]`
- **文件位置**：`packages/continuum-cli/tests/mna-command.test.ts`

### 15.18 `continuum mna start` 遇到已健康实例时复用

- **交互**：已有被托管且健康的 mna，再次执行 `continuum mna start`
- **断言**：不重复 spawn；直接返回现有 `url / tokenPath / artifactsPath`
- **状态**：`[✅ 已完成]`
- **文件位置**：`packages/continuum-cli/tests/mna-command.test.ts`

---

## 16. 可观测接口（metrics / openapi）

### 16.1 `/v1/agent/openapi.json` 输出

- **断言**：`openapi:"3.1.0"` + `paths["/v1/agent/sessions"]` 存在；可被 openapi-typescript 消费
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/http/__tests__/sessions.test.ts`

### 16.2 `/v1/agent/metrics` 基础字段

- **断言**：返回 `uptime_s / turns_total / turns_by_finish_reason / provider_calls_total / tool_invocations_total / stream_flushed_events_total / runtime_errors_total / latency_p50_ms / latency_p95_ms`
- **状态**：`[⚙️ 部分完成]`（基础计数字段已覆盖；文档里提到的 `latency_p50_ms / latency_p95_ms` 当前实现和测试都还没有）
- **文件位置**：`src/http/__tests__/health-routes.test.ts`
- **新增建议**：若需要延迟指标，先补实现再补测

### 16.3 abort 后 `stream_dropped_after_abort_total` ↑

- **断言**：跑一轮 abort 后 metrics 对应计数增加
- **状态**：`[✅ 已完成]`
- **文件位置**：`src/http/__tests__/health-routes.test.ts`

### 16.4 provider error 分类

- **断言**：429 / 5xx / timeout 各自落到不同 bucket
- **状态**：`[⏳ 待开始]`

---

## 17. 错误码枚举（T08 §3.12）

对每个 `code` 至少覆盖一次，断言 4xx/5xx 响应 body 与 WS `error` 事件的 code/message 结构。

| code | 覆盖来源 | 状态 |
| :--- | :--- | :--- |
| `token_invalid` | 2.1 / 2.2 | `[✅ 已完成]` |
| `token_expired` | 预留 | `[⏳ 待开始]`（首版不触发） |
| `session_not_found` | 3.2 | `[✅ 已完成]` |
| `turn_not_found` | 10.10 | `[✅ 已完成]` |
| `workspace_mismatch` | — | `[⏳ 待开始]` |
| `runtime_unavailable` | 12.2 | `[✅ 已完成]` |
| `provider_not_registered` | 3.8 | `[✅ 已完成]` |
| `provider_auth_failed` | 7.6 | `[✅ 已完成]` |
| `provider_rate_limited` | 7.4 | `[✅ 已完成]`（provider 层）/ WS 层 `[⏳ 待开始]` |
| `provider_timeout` | T04 3.4.0 | `[✅ 已完成]` |
| `provider_stream_error` | 4.6 | `[⚙️ 部分完成]`（后端顺序已覆盖；WS/页面级仍待补） |
| `tool_denied_path` | 3.2、8.2 | `[✅ 已完成]` |
| `tool_denied_pattern` | 8.7 | `[✅ 已完成]` |
| `tool_confirm_timeout` | 8.15 | `[⏳ 待开始]` |
| `mcp_disconnected` | 8.12 | `[✅ 已完成]` |
| `abort_ack` | 4.7 | `[⚙️ 部分完成]`（`turn_end(abort)` 已覆盖；错误码表驱动未单列） |
| `session_store_unavailable` | 5.12 | `[✅ 已完成]` |
| `api_version_mismatch` | 1.2 | `[⏳ 待开始]` |

**新增建议统一文件**：`src/http/__tests__/error-codes.table.test.ts`（表驱动）

---

## 18. 性能与预算（非阻塞）

| 指标 | 约束（`memory-module-contract.md` §8/9） | 自动化状态 |
| :--- | :--- | :--- |
| `prepareContext` P95 | ≤ 800ms | `[⏳ 待开始]` |
| provider first_token P95 | ≤ 2s | `[⏳ 待开始]` |
| 注入块 token_estimate ≤ 512 | 不挤爆上下文 | `[⏳ 待开始]` |
| 单轮注入记录 ≤ 7 条 | 遵守 §8 | `[⏳ 待开始]` |

首版不做压测，但可以在 E2E 层做**上限断言**（如 injection_block.memory_records.length ≤ 7）。

---

## 19. 契约符合性检查

### 19.1 request body `host` 字段一致性

- **断言**：所有 runtime 调用 body.host 都是 `"memory_native_agent"`
- **状态**：`[✅ 已完成]`（见 6.1）

### 19.2 scope 正式枚举（session / task / workspace / user）

- **断言**：
  - `prepareContext` 响应 `injection_block.requested_scopes` 只用这四个
  - `workspace_only` 模式下 `selected_scopes` 不含 `user`
- **状态**：`[⚙️ 部分完成]`（mode-switch e2e 间接覆盖）
- **新增建议**：加显式断言

### 19.3 写回候选只带正式 scope

- **断言**：`writeback_submissions` 的 scope ∈ `{session, task, workspace, user}`
- **状态**：`[⚙️ 部分完成]`

### 19.4 visualization 后端不调 mna 主链路

- **断言**：visualization 的 API route 不出现 `prepare-context` / `finalize-turn` 调用
- **状态**：`[✅ 已完成]`
- **文件位置**：`services/visualization/tests/contract-no-runtime-call.test.ts`

---

## 20. 新增测试落地优先级建议

按"回归风险大 + 当前覆盖缺失"排序：

1. **错误码枚举表驱动测试**（§17）—— 一次搞完大部分 REST/WS 失败路径
2. **Token / bootstrap / 离线原因测试**（2.6、13.7 ~ 13.9）—— 这是 `/agent` 首屏能不能正确恢复的前提
3. **Mid-stream 错误顺序** + **abort 传播**（4.6 / 4.7 / 7.11）—— 前端 reducer 状态机核心依赖
4. **WS 客户端重连 + replay gap**（4.8、13.16、13.20、14.13）—— 真实网络波动下的核心体验
5. **Prompt inspector HTTP 路由 + dispatched_messages**（10.10）—— T11 依赖
6. **Provider 切换端点**（3.8）—— T11 provider-switch UI 依赖
7. **MCP 管理 HTTP 路由 + restart / disable**（9.7 ~ 9.10）—— T11 mcp-panel 依赖
8. **补齐剩余页面交互 Playwright 用例**（§14）—— 优先补 `mna` 恢复、shell 黑名单、session error、keyboard shortcuts
9. **CLI 真命令交互**（15.13 ~ 15.18）—— 用户实际交付链路不能只停留在参数解析
10. **Metrics 端点 + contract-no-runtime-call**（§16、19.4）—— 监控与契约层兜底

---

## 21. 维护约定

- 新增交互点必须先补到本文档，再开发代码与测试。
- 每次 PR 若改动 T01 ~ T14 中某任务，需要同步勾转本文档对应小节状态。
- 状态从 `[⏳ 待开始]` → `[⚙️ 部分完成]` → `[✅ 已完成]`，回退时要在 PR 里解释为什么降级。
- 本文档不直接写测试代码；但"新增建议"字段给出了推荐文件名，落地时以该名字为准。
- 每个季度或发版前，按清单复核一次，清理已过时用例并把 `[👤 人工复核]` 项尽量自动化。
