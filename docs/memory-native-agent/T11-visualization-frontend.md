# T11 — visualization 前端 agent IDE 页面

## 1. 目标

在 `services/visualization/` 下新增 `/agent/*` 路由，提供类似 Cursor / Continue 的内嵌 agent IDE 体验：
对话面板、文件树、工具控制台、记忆面板、权限确认对话框。

后端数据完全来自 `memory-native-agent`（T08 HTTP + WebSocket），visualization 自身不承接业务逻辑。

## 2. 前置依赖

- T08 mna HTTP/WS API 完成。

## 3. 交付物

### 3.1 文件清单

```
services/visualization/src/app/agent/
├── layout.tsx                       # agent IDE 外壳（四栏布局）
├── page.tsx                         # 默认：创建 session 或恢复最近 session
├── [sessionId]/
│   └── page.tsx                     # 对话主视图
├── _components/
│   ├── chat-panel.tsx               # 对话流
│   ├── session-list.tsx             # 会话列表（最左栏顶部）
│   ├── file-tree.tsx                # 文件浏览器（最左栏下半）
│   ├── tool-console.tsx             # 底部工具调用日志（含审计来源）
│   ├── memory-panel.tsx             # 右侧记忆面板（本轮注入 / session 记忆）
│   ├── prompt-inspector.tsx         # 查看本轮发给 provider 的完整 messages
│   ├── confirm-dialog.tsx           # 工具权限确认弹窗
│   ├── mode-switch.tsx              # memory_mode 切换
│   ├── provider-switch.tsx          # 运行时切换 provider / model
│   ├── mcp-panel.tsx                # MCP server 状态 + restart/disable
│   ├── cost-bar.tsx                 # 顶部 token 用量（本 session 累计）
│   └── untrusted-badge.tsx          # 工具输出 trust level 角标
├── _lib/
│   ├── mna-client.ts                # 浏览器端 fetch + WS 封装
│   ├── event-reducer.ts             # WS 事件 → React state reducer
│   ├── openapi-types.ts             # 从 mna /openapi.json 生成
│   └── config.ts                    # MNA_BASE_URL / token 读取
└── _hooks/
    ├── use-session.ts
    ├── use-session-list.ts
    ├── use-turn-stream.ts
    ├── use-dispatched-messages.ts
    └── use-file-tree.ts

services/visualization/src/app/api/agent/
└── token/route.ts                   # server-only 读取 ~/.mna/token.txt，给浏览器下发 token
```

### 3.2 路由行为

- `/agent` → 若有最近 session 则 302 到 `/agent/{id}`，否则创建新 session 后跳转
- `/agent/{sessionId}` → 主视图
- 深链可分享（同机器前提下）

### 3.3 四栏布局

```
┌──────────────────────────────────── 顶部栏：cost-bar + provider-switch + mode-switch ─┐
├──────────────┬────────────────────────────────┬───────────────┤
│ 会话列表      │ 对话面板                        │ 记忆面板       │
│ (session-list│ (chat-panel)                    │ (memory-panel)│
│  ↑上半)      │                                 │               │
│              │   [InjectionBanner] [Phase 轨迹][🔍 查看 prompt]│  本轮注入：    │
│ 文件树        │   You> ...                      │   • fact ×1   │
│ (file-tree   │   Assistant> streaming...       │   • task ×2   │
│  ↓下半)      │   ⚙ fs_read ... ✓              │               │
│              │   ...                           │  MCP 状态:    │
│              │  ┌─────────────────────────────┐│   (mcp-panel) │
│              │  │ > 输入 (Enter 提交)          ││               │
│              │  └─────────────────────────────┘│               │
├──────────────┴────────────────────────────────┴───────────────┤
│ 工具控制台 (tool-console) - 折叠式                              │
│  c1 fs_read  path=README.md  ✓ 3.4kb  250ms  [untrusted:read] │
│  c2 shell    npm test        ✓ 5.2s          [untrusted:shell]│
└───────────────────────────────────────────────────────────────┘
```

