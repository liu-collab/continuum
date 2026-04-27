# 项目技术文档

## 1. 项目概览

Continuum 是一套给 `Codex`、`Claude Code` 这类 agent 宿主接入长期上下文能力的工程化系统。

它主要解决四件事：

- 把值得保留的信息整理成结构化记忆
- 在运行时合适的阶段主动恢复上下文
- 在回合结束后把候选记忆写回、治理、沉淀
- 把配置、记忆、运行轨迹和指标做成可查看、可排查的页面

如果先抓一条主线，可以这样理解：

> `storage` 负责把记忆存对，`retrieval-runtime` 负责把记忆用对，`memory-native-agent`（MNA）负责把能力挂到 agent 上，`visualization` 负责把系统看清楚，`continuum`（统一命令）负责把这些东西装起来、跑起来、接到宿主上。

### 1.1 仓库组成

| 模块 | 作用 |
|---|---|
| `storage` | 结构化记忆写入、治理、共享读模型发布 |
| `retrieval-runtime` | 召回、注入、写回检查、运行时观测 |
| `memory-native-agent` | 会话、工作区、工具、技能、MCP、宿主侧运行 |
| `visualization` | 页面、指标、轨迹、配置与文档入口 |
| `packages/continuum-cli` | 安装、托管启动、宿主接入、统一 CLI |

### 1.2 典型链路

1. 用户从页面或宿主发起一轮输入。
2. `MNA` 组装会话、工作区、工具、技能和 `MCP` 上下文。
3. `MNA` 调用 `retrieval-runtime` 做触发、召回和注入。
4. 当前轮结束后，`retrieval-runtime` 生成写回候选并提交给 `storage`。
5. `storage` 做标准化、去重、合并和读模型投影。
6. `visualization` 读取这些结果并展示给用户。

### 1.3 适用场景

- 长对话、多轮协作
- 需要跨任务延续状态的编码助手
- 需要保存用户偏好、项目约束、工作方式的个人 agent
- 需要把召回、写回、治理和观测做成产品化系统的团队

### 1.4 运行依赖

| 依赖 | 说明 |
|---|---|
| Node.js `>=22` | 仓库统一要求 |
| PostgreSQL `15+` | 结构化记忆与运行时数据存储 |
| `pgvector` | 向量能力 |
| Docker | 托管模式使用 |
| 第三方 `embedding API` | 向量检索与相似度能力 |
| 第三方模型服务 | `provider` 与 `memory_llm` 相关能力 |

### 1.5 重要约束

- `continuum start` 当前只正式支持 Windows。
- `npm run dev`、单服务启动、Docker Compose、自行部署不受这个限制。
- 文档里统一使用 `memory_llm` 作为用户可见名称。
- 历史上的 `writeback llm`、`WRITEBACK_LLM_*` 仅作为兼容名保留。

## 2. 启动与使用

这一章只回答四件事：装在哪里、怎么启动、怎么用、分别适合什么场景。

### 2.1 安装

推荐直接安装统一包：

```powershell
npm install -g @jiankarlin/continuum
```

安装后先确认命令可用：

```powershell
continuum --help
```

### 2.2 托管启动

这是最短路径，适合先把整套系统跑起来。

```powershell
continuum start
continuum ui
```

说明：

- `continuum start` 会启动托管栈，并在栈就绪后拉起 `MNA`
- 默认页面地址是 `http://127.0.0.1:3003`
- 首次启动时，页面可以先打开，不要求你预先把所有模型都配齐

可选地补 `embedding`：

```powershell
$env:EMBEDDING_BASE_URL="https://api.openai.com/v1"
$env:EMBEDDING_MODEL="text-embedding-3-small"
$env:EMBEDDING_API_KEY="your-key"
continuum start
```

这里的 `embedding` 是可选项，不是“页面能否启动”的前置条件。

- 不配它，页面仍然能打开
- 但向量召回、相关依赖状态和健康检查会显示未配置或未就绪

如果需要局域网访问：

```powershell
continuum start --bind-host 0.0.0.0
```

### 2.3 源码开发

适合本地开发和联调。

默认前提：

- 你已经准备好了 PostgreSQL
- 数据库默认会连 `postgres://postgres:postgres@127.0.0.1:5432/agent_memory`

启动命令：

```powershell
npm run dev
```

它会依次做两件事：

1. 先跑 `storage` 和 `retrieval-runtime` 的迁移
2. 再同时启动 5 个服务

默认服务包括：

- `storage`：`127.0.0.1:3001`
- `retrieval-runtime`：`127.0.0.1:3002`
- `visualization`：`127.0.0.1:3003`
- `memory-native-agent`：`127.0.0.1:4193`
- `storage worker`

如果你已经自己准备好了地址，也可以先改环境变量再启动。

### 2.4 单服务调试

适合只调一个模块。

`storage`：

```powershell
cd services/storage
npm run migrate
npm run dev
```

另开一个终端：

```powershell
cd services/storage
npm run dev:worker
```

`retrieval-runtime`：

```powershell
cd services/retrieval-runtime
npm run migrate
npm run dev
```

`memory-native-agent`：

```powershell
cd services/memory-native-agent
npm run dev
```

`visualization`：

```powershell
cd services/visualization
npm run dev
```

### 2.5 宿主接入

这一部分只讲安装和使用，不再写成“常见流程”。

#### `Codex`

安装：

