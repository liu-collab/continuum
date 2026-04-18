# T08 — HTTP + WebSocket API 服务端

## 1. 目标

在 `services/memory-native-agent/` 里暴露 agent 主链路的对外接口，让 visualization 前端（T11）能通过 HTTP + WebSocket 与 agent 对话、观察工具调用、响应权限确认。

这一层是 mna 后端与浏览器前端之间的**正式契约**，改动需回写到本任务文档。

## 2. 前置依赖

- T07 AgentRunner 完成（主循环与事件发射能力）。

## 2.1 当前状态

- 状态：已完成
- 完成时间：当前阶段收口
- 已落地范围：
  - `server.ts` 已接入 `loadConfig`、`runtimeState`、HTTP 路由装配与关闭清理
  - `health / ready / dependency-status / metrics / openapi` 已对外暴露
  - `sessions / mode / provider / dispatched-messages / fs / artifacts / mcp` 已落地
  - WebSocket 已支持 `session_started`、turn 事件推送、confirm 回传、事件缓冲与 `last_event_id` 回放
  - `sessions.test.ts`、`session-ws.test.ts`、`smoke.test.ts` 已覆盖主链路
- 当前已知保留项：
  - 仍未单独拆出 `turns.ts / files.ts / tools.ts` 物理文件，当前实现集中在 `sessions.ts` 与 `ws/session-ws.ts`
  - `provider` 切换仍是单 provider 注册下的下一轮占位返回，真正多 provider 运行时切换留待后续阶段
  - 尚未补 CORS 配置与 Prometheus 文本格式，当前仍按本地回环单机场景收口

## 3. 交付物

### 3.1 文件清单

```
src/http/
├── index.ts                # 装配所有路由
├── routes/
│   ├── health.ts           # /healthz /readyz /dependency-status
│   ├── sessions.ts         # /v1/agent/sessions
│   ├── turns.ts            # /v1/agent/turns（提交 + 流）
│   ├── tools.ts            # /v1/agent/tools/confirm
│   ├── files.ts            # /v1/agent/fs/*（文件树、预览）
│   └── mcp.ts              # /v1/agent/mcp/servers
├── ws/
│   ├── session-ws.ts       # WebSocket 主事件通道
│   └── event-codec.ts      # 事件序列化
├── middleware/
│   ├── cors.ts             # CORS 仅允许 visualization 源
│   └── auth.ts             # 本地鉴权（token 或 loopback）
└── __tests__/
    ├── sessions.test.ts
    ├── turns.test.ts
    └── session-ws.test.ts
```

### 3.2 HTTP REST 端点

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| GET | `/healthz` | liveness（同时返回 `api_version` 与 `runtime_min_version`，见 §3.8） |
| GET | `/readyz` | readiness（含 runtime 依赖） |
| GET | `/v1/agent/dependency-status` | 依赖详情：runtime / provider / mcp 列表 |
| GET | `/v1/agent/metrics` | 运行指标（见 §3.9） |
| POST | `/v1/agent/sessions` | 创建会话，返回 `{session_id, ws_url, memory_mode, workspace_id}` |
| GET | `/v1/agent/sessions` | **列表**：按 `workspace_id` 过滤，`last_active_at DESC`，游标分页 |
| GET | `/v1/agent/sessions/:id` | 获取会话元数据与消息历史（来自 T14 session-store） |
| PATCH | `/v1/agent/sessions/:id` | 改 `title`（其他字段只读） |
| DELETE | `/v1/agent/sessions/:id` | 软关闭会话；`?purge=all` 触发物理清理（含 artifact + store 记录，见 T14 §3.6） |
| POST | `/v1/agent/sessions/:id/mode` | 切换 `memory_mode` |
| POST | `/v1/agent/sessions/:id/provider` | 运行时切换 provider / model（见 §3.10） |
| POST | `/v1/agent/turns` | 提交一轮输入（非流式场景或初始化） |
| GET | `/v1/agent/turns/:turn_id/dispatched-messages` | 查看该轮发给 provider 的完整 messages + tools（prompt inspector，见 §3.11） |
| GET | `/v1/agent/fs/tree?path=...` | 工作区文件树（受限在 workspace_root 内） |
| GET | `/v1/agent/fs/file?path=...` | 文件内容预览 |
| GET | `/v1/agent/artifacts/:session_id/:call_id` | 工具输出 artifact 下载（见 T12 第 4 节） |
| GET | `/v1/agent/mcp/servers` | 已连接的 MCP server 列表与工具清单 |
| POST | `/v1/agent/mcp/servers/:name/restart` | 重启指定 MCP server（见 T06） |
| POST | `/v1/agent/mcp/servers/:name/disable` | 运行时禁用（下次启动按配置恢复） |

