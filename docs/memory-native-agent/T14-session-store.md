# T14 — 会话持久化、工具审计与清理

## 1. 目标

给 mna 提供**本地落盘的 session store**，承载三件"后端主链路之外、但首版必须"的数据：

- 会话元数据 + 每轮消息历史（mna 进程重启 / continuum stop / 崩溃后能恢复）
- 工具调用审计日志（谁在什么时候批准 / 拒绝了对哪个文件 / 命令的副作用）
- Artifact 清单与按需清理入口（包含用户主动 purge）

后端主链路（runtime、storage）**不感知** session-store：它是 mna 的本地资产，不跨服务。

## 2. 前置依赖

- T01 完成
- T07 主循环结构已就位（store 的写入点由 runner 触发）
- T08 接口层存在（list / purge 路由依赖本任务）

## 3. 交付物

### 3.1 文件清单

```
src/session-store/
├── index.ts                  # 导出 SessionStore
├── types.ts
├── sqlite-store.ts           # SQLite 实现（首版）
├── migrations/
│   └── 0001-init.sql
└── __tests__/
    ├── session-crud.test.ts
    ├── message-append.test.ts
    ├── audit-write.test.ts
    └── purge.test.ts
```

### 3.2 存储位置与技术选型

- 文件：`~/.mna/sessions.db`
- 技术：`better-sqlite3`（同步 API、单进程、部署简单；首版只有本地用户不追求并发）
- 迁移：首版 `0001-init.sql`，后续 schema 变更写新编号 sql 按序执行（启动时自动跑）
- 备份：不做自动备份；T13 `continuum mna` 追加一条 `continuum mna export --out <dir>` 打 tar 包（后续独立任务）

### 3.3 数据模型

```sql
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  title        TEXT,                 -- 用户可编辑；默认首轮 user 输入前 40 字
  memory_mode  TEXT NOT NULL,        -- workspace_only | workspace_plus_global
  locale       TEXT NOT NULL,        -- zh-CN | en-US，创建时固化（T12 §10.3）
  created_at   TEXT NOT NULL,        -- ISO8601
  last_active_at TEXT NOT NULL,
  closed_at    TEXT                  -- 软关闭；null = 仍可续对话
);
CREATE INDEX idx_sessions_ws_active ON sessions(workspace_id, last_active_at DESC);

CREATE TABLE turns (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_index   INTEGER NOT NULL,     -- 同 session 内递增
  task_id      TEXT,                 -- runner TaskState.id
  trace_id     TEXT,                 -- runtime 返回的 trace_id，关联 observability
  created_at   TEXT NOT NULL,
  finish_reason TEXT                 -- stop|tool_use|length|error|abort；null = 进行中
);
CREATE INDEX idx_turns_session ON turns(session_id, turn_index);

CREATE TABLE messages (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_id      TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  role         TEXT NOT NULL,        -- system|user|assistant|tool
  content      TEXT NOT NULL,
  tool_call_id TEXT,                 -- role=tool 时指向 tool_invocations.call_id
  token_in     INTEGER,              -- 仅 provider 上报时填；否则 null
  token_out    INTEGER,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_messages_turn ON messages(turn_id);

CREATE TABLE tool_invocations (
  call_id      TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_id      TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  tool_name    TEXT NOT NULL,        -- fs_read/fs_write/.../mcp_call
  args_hash    TEXT NOT NULL,        -- sha256(JSON.stringify(args)) —— 不存原文避免泄露
  args_preview TEXT,                 -- 首 512 字符（脱敏用）
  permission_decision TEXT NOT NULL, -- auto|allowed_once|allowed_session|denied|timeout|blocked_pattern
  exit_code    INTEGER,              -- shell_exec 专用；其他为 null
  ok           INTEGER NOT NULL,     -- 0|1
  error_code   TEXT,
  artifact_ref TEXT,                 -- ~/.mna/artifacts/... 相对路径
  duration_ms  INTEGER NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_tools_session ON tool_invocations(session_id, created_at DESC);

CREATE TABLE dispatched_messages (
  turn_id      TEXT PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,
  messages_json TEXT NOT NULL,       -- 发给 provider 的完整 messages 数组（system + injection + history）
  tools_json   TEXT NOT NULL,        -- 当次发给 provider 的 tool schema 列表
  provider_id  TEXT NOT NULL,
  model        TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
```

`dispatched_messages` 支撑前端"prompt 检查视图"（见 T11 §3.x）。内容可能很大（含注入的记忆块），不直接随 session GET 返回，按 turn 独立拉。

### 3.4 `SessionStore` 接口