```powershell
continuum codex install
```

使用：

```powershell
continuum codex
```

也可以显式写成：

```powershell
continuum codex use
```

说明：

- `install` 只保留为兼容入口；Codex 现在不需要注册记忆 `MCP server`
- `codex` 或 `codex use` 会用桥接方式启动已经接好 Continuum 的 `Codex`，记忆由平台强制注入

#### `Claude Code`

安装：

```powershell
continuum claude install
```

使用：

```powershell
claude --plugin-dir "<plugin-dir>"
```

说明：

- 默认插件目录通常在 `~/.continuum/claude-plugin`
- 如果安装时传了 `--plugin-dir`，使用时要保持一致
- `continuum claude install` 负责安装和改写插件命令
- `claude --plugin-dir "<plugin-dir>"` 才是实际启动宿主的命令

### 2.6 页面里怎么用

页面主要有这些入口：

- `Agent`
- `记忆`
- `治理`
- `运行`
- `看板`
- `文档`

最常用的是 `Agent` 页，可以做这些事：

- 新建和切换会话
- 注册和切换工作区
- 查看工作区文件树与文件内容
- 与 agent 对话
- 查看当前轮注入的记忆
- 管理 `MCP servers`
- 打开设置面板修改运行配置
- 打开 `prompt inspector`

输入框侧的实际使用入口包括：

- 正常对话
- `/skill`
- 所有已导入、允许用户触发的技能命令

## 3. 命令参考

### 3.1 根目录命令

| 命令 | 作用 |
|---|---|
| `npm run start` | 启动托管栈 |
| `npm run stop` | 停止托管栈 |
| `npm run status` | 查看托管栈状态 |
| `npm run ui` | 打开或启动页面 |
| `npm run dev` | 启动源码开发栈 |

### 3.2 `continuum`

| 命令 | 作用 |
|---|---|
| `continuum start` | 启动托管栈 |
| `continuum stop` | 停止托管栈 |
| `continuum status` | 查看健康状态 |
| `continuum ui` | 打开页面 |
| `continuum mna install` | 检查或准备 `MNA vendor` |
| `continuum mna start` | 单独启动 `MNA` |
| `continuum mna stop` | 单独停止 `MNA` |
| `continuum mna logs` | 查看 `MNA` 日志 |
| `continuum mna token` | 输出 `MNA token` |
| `continuum claude install` | 安装 `Claude plugin` |
| `continuum claude uninstall` | 卸载 `Claude plugin` |
| `continuum codex install` | Codex 强制注入入口说明，不注册 MCP |
| `continuum codex uninstall` | 清理历史 `Codex MCP server` 注册 |
| `continuum codex use` | 用桥接方式启动 `Codex` |
| `continuum codex` | 等价于 `continuum codex use` |
| `continuum runtime` | 直接启动打包后的 `retrieval-runtime` |
| `continuum mcp-server` | 直接启动打包后的记忆 `MCP server` |

### 3.3 常用参数

#### `continuum start`

| 参数 | 作用 |
|---|---|
| `--open` | 启动后自动打开页面 |
| `--bind-host` | `127.0.0.1` 或 `0.0.0.0` |
| `--postgres-port` | 托管 PostgreSQL 端口 |
| `--embedding-base-url` | 第三方 `embedding API` 地址 |
| `--embedding-model` | 向量模型名 |
| `--embedding-api-key` | 向量接口鉴权 |
| `--provider-kind` | 启动时写入的 agent provider 类型 |
| `--provider-model` | 启动时写入的 agent provider 模型名 |
| `--provider-base-url` | 启动时写入的 agent provider 地址 |
| `--provider-api-key-env` | 启动时写入的 agent provider 密钥环境变量名 |

#### `continuum status`

| 参数 | 作用 |
|---|---|
| `--json` | 输出 JSON |
| `--strict` | 有 degraded 也返回失败 |
| `--runtime-url` | 指定 runtime 地址 |
| `--storage-url` | 指定 storage 地址 |
| `--ui-url` | 指定页面地址 |
| `--database-url` | 指定数据库连接串 |
| `--timeout` | 指定检查超时 |

#### `continuum ui`

| 参数 | 作用 |
|---|---|
| `--host` | 页面监听地址 |
| `--port` | 页面监听端口 |
| `--open` | 自动打开浏览器 |
| `--url` | 直接打开指定页面地址 |
| `--runtime-url` | 指定 runtime 地址 |
| `--storage-url` | 指定 storage 地址 |
| `--database-url` | 指定读模型数据库连接串 |
| `--mna-url` | 指定 `MNA` 地址 |
| `--mna-token-path` | 指定 `MNA token` 文件路径 |

#### `continuum mna`

| 参数 | 作用 |
|---|---|
| `--mna-url` | 指定 `MNA` 地址 |
| `--mna-host` | 指定 `MNA` 监听地址 |
| `--mna-port` | 指定 `MNA` 监听端口 |
| `--mna-home` | 指定 `MNA_HOME` |
| `--runtime-url` | 指定 runtime 地址 |
| `--provider-kind` | 指定 agent provider 类型 |
| `--provider-model` | 指定 agent provider 模型名 |
| `--provider-base-url` | 指定 agent provider 地址 |
| `--provider-api-key-env` | 指定 agent provider 密钥环境变量名 |

#### 宿主接入相关

