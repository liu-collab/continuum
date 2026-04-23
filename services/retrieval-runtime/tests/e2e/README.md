# 本地宿主实机 E2E 验收

这里补的是“真实宿主链路”验证，不是仓库内的内存 stub 集成测试。

## 这套验证分两层

1. 半自动真链路测试
- 直接调用真实桥接脚本：`memory-bridge.mjs`、`memory-codex-proxy.mjs`、`memory-mcp-server.mjs`
- 连接真实 `retrieval-runtime` HTTP 服务
- 不依赖 fake HTTP，不走内存注入替身
- 适合本地重复执行，也适合作为验收前检查

2. 本机宿主实机验收
- 由你本机已安装的 `Claude Code`（Claude Code）或 `Codex`（Codex）客户端真实触发
- 用于确认 hook / proxy / MCP / runtime 整条链路都能在你的本机环境里工作
- 因为通常依赖登录态、交互环境和本机安装，所以不适合写成完全无人值守测试

## 前置条件

需要你本机已经满足：

- Node.js 22+
- 已安装并能启动 `retrieval-runtime`（retrieval-runtime）
- 已安装可用的 `Claude Code`（Claude Code）客户端（如果要验 Claude）
- 已安装可用的 `Codex`（Codex）客户端（如果要验 Codex）
- 真实可访问的 runtime 地址，默认：`http://127.0.0.1:3002`

## 推荐执行顺序

先做半自动真链路，再做本机宿主实机验收：

1. 复制环境模板并填写真实值
2. 启动 `retrieval-runtime`（retrieval-runtime）
3. 运行统一检查入口
4. 单独运行 Claude / Codex 本地链路测试
5. 最后按下面步骤做一次宿主实机操作验收

## 配置模板

示例模板：

- `tests/e2e/fixtures/claude.local.env.example`
- `tests/e2e/fixtures/codex.local.env.example`

建议复制为你自己的本地文件，例如：

- `tests/e2e/fixtures/claude.local.env`
- `tests/e2e/fixtures/codex.local.env`

这些本地文件不要提交。

## Claude Code 本机实机验收

### 1. 设置环境变量

至少保证这些变量可用：

- `MEMORY_RUNTIME_BASE_URL`
- `MEMORY_WORKSPACE_ID`
- `MEMORY_USER_ID`
- `MEMORY_SESSION_ID`
- `MEMORY_MODE`
- `CLAUDE_PLUGIN_ROOT`

### 2. 安装 hook 配置

仓库内现成 hook 配置在：

- `host-adapters/memory-claude-plugin/hooks/hooks.json`

桥接脚本在：

- `host-adapters/memory-claude-plugin/bin/memory-bridge.mjs`

MCP 配置在：

- `host-adapters/memory-claude-plugin/.mcp.json`

### 3. 半自动链路验证

可先运行：

- `tests/e2e/claude-local-host.e2e.test.ts`

它会直接调用真实 `memory-bridge.mjs`，分别验证：

- `session-start`
- `prepare-context`
- `finalize-turn`

验收重点：

- 桥接脚本是否成功向 runtime 发请求
- runtime 是否返回 `trace_id`
- `prepare-context` 是否返回可见的 `additionalContext`
- `finalize-turn` 是否返回写回统计字段

### 4. Claude 实机操作验收

在你本机真实打开 `Claude Code`（Claude Code）后，做一次最小操作：

1. 打开带有 Continuum 配置的工作区
2. 触发一次会话启动
3. 输入一句会命中记忆检索的话
4. 完成一轮回答并结束

你应观察到：

- `SessionStart`（会话启动）触发成功
- `UserPromptSubmit`（用户提交）触发成功
- `Stop`（会话结束）触发成功
- runtime 侧能查到对应 `trace_id`、`session_id`、`turn_id`

## Codex 本机实机验收

### 1. 设置环境变量

至少保证这些变量可用：

- `MEMORY_RUNTIME_BASE_URL`
- `MEMORY_USER_ID`
- `MEMORY_MODE`
- `MEMORY_CODEX_PROXY_LISTEN_URL`
- `CODEX_APP_SERVER_URL`
- `MEMORY_CODEX_CLIENT_COMMAND`

### 2. 检查配置文件

仓库里已有 Codex 配置模板：

- `host-adapters/memory-codex-adapter/config/codex.memory.toml`

默认链路是：

- runtime：`http://127.0.0.1:3002`
- proxy listen：`ws://127.0.0.1:3788`
- upstream app server：`ws://127.0.0.1:3777`

### 3. 半自动链路验证

可先运行：

- `tests/e2e/codex-local-host.e2e.test.ts`

它会验证：

- `memory-codex-proxy.mjs` 能启动
- proxy 能接受 WebSocket 连接
- proxy 能把真实请求转成 runtime 的 `session-start-context / prepare-context / finalize-turn`
- `memory-mcp-server.mjs` 能对 runtime 发起真实工具调用

### 4. Codex 实机操作验收

你本机的 Codex 启动入口在：

- `host-adapters/memory-codex-adapter/bin/memory-codex.mjs`

它会启动：

- runtime bootstrap
- proxy
- 真实 Codex 客户端命令

验收重点：

- 客户端是否接入 proxy
- 首轮是否收到 developer 注入消息
- 完成一轮后 runtime 是否记录 finalize 轨迹
- MCP 工具是否可列出并可调用

## 统一入口

统一检查入口：

- `tests/e2e/run-local-host-checks.mjs`

它会做三件事：

1. 检查本机依赖和关键命令
2. 检查 runtime 是否可访问
3. 顺序执行 Claude / Codex 本地链路验证

## 验收通过标准

满足以下条件即可认为本地宿主实机链路通过：

- 真实桥接脚本能调用真实 runtime
- Claude hook 三阶段都能触发
- Codex proxy / MCP / client 链路可连通
- runtime 能返回并记录真实 `trace_id`
- `observe/runs`（运行观测）能查到对应轨迹

## 说明

这套测试不会强依赖仓库内 stub 数据，但仍然需要你本地先把 runtime、存储、向量或降级路径准备好。

如果你的本机 Claude / Codex 需要登录或交互确认，这部分属于正常现象，因此文档把它归到“实机验收”，而不是强行做成完全无人值守测试。
