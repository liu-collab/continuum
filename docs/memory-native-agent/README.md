# memory-native-agent 总览

## 1. 文档目的

这一套文档定义 `memory-native-agent`（自主记忆 agent）的首版实现边界与任务拆分。

它回答两件事：

- 这个新模块在当前产品里是什么定位
- 从零开始到首版可用，一共要做哪些可执行任务

任务文档以 `T01` ~ `T14` 编号，每一份独立可交付。本 README 只承担"统领"职责：
说明定位、边界、依赖关系、阅读顺序。

## 2. 定位

`memory-native-agent` 是一个 **独立的 agent 宿主进程**，对外暴露 HTTP/WebSocket 接口；
`visualization` 在自己的 Next.js 前端里新增 `/agent/*` 路由消费 mna 的接口，给用户提供类似 Cursor / Continue 的内嵌 agent IDE 体验。

它与 `Claude Code plugin`、`Codex adapter` 并列，作为 `retrieval-runtime` 的第三个宿主消费者。

```
┌────────────────────────────────────────────────────────────────┐
│  浏览器 (visualization 前端)                                    │
│  ├── /memory /runs /dashboard   → 既有只读观测页（不变）          │
│  └── /agent/*                    → 新增 agent IDE 页面           │
│        ↓  HTTP / WebSocket                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  memory-native-agent  (Node service, 本地常驻)            │   │
│  │  ├── HTTP/WS 服务端（T08）                                │   │
│  │  ├── runner / providers / tools / mcp-client             │   │
│  │  └── memory-client → retrieval-runtime                   │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
                                ↓
┌────────────────────────────────────────────────────────────────┐
│  retrieval-runtime（HTTP API，不变）                            │
└────────────────────────────────────────────────────────────────┘
                                ↓
┌────────────────────────────────────────────────────────────────┐
│  storage（共享读模型 + 写接口，不变）                            │
└────────────────────────────────────────────────────────────────┘
```

## 3. 架构独立性说明

- `memory-native-agent` 是独立服务，**不是** `visualization` 的子模块。
- `visualization` 自身的后端进程仍然只调观测接口（`storage` 共享读模型 + `retrieval-runtime/observe/*`），
  **不直接**调用 `prepare-context` / `finalize-turn`。
- 主链路调用由 `memory-native-agent` 作为宿主发起，`visualization` 前端只是把 mna 的 UI 嵌进自己的壳里。
- 因此现有契约的**核心边界不改**，只补一条"允许跨服务嵌入前端面板"的澄清（见 T11 的契约回写要求）。

三服务依然可以独立启停、独立部署、独立治理。`memory-native-agent` 不可达时，visualization 的 `/agent/*` 页面显示"agent 离线"，其他观测页面不受影响。

## 4. 首版能力范围

| 能力 | 范围 | 参考契约 |
| :--- | :--- | :--- |
| 多模型 provider | OpenAI 兼容 / Anthropic / Ollama 本地 | T04 |
| 对话主循环 | WebSocket 流式多轮 | T07 / T08 |
| 记忆主链路 | session_start → prepare-context → finalize-turn | `memory-module-contract.md` 第 5 / 6 节 |
| 文件工具 | fs_read / fs_write / fs_edit（本地 FS，mna 后端执行） | T05 |
| Shell 工具 | 白名单 + 用户在 web 前端按钮确认 | T05 |
| MCP 工具消费 | stdio / http client | T06 |
| 工作区与 memory_mode | 默认 `single_local_user` + `workspace_plus_global` | `current-phase-closure-plan.md` |
| Web agent IDE | 对话 + session 列表 + 文件树 + 工具控制台 + 记忆面板 + Prompt 检查 + MCP 管理 + 成本条 | T11 |
| 会话持久化 | SQLite 落盘（对话历史 + 工具审计 + prompt snapshot） | T14 |
| 流式输出协议 | ChatChunk → WS 事件合批 / 错误顺序 / abort 语义 | T12 §9 |
| 工具输出信任边界 | `<tool_output trust="...">` 包裹 + system 规则 | T12 §8 |

首版 **不做**：

- 任务编排 / subagent / 多 agent 协作
- CLI TUI（已放弃）
- 替代现有 Claude Code / Codex 宿主接入（并列共存）
- 自研模型 / 嵌入服务（embedding 仍然走共享外部依赖）

## 5. 模块物理位置