| 命令 | 常用参数 |
|---|---|
| `continuum claude install` | `--plugin-dir`、`--package`、`--force` |
| `continuum claude uninstall` | `--plugin-dir` |
| `continuum codex install` | `--runtime-url`、`--codex-home` |
| `continuum codex uninstall` | `--codex-home`、`--server-name` |
| `continuum codex` / `continuum codex use` | `--runtime-url`、`--client-command`、`--app-server-command`、`--ensure-runtime`、`--codex-home` |

### 3.4 单服务命令

#### `storage`

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发模式启动 API |
| `npm run dev:worker` | 开发模式启动 worker |
| `npm run migrate` | 执行迁移 |
| `npm run build` | 构建 |
| `npm run start` | 启动构建产物 |
| `npm run start:worker` | 启动构建后的 worker |
| `npm run test` | 跑测试 |

#### `retrieval-runtime`

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发模式启动 |
| `npm run migrate` | 执行迁移 |
| `npm run build` | 构建 |
| `npm run start` | 启动构建产物 |
| `npm run test` | 跑普通单测 |
| `npm run test:e2e` | 跑宿主桥接 E2E |
| `npm run test:memory-orchestrator-eval` | 跑真实评估测试 |
| `npm run test:real-user-experience` | 跑真实用户体验样本测试 |
| `npm run eval:memory-orchestrator-real` | 跑真实评估 CLI |
| `npm run eval:real-user-experience` | 跑真实用户体验 A/B 评测 |
| `npm run eval:real-user-experience:host` | 跑真实宿主用户体验 A/B 评测 |

#### `memory-native-agent`

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发模式启动 |
| `npm run start` | 直接启动 |
| `npm run memory:tiering` | 记忆分层调试工具 |
| `npm run build` | 构建 |
| `npm run test` | 跑测试 |

#### `visualization`

| 命令 | 作用 |
|---|---|
| `npm run dev` | 本地页面开发 |
| `npm run build` | 页面构建 |
| `npm run start` | 启动生产构建 |
| `npm run lint` | 代码检查 |
| `npm run typecheck` | 类型检查 |
| `npm run test` | 单元测试 |
| `npm run test:e2e` | 端到端测试 |

## 4. 配置模型

这一章只回答三件事：配置从哪来、落在哪、谁覆盖谁。

### 4.1 配置来源

当前外部配置主要来自 6 层：

1. CLI 参数
2. 服务环境变量
3. `MNA` 配置文件
4. 页面设置写回的托管配置
5. 技能目录与 `MCP` 定义
6. Docker / 部署编排文件

### 4.2 配置落点

#### 仓库内

| 路径 | 作用 |
|---|---|
| `docs` | 仓库文档 |
| `docker-compose.yml` | 本地容器编排示例 |
| `deploy/k8s/agent-memory.yaml` | Kubernetes 示例 |
| `<workspace>/.mna/config.yaml|yml|json` | 当前工作区 `MNA` 配置 |
| `<workspace>/.mna/skills` | 当前工作区技能目录 |

#### 用户目录

| 路径 | 作用 |
|---|---|
| `~/.continuum` | 托管模式目录 |
| `~/.continuum/state.json` | 托管状态 |
| `~/.continuum/logs` | 托管日志 |
| `~/.continuum/managed/embedding-config.json` | 托管 `embedding` 配置 |
| `~/.continuum/managed/writeback-llm-config.json` | 托管 `memory_llm` 配置文件名 |
| `~/.continuum/managed/mna/config.json` | 托管 `MNA` 配置子集 |
| `~/.continuum/managed/mna/provider-secret.json` | 托管 provider 密钥 |
| `~/.continuum/managed/mna/token.txt` | 托管 `MNA token` |
| `~/.mna/config.yaml|yml|json` | 全局 `MNA` 配置 |
| `~/.mna/workspaces.json` | 工作区映射 |
| `~/.mna/token.txt` | 非托管 `MNA token` |

说明：

- 页面和 `continuum start` 主要写的是 `~/.continuum/managed/...`
- 手工维护 `MNA` 时，常用的是 `~/.mna/...` 和工作区里的 `.mna/...`
- 托管模式运行时会优先把 `memory_llm` 读写到 `memory-llm-config.json` 路径语义，但当前托管 CLI 仍保留 `writeback-llm-config.json` 文件名

### 4.3 配置优先级

#### `continuum start`

- CLI 参数优先于当前 shell 环境变量
- 启动时写入的托管配置会在后续启动中继续复用

#### `MNA`

从高到低大致是：

1. 启动环境变量覆盖
2. 显式注入的托管配置
3. 工作区配置
4. 全局配置
5. 内置默认值

#### `storage`、`retrieval-runtime`、`visualization`

- 这三层主要以环境变量为准
- 托管模式下，`embedding` 和 `memory_llm` 还会再读取托管 JSON 配置文件

### 4.4 一眼看懂配置归属

判断一项配置属于哪一层，可以直接按这个顺序：

1. 它是页面里能改的吗
2. 它是 agent 行为、技能、MCP 吗
3. 它是向量或 `memory_llm` 这类平台共享依赖吗
4. 它是 `storage` / `runtime` / `visualization` 自己的运行参数吗

如果一个配置项你需要先猜“它到底属于哪层”，优先回来看本章和后面的两张大表。

## 5. 平台共享配置

这一章只定义一次跨模块复用的概念，不再在每个服务章节里重复解释。

### 5.1 平台共享配置表

