# 宿主接入实施方案：Claude Code 与 Codex

## 1. 这份文档解决什么问题

这份文档不再讨论“要不要这样做”。

这里直接约定：

- 我们就是要把产品接入 `Claude Code`
- 我们也要把产品接入 `Codex`
- 用户启动宿主时，记忆能力已经接好

这份文档只回答三件事：

- 各自怎么实现
- 我们的产品侧要提供什么组件
- 用户最终怎么启动

## 2. 先定实现口径

这里先把一个容易混淆的点说清楚：

`plugin` 只是交付和装载形态，不等于注入机制本身。

真正让记忆“在关键时刻自动进上下文”的，是宿主接入点。

所以我们这里统一按两层来实现：

### 第一层：宿主接入层

负责：

- 宿主启动时接入
- 当前轮开始前触发记忆恢复
- 当前轮结束后触发写回

### 第二层：产品运行时层

负责：

- 检索
- 注入块生成
- 写回判断
- 记忆工具查询

也就是说：

- `Claude Code` 用官方 `plugin` 承载宿主接入层
- `Codex` 用启动适配器承载宿主接入层

## 3. 最终要交付的三个程序

不管接到哪个宿主，首版都统一交付下面三个程序：

### 3.1 retrieval-runtime

这是运行时主服务。

负责：

- 会话启动记忆恢复
- 当前轮记忆恢复
- 本轮结束写回判断

### 3.2 memory-mcp-server

这是工具面服务。

负责：

- 手动查记忆
- 解释为什么命中
- 运行状态查看

### 3.3 host-adapter

这是宿主接入层。

不同宿主有不同实现：

- `Claude Code`：放在 plugin 里
- `Codex`：做成启动适配器

## 4. 产品侧统一接口

为了让两个宿主都能接，`retrieval-runtime` 固定提供下面几组接口。

### 4.1 会话启动恢复

`POST /runtime/session-start-context`

输入：

- `host`
- `session_id`
- `cwd`
- `source`
- `user_id`
- `workspace_id`

输出：

- `additional_context`
- `active_task_summary`
- `dependency_status`

### 4.2 当前轮注入

`POST /runtime/prepare-context`

输入：

- `host`
- `session_id`
- `thread_id`
- `turn_id`
- `cwd`
- `user_prompt`
- `recent_context_summary`

输出：

- `injection_block`
- `memory_packet_ids`
- `budget_used`
- `trace_id`

### 4.3 当前轮结束写回

`POST /runtime/finalize-turn`

输入：

- `host`
- `session_id`
- `thread_id`
- `turn_id`
- `user_prompt`
- `assistant_final`
- `tool_trace_summary`

输出：

- `writeback_submitted`
- `candidate_count`
- `trace_id`

### 4.4 工具查询

`memory-mcp-server` 固定暴露：

- `memory_search`
- `memory_explain_hit`
- `memory_trace_turn`
- `memory_dependency_status`

## 5. Claude Code 直接实现方案

## 5.1 Claude Code 这里就直接做成官方 plugin

这里不绕。

`Claude Code` 的实现方案就是：

- 一个官方 `plugin`
- 插件里直接带 `hooks`
- 插件里直接带 `MCP`
- 插件里直接带本地桥接脚本

交付目录固定成这样：

```text
memory-claude-plugin/
├── .claude-plugin/
│   └── plugin.json
├── hooks/
│   └── hooks.json
├── .mcp.json
├── bin/
│   ├── memory-bridge
│   └── memory-runtime-bootstrap
└── settings.json
```

## 5.2 Claude 插件内部各部分做什么

### `plugin.json`

负责：

- 声明插件元信息
- 让 Claude Code 能安装和识别这个插件

### `hooks/hooks.json`

负责：

- 在宿主生命周期点调用我们的桥接脚本

固定接三个事件：

- `SessionStart`
- `UserPromptSubmit`
- `Stop`

### `.mcp.json`

负责：

- 让 Claude Code 自动连上 `memory-mcp-server`

### `bin/memory-bridge`

负责：

