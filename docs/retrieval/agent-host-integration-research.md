# Agent 宿主接入调研：Claude Code 与 Codex

## 1. 文档目的

这份文档只回答一个问题：

如果要把我们的记忆产品接入 `Claude Code` 和 `Codex`，并且希望用户在启动时就已经接好，应该怎么接。

这里不再讨论抽象选型，也不让用户自己判断要不要用什么协议。
重点是：

- 这两个宿主当前公开支持什么接入面
- 哪条接入路径最适合我们这套“系统主动恢复上下文”的产品
- 我们的产品需要对外提供什么能力
- 用户最终需要做什么启动配置

## 2. 先说结论

先给结论：

- `Claude Code` 的最佳接入路径是：`hooks + 本地 HTTP retrieval-runtime 服务`，必要时再配一个 `MCP` 作为补充工具面。
- `Codex` 当前最稳的公开接入路径是：`MCP + 启动配置`。如果要做到真正的“系统主动注入”，需要走 `remote app-server` 包装层，而不是只靠普通 MCP。

换句话说：

- `Claude Code` 已经公开提供了比较完整的宿主生命周期接入点，适合做主动记忆恢复。
- `Codex` 当前公开稳定能力里，没有看到与 `Claude Code hooks` 同等级的本地生命周期钩子。只靠 MCP，可以接入工具，但不能稳定保证“每次关键时刻都自动注入”。

## 3. 这次调研采用的判断标准

我们这套产品不是普通工具集成，而是 `运行时记忆恢复`。

所以判断一个宿主是否适合，不看它能不能“调用一下工具”，而看它有没有下面这些能力：

- 会话启动时能接入
- 用户发出问题前能接入
- 一轮结束后能接入
- 接入失败时不影响宿主继续工作
- 可以把恢复出来的上下文稳定放到模型当前轮里

如果一个宿主只有 `MCP`，但没有稳定的宿主生命周期接入点，那么它更适合：

- 手动查记忆
- 调试记忆
- 补充工具能力

不适合作为“首版主链路”的主动记忆注入入口。

## 4. Claude Code 调研结论

## 4.1 Claude Code 公开支持宿主级 hooks

官方 `hooks` 文档已经明确给出生命周期事件。

这几个事件和我们的需求直接对齐：

- `SessionStart`：新会话启动、恢复会话、清空后重开、压缩后重开
- `UserPromptSubmit`：用户提交 prompt（提示词）后、Claude 正式处理前
- `PreToolUse`：工具调用前
- `PostToolUse`：工具调用后
- `Stop`：主 agent 完成回复后
- `SubagentStart / SubagentStop`：子 agent 生命周期

其中最关键的是两点：

- `SessionStart` 可以在会话启动时注入附加上下文
- `UserPromptSubmit` 可以在用户本轮输入刚提交、模型还没处理前注入附加上下文

官方还明确写了：

- hook 输出到 `stdout` 的文本会加入 Claude 上下文
- 也可以通过 `additionalContext` 注入更结构化的附加上下文

这意味着：

- 我们可以在 `SessionStart` 做会话级基础恢复
- 在 `UserPromptSubmit` 做本轮问题相关的精准恢复
- 在 `Stop` 做本轮写回触发

这和我们产品定义里的主链路是对齐的。

## 4.2 Claude Code 支持启动即加载

官方 `settings` 文档明确说明了配置作用域和优先级。

主要有这些位置：

- `~/.claude/settings.json`
- `.claude/settings.json`
- `.claude/settings.local.json`

也就是说，用户只要：

- 在用户级配置一次
- 或者在项目级配置一次

启动 `Claude Code` 时就会自动生效，不需要每次手动接入。

这很适合你的目标：

- 用户启动就接好
- 团队项目也可以共享接入配置

## 4.3 Claude Code 也支持 MCP，但它不是主链路

官方 `mcp` 文档说明：

- Claude Code 支持 `stdio`
- 支持 `HTTP`
- 支持 `SSE`
- 支持用户级、项目级、本地级配置

所以我们的产品当然也可以提供一个 `MCP server`。

但在 Claude Code 里，`MCP` 更适合做这些事：

- 手动查询深层记忆
- 检查某条记忆为什么被命中
- 调试召回结果
- 可视化联调时读取运行状态

而不是承担“首版基础记忆注入”的主职责。

原因很简单：

- `MCP` 工具是否被调用，仍然部分依赖模型或交互过程
- `hooks` 是宿主固定生命周期点，触发更稳定

## 4.4 Claude Code 最佳接入方案

### 方案定位

首版推荐方案：

- 主链路：`hooks + retrieval-runtime HTTP API`
- 补充链路：`MCP server`
- 打包方式：优先做成 `Claude Code plugin`

### 为什么推荐 plugin

官方 `plugins` 文档明确说明：

- 插件可以同时包含 `hooks`
- 插件可以同时包含 `MCP servers`
- 插件启用后，相关能力会在 session startup（会话启动）时自动连接
- 可以通过 `--plugin-dir` 本地加载，也可以通过 marketplace（插件市场）分发

这非常适合我们的产品：