| 配置项 | 作用 | 由谁消费 | 可在哪改 |
|---|---|---|---|
| `provider` | 主对话模型 | `MNA` | 页面、CLI、env、`MNA config` |
| `memory_mode` | 记忆作用域 | `MNA`、runtime 会话链路 | 页面、会话 API |
| `locale` | agent 页面与会话语言偏好 | `MNA`、visualization | 页面、浏览器本地存储、env、`MNA config` |
| `embedding` | 向量嵌入服务 | runtime、storage | 页面、CLI、env、托管配置 |
| `memory_llm` | 写回、治理、召回评估模型 | runtime | 页面、env、托管配置 |
| `mcp.servers` | MCP 服务注册表 | `MNA` | 页面、`MNA config` |
| `skills` | 技能发现与启用 | `MNA` | `MNA config`、技能目录 |

### 5.2 `provider`

这是主对话模型，也可以理解成 agent provider。

常见字段：

- `kind`
- `model`
- `base_url`
- `api_key`
- `api_key_env`
- `temperature`
- `effort`
- `max_tokens`

当前支持的 `kind`：

- `openai-compatible`
- `anthropic`
- `ollama`
- `demo`
- `record-replay`

对应的 `MNA` 环境变量：

- `MNA_PROVIDER_KIND`
- `MNA_PROVIDER_MODEL`
- `MNA_PROVIDER_BASE_URL`
- `MNA_PROVIDER_API_KEY`
- `MNA_PROVIDER_API_KEY_ENV`
- `MNA_FIXTURE_DIR`
- `MNA_FIXTURE_NAME`
- `MNA_REC_TARGET`

### 5.3 `embedding`

这是向量嵌入依赖，只在这里定义一次。

常见字段：

- `base_url`
- `model`
- `api_key`

相关环境变量：

- `EMBEDDING_BASE_URL`
- `EMBEDDING_MODEL`
- `EMBEDDING_API_KEY`
- `CONTINUUM_EMBEDDING_CONFIG_PATH`

说明：

- `retrieval-runtime` 用它做检索、相似度和相关健康检查
- `storage` 也会读取它，用于与记忆写入相关的嵌入能力
- 页面能打开，不代表向量链路已经就绪

### 5.4 `memory_llm`

这是写回、治理、召回评估等链路使用的模型。

常见字段：

- `base_url`
- `model`
- `api_key`
- `protocol`
- `timeout_ms`
- `effort`
- `max_tokens`

相关环境变量：

- `MEMORY_LLM_BASE_URL`
- `MEMORY_LLM_MODEL`
- `MEMORY_LLM_API_KEY`
- `MEMORY_LLM_PROTOCOL`
- `MEMORY_LLM_TIMEOUT_MS`
- `MEMORY_LLM_EFFORT`
- `MEMORY_LLM_MAX_TOKENS`
- `CONTINUUM_MEMORY_LLM_CONFIG_PATH`

兼容说明：

- 文档统一写 `memory_llm`
- 历史兼容变量 `WRITEBACK_LLM_BASE_URL` 这一类仍有迁移逻辑，但不建议新配置继续使用

### 5.5 Agent 侧配置

这一组实际就是 `MNA + skills + MCP` 配置域。

支持的顶层字段：

```yaml
runtime:
provider:
memory:
mcp:
tools:
cli:
context:
planning:
logging:
streaming:
skills:
locale:
```

一个工作区 `.mna/config.yaml` 示例：

```yaml
runtime:
  base_url: http://127.0.0.1:3002
  request_timeout_ms: 30000
  finalize_timeout_ms: 10000

provider:
  kind: openai-compatible
  model: gpt-4.1-mini
  base_url: https://api.openai.com/v1
  api_key_env: OPENAI_API_KEY
  temperature: 0.2

memory:
  mode: workspace_plus_global
  user_id: null

mcp:
  servers:
    - name: filesystem
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
      request_timeout_ms: 30000
      reconnect_on_failure: true

tools:
  approval_mode: confirm
  max_output_chars: 8192
  shell_exec:
    enabled: true
    timeout_ms: 30000
    deny_patterns:
      - git reset --hard

cli:
  system_prompt_file: null

context:
  max_tokens: null
  reserve_tokens: 4096
  compaction_strategy: truncate

planning:
  plan_mode: advisory

logging:
  level: info
  format: json

streaming:
  flush_chars: 32
  flush_interval_ms: 30

skills:
  enabled: true
  auto_discovery: true
  discovery_paths:
    - .mna/skills
    - .claude/skills

locale: zh-CN
```

#### `runtime`

- `runtime.base_url`
- `runtime.request_timeout_ms`
- `runtime.finalize_timeout_ms`

环境变量覆盖：

- `RUNTIME_BASE_URL`
- `RUNTIME_REQUEST_TIMEOUT_MS`
- `RUNTIME_FINALIZE_TIMEOUT_MS`

#### `memory`

- `memory.mode`
- `memory.user_id`

当前支持：

- `workspace_only`
- `workspace_plus_global`

#### `tools`

- `tools.max_output_chars`
- `tools.approval_mode`
- `tools.shell_exec.enabled`
- `tools.shell_exec.timeout_ms`
- `tools.shell_exec.deny_patterns`

#### `planning`

- `planning.plan_mode`

当前支持：

- `advisory`
- `confirm`

#### `context`