- 接收 hook 输入
- 转成我们统一的 HTTP 请求
- 调 `retrieval-runtime`
- 把返回值转成 Claude Code 可接受的 `additionalContext`

### `bin/memory-runtime-bootstrap`

负责：

- 确保本地 `retrieval-runtime` 已经启动
- 确保本地 `memory-mcp-server` 已经启动

## 5.3 Claude Code 的启动流程

用户启动 `Claude Code` 后，流程固定如下：

1. Claude Code 加载插件
2. 插件执行 `memory-runtime-bootstrap`
3. 本地 `retrieval-runtime` 和 `memory-mcp-server` 被拉起或确认已在线
4. `SessionStart` hook 触发
5. `memory-bridge` 调 `POST /runtime/session-start-context`
6. 返回的 `additional_context` 被放入当前 session

到这里，会话启动级接入就已经完成了。

## 5.4 Claude Code 当前轮注入流程

当用户输入一轮新问题时：

1. `UserPromptSubmit` hook 触发
2. `memory-bridge` 读取本轮 `prompt`
3. 调 `POST /runtime/prepare-context`
4. `retrieval-runtime` 返回 `injection_block`
5. `memory-bridge` 把 `injection_block` 填到 `additionalContext`
6. Claude Code 再继续本轮推理

这就是首版基础记忆注入主链路。

这里不依赖模型自己先决定要不要查。

## 5.5 Claude Code 写回流程

Claude 回复完成后：

1. `Stop` hook 触发
2. `memory-bridge` 读取本轮最终输出
3. 调 `POST /runtime/finalize-turn`
4. `retrieval-runtime` 做写回判断
5. 异步提交给 `storage`

这里要求：

- Claude 主流程不等待写回完成
- 写回失败不影响当前会话继续使用

## 5.6 Claude Code 中 MCP 的作用

这里直接定角色，不混用：

- `hooks` 负责主注入
- `MCP` 负责工具查询

所以 Claude 插件里的 MCP 只做这些：

- 用户主动查记忆
- 用户主动看命中解释
- 调试会话注入链路

## 5.7 Claude Code 用户怎么用

这里也直接定：

### 本地开发

```bash
claude --plugin-dir ./memory-claude-plugin
```

### 正式安装

- 安装插件一次
- 后面正常启动 `Claude Code`

不需要每次重复配置。

## 6. Codex 直接实现方案

## 6.1 Codex 这里不做“纯插件注入”，直接做启动适配器

这里不再用模糊说法。

`Codex` 的直接实现方案就是：

- 一个 `Codex 启动适配器`
- 它前面接用户，后面接 `codex app-server`
- 它在 `turn/start` 前插入记忆
- 它在 `turn/completed` 后提交写回

交付目录固定成这样：

```text
memory-codex-adapter/
├── bin/
│   ├── memory-codex
│   ├── memory-codex-proxy
│   └── memory-runtime-bootstrap
├── config/
│   └── codex.memory.toml
└── mcp/
    └── memory-mcp-server
```

## 6.2 Codex 侧各部分做什么

### `bin/memory-codex`

负责：

- 作为用户的实际启动入口
- 启动本地 `memory-runtime-bootstrap`
- 启动 `memory-codex-proxy`
- 再把 Codex UI 或 CLI 连到 proxy

它就是用户侧看到的“Codex 已接入记忆”的启动命令。

### `bin/memory-codex-proxy`

负责：

- 充当前置宿主层
- 向后连接 `codex app-server`
- 拦截 `turn/start`
- 监听 `turn/completed`

### `bin/memory-runtime-bootstrap`

负责：

- 启动或确认 `retrieval-runtime`
- 启动或确认 `memory-mcp-server`
- 启动或确认后端 `codex app-server`

### `config/codex.memory.toml`

负责：

- 写入 `mcp_servers.memory`
- 让 Codex 同时能看到记忆查询工具

## 6.3 Codex 为什么不用“只靠 plugin”

这里直接定原因：

- 只靠技能、提示文件、普通工具装载，不足以拦住每个 `turn/start`
- 我们要的不是“让模型知道有记忆工具”
- 我们要的是“每一轮进入模型前，系统先恢复上下文”