- 用户装一个插件，就把接入逻辑带进去
- 不需要让用户分散改多个地方
- 团队内也更容易统一治理

### Claude Code 里的接入分层

在 Claude Code 里建议分成三层：

#### 第一层：SessionStart Hook

作用：

- 会话刚启动时恢复用户稳定偏好
- 恢复最近活跃任务
- 恢复当前仓库相关的长期约束

调用方式：

- hook 脚本调用本地 `retrieval-runtime`
- 传入 `session_id`、`cwd`、`source`
- 由服务返回 `additionalContext`

注入结果：

- 直接写入 Claude 当前 session 的附加上下文

#### 第二层：UserPromptSubmit Hook

作用：

- 在用户每一轮真正发问前做相关记忆恢复
- 这是首版最关键的主动注入点

调用方式：

- hook 脚本读取本轮 `prompt`
- 连同 `session_id`、`cwd`、最近会话摘要发给 `retrieval-runtime`
- 由服务返回本轮 `injection_block`

注入结果：

- 通过 `additionalContext` 放入当前轮上下文

#### 第三层：Stop Hook

作用：

- Claude 完成回复后，提取本轮可能形成的新记忆
- 异步提交到 `storage`

调用方式：

- hook 脚本读取 `last_assistant_message`
- 连同本轮用户输入摘要发给 `retrieval-runtime`
- 由服务做写回判断，再异步投递给 `storage`

### Claude Code 中 MCP 的角色

在同一套插件里再加一个 `.mcp.json`，暴露这几类工具就够了：

- `memory_search`
- `memory_explain_hit`
- `memory_trace_session`
- `memory_pin`
- `memory_forget_request`

它们主要服务：

- 调试
- 人工检查
- 高级用户主动查询

不作为基础注入的唯一入口。

## 4.5 Claude Code 对我们产品的接口要求

为了接入 Claude Code，我们的产品至少要提供下面几个接口：

### retrieval-runtime

- `POST /v1/runtime/session-start-context`
- `POST /v1/runtime/prepare-context`
- `POST /v1/runtime/finalize-turn`

说明：调研阶段使用的 `prompt-context` 和 `turn-writeback` 已在正式服务设计中统一为 `prepare-context` 和 `finalize-turn`，以下以正式命名为准。

### mcp-server

- `memory_search`
- `memory_explain_hit`
- `memory_trace_session`

### 可选

- `GET /healthz`
- `GET /v1/runtime/dependency-status`

## 4.6 Claude Code 侧最终落地形态

推荐最终形态是：

- 一个 `Claude Code plugin`
- 插件里包含：
  - `hooks/hooks.json`
  - `.mcp.json`
  - 可选 `settings.json`
  - 若需要，还可以带一个本地启动脚本

用户接入方式可以做到非常简单：

- 本地开发：`claude --plugin-dir ./memory-plugin`
- 正式安装：走插件安装或团队分发

这样基本满足“启动时就接进去”的要求。

## 5. Codex 调研结论

## 5.1 Codex 公开稳定能力里，明确有 MCP

本地 CLI 和公开 `docs/config.md` 都能确认：

- `codex mcp`
- `~/.codex/config.toml`
- `[mcp_servers.*]`

所以 `Codex` 接入我们的产品，最稳的一条公开路径一定包含 `MCP server`。

这部分已经非常明确。

## 5.2 Codex 公开稳定能力里，没有看到与 Claude hooks 对等的生命周期 hook

这次能确认到的 Codex 公开入口主要是：

- `MCP`
- `config.toml`
- `app-server`
- `remote`
- `notify hook`

其中 `notify hook` 在公开 `docs/config.md` 里提到的是：

- “agent finishes a turn”（agent 完成一轮后）的通知钩子

这只能覆盖：

- 一轮结束后的通知

不能覆盖：

- 会话启动前注入
- 用户当前问题进入模型前注入

所以它不能承担我们的主注入职责。

换句话说：

- 当前没有看到 Codex 官方公开提供 `SessionStart / PromptSubmit` 这种对等生命周期 hook
- 因此不能把 `Codex CLI + 普通 MCP` 直接等价看成 `Claude Code hooks`

## 5.3 Codex 公开能力里，有 app-server / remote 模式

本地 CLI 明确有这些能力：

- `codex app-server`
- `--remote <ADDR>`

而且 `app-server` 公开支持：

- `stdio://`
- `ws://IP:PORT`

这说明 Codex 有一个“宿主和前端分离”的远程运行模式。

这很重要。

因为如果没有本地生命周期 hook，那么要实现“系统主动注入”，最有希望的不是普通 MCP，而是：

- 让我们的产品接到 `Codex app-server` 前面
- 或者把 Codex 运行在一个受控宿主里
- 由这个宿主在消息进入 Codex 前后做上下文处理

也就是说，Codex 真正适合我们产品主链路的，不是“只加一个 MCP server”，而是：

- `受控宿主 / remote wrapper + Codex app-server`

## 5.4 Codex 最佳接入方案

### 方案定位

首版推荐分成两档：

#### A 档：最快落地版