- `context.max_tokens`
- `context.reserve_tokens`
- `context.compaction_strategy`

#### `skills`

- `skills.enabled`
- `skills.auto_discovery`
- `skills.discovery_paths`

默认发现路径：

- `.mna/skills`
- `.claude/skills`
- `.claude/commands`
- `~/.codex/skills`

最小技能结构：

```text
my-skill/
  SKILL.md
```

#### `mcp.servers`

每个 server 常用字段：

- `name`
- `transport`
- `command`
- `args`
- `env`
- `url`
- `headers`
- `cwd`
- `startup_timeout_ms`
- `request_timeout_ms`
- `reconnect_on_failure`

规则：

- `transport=stdio` 时必须有 `command`
- `transport=http` 时必须有 `url`

#### `locale`

当前支持：

- `zh-CN`
- `en-US`

补充环境变量：

- `MNA_HOME`
- `MNA_HOST`
- `MNA_PORT`
- `MNA_WORKSPACE_CWD`
- `MNA_PLATFORM_USER_ID`
- `MNA_LOCALE`

### 5.6 页面可编辑配置子集

这张表只回答一件事：页面里改的到底是哪一层，最终写到哪里。

| 页面字段 | 对应平台键 | 持久化位置 |
|---|---|---|
| 主模型 `kind/model/base_url/api_key/effort/max_tokens` | `provider.*` | `~/.continuum/managed/mna/config.json` 和 `provider-secret.json` |
| 审批模式 | `tools.approval_mode` | `~/.continuum/managed/mna/config.json` |
| 计划模式 | `planning.plan_mode` | `~/.continuum/managed/mna/config.json` |
| `MCP servers` | `mcp.servers` | `~/.continuum/managed/mna/config.json` |
| 向量地址、模型、密钥 | `embedding.*` | `~/.continuum/managed/embedding-config.json` |
| 写回模型地址、模型、密钥、协议、超时、推理强度、max tokens | `memory_llm.*` | `~/.continuum/managed/memory-llm-config.json` 路径语义，托管 CLI 当前文件名为 `writeback-llm-config.json` |
| 记忆模式 | `memory_mode` | 会话级状态，不写入上面的配置文件 |
| 语言 | `locale` | 浏览器本地存储 `continuum.agent.locale`，创建会话时也会传给 `MNA` |

说明：

- 页面设置不会改仓库源码
- 页面设置主要改的是托管配置目录和当前会话状态
- `memory_mode` 是会话态，不是平台全局态

## 6. 服务私有配置

这一章只讲服务自己消费的配置，不再混入平台共享概念。

### 6.1 共享依赖配置

这些变量会被多个服务共同消费：

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | PostgreSQL 连接串 |
| `EMBEDDING_BASE_URL` | 向量接口地址 |
| `EMBEDDING_MODEL` | 向量模型名 |
| `EMBEDDING_API_KEY` | 向量接口鉴权 |
| `CONTINUUM_EMBEDDING_CONFIG_PATH` | 托管 `embedding` 配置文件路径 |
| `MEMORY_LLM_BASE_URL` | `memory_llm` 地址 |
| `MEMORY_LLM_MODEL` | `memory_llm` 模型名 |
| `MEMORY_LLM_API_KEY` | `memory_llm` 鉴权 |
| `MEMORY_LLM_PROTOCOL` | `memory_llm` 协议类型 |
| `MEMORY_LLM_TIMEOUT_MS` | `memory_llm` 超时 |
| `MEMORY_LLM_EFFORT` | `memory_llm` 推理强度 |
| `MEMORY_LLM_MAX_TOKENS` | `memory_llm` 最大 token |
| `CONTINUUM_MEMORY_LLM_CONFIG_PATH` | 托管 `memory_llm` 配置文件路径 |