```
services/memory-native-agent/              # 新增：agent 后端服务
  ├── bin/
  │   └── mna-server.mjs                   # HTTP 服务入口（非 CLI）
  ├── src/
  │   ├── http/                            # Fastify 路由 + WebSocket（T08）
  │   ├── runner/                          # agent 主循环 + 生命周期钩子（T07）
  │   ├── providers/                       # IModelProvider 实现（T04）
  │   ├── tools/                           # 内置工具 + MCP 分发（T05）
  │   ├── mcp-client/                      # MCP stdio/http 客户端（T06）
  │   ├── memory-client/                   # retrieval-runtime HTTP 封装（T02）
  │   ├── config/                          # 配置解析 + workspace 映射（T09）
  │   └── shared/
  ├── tests/
  ├── package.json                         # @jiankarlin/memory-native-agent
  ├── tsconfig.json
  └── vitest.config.ts

services/visualization/src/app/agent/      # 新增：前端 agent 页面（T11）
  ├── layout.tsx                           # agent IDE 外壳
  ├── page.tsx                             # 默认重定向到最近 session
  ├── [sessionId]/
  │   └── page.tsx                         # 对话主视图
  ├── _components/
  │   ├── chat-panel.tsx
  │   ├── file-tree.tsx
  │   ├── tool-console.tsx
  │   ├── memory-panel.tsx
  │   └── confirm-dialog.tsx
  ├── _lib/
  │   └── mna-client.ts                    # 调 mna HTTP/WS 的浏览器端封装
services/visualization/src/app/api/agent/
  └── token/route.ts                       # server-only 读取 ~/.mna/token.txt

services/retrieval-runtime/                # 小幅改动（T03）
  └── src/host-adapters/
      ├── types.ts                         # 增加 memory_native_agent 枚举
      ├── index.ts                         # 注册新 adapter
      └── memory-native-agent-adapter.ts   # 新增
```

## 6. 任务索引

| 编号 | 标题 | 状态 | 所在服务 | 前置依赖 | 跨服务改动 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| [T01](./T01-scaffold.md) | mna 包骨架与 HTTP 服务初始化 | 已完成 | mna | — | 无 |
| [T02](./T02-memory-client.md) | retrieval-runtime HTTP 客户端 | 已完成 | mna | T01, T03 | 无 |
| [T03](./T03-runtime-adapter.md) | runtime 新增 adapter 与 host 枚举 | 已完成 | retrieval-runtime | — | `retrieval-runtime` |
| [T04](./T04-model-providers.md) | 模型 provider 抽象与三实现 | 已完成 | mna | T01 | 无 |
| [T05](./T05-tools.md) | 内置工具层（fs / shell / mcp 分发） | 已完成 | mna | T01, T06, T12 | 无 |
| [T06](./T06-mcp-client.md) | MCP 客户端（stdio + http） | 已完成 | mna | T01 | 无 |
| [T07](./T07-agent-runner.md) | agent 主循环与生命周期钩子 | 已完成 | mna | T02, T04, T05, T09, T12 | 无 |
| [T08](./T08-http-api.md) | HTTP + WebSocket API 服务端 | 已完成 | mna | T07, T12 | 无 |
| [T09](./T09-config-workspace.md) | 配置与工作区 / memory_mode 解析 | 已完成 | mna | T01 | 无 |
| [T10](./T10-e2e-acceptance.md) | 端到端联调与验收测试 | 进行中 | 全部 | T01-T09, T11, T12 | 剩余 UI e2e |
| [T11](./T11-visualization-frontend.md) | visualization 前端 agent IDE 页面 | 已完成 | visualization | T08, T12 | `visualization` |
| [T12](./T12-cross-cutting.md) | 横切规范（token / prompt / artifact / shell / fixture / port） | 进行中 | mna | T01 | 无 |
| [T13](./T13-cli-integration.md) | continuum-cli 集成 mna 启停 | 已完成 | continuum-cli | T01, T12 | `continuum-cli` |
| [T14](./T14-session-store.md) | 会话持久化、工具审计与清理 | 已完成 | mna | T01 | 无 |

## 6.1 当前进度