权限确认**只走 WebSocket**（`tool_confirm` 事件），不提供 REST 入口，避免双通道状态同步 bug。

#### POST /v1/agent/sessions 请求 schema

```json
{
  "workspace_id": "project-abc",
  "memory_mode": "workspace_plus_global",
  "locale": "zh-CN"
}
```

- `workspace_id`（必填）：工作区标识，用于 session 列表过滤与记忆隔离
- `memory_mode`（可选）：默认从 `AgentConfig.memory.mode` 读取
- `locale`（可选）：会话语言，优先级见 T12 §10.3；固化到 `sessions.locale` 列（T14）

响应：

```json
{
  "session_id": "sess_abc123",
  "ws_url": "ws://127.0.0.1:4193/v1/agent/sessions/sess_abc123/ws?token=...",
  "memory_mode": "workspace_plus_global",
  "workspace_id": "project-abc",
  "locale": "zh-CN"
}
```

### 3.3 WebSocket 事件通道

- URL：`ws://127.0.0.1:4193/v1/agent/sessions/:id/ws`
- 鉴权：查询参数 `?token=...` 或 Cookie，首次 `/v1/agent/sessions` 创建时下发

#### 客户端 → 服务端

```ts
type ClientEvent =
  | { kind: "user_input"; turn_id: string; text: string }
  | { kind: "abort"; turn_id: string }
  | { kind: "tool_confirm"; confirm_id: string; decision: "allow" | "deny" | "allow_session" }
  | { kind: "ping" };
```

#### 服务端 → 客户端

```ts
type ServerEvent =
  | { kind: "session_started"; session_id: string; memory_mode: MemoryMode; workspace_id: string }
  | { kind: "phase_result"; turn_id: string; phase: Phase; trace_id: string; degraded: boolean; injection_summary?: string }
  | { kind: "task_change"; turn_id: string; change: "start" | "switch" | "resume"; task_id: string; label: string; previous_task_id?: string }
  | { kind: "injection_banner"; turn_id: string; injection: InjectionSummary | null; degraded: boolean }
  | { kind: "assistant_delta"; turn_id: string; text: string }
  | { kind: "tool_call_start"; turn_id: string; call_id: string; name: string; args_preview: string }
  | { kind: "tool_confirm_needed"; confirm_id: string; call_id: string; tool: string; params_preview: string; risk_hint?: "write" | "shell" | "mcp" }
  | { kind: "tool_call_result"; call_id: string; ok: boolean; output_preview: string; artifact_ref?: string }
  | { kind: "turn_end"; turn_id: string; finish_reason: string }
  | { kind: "error"; scope: "turn" | "session"; code: string; message: string }
  | { kind: "pong" };
```

`phase_result` 事件在**每一次** prepareContext 调用返回后发出，前端可以按 phase 分别展示哪一段记忆来自 `task_switch` / `task_start` / `before_plan` / `before_response`。
`task_change` 事件在 runner 的 `trigger-detector` 识别出任务事件时发出（早于对应的 `phase_result`）。

#### 事件流样例（单轮同时命中任务切换 + 规划）

```
→ user_input(turn_id=t1, text="换到另一个仓库。帮我规划一下这次重构。")
← task_change(t1, change="switch", task_id=T2, label="重构另一个仓库", previous_task_id=T1)
← phase_result(t1, phase="task_switch", trace_id=..., degraded=false)
← phase_result(t1, phase="task_start", trace_id=..., degraded=false)
← phase_result(t1, phase="before_plan", trace_id=..., degraded=false)
← phase_result(t1, phase="before_response", trace_id=..., degraded=false)
← injection_banner(t1, {reason, summary_text, record_count:6}, degraded:false)
← assistant_delta(t1, "好的，...")
← turn_end(t1, "stop")
```

#### 事件流样例（纯对话轮）

```
→ user_input(turn_id=t2, text="...")
← phase_result(t2, phase="before_response", ...)
← injection_banner(t2, {...}, degraded:false)
← assistant_delta(t2, "...")
← turn_end(t2, "stop")
```

### 3.4 权限确认流程

1. 工具调用触发 `tool_confirm_needed` WebSocket 事件
2. 前端弹对话框，用户选择 → WS 发送 `tool_confirm` 事件
3. 后端 `RunnerIO.requestConfirm` Promise 被 resolve
4. 后端继续执行或跳过工具