### 6.2 `storage` 私有配置

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3001` | API 端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `LOG_LEVEL` | `info` | 日志级别 |
| `STORAGE_SCHEMA_PRIVATE` | `storage_private` | 私有写模型 schema |
| `STORAGE_SCHEMA_SHARED` | `storage_shared_v1` | 共享读模型 schema |
| `WRITE_JOB_POLL_INTERVAL_MS` | `1000` | worker 轮询间隔 |
| `WRITE_JOB_BATCH_SIZE` | `10` | 单批处理数量 |
| `WRITE_JOB_MAX_RETRIES` | `3` | 写任务最大重试次数 |
| `READ_MODEL_REFRESH_MAX_RETRIES` | `3` | 读模型刷新最大重试次数 |
| `REDIS_URL` | 无 | 可选 Redis |

这组主要是 `schema`、worker、重试和读模型刷新参数，属于 `storage` 私有域。

### 6.3 `retrieval-runtime` 私有配置

#### 基础运行

| 变量 | 默认值 | 说明 |
|---|---|---|
| `NODE_ENV` | `development` | 运行环境 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `PORT` | `3002` | 端口 |
| `LOG_LEVEL` | `info` | 日志级别 |
| `LOG_SAMPLE_RATE` | `1` | 低等级日志采样率，范围 `0` 到 `1` |
| `READ_MODEL_SCHEMA` | `storage_shared_v1` | 共享读模型 schema |
| `READ_MODEL_TABLE` | `memory_read_model_v1` | 共享读模型表 |
| `RUNTIME_SCHEMA` | `runtime_private` | runtime 私有 schema |
| `STORAGE_WRITEBACK_URL` | 无 | 指向 `storage` 的写回地址 |

#### 召回、阈值、预算

| 变量 | 默认值 | 说明 |
|---|---|---|
| `QUERY_TIMEOUT_MS` | `800` | 查询超时 |
| `STORAGE_TIMEOUT_MS` | `800` | 调用 storage 超时 |
| `EMBEDDING_TIMEOUT_MS` | `30000` | 嵌入调用超时 |
| `QUERY_CANDIDATE_LIMIT` | `30` | 查询候选上限 |
| `PACKET_RECORD_LIMIT` | `10` | 记忆包记录上限 |
| `INJECTION_RECORD_LIMIT` | `5` | 注入记录上限 |
| `INJECTION_TOKEN_BUDGET` | `1500` | 注入 token 预算 |
| `SEMANTIC_TRIGGER_THRESHOLD` | `0.72` | 语义触发阈值 |
| `IMPORTANCE_THRESHOLD_SESSION_START` | `4` | 会话开始重要性阈值 |
| `IMPORTANCE_THRESHOLD_DEFAULT` | `3` | 默认重要性阈值 |
| `IMPORTANCE_THRESHOLD_SEMANTIC` | `4` | 语义命中重要性阈值 |

#### 注入窗口和近期状态

| 变量 | 默认值 | 说明 |
|---|---|---|
| `INJECTION_DEDUP_ENABLED` | `true` | 是否去重 |
| `INJECTION_HARD_WINDOW_TURNS_FACT_PREFERENCE` | `5` | 事实/偏好硬窗口轮数 |
| `INJECTION_HARD_WINDOW_TURNS_TASK_STATE` | `3` | 任务状态硬窗口轮数 |
| `INJECTION_HARD_WINDOW_TURNS_EPISODIC` | `2` | 事件记忆硬窗口轮数 |
| `INJECTION_HARD_WINDOW_MS_FACT_PREFERENCE` | `1800000` | 事实/偏好硬窗口时间 |
| `INJECTION_HARD_WINDOW_MS_TASK_STATE` | `600000` | 任务状态硬窗口时间 |
| `INJECTION_HARD_WINDOW_MS_EPISODIC` | `300000` | 事件记忆硬窗口时间 |
| `INJECTION_SOFT_WINDOW_MS_TASK_STATE` | `1800000` | 任务状态软窗口时间 |
| `INJECTION_SOFT_WINDOW_MS_EPISODIC` | `900000` | 事件记忆软窗口时间 |
| `INJECTION_RECENT_STATE_TTL_MS` | `3600000` | 最近状态 TTL |
| `INJECTION_RECENT_STATE_MAX_SESSIONS` | `500` | 最近状态缓存会话上限 |

#### `memory_llm` 降级与恢复

| 变量 | 默认值 | 说明 |
|---|---|---|
| `MEMORY_LLM_FALLBACK_ENABLED` | `true` | 是否允许降级 |
| `MEMORY_LLM_DEGRADED_THRESHOLD` | `0.5` | 判定降级阈值 |
| `MEMORY_LLM_RECOVERY_INTERVAL_MS` | `300000` | 恢复重试间隔 |

#### 写回、治理、维护任务

这组参数确实属于 `retrieval-runtime` 私有域，建议保留独立：

- `RECALL_LLM_JUDGE_ENABLED`
- `RECALL_LLM_JUDGE_MAX_TOKENS`
- `RECALL_LLM_CANDIDATE_LIMIT`
- `WRITEBACK_LLM_REFINE_MAX_TOKENS`
- `WRITEBACK_REFINE_ENABLED`
- `WRITEBACK_MAX_CANDIDATES`
- `WRITEBACK_OUTBOX_FLUSH_INTERVAL_MS`
- `WRITEBACK_OUTBOX_BATCH_SIZE`
- `WRITEBACK_OUTBOX_MAX_RETRIES`
- `WRITEBACK_MAINTENANCE_ENABLED`
- `WRITEBACK_MAINTENANCE_INTERVAL_MS`
- `WRITEBACK_MAINTENANCE_WORKSPACE_INTERVAL_MS`
- `WRITEBACK_MAINTENANCE_WORKSPACE_BATCH`
- `WRITEBACK_MAINTENANCE_SEED_LIMIT`
- `WRITEBACK_MAINTENANCE_RELATED_LIMIT`
- `WRITEBACK_MAINTENANCE_SIMILARITY_THRESHOLD`
- `WRITEBACK_MAINTENANCE_SEED_LOOKBACK_MS`
- `WRITEBACK_MAINTENANCE_TIMEOUT_MS`
- `WRITEBACK_MAINTENANCE_LLM_MAX_TOKENS`
- `WRITEBACK_MAINTENANCE_MAX_ACTIONS`
- `WRITEBACK_MAINTENANCE_MIN_IMPORTANCE`
- `WRITEBACK_MAINTENANCE_ACTOR_ID`
- `WRITEBACK_GOVERNANCE_VERIFY_ENABLED`
- `WRITEBACK_GOVERNANCE_VERIFY_MAX_TOKENS`
- `WRITEBACK_GOVERNANCE_ARCHIVE_MIN_CONFIDENCE`
- `WRITEBACK_GOVERNANCE_DELETE_MIN_CONFIDENCE`
- `WRITEBACK_GOVERNANCE_SHADOW_MODE`
- `FINALIZE_IDEMPOTENCY_TTL_MS`
- `FINALIZE_IDEMPOTENCY_MAX_ENTRIES`
- `WRITEBACK_INPUT_OVERLAP_THRESHOLD`

### 6.4 `visualization` 私有配置

| 变量 | 默认值 | 说明 |
|---|---|---|
| `NEXT_PUBLIC_APP_NAME` | `Agent Memory Observatory` | 页面标题 |
| `NEXT_PUBLIC_APP_DESCRIPTION` | 内置文案 | 页面描述 |
| `NEXT_PUBLIC_MNA_BASE_URL` | `http://127.0.0.1:4193` | 浏览器访问 `MNA` 的地址 |
| `MNA_INTERNAL_BASE_URL` | 无 | 服务端代理访问 `MNA` 的地址 |
| `NEXT_PUBLIC_MNA_DEFAULT_LOCALE` | `zh-CN` | 页面默认语言 |
| `STORAGE_READ_MODEL_DSN` | 无 | 读模型数据库连接串 |
| `STORAGE_READ_MODEL_SCHEMA` | `storage_shared_v1` | 读模型 schema |
| `STORAGE_READ_MODEL_TABLE` | `memory_read_model_v1` | 读模型表 |
| `STORAGE_READ_MODEL_TIMEOUT_MS` | `2000` | 读模型查询超时 |
| `DATABASE_POOL_MAX` | `5` | 数据库连接池大小 |
| `STORAGE_API_BASE_URL` | 无 | storage API 地址 |
| `STORAGE_API_TIMEOUT_MS` | `2000` | storage API 超时 |
| `RUNTIME_API_BASE_URL` | 无 | runtime API 地址 |
| `RUNTIME_API_TIMEOUT_MS` | `2000` | runtime API 超时 |
| `PLATFORM_USER_ID` | 固定 UUID | 默认平台用户 ID |
| `MNA_TOKEN_PATH` | `~/.mna/token.txt` | `MNA token` 路径 |
| `DEFAULT_PAGE_SIZE` | `20` | 默认分页 |
| `HEALTH_POLL_INTERVAL_MS` | `5000` | 健康轮询间隔 |
| `SOURCE_HEALTH_CACHE_MS` | `8000` | 健康缓存时间 |
| `DASHBOARD_REFRESH_MS` | `30000` | 看板刷新间隔 |
| `DASHBOARD_CACHE_MS` | `20000` | 看板缓存时间 |

