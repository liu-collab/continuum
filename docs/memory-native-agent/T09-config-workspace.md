# T09 — 配置与工作区 / memory_mode 解析

## 当前状态

- 状态：已完成
- 完成时间：2026-04-18
- 验证结果：`npm run check`、`npm run build`、`npm test` 已通过
- 代码位置：`services/memory-native-agent/src/config/`

## 1. 目标

定义 `memory-native-agent` 的配置文件格式与加载策略，解析并传递 `workspace_id`、`user_id`、`memory_mode` 给 runner / memory-client。

## 2. 前置依赖

- T01 完成。

## 3. 交付物

### 3.1 文件清单

```
src/config/
├── index.ts               # 导出 loadConfig、AgentConfig
├── schema.ts              # zod schema
├── resolver.ts            # workspace/user 解析
├── defaults.ts
└── __tests__/
    └── config.test.ts
```

### 3.2 配置文件位置（优先级从高到低）

1. `--config <path>` 显式传入
2. `./.mna/config.yaml`（当前工作区目录下）
3. `~/.mna/config.yaml`（用户全局）
4. 内置 defaults

同一字段高优先级覆盖低优先级，按字段 merge，不是整段覆盖。

### 3.3 配置 schema（示例）

```yaml
# ~/.mna/config.yaml
runtime:
  base_url: http://127.0.0.1:4100
  request_timeout_ms: 800
  finalize_timeout_ms: 1500

provider:
  kind: openai-compatible    # openai-compatible | anthropic | ollama
  model: deepseek-chat
  base_url: https://api.deepseek.com
  api_key_env: DEEPSEEK_API_KEY
  temperature: 0.7

memory:
  mode: workspace_plus_global   # workspace_plus_global | workspace_only
  user_id: null                 # 留空时由 resolver 生成并持久化

mcp:
  servers:
    - name: fs
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-filesystem", "."]

tools:
  shell_exec:
    enabled: true
    timeout_ms: 30000
    deny_patterns: ["rm -rf /", "sudo ", "curl * | sh"]

cli:
  system_prompt_file: null     # 可选：相对配置文件的路径
```

### 3.4 `workspace_id` / `user_id` 解析

#### user_id

- 优先用 `memory.user_id`
- 否则读 `~/.mna/identity.json` 里的 `user_id`
- 否则生成一个 UUIDv4，写入 `~/.mna/identity.json`，首次使用后固定

对齐 `current-phase-closure-plan.md` 第 5.1 节：`single_local_user` 模式下本地只有一个用户。

#### workspace_id

- 由 `cwd` 到 `workspace_id` 的确定性映射
- 实现：`workspace_id = uuidv5(WORKSPACE_NS, normalize(cwd))`，namespace UUID 固定在 `defaults.ts`
- `normalize(cwd)` 规则（跨平台稳定）：
  1. `path.resolve(cwd)` 得到绝对路径
  2. 解开符号链接：`fs.realpathSync.native(resolved)`
  3. **Windows**：统一大写盘符（`c:\...` → `C:\...`），把 `\` 替换为 `/`
  4. **POSIX**：保留大小写
  5. 移除末尾 `/`（除根目录）
- 同一路径多次启动得到相同 UUID，跨机器也保持稳定
- `--workspace <path>` 可覆盖默认 cwd

把映射写入 `~/.mna/workspaces.json`（可选，用于调试）：

```json
{
  "/home/me/repo-a": "b4b1...",
  "/home/me/repo-b": "f7c9..."
}
```

### 3.5 `AgentConfig` 类型

```ts
export interface AgentConfig {
  runtime: {
    baseUrl: string;
    requestTimeoutMs: number;
    finalizeTimeoutMs: number;
  };
  provider: ProviderConfig;      // 与 T04 对齐
  memory: {
    mode: "workspace_only" | "workspace_plus_global";
    userId: string;
    workspaceId: string;
    cwd: string;
  };
  mcp: {
    servers: McpServerConfig[];
  };
  tools: {
    shellExec: {
      enabled: boolean;
      timeoutMs: number;
      denyPatterns: string[];
    };
  };
  cli: {
    systemPrompt: string | null;
  };
  locale?: "zh-CN" | "en-US";    // 会话语言，优先级见 T12 §10.3
}
```

### 3.6 加载与校验流程

1. `loadConfig({ configPath, cwdOverride, memoryModeOverride })`
2. 读文件（YAML / JSON 都支持），`yaml` 库解析
3. `zod` 校验
4. resolver 补齐 `user_id` / `workspace_id` / `cwd`
5. 合成最终 `AgentConfig`
6. **不**把 api_key 读进内存的配置对象；由 provider-factory 在需要时从 `process.env[api_key_env]` 读取，防止日志误打印

### 3.7 错误输出

配置不合法时：

- 打印具体字段路径（zod flatten）
- 退出码 2（区别于运行时错误）

## 4. 实施步骤

1. 写 zod schema、defaults、resolver。
2. 写 loader：多级合并 + 覆盖顺序。
3. 测试：
   - 无配置文件时走 defaults
   - `--config` 覆盖
   - cwd 到 workspace_id 幂等
   - api_key_env 未设置时报明确错误
   - `memory.mode` 非法值报错

## 5. 验收标准

- 10+ 条测试用例覆盖上述分支。
- `workspace_id` 同一路径稳定返回同一 UUID。
- `~/.mna/identity.json` 首次生成后，第二次启动读到同一 `user_id`。
- 任何 api key 都不会出现在 `AgentConfig` 对象的序列化结果里。

## 6. 相关契约

- `docs/current-phase-closure-plan.md` 第 5.1 / 5.2 / 6.2 节：正式交付模式与 memory_mode
- `docs/memory-module-contract.md` 第 5.1 节：检索接口字段 `user_id` / `workspace_id` / `memory_mode`

## 7. 不在范围内

- 多用户配置文件（single_local_user 前提下用不到）
- 热更新配置
- 加密存储 api key（首版靠 env 变量，不搞密钥库）