确认超时：前端 60s 未回，后端当 `deny` 处理并发 `tool_call_result` 带错误。

### 3.4.1 WebSocket 重连与事件缓冲

- 断线后服务端保留 session，**内存缓冲上限 200 条事件 / 10 分钟 TTL**
- 客户端重连时带 `?last_event_id=<n>` 查询参数，服务端从缓冲里补发
- 缓冲超限或 TTL 过期时丢弃未投递事件；客户端察觉后：
  - 已结束的 turn：从 `/v1/agent/sessions/:id` 拿最终状态
  - 进行中的 turn：显示"连接恢复但部分事件丢失"提示，下一轮正常

### 3.5 CORS 与鉴权

- 仅允许 origin：`http://127.0.0.1:3000`（visualization dev）与配置文件 `cors.allowed_origins`
- **Token 引导与分发统一遵守 T12 第 2 节**。mna 启动时通过 `src/shared/token.ts` 生成或读取 `~/.mna/token.txt`
- 鉴权：`Authorization: Bearer <token>`（REST）或 WS 查询参数 `?token=<token>`
- 防止远程机器访问：监听只绑 `127.0.0.1`

### 3.6 流式与回压

- WebSocket 文本消息，每条独立事件，不做多事件拼包（简化前端解析）
- **`assistant_delta` 的合批与顺序规则由 T12 §9 流式输出协议统一定义**（默认每 32 字符或 30ms 刷一次；mid-stream 错误后 `error` 先于 `turn_end` 发出）
- 服务端若 `provider.chat()` 产生 delta 过快，用 `p-queue` 按 session 串行化；不做 per-chunk 回压
- 客户端 `abort` 事件触发 `AbortController.abort()`，provider 要尊重 signal，后续残余 chunk 一律丢弃

### 3.7 OpenAPI schema

导出 `src/http/openapi.ts` 生成 OpenAPI 3.1 文档，`/v1/agent/openapi.json` 对外暴露。
T11 前端据此生成类型。

### 3.8 API 版本握手

`GET /healthz` 返回体（扩展自 T01 §3.4）：

```json
{
  "status": "ok",
  "version": "0.1.0",
  "api_version": "v1",
  "runtime_min_version": "0.1.3",
  "dependencies": { "retrieval_runtime": "reachable" }
}
```

mna 启动时主动探 `GET {RUNTIME_BASE_URL}/v1/runtime/healthz`，读 runtime 的 `version`，若 < `runtime_min_version` 直接 fail-fast（退出码 4）+ 明确错误提示。这样 continuum 升级顺序错了会立刻暴露，而不是运行中黑盒报错。

### 3.9 Metrics 端点

`GET /v1/agent/metrics` 返回结构化 JSON（首版不做 Prometheus 文本格式）：

```json
{
  "uptime_s": 3821,
  "turns_total": 42,
  "turns_by_finish_reason": { "stop": 38, "tool_use": 0, "length": 1, "error": 2, "abort": 1 },
  "provider_calls_total": { "openai-compatible:deepseek-chat": 42 },
  "provider_errors_total": { "rate_limited": 1, "timeout": 0, "5xx": 0 },
  "tool_invocations_total": { "fs_read": 50, "fs_write": 12, "shell_exec": 8, "mcp_call": 3 },
  "tool_denials_total": { "blocked_pattern": 1, "denied": 2, "timeout": 0 },
  "stream_flushed_events_total": 1923,
  "stream_dropped_after_abort_total": 7,
  "runtime_errors_total": { "timeout": 3, "5xx": 0, "dependency_unavailable": 2 },
  "latency_p50_ms": { "prepare_context": 210, "provider_first_token": 680 },
  "latency_p95_ms": { "prepare_context": 540, "provider_first_token": 1820 }
}
```

实现放 `src/metrics/` 目录；计数与 latency 桶都在内存，进程重启清零（不需要外部 TSDB）。

### 3.10 Provider 切换端点

`POST /v1/agent/sessions/:id/provider`

```json
{
  "provider_id": "anthropic",
  "model": "claude-sonnet-4-6",
  "temperature": 0.5
}
```

- 仅对**下一轮**生效，不打断当前进行中的 turn
- 要求目标 provider 已在 `AgentConfig.providers[]` 注册（T09 更新：provider 从单值改为列表）
- 未注册返回 400 + `code: provider_not_registered`
- 变更写 session-store `sessions.provider_override`（T14 可选扩展字段）

### 3.11 Prompt inspector 端点

`GET /v1/agent/turns/:turn_id/dispatched-messages`