## 7. 宿主接入配置

### 7.1 `Codex`

`Codex` 侧主要有两层配置：

1. 平台强制注入启动入口
2. 桥接启动时的运行参数

安装：

```powershell
continuum codex install --runtime-url http://127.0.0.1:3002
```

可选项：

- `--codex-home`

使用：

```powershell
continuum codex --runtime-url http://127.0.0.1:3002
```

桥接时常见环境包括：

- `MEMORY_RUNTIME_BASE_URL`
- `MEMORY_RUNTIME_START_COMMAND`
- `MEMORY_MCP_COMMAND`：Codex 默认值为 `off`，主链路走平台强制注入；只有调试 MCP server 时才需要显式打开
- `MEMORY_CODEX_CLIENT_COMMAND`
- `CODEX_APP_SERVER_COMMAND`

### 7.2 `Claude Code`

`Claude Code` 侧主要是插件目录和插件内改写后的启动命令。

安装：

```powershell
continuum claude install --plugin-dir "C:\\path\\to\\plugin"
```

可选项：

- `--plugin-dir`
- `--package`
- `--force`

使用：

```powershell
claude --plugin-dir "C:\\path\\to\\plugin"
```

默认安装目录通常是：

- `~/.continuum/claude-plugin`

### 7.3 技能和宿主的关系

技能不只是“配好就行”，它会直接影响实际使用入口。

实际效果是：

- 被发现的技能会出现在 agent 的技能列表里
- 可用户触发的技能命令会进入输入框可用的 `/skill` 或相关命令入口

## 8. API 与页面能力

### 8.1 页面能力

#### `Agent`

- 新建和切换会话
- 切换工作区
- 查看工作区文件树和文件内容
- 管理 `MCP`
- 修改平台配置子集
- 查看当前轮注入、提示词和依赖状态

#### `记忆`

- 查看结构化记忆目录
- 筛选共享读模型内容

#### `治理`

- 查看治理执行历史和治理结果

#### `运行`

- 查看触发、召回、注入、写回链路

#### `看板`

- 查看 `storage` 和 `runtime` 聚合指标

#### `文档`

- 从页面内直接查看这份技术文档

### 8.2 `MNA API`

#### 基础接口

| 接口 | 作用 |
|---|---|
| `GET /healthz` | 存活状态 |
| `GET /readyz` | 就绪状态 |
| `GET /v1/agent/openapi.json` | 接口总览 |
| `GET /v1/agent/dependency-status` | 依赖状态 |
| `GET /v1/agent/config` | 当前配置 |
| `POST /v1/agent/config` | 更新可编辑配置子集 |
| `GET /v1/agent/metrics` | 运行指标 |
| `GET /metrics` | Prometheus 指标 |

#### 会话接口