- `MCP server + ~/.codex/config.toml`

适合：

- 先把产品接进去
- 先提供查记忆、解释命中、调试链路

但它的限制必须写清楚：

- 不能单靠它保证“系统关键时刻主动恢复上下文”
- 因为它主要还是工具入口，不是宿主生命周期入口

#### B 档：产品目标版

- `memory gateway / remote host wrapper + codex app-server`

适合：

- 真正实现自动注入
- 启动时就接好
- 不依赖模型自己决定何时查记忆

### B 档的基本结构

建议结构如下：

1. 用户不直接启动裸 `codex`
2. 用户启动我们提供的 `memory-codex-launcher`
3. 这个 launcher 拉起或连接 `codex app-server`
4. launcher 在请求进入 Codex 前，先向 `retrieval-runtime` 请求当前轮记忆注入块
5. 再把注入块拼进发送给 Codex 的 prompt 输入
6. Codex 返回后，launcher 再把回合结果发给 `retrieval-runtime` 做写回

这样才能满足我们的产品原则：

- 不是模型自己想起才去查
- 而是宿主固定做恢复

## 5.5 为什么 Codex 不建议只靠 MCP 做主链路

原因只有一个，但非常关键：

`MCP` 是工具面，不是稳定的前置注入面。

只靠 MCP，会出现这些问题：

- 什么时候查，仍然不完全由系统掌控
- 本轮该恢复的记忆，可能没有在模型调用前进入上下文
- 写回也更像工具后动作，而不是固定 runtime（运行时）流程

所以在 Codex 里：

- `MCP` 是必要能力
- 但不是充分能力

## 5.6 Codex 中 MCP 的正确角色

即使走 B 档，也建议保留 MCP，作用是：

- 手动查记忆
- 解释为什么命中
- 查询运行状态
- 给用户开放可见的记忆工具

建议暴露：

- `memory_search`
- `memory_trace_turn`
- `memory_explain_hit`
- `memory_dependency_status`

## 5.7 Codex 对我们产品的接口要求

如果做 A 档：

- 只需要一个 `MCP server`

如果做 B 档：

- 需要 `retrieval-runtime HTTP API`
- 需要 `launcher / wrapper`
- 需要连接 `codex app-server`
- 可选再加 `MCP server`

建议至少提供：

- `POST /v1/runtime/prepare-context`
- `POST /v1/runtime/finalize-turn`
- `GET /healthz`
- `GET /v1/runtime/dependency-status`

## 5.8 Codex 侧最终落地形态

我建议把 Codex 接入分成两期：

### 第一期

先做：

- `MCP server`
- `~/.codex/config.toml` 自动接入说明

目的：

- 先跑通能力接入
- 先让用户启动 Codex 时能看到我们的产品已经可用

### 第二期

再做：

- `memory-codex-launcher`
- `codex app-server` 包装接入

目的：

- 把主动注入做成真正稳定的主链路

## 6. 两个宿主的推荐路径对比

| 维度 | Claude Code | Codex |
| :--- | :--- | :--- |
| 会话启动接入 | 有，`SessionStart hook` | 没看到公开对等 hook |
| 用户当前轮前接入 | 有，`UserPromptSubmit hook` | 没看到公开对等 hook |
| 一轮结束后写回 | 有，`Stop hook` | 有弱能力，`notify hook` / wrapper |
| MCP 支持 | 有 | 有 |
| 插件打包能力 | 有，而且适合本产品 | 当前没看到同等级公开插件体系证据 |
| 启动即接入难度 | 低 | 中 |
| 主动注入适配度 | 高 | 中，需 wrapper |

## 7. 我们产品的推荐实施策略

如果按产品优先级排，我建议这样做：

### 第一优先级：Claude Code

原因：

- 宿主接入点完整
- 能直接支持主动记忆恢复
- 可以打包成插件
- 更接近我们产品理想形态

### 第二优先级：Codex MCP 版

原因：

- 最快接进去
- 先有工具面和观测面
- 先建立用户接入习惯

### 第三优先级：Codex Wrapper 版

原因：

- 这是 Codex 上真正对齐我们产品目标的版本
- 但实现复杂度高于 Claude Code

## 8. 对当前架构文档的影响

这次调研不会推翻原有产品架构，只是把“宿主接入层”补清楚了。

现在可以这样约定：

- `retrieval-runtime` 仍然是统一运行时服务
- `storage` 仍然是统一记忆写入与读模型发布服务
- `visualization` 仍然独立存在
- 宿主接入层按宿主分别实现

具体分为两类：

- `Claude Code adapter`：基于 `hooks + plugin + MCP`
- `Codex adapter`：基于 `MCP`，后续升级到 `app-server wrapper`

## 9. 最终建议

最终建议就一句话：

- `Claude Code` 先做成 `plugin`，主链路用 `SessionStart + UserPromptSubmit + Stop`
- `Codex` 先做成 `MCP` 接入，后续补 `app-server wrapper`，不要把“只接了 MCP”误认为已经完成主动记忆注入

如果按你的产品目标来判断，首个最完整可交付宿主应该是 `Claude Code`。