- 顶部栏常驻：`cost-bar`（本 session 累计 tokens/美元估算，来自 metrics + session-store）、`provider-switch`（下拉切模型）、`mode-switch`（workspace_only / workspace_plus_global）
- 左栏分上下两半：上半 `session-list`（按 `workspace_id` 过滤，LRU 排序，支持改标题/purge），下半 `file-tree`
- 对话面板：InjectionBanner 下方加"查看 prompt"按钮 → 弹 `prompt-inspector`（从 `GET /v1/agent/turns/:turn_id/dispatched-messages` 拉）
- 记忆面板下方 `mcp-panel` 显示 MCP server 连接状态 + restart/disable 按钮
- 工具控制台每行末尾加 `untrusted-badge`（来自 T12 §8 trust_level），用户能一眼看到这条输出来自外部

### 3.4 客户端与事件流

`mna-client.ts` 承担：

- REST 调用（使用 openapi-typescript 生成的类型）
- WebSocket 建立与重连（指数退避，最多 5 次）
- 心跳 ping/pong

`event-reducer.ts` 把 T08 定义的 `ServerEvent` 更新到 React state：

```ts
type AgentState = {
  session: SessionMeta | null;
  memoryMode: MemoryMode;
  workspaceId: string;
  turns: Turn[];                      // 每个 turn 包含 injection / messages / toolCalls / finishReason
  pendingConfirm: ConfirmRequest | null;
  connection: "connecting" | "open" | "reconnecting" | "closed";
  degraded: boolean;
};
```

使用 `useReducer` + Context，不引入 Redux。

### 3.5 关键交互

- **提交输入**：回车送 `user_input` WS 事件；Shift+Enter 换行；`Esc` 送 `abort`
- **权限确认**：收到 `tool_confirm_needed` 弹 `ConfirmDialog`，三个按钮：`允许`、`拒绝`、`本 session 全部允许`
- **流式渲染**：`assistant_delta` 累积到当前 turn 的 assistant 消息（注意事件顺序：mid-stream 出错时会先收到 `error` 再收到 `turn_end`，reducer 必须等 `turn_end` 才 finalize turn，不要在 `error` 里清 pending，见 T12 §9.5）
- **工具调用**：`tool_call_start` 显示加载态；`tool_call_result` 标记 ✓ / ✗；末尾挂 `untrusted-badge` 显示 trust_level
- **文件预览**：点文件树条目 → 右侧对话上方开一个预览 tab（Monaco 只读）
- **session 列表**：左侧上半 `session-list` 支持切换、改标题（调 `PATCH /v1/agent/sessions/:id`）、purge（调 `DELETE ?purge=all` 带二次确认）
- **mode 切换**：顶部栏 `mode-switch` 下拉 `workspace_only` / `workspace_plus_global`
- **provider 切换**：顶部栏 `provider-switch` 下拉，选中后调 `POST /sessions/:id/provider`，立即对下一轮生效；UI 标注"下一轮生效"
- **cost bar**：从 `GET /v1/agent/metrics` + session 累计 `token_in/token_out` 合算，简单估算成本（可选表）
- **prompt 检查**：InjectionBanner 的"查看 prompt"按钮弹 `prompt-inspector`（只读 Monaco 渲染 JSON messages 数组，可折叠展开每段）
- **MCP 管理**：`mcp-panel` 按 server 显示 `state` 与最近错误；`restart` / `disable` 按钮直连后端
- **任务面包屑**：顶部显示当前 `TaskState.label`（来自 `task_change` 事件），点击可折叠展开本 session 的 `recentTasks` 列表；任务完全由 mna runner 的语义检测驱动，前端不提供"新建任务"按钮
- **Phase 轨迹**：InjectionBanner 下方展示本轮实际命中的 phase 列表（比如 `task_switch • before_plan • before_response`），来自一系列 `phase_result` 事件——用户能看到哪些钩子被自动触发了

### 3.6 配置

visualization 读两个环境变量：

- `NEXT_PUBLIC_MNA_BASE_URL`：mna 的 HTTP 基址，默认 `http://127.0.0.1:4193`
- `MNA_TOKEN_PATH`：Node server 端读 token（仅 `app/api/agent/token/route.ts` 使用），默认 `~/.mna/token.txt`

首版必须提供轻量 `app/api/agent/token/route.ts` 用来给浏览器下发 token，但不做 mna 业务代理。浏览器拿到 token 后直接调 mna（local 回环不涉及跨机器）。CORS 由 mna 侧放行 visualization origin。

### 3.7 降级 UI

- mna 不可达：主视图显示"agent 离线：请启动 memory-native-agent"，给出启动命令
- WS 断连：顶部条显示"重连中..."，输入框灰掉
- `degraded: true`：InjectionBanner 显示灰色"memory 降级（runtime/storage 不可用）"
- 其他 visualization 页面（`/memory`、`/runs`）不受 agent 面板影响