所以 Codex 侧主实现就是：

- 启动适配器
- 不是单独的技能包

## 6.4 Codex 的启动流程

用户启动时流程固定如下：

1. 用户执行 `memory-codex`
2. `memory-codex` 启动 `memory-runtime-bootstrap`
3. `memory-runtime-bootstrap` 拉起：
   - `retrieval-runtime`
   - `memory-mcp-server`
   - `codex app-server`
4. `memory-codex-proxy` 对外提供前端 websocket 地址
5. Codex 客户端连到这个 proxy

到这里，Codex 的运行入口已经被我们接管。

## 6.5 Codex 当前轮注入流程

这部分直接按 `app-server` 协议实现。

目前协议里已经明确有：

- `turn/start`
- `turn/completed`

所以当前轮注入流程固定如下：

1. Codex 客户端发出 `turn/start`
2. `memory-codex-proxy` 拦截这个请求
3. 读取其中的：
   - `threadId`
   - `input[]`
4. 从 `input[]` 里提取当前用户输入
5. 调 `POST /runtime/prepare-context`
6. 收到 `injection_block`
7. 把 `injection_block` 作为额外输入项插入 `turn/start.params.input`
8. 再把改写后的 `turn/start` 转发给后端 `codex app-server`

这里就是 Codex 版主动注入主链路。

不是让模型自己先去调用记忆工具。

## 6.6 Codex 写回流程

当后端发出 `turn/completed` 时：

1. `memory-codex-proxy` 收到 `turn/completed`
2. 从 `turn` 数据里提取：
   - 当前轮最终输出
   - 工具执行摘要
   - turn 元信息
3. 调 `POST /runtime/finalize-turn`
4. `retrieval-runtime` 做写回判断
5. 异步提交给 `storage`
6. 原始 `turn/completed` 继续返回给 Codex 客户端

## 6.7 Codex 中 MCP 的作用

Codex 里也同样定角色：

- `proxy` 负责主注入
- `MCP` 负责工具查询

MCP 不承担基础注入主链路。

## 6.8 Codex 用户怎么用

这里不让用户自己拼参数。

直接给两个入口：

### CLI 入口

用户执行：

```bash
memory-codex
```

### 桌面或 IDE 入口

安装器创建：

- 桌面快捷方式
- IDE 启动项
- 或 shell alias（命令别名）

它们都指向 `memory-codex`。

这样用户感知就是：

- 启动 Codex
- 但已经带记忆接入

## 7. 两边的最终交付形态

## 7.1 Claude Code

直接交付一个：

- `Claude Code 官方 plugin`

## 7.2 Codex

直接交付一个：

- `Codex 启动适配器安装包`

这个安装包里包含：

- 启动入口
- proxy
- MCP 配置
- 本地服务拉起脚本

## 8. 故障处理约束

这里统一定故障策略。

### retrieval-runtime 挂了

- Claude hook 返回空上下文
- Codex proxy 直接透传原始 turn

结果：

- 宿主还能继续用
- 只是这一轮没有记忆增强

### memory-mcp-server 挂了

- 只影响手动查询工具
- 不影响基础对话

### storage 挂了

- 写回跳过
- 不影响当前轮响应

## 9. 这版需要立刻开工的实现任务

现在可以直接拆成下面两条开发线。

### 9.1 Claude Code 线

- 做 `memory-claude-plugin`
- 做 `hooks/hooks.json`
- 做 `bin/memory-bridge`
- 做 `.mcp.json`
- 接到 `retrieval-runtime`

### 9.2 Codex 线

- 做 `memory-codex`
- 做 `memory-codex-proxy`
- 接 `codex app-server`
- 在 `turn/start` 前注入
- 在 `turn/completed` 后写回
- 配 `mcp_servers.memory`

## 10. 最终落地口径

最后把口径定死：

- `Claude Code`：直接用官方 `plugin` 实现
- `Codex`：直接用启动适配器实现

如果你要的是“把产品真正接进去”，这就是这版应该执行的实现方案。