| 接口 | 作用 |
|---|---|
| `POST /v1/agent/sessions` | 创建会话 |
| `GET /v1/agent/sessions` | 会话列表 |
| `GET /v1/agent/sessions/{id}` | 会话详情 |
| `PATCH /v1/agent/sessions/{id}` | 改标题 |
| `DELETE /v1/agent/sessions/{id}` | 关闭或清理会话 |
| `POST /v1/agent/sessions/{id}/mode` | 修改 `memory_mode` |
| `POST /v1/agent/sessions/{id}/provider` | 修改下一轮模型 |

#### 工作区与文件接口

| 接口 | 作用 |
|---|---|
| `GET /v1/agent/fs/tree` | 读取工作区文件树 |
| `GET /v1/agent/fs/file` | 读取工作区文件 |
| `GET /v1/agent/workspaces` | 列出已知工作区 |
| `POST /v1/agent/workspaces` | 注册工作区 |
| `POST /v1/agent/workspaces/pick` | 打开原生目录选择器 |
| `GET /v1/agent/artifacts/{sessionId}/{file}` | 读取会话产物 |

#### 技能与 `MCP`

| 接口 | 作用 |
|---|---|
| `GET /v1/skills` | 列出技能 |
| `POST /v1/skills/import` | 从本地路径导入技能 |
| `POST /v1/skills/preview` | 预览技能上下文 |
| `GET /v1/agent/mcp/servers` | 查看 `MCP` 服务与工具 |
| `POST /v1/agent/mcp/servers/{name}/restart` | 重启 `MCP` 服务 |
| `POST /v1/agent/mcp/servers/{name}/disable` | 禁用 `MCP` 服务 |

### 8.3 页面与 API 的对应关系

最常见的三件事：

- 页面设置保存，走的是 `POST /v1/agent/config`
- 页面切换记忆模式，走的是 `POST /v1/agent/sessions/{id}/mode`
- 页面依赖检查，走的是 `POST /v1/agent/dependency-status/embeddings/check` 和 `POST /v1/agent/dependency-status/memory-llm/check`

## 9. 排障

### 9.1 先看启动和健康状态

托管模式先看：

```powershell
continuum status
```

需要机器可读输出时：

```powershell
continuum status --json
```

常用健康接口：

- `storage`：`GET /health`
- `retrieval-runtime`：`GET /healthz`
- `visualization`：`GET /api/health/readiness`
- `memory-native-agent`：`GET /healthz`

### 9.2 页面打不开

按这个顺序查：

1. 先确认 `continuum status` 里 `visualization` 是否 healthy
2. 再看 `3003` 端口是否被占用
3. 如果是源码开发，看 `npm run dev` 是否在迁移阶段就失败了
4. 如果是托管模式，重启时用 `npm run stop` 再 `npm run start`

### 9.3 配置为什么没生效

优先按这个顺序查：

1. 这项配置到底属于哪一层
2. 有没有被更高优先级覆盖
3. 你改的是仓库文件，还是托管目录文件
4. 格式和校验是否满足要求

典型问题：

- 把 `MNA` 配置写进了 `visualization` 的环境变量
- 页面里改了配置，但去仓库源码里找结果
- `http transport` 缺 `url`
- `stdio transport` 缺 `command`
- 环境变量覆盖了 `config.yaml`

### 9.4 模型或向量依赖异常

如果页面能打开，优先去 `Agent` 页右侧依赖卡片看这四项：

- `runtime`
- `provider`
- `embeddings`
- `memory_llm`

再做两步：

1. 在设置面板里执行 `embedding` 检查
2. 在设置面板里执行 `memory_llm` 检查

如果这里显示未配置或不可用，再回头查：

- `EMBEDDING_BASE_URL`
- `EMBEDDING_MODEL`
- `MEMORY_LLM_BASE_URL`
- `MEMORY_LLM_MODEL`
- 页面保存后的托管 JSON 文件

### 9.5 `MCP` 和技能异常

#### `MCP` 服务不工作

先看：

1. 页面里的 `MCP panel`
2. `GET /v1/agent/mcp/servers`
3. `transport` 和必填字段是否对应

#### 技能没有出现在输入框里

优先回头查：

- `skills.enabled`
- `skills.auto_discovery`
- `skills.discovery_paths`
- 技能目录结构是否是 `SKILL.md`
- 技能是否允许用户触发

### 9.6 工作区相关异常

如果工作区不对，很多问题会一起出现。

优先检查：

- 页面里注册的工作区是否正确
- `~/.mna/workspaces.json` 是否有映射
- `MNA_WORKSPACE_CWD` 是否指向了你当前项目

如果需要重新注册，可用：

- 页面里手动添加
- `POST /v1/agent/workspaces`
- `POST /v1/agent/workspaces/pick`

### 9.7 常看哪些文件和日志

最常用的排障入口：

- `~/.continuum/state.json`
- `~/.continuum/logs`
- `~/.continuum/managed/mna/config.json`
- `~/.continuum/managed/embedding-config.json`
- `~/.continuum/managed/writeback-llm-config.json`
- `~/.mna/workspaces.json`
- `~/.mna/token.txt`

查看 `MNA` 日志：

```powershell
continuum mna logs
```

### 9.8 页面里改了配置，但源码里看不到

这是正常现象。

如果你改的是这些项：

- `provider`
- `embedding`
- `memory_llm`
- `MCP`
- `approval_mode`
- `plan_mode`

优先去看托管目录：

- `~/.continuum/managed/mna/config.json`
- `~/.continuum/managed/embedding-config.json`
- `~/.continuum/managed/writeback-llm-config.json`

而不是仓库源码。