### 3.8 Monaco 集成

文件预览与 diff 展示用 Monaco Editor。关键约束：

- 在 Next.js 15 RSC 下 Monaco 依赖 `window`，**组件文件顶部必须加 `'use client'`**
- 用 `next/dynamic(() => import('@monaco-editor/react'), { ssr: false })` 延迟加载
- 按需动态 import，不进入首屏 bundle

## 4. 实施步骤

1. 在 visualization 里新增路由与 layout，打出空三栏骨架。
2. 先实现 `app/api/agent/token/route.ts`，统一 token bootstrap 形状：`{ status, token?, reason?, mnaBaseUrl? }`。
3. 用 `openapi-typescript` 从 mna 的 `/v1/agent/openapi.json` 生成 TS 类型。
4. 实现 `mna-client.ts`：REST fetch 加 Bearer token、WS 建连 + 重连；收到 401 后最多重新获取一次 token。
5. 实现 `event-reducer.ts`，配一组纯函数单元测试（给定事件序列 → 断言 state）。
6. 依次实现组件：ChatPanel → ConfirmDialog → ToolConsole → MemoryPanel → FileTree → ModeSwitch。
7. 用 `@testing-library/react` 做组件测试，`msw` 模拟 mna REST，fake WS 驱动事件。
8. Playwright e2e（T10 UI 场景）里 **不 mock WebSocket**：直接跑真 mna 进程，用 record/replay provider 保证模型确定性。
9. 最后做视觉打磨：tailwind、lucide icons、主题对齐既有 `/memory` 页面。

## 5. 验收标准

- `/agent` 路由能创建 session、发送消息、收到流式回复。
- 工具权限确认在前端正常弹出并能改变后端行为。
- 关闭 mna 后页面不崩，给出离线提示；重启后自动重连。
- `token.txt` 缺失、不可读、内容损坏时，页面能显示明确离线原因，不会静默白屏。
- 切换 `memory_mode` 后，下一轮注入 Banner 体现变化。
- 既有 `/memory`、`/runs`、`/dashboard` 页面功能回归无影响。
- Lighthouse 性能可以不做首版硬性要求，但首屏 JS 不能因为引入 Monaco 膨胀到 > 2MB。

## 6. 相关契约

- `docs/visualization/visualization-service-design.md`：新增 agent 路由视为 visualization 的独立 feature
- `docs/architecture-independence.md` 第 3.2 节：visualization 的数据来源约束
- `docs/memory-module-contract.md` 第 11.1 节：visualization 能消费的数据源

## 7. 契约回写要求

这里的回写含义是：**不改核心边界，只补一条澄清**，说明这种前端跨服务嵌入不视为耦合。

完成后在 `docs/architecture-independence.md` 第 4 节末尾追加一条说明：

```
### 4.2 跨服务前端嵌入

允许一个服务的前端页面调用另一个服务的公共 HTTP/WebSocket 接口，
以实现用户可见的聚合体验。前提是：

- 被调用方仍然是独立服务、独立部署、独立治理
- 调用方的后端进程不承接被调用方的业务逻辑
- 调用方只通过正式契约通信，不引用被调用方的内部实现

首版落地场景：`visualization` 前端 `/agent/*` 路由调用 `memory-native-agent` 的 HTTP/WS 接口。
```

并在 `docs/memory-module-contract.md` 第 11.1 节末尾追加一条澄清：

```
补充说明：

`visualization` 自身的后端进程不调用 `retrieval-runtime` 主链路接口。
如果用户通过 `visualization` 前端发起 agent 对话，主链路调用由 `memory-native-agent` 作为宿主发起，
`visualization` 只承担渲染职责。此种前后端跨服务聚合不视为耦合。
```

## 8. 不在范围内

- 多 session 并行面板（首版单 session 主视图，session-list 只做切换）
- 对话导出 / fork / 清空上下文（留给 0.2.x）
- 代码编辑器写模式（文件预览只读，写回仍走 agent 的 fs_write 工具）
- 主题定制 / 国际化（继承 visualization 现有约定）
- 移动端布局
- cost-bar 的精确计费（首版仅基于 token 计数 + 可选 `provider.price_per_1k`，无需接入计费系统）