```ts
export interface SessionStore {
  // sessions
  createSession(input: { workspace_id: string; user_id: string; memory_mode: MemoryMode; title?: string }): Session;
  getSession(id: string): Session | null;
  listSessions(filter: { workspace_id?: string; limit?: number; cursor?: string }): { items: SessionSummary[]; next_cursor: string | null };
  updateSession(id: string, patch: Partial<Pick<Session, "title" | "memory_mode" | "closed_at">>): void;
  deleteSession(id: string, opts: { purgeArtifacts: boolean }): void;

  // turns + messages
  openTurn(input: { session_id: string; task_id?: string }): Turn;
  appendMessage(input: AppendMessageInput): void;
  closeTurn(turn_id: string, finish_reason: string, trace_id?: string): void;
  getTurn(turn_id: string): { turn: Turn; messages: Message[]; tool_invocations: ToolInvocation[] } | null;
  getMessages(session_id: string, opts?: { before_turn_index?: number; limit?: number }): Message[];

  // audit
  recordToolInvocation(input: ToolInvocationInput): void;

  // prompt inspector
  saveDispatchedMessages(turn_id: string, payload: DispatchedMessagesPayload): void;
  getDispatchedMessages(turn_id: string): DispatchedMessagesPayload | null;
}
```

### 3.5 写入点约定

| 数据 | 写入者 | 时机 |
| :--- | :--- | :--- |
| `sessions` insert | T08 `POST /v1/agent/sessions` | 创建 session 时 |
| `turns` insert | T07 `AgentRunner.submit()` 进入 | 每轮开始 |
| `messages` insert (user) | T07 | 接到 `user_input` 后立即写（让重启后能看到最后一次输入） |
| `messages` insert (assistant) | T07 | 流式结束时**合并**写入完整文本；不按 chunk 写（见 T12 §9） |
| `messages` insert (tool) | T07 | 每次 tool_call 结果返回后 |
| `tool_invocations` | T05 `ToolDispatcher` | 每次工具调用结束（含拒绝、超时、黑名单拦截） |
| `dispatched_messages` | T07 | 每次发给 provider 前 snapshot |
| `turns` update finish_reason | T07 | turn 结束或 abort |

### 3.6 清理语义

- `DELETE /v1/agent/sessions/:id` — 只把 `closed_at` 置位，保留历史（默认）
- `DELETE /v1/agent/sessions/:id?purge=all` — **物理清理**：
  1. SQLite `DELETE FROM sessions WHERE id = ?`（CASCADE 到 turns/messages/tool_invocations/dispatched_messages）
  2. `rm -rf ~/.mna/artifacts/<session_id>/`
  3. 可选：调 storage 治理接口把本 session 写回的记忆软删——首版**不做**，文档里标 TODO
- 启动扫清理（T12 §4 已有）：artifact 目录超 7 天清理时，顺带把对应 session 的 `artifacts_purged_at` 打戳

### 3.7 恢复语义

mna 启动时：
1. 打开 db、跑未执行的 migration
2. 不预加载会话（懒加载，列表接口返回摘要即可）
3. 对 `finish_reason IS NULL` 的 turn 视为"崩溃时的残局"——启动时批量改为 `finish_reason = "crashed"`，前端看到这些轮次显示灰色"中断未完成"，不允许继续在同一个 turn 上续写（鼓励用户重发）

### 3.8 与 runtime session_id 的关系

- mna 的 `session_id` 等于 runtime 的 `session_id`（同一个 UUID 透传）
- mna 可单独在本地建 session 但 runtime 没感知，只有首轮 `session_start` 调用时 runtime 才登记
- 用户 purge 某 session 时，runtime / storage 侧可能仍有关联观测数据（trace_id 指向它）——这是**预期行为**：observability 数据留用于问题排查；记忆写回数据按 7.x 节的 TODO 接入治理

## 4. 实施步骤

1. 装 `better-sqlite3`，写 `0001-init.sql` migration。
2. 写 `sqlite-store.ts`，每张表 CRUD + 事务封装。
3. 补 4 组单测（session CRUD / message append / audit write / purge）。
4. 在 T07 runner 的每个写入点加 store 调用。store 失败**只打 warn 日志**，不阻断对话（store 不可用 ≠ 对话不能继续）。
5. 在 T05 dispatcher 的工具调用出口加 `recordToolInvocation`。
6. 在 T08 的 session / turn / artifacts 路由里加读取入口（具体见 T08 §3.x 更新）。

## 5. 验收标准

- 13+ 条测试用例覆盖 sessions / turns / messages / tool_invocations / dispatched_messages 的 CRUD 与 purge。
- 新建 session → 发 2 轮 → kill -9 mna → 重启 → `GET /v1/agent/sessions/:id` 能看到 2 条完整 turn（最后一轮若中断显示 `finish_reason = "crashed"`）。
- `args_hash` 不存 args 原文；`args_preview` 长度 ≤ 512。
- `DELETE ?purge=all` 执行后 db 和 artifact 目录里均查不到该 session 的数据。
- store 故意打挂（只读文件系统）时对话能继续，日志里出现 `session_store_unavailable`，前端能通过 error 事件感知。

## 6. 相关契约

- 无跨服务契约新增（store 是 mna 内部资产）
- 对 `docs/architecture-independence.md` 无影响：store 不跨服务暴露
- 对 `docs/memory-module-contract.md` 无影响：记忆落在 storage，store 只承载对话历史 + 审计

## 7. 不在范围内

- 对话内容全文搜索 / 向量化（首版只做线性拉取）
- 多设备同步
- 加密存储（首版 `~/.mna/sessions.db` 为明文；依靠 OS 文件权限）
- 对 runtime/storage 的级联删除（treated as TODO，需要 storage 侧先开 per-session 治理接口）
- 历史数据压缩 / 归档策略
