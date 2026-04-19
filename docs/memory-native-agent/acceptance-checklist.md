# memory-native-agent 验收清单

这份清单现在同时用于人工收口和自动化回写。

状态约定：

- `[自动化通过]` 已有测试覆盖，当前代码已通过对应用例
- `[进行中]` 已有部分自动化或基座，但还没有形成稳定闭环
- `[未开始]` 还没有有效自动化
- `[人工复核]` 当前仍以人工检查为主

## 1. 基础启动

- [人工复核] `continuum start` 后，`storage`、`retrieval-runtime`、`visualization`、`memory-native-agent` 都能启动
- [人工复核] `continuum status` 能看到 `memory-native-agent` 状态
- [自动化通过] `GET http://127.0.0.1:4193/healthz` 返回 200
- [自动化通过] `GET http://127.0.0.1:4193/v1/agent/dependency-status` 能返回 runtime / provider / mcp 状态

## 2. agent 页面

- [自动化通过] 浏览器打开 `/agent` 能自动创建或恢复一个 session
- [自动化通过] 发送一条消息后，页面能看到流式 assistant 输出
- [自动化通过] 首轮消息后能看到 Injection Banner 或明确的空注入状态
- [自动化通过] 左侧 session 列表能切换、改标题、删除 session
- [自动化通过] 左侧文件树能浏览目录并预览文件
- [自动化通过] Prompt Inspector 能打开并显示 messages / tools

## 3. 工具与 MCP

- [自动化通过] 当工具需要确认时，页面会弹出 ConfirmDialog
- [自动化通过] 点击允许或拒绝后，后端行为会发生对应变化
- [自动化通过] 工具控制台能看到工具调用、输出摘要和 trust level
- [自动化通过] MCP 面板能显示 server 状态
- [自动化通过] MCP 的 `restart` / `disable` 按钮能成功调用后端

## 4. 降级与恢复

- [自动化通过] 关闭 `retrieval-runtime` 后，agent 页面不会白屏
- [自动化通过] runtime 不可用时，页面能显示降级状态
- [自动化通过] 关闭 `memory-native-agent` 后，`/agent` 页面显示离线提示
- [进行中] 重启 `memory-native-agent` 后，页面能恢复连接

## 5. 记忆边界

- [自动化通过] `memory_mode` 从 `workspace_plus_global` 切到 `workspace_only` 后，下一轮状态有变化
- [自动化通过] 对应 turn 的 `trace_id` 能在 `/runs` 页面查到
- [自动化通过] `visualization` 其他页面（`/memories`、`/runs`、`/dashboard`）不受 `/agent` 功能影响

## 6. 当前自动化覆盖说明

当前已由自动化覆盖的部分：

- `memory-native-agent` 的 HTTP / WS / CORS / runner / session-store / provider / MCP / tools 单测
- `visualization` 的 `agent reducer`、token route、观测页服务层单测
- `continuum-cli` 的 mna 命令解析、状态命令、构建和类型检查
- `visualization` 的 `/agent` 核心交互 `Playwright` 用例：session 启动、消息发送、注入空态、Prompt Inspector、memory_mode、文件预览、session 管理
- `visualization` 的 `/agent` 工具与 MCP `Playwright` 用例：确认框、allow/deny、工具控制台、MCP restart/disable
- `visualization` 的 `/runs` 联动 `Playwright` 用例：turn trace 查询、`/memories` 与 `/dashboard` 页面回归
- `visualization` 的 `/agent` 降级 `Playwright` 用例：runtime down 后页面可继续工作并展示降级状态

当前还未自动化覆盖、需要人工复核的部分：

- `continuum start` 拉起整套服务后的真实跨服务联通
- `token --rotate` 的完整轮换流程
- `memory-native-agent` 重启后，`/agent` 页面自动恢复连接 这一条还在补稳定性