- `T01` 已完成：工程骨架、最小 `Fastify` HTTP 服务、`/healthz`、启动脚本、smoke test 已落地。
- `T02` 已完成：`memory-client` 已提供 `sessionStartContext / prepareContext / finalizeTurn / dependencyStatus / healthz`，并补齐超时、错误分类、降级回退和契约校验测试。
- `T03` 已完成：`retrieval-runtime` 已正式支持 `memory_native_agent` 宿主枚举和独立 adapter。
- `T04` 已完成：`OpenAI-compatible / Anthropic / Ollama` 三个 provider 已落地统一接口、流式解析、工具调用映射、错误分类与回退测试。
- `T05` 已完成：`fs_read / fs_write / fs_edit / shell_exec / mcp_call`、权限门、session 级确认缓存、审计写入与工具测试已落地。
- `T06` 已完成：`stdio / streamable-http` 两种 MCP client 已落地，支持工具发现、工具调用、运行时状态、单 server 重启/禁用，以及 mock server 集成测试。
- `T07` 已完成：runner 主循环、phase 检测、任务状态、工具输出包裹、流式桥接、写回判定与 runner 测试已落地。
- `T08` 已完成：HTTP/WS 路由装配、token 鉴权、session CRUD、文件与 artifact 读取、MCP 管理、OpenAPI 输出、事件缓冲回放与 HTTP/WS 测试已落地。
- `T11` 已完成：`/agent` 与 `/agent/[sessionId]` 页面、会话列表、文件树、聊天流、Prompt Inspector、工具确认弹窗、MCP 面板、基础 cost bar、Monaco 文件预览、前端 reducer 测试和浏览器直连 mna 所需的 loopback CORS 已落地。
- `T13` 已完成：`continuum start/status/stop` 已接入 mna，`continuum mna install/start/stop/logs/token` 已落地，vendor 打包和交付文档已同步。
- `T10` 进行中：人工验收清单已补齐；`mna + runtime + storage` 的真实后端 e2e 已补 `happy path / runtime down / storage down / memory_mode switch / governance roundtrip` 五条并跑通；当前只剩 Playwright UI e2e 和 record/replay 浏览器验收待补。
- `T12` 进行中：`token` 引导、默认 `system prompt`、流式常量、`record-replay provider` 已落地；artifact、工具信任边界、stream-bridge 和 i18n 相关收口将在 `T05/T07/T08/T11/T14` 继续完成。
- `T09` 已完成：配置发现、分层合并、`user_id / workspace_id / locale` 解析、`identity.json / workspaces.json` 持久化与测试已落地。
- `T14` 已完成：`SQLite session-store`、启动 migration、会话/轮次/消息/工具审计/`prompt snapshot` 持久化、`crashed` 恢复标记与 purge 测试已落地。

## 7. 推荐实施顺序与并行度

```
阶段 A（串行准备）
  T01  ─── mna 骨架

阶段 B（并行 5 条线）
  T03  ─── runtime adapter 改动
  T04  ─── model providers（含 Usage 必返 + 429/5xx 退避）
  T06  ─── mcp client（含运行时管理接口）
  T09  ─── config & workspace
  T12  ─── 横切规范（token / prompt / constants / untrusted / streaming）

阶段 C（并行 3 条线）
  T02  ─── memory-client
  T05  ─── tools（依赖 T12 的 shell/artifact/untrusted 规则 + T14 审计接入）
  T14  ─── session-store（独立可开工，被 T07 依赖）

阶段 D（串行闭合）
  T07  ─── agent runner（依赖 T14 store + T12 §9 stream-bridge + T12 §8 untrusted 包裹）
  T08  ─── HTTP/WS API（含 session list / error code 枚举 / metrics / provider 切换 / prompt inspector / MCP 管理 / API 版本握手）

阶段 E（并行 2 条线）
  T11  ─── visualization 前端（四栏 + session list + provider switch + prompt inspector + mcp panel + cost bar）
  T13  ─── continuum-cli 集成

阶段 F
  T10  ─── 端到端验收
```

## 8. 阅读顺序

- 第一次读：先看本 README 第 2-5 节对齐定位；再读 `T01` 理解工程骨架。
- mna 后端开发：按 T02 → T07 → T08 顺序读核心链路。
- visualization 前端开发：先读 T08（后端接口），再读 T11（前端实现）。
- 跨服务改动：T03 要先读 `docs/retrieval/retrieval-runtime-service-design.md` 第 5 节；T11 要先读 `docs/visualization/visualization-service-design.md`。

## 9. 与现有契约的关系

这一套文档只定义 `memory-native-agent` 与前端嵌入方式的实现。不改动、不覆盖：

- `docs/product-baseline.md`
- `docs/memory-module-contract.md`
- `docs/architecture-independence.md`
- `docs/api-contract.md`
- `docs/current-phase-closure-plan.md`

唯一可能的契约影响是一条小澄清："允许一个服务的前端嵌入另一个服务的 UI 面板；只要 HTTP 调用关系不变，不视为耦合"。
该澄清由 T11 负责回写到 `architecture-independence.md` 第 4 节或 `memory-module-contract.md` 第 11.1 节的末尾。