返回该轮**最后一次**发给 provider 的内容（若一轮内有多次 tool 循环，返回最终那次；要看中间可加 `?round=n`）：

```json
{
  "turn_id": "...",
  "provider_id": "openai-compatible",
  "model": "deepseek-chat",
  "round": 2,
  "messages": [ /* 完整 system + 注入 + history + new user + tool results */ ],
  "tools": [ /* 本次发给 provider 的 tool schema 列表 */ ]
}
```

数据源是 T14 `dispatched_messages` 表。敏感字段（provider api key）不会出现在 messages 里，不需要额外 mask。

### 3.12 错误码枚举

所有 REST 4xx/5xx 响应体与 WS `error` 事件统一使用以下 `code`：

| code | 触发条件 | 建议前端处理 |
| :--- | :--- | :--- |
| `token_invalid` | Bearer/查询参数 token 不匹配或缺失 | 重新拉 `/agent/api/token` |
| `token_expired` | 预留，首版不会触发 | 同上 |
| `session_not_found` | 访问不存在的 session | 跳 `/agent` 创建新 session |
| `turn_not_found` | 访问不存在的 turn | 提示"记录已失效" |
| `workspace_mismatch` | session 的 workspace_id 与当前前端 workspace 不一致 | 切 workspace 或打开对应 session |
| `runtime_unavailable` | runtime 不可达 / 超时 | 显示降级条；允许继续 |
| `provider_not_registered` | 切换到未配置的 provider | 列可用 provider |
| `provider_auth_failed` | 401 from provider | 提示用户检查 api key |
| `provider_rate_limited` | 429（首次重试也失败） | 稍后重试按钮 |
| `provider_timeout` | provider 响应超时 | 同上 |
| `provider_stream_error` | 流中途异常 | 保留已收到的文本，允许重新提问 |
| `tool_denied_path` | fs 工具越权 | 红色提示 |
| `tool_denied_pattern` | shell 黑名单命中 | 同上，说明原因 |
| `tool_confirm_timeout` | 60s 未回 confirm | 退回 denied |
| `mcp_disconnected` | MCP server 未连接或掉线 | 给按钮 restart |
| `abort_ack` | 收到客户端 abort 后的回执（作为 turn_end 的 finish_reason，不作为 error） | 静默 |
| `session_store_unavailable` | T14 store 写入失败 | 顶部黄条提示持久化异常；对话继续 |
| `api_version_mismatch` | runtime 版本过低（仅启动时会出现） | 不到前端，server 直接退出 |

前端 reducer 只对 `code` 分支，不读 `message`。新增 code 必须在本表追加。

## 4. 实施步骤

1. 装 `@fastify/websocket`、`fastify-cors`、`zod`。
2. 实现 REST 路由，每条路由单独文件；用 zod schema 做入参/出参校验。
3. 实现 WebSocket 通道，封装 `EventEncoder`（JSON 序列化 + 心跳）。
4. 把 T07 的 `AgentRunner` 通过 `RunnerIO` 适配成事件发射：
   - `renderAssistantDelta` → `assistant_delta`
   - `renderToolCall` → `tool_call_start` / `tool_call_result`
   - `renderInjectionBanner` → `injection_banner`
   - `confirm` → `tool_confirm_needed` + 等待 WS `tool_confirm` 事件
5. 写 3 组测试：REST 正常/错误/边界；WS 一轮对话 happy path；权限确认超时路径。

## 5. 验收标准

- 7 条 REST 路由 + WebSocket 通道全部通过测试。
- `node bin/mna-server.mjs` 启动后，`curl` 能创建会话、`websocat` 能收到事件流。
- WebSocket 断线重连：服务端保留 session，重连后继续发送后续事件（至少 turn_end）。
- `/v1/agent/openapi.json` 可以通过 openapi-typescript 生成前端类型。
- 非 `127.0.0.1` 来源请求被拒。

## 6. 相关契约

- `docs/memory-module-contract.md` 第 5.2 节：注入三段内容（`injection_reason` / `memory_summary` / `memory_records`）
- `docs/architecture-independence.md` 第 4 节：跨服务调用约束（超时、显式错误）
- `docs/current-phase-closure-plan.md` 第 6.2 节：`memory_mode` 开关

## 7. 不在范围内

- 多用户鉴权（single_local_user 前提下用本地 token 即可）
- HTTPS / WSS（本地回环不要求 TLS）
- 跨域 credentials（不开放远端访问）
- 事件持久化（不存 SSE replay log，断线补发只靠 session 内存缓冲）
