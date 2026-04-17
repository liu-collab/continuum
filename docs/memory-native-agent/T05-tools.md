# T05 — 内置工具层（fs / shell / mcp 分发）

## 1. 目标

给 agent 提供首版可用的工具集合：文件读写、Shell 执行、MCP 工具转发。
所有工具声明 JSON Schema，统一经 `ToolDispatcher` 分发，并落实首版**权限模型**。

## 2. 前置依赖

- T01 完成
- T06 完成（MCP client 必须先可用，`mcp_call` 才能分发到外部 server）

## 3. 交付物

### 3.1 文件清单

```
src/tools/
├── index.ts                   # 导出 ToolRegistry、ToolDispatcher
├── types.ts                   # Tool、ToolInvocation、ToolResult
├── registry.ts                # ToolRegistry：注册 + 查 schema
├── dispatcher.ts              # ToolDispatcher：按 name 路由 + 权限门
├── permission-gate.ts         # 用户确认 / 白名单逻辑
├── builtin/
│   ├── fs-read.ts
│   ├── fs-write.ts
│   ├── fs-edit.ts
│   ├── shell-exec.ts
│   └── mcp-call.ts            # 转发到 T06 的 MCP client
└── __tests__/
    ├── fs.test.ts
    ├── shell.test.ts
    └── dispatcher.test.ts
```

### 3.2 Tool 接口

```ts
export interface Tool {
  name: string;                     // 唯一工具名，例如 "fs_read"
  description: string;
  parameters: JSONSchema;           // 暴露给 LLM 的参数 schema
  permission: "auto" | "confirm" | "deny_by_default";
  invoke(args: unknown, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  cwd: string;
  workspace_root: string;
  confirm(promptText: string): Promise<boolean>;   // 由 TUI 层实现
  abort: AbortSignal;
}

export interface ToolResult {
  ok: boolean;
  output: string;                   // 给 LLM 的回显（文本）
  artifact?: { kind: "file_diff" | "file_content" | "stdout"; data: string };
  error?: { code: string; message: string };
}
```

### 3.3 内置工具清单与权限等级

| 工具 | 用途 | permission | 说明 |
| :--- | :--- | :--- | :--- |
| `fs_read` | 读文件 / 目录列表 | `auto` | 仅允许 `workspace_root` 下的相对路径；拒绝绝对路径越权 |
| `fs_write` | 新建或覆写文件 | `confirm` | 首次调用必须 TUI 确认；带 diff 预览 |
| `fs_edit` | 字符串定位替换 | `confirm` | old_string / new_string 模式，类似 Claude Code Edit |
| `shell_exec` | 执行 shell 命令 | `confirm` | 默认黑名单：`rm -rf /`、`curl | sh`、`sudo`；超时 30s |
| `mcp_call` | 调用 MCP server 工具 | 视 MCP 工具声明 | 透传 T06 提供的能力 |

### 3.4 权限门

`permission-gate.ts` 实现两种策略：

- `auto`：直接执行
- `confirm`：调用 `ctx.confirm(promptText)`；TUI/WS 层负责 Y/N 交互；用户可选"本次会话全部允许"，会把该工具升级为 `auto`（仅在当前 session 内）

（去掉了之前列出的 `deny_by_default`，首版无工具使用此级别；后续如需再加。）

工作区边界：

- 所有文件路径先做 `path.resolve(ctx.workspace_root, arg)`，然后 `fs.realpath` 解开**符号链接**后再次判断是否落在 `workspace_root` 内。任何一步指向外部直接拒绝，不进入 confirm
- shell 命令只在 `cwd = workspace_root` 下执行

### 3.4.1 工具输出超限与 artifact

每个工具的 `ToolResult.output`（给 LLM 回显）**必须 ≤ 10 KB**。超限时：

1. 截断文本（头 5KB + "..." + 尾 2KB 策略）放到 `output`
2. 完整内容按 T12 第 4 节"Artifact 存储"写入 `~/.mna/artifacts/<session_id>/<call_id>.txt`
3. `ToolResult.artifact` 填 `{kind, data}`，`artifact_ref` 路径由 T08 WS 层生成
4. 单 artifact 超 5 MB 直接返回错误，不写文件

**output 会被 T07 `conversation.ts` 按 T12 §8 包裹成 `<tool_output tool="..." trust="...">...</tool_output>` 再喂回模型。** 工具实现侧不需要自己加 tag，但要保证 output 里不包含未转义的 `</tool_output>`（由 `conversation.ts` 统一转义，这里只是约束约定）。

### 3.4.2 审计日志（接 T14 session-store）

`ToolDispatcher.invoke` 出口**必须**调 `SessionStore.recordToolInvocation`，不论成功/失败/拒绝/黑名单命中/超时都要记录。字段见 T14 §3.3 `tool_invocations` 表。

- `args_hash` 在 dispatcher 计算：`sha256(JSON.stringify(args))`
- `args_preview` 取 `JSON.stringify(args)` 前 512 字符
- `permission_decision` 来自 permission-gate 的返回值（`auto|allowed_once|allowed_session|denied|timeout|blocked_pattern`）
- store 不可用时 only warn 日志，不阻断工具执行

### 3.5 `fs_edit` 语义

参考 Claude Code `Edit` 工具：

- 参数：`path`、`old_string`、`new_string`、`replace_all?`
- 约束：`old_string` 在文件里必须唯一，否则返回错误并要求扩大 old_string
- 返回：文件 diff 片段

### 3.6 `shell_exec` 语义

- 参数：`command`、`description`、`timeout_ms?`（默认 30000，最大 120000）
- **跨平台分派、黑名单规则、超时信号行为**统一遵守 T12 第 5 节"跨平台 shell 适配"
- 输出 stdout / stderr 截断到 10 KB 给 LLM；完整输出按 3.4.1 写 artifact

### 3.7 `ToolDispatcher`

```ts
class ToolDispatcher {
  constructor(registry: ToolRegistry, gate: PermissionGate);
  async invoke(call: ToolInvocation, ctx: ToolContext): Promise<ToolResult>;
  listTools(): ToolSchema[];   // 给 provider 用
}
```

## 4. 实施步骤

1. 写 `types.ts` 与 `registry.ts`（最小可注册）。
2. 写 `permission-gate.ts`（提供 `noopGate` for test）。
3. 实现四个内置工具 + 测试。
4. 实现 `mcp_call`：接收 `{ server: string; tool: string; args: unknown }`，调用 T06 的 `McpClient` 发请求。
5. 测试覆盖：合法路径 / 越权路径 / confirm 被拒 / shell 黑名单命中 / 超时。

## 5. 验收标准

- 四个内置工具 + `mcp_call` 至少各 2 条用例通过。
- 越权路径用例必须**拒绝而不是 confirm**。
- shell 黑名单用例返回明确错误。
- `ToolDispatcher.listTools()` 返回的 schema 能被 T04 的 `IModelProvider` 直接喂给 LLM（形状一致）。

## 6. 相关契约

- `docs/product-baseline.md` 第 6.4 节：写回必须有选择（对 agent 动作也适用的"有节制"原则）
- 首版没有跨服务契约约束

## 7. 不在范围内

- 网络工具（http_fetch、web_search）
- 代码执行沙箱（首版只靠权限门 + 黑名单）
- 批量工具调用并发（runner 决定并发策略）
