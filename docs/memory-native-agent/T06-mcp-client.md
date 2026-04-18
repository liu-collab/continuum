# T06 — MCP 客户端（stdio + http）

## 1. 目标

在 agent 进程内提供一个 MCP 客户端（Model Context Protocol），能连接多个已配置的 MCP server，
自动发现其工具列表，并把调用结果包装成 `ToolResult` 供 T05 的 `mcp_call` 分发使用。

## 2. 前置依赖

- T01 完成。

## 3. 交付物

### 3.1 文件清单

```
src/mcp-client/
├── index.ts                # 导出 McpClient、McpRegistry
├── registry.ts             # 管理多 server 连接
├── stdio-transport.ts      # stdio 模式
├── http-transport.ts       # streamable-http 模式
├── types.ts
└── __tests__/
    ├── stdio.test.ts
    └── http.test.ts
```

### 3.2 依赖

使用官方 SDK `@modelcontextprotocol/sdk`（npm package），不自研 wire protocol。

**版本锁定**：实施时先 `npm view @modelcontextprotocol/sdk version` 查当前稳定版，在 `package.json` 里**固定 minor 版本**（例如 `"^1.6.0"` 而非 `"*"`）。该 SDK 近期 API 改动较频繁，不锁版本会在升级时踩坑。

### 3.3 `McpRegistry` 公共接口

```ts
export interface McpServerConfig {
  name: string;                        // 本地别名，例如 "fs" / "github"
  transport: "stdio" | "http";
  // stdio:
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // http:
  url?: string;
  headers?: Record<string, string>;
}

export class McpRegistry {
  constructor();
  async addServer(config: McpServerConfig): Promise<void>;
  listTools(): McpToolDescriptor[];                       // 聚合所有 server 的工具
  async callTool(server: string, tool: string, args: unknown): Promise<McpCallResult>;
  async shutdown(): Promise<void>;
}

export interface McpToolDescriptor {
  server: string;                      // "fs"
  name: string;                        // "read_file"
  description: string;
  input_schema: JSONSchema;
}
```

### 3.4 启动与工具发现

- agent 启动时，按 config 顺序初始化每个 server：
  - stdio：spawn 子进程，用 JSON-RPC over stdio 通信
  - http：建立 HTTP/SSE 长连接
- 每连上一个 server，发 `tools/list`，缓存工具描述
- 失败的 server **不阻塞整体启动**，日志打印并标记为 `unavailable`；`listTools()` 会过滤掉不可用 server

### 3.5 工具名冲突处理

不同 MCP server 可能有同名工具。在 `listTools()` 返回里用 `server` + `name` 两段式区分。
暴露给 LLM 的工具名统一为 `mcp_<server>_<name>`，或者统一通过 `mcp_call` 单一入口（`{server, tool, args}`）。

**首版选择"单一入口 `mcp_call`"**：LLM 只看到一个工具，参数里指定 `server` + `tool`。理由：

- 对 LLM 的工具列表更短，减少 prompt 膨胀
- 切换 MCP server 不影响 system prompt
- 与 T05 `mcp_call` 设计保持一致

### 3.6 降级

- 某个 server 断连时：
  - 后续对它的 `callTool` 立即返回错误，不阻塞其他 server
  - 尝试一次重连（可配置关闭），失败则标记为 `dead`
- 全部 server 不可用时，`mcp_call` 工具仍然注册给 LLM，但调用永远返回错误（与"工具存在但执行失败"一致，不破坏对话流）

### 3.7 生命周期与运行时管理

- `McpRegistry` 由 runner 持有
- `SIGINT` / `SIGTERM` 时调用 `shutdown()` 回收子进程
- 不做**配置热更新**（改配置需要重启 agent）
- 提供**运行时管理接口**，支撑 T08 的 MCP 路由：

```ts
export class McpRegistry {
  // ... 原有 ...
  async restartServer(name: string): Promise<void>;     // shutdown + re-connect 单 server
  disableServer(name: string): void;                    // 标记为 disabled；listTools 过滤；运行时状态不落盘
  getServerStatus(name: string): McpServerStatus;       // ok | unavailable | dead | disabled
}

export interface McpServerStatus {
  name: string;
  transport: "stdio" | "http";
  state: "ok" | "unavailable" | "dead" | "disabled";
  last_error?: string;
  connected_at?: string;
  tool_count: number;
}
```

`disableServer` 只影响本次进程生命周期；下次 mna 启动按 config 恢复（这是给"临时掐掉某个可疑 server"用的，不是持久禁用）。

### 3.8 Trust level 标注

每个 server 的调用结果经 T05 `mcp_call` 返回后，T07 `conversation.ts` 包裹成：

```
<tool_output tool="mcp_call" call_id="..." trust="mcp:{{server_name}}">
{{output}}
</tool_output>
```

`trust_level` 默认为 `mcp:<server_name>`。后续若要给不同 server 设不同信任等级（例如内置 fs server 高 / 第三方 server 低），可在 `McpServerConfig` 加 `trust?: "builtin" | "third_party"` 字段——首版不做，默认全部视为第三方。

## 4. 实施步骤

1. 引入 `@modelcontextprotocol/sdk`，调研其 Client、StdioClientTransport、HttpClientTransport API。
2. 实现 `McpRegistry`：串行 add、并发 listTools、按 name 路由 callTool。
3. 测试：起两个 mock MCP server（可以用 SDK 自带的 Server 类实现 echo server），验证 stdio + http 各一。
4. 验证断连 / 未响应超时路径。

## 5. 验收标准

- 连接两个 mock server，`listTools()` 返回合并后的工具列表。
- `callTool("fs", "read_file", {path: "README.md"})` 返回正常结果。
- 模拟一个 server crash，对它的调用立即失败，对另一个 server 调用仍成功。
- agent 进程退出时所有子进程被回收（ps 检查无残留）。

## 6. 相关契约

- `docs/retrieval/agent-host-integration-research.md` 第 4.3 / 5.1 节：MCP 在其他宿主里的角色（参考但不绑定）
- 本模块在 agent 进程内独立，不与三服务共享实现

## 7. 不在范围内

- agent 作为 MCP **server** 对外暴露工具（现有 `services/retrieval-runtime` 已经有 MCP server）
- MCP authorization / OAuth
- 工具调用结果的持久化

## 8. 当前状态

- 当前状态：已完成
- 已落地内容：
  - `src/mcp-client/registry.ts` 已实现 `addServer / listTools / callTool / restartServer / disableServer / getServerStatus / shutdown`
  - `src/mcp-client/stdio-transport.ts` 与 `src/mcp-client/http-transport.ts` 已基于官方 SDK 落地
  - 工具列表按 `server + name` 聚合缓存，返回结构保持 `input_schema` 形式，供后续 `T05` 直接消费
  - 连接失败不会阻塞整体启动，server 状态会落为 `unavailable` 或 `dead`
  - 已补 `stdio` 与 `http` 两组真实 SDK mock server 集成测试
- 已验证：
  - `npm run check`
  - `npm test`
  - `npm run build`
