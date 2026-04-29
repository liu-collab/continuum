# Axis 系统手册

## 1. 快速上手

前提：已安装 Docker，并确保 Docker Desktop 正在运行。首次启动需要构建 Docker 镜像，通常需要 3-8 分钟。

如果你有 OpenAI API Key，可以这样启动：

```powershell
npm install -g axis-agent
$env:OPENAI_API_KEY="sk-..."
axis start --provider-kind openai-compatible --provider-model gpt-4.1-mini --provider-base-url https://api.openai.com/v1 --provider-api-key-env OPENAI_API_KEY
axis ui
```

页面默认 `http://127.0.0.1:3003`。`axis start` 会启动托管服务、数据库和页面；首次构建期间会输出 Docker 日志，请等待服务健康后再打开页面。

向量配置可以先使用默认值。需要手动指定时再补上：

```powershell
$env:EMBEDDING_BASE_URL="https://api.openai.com/v1"
$env:EMBEDDING_MODEL="text-embedding-3-small"
$env:EMBEDDING_API_KEY="your-key"
axis start
```

## 2. 项目概览

Axis 给 `Codex`、`Claude Code` 这类 agent 宿主接入长期记忆——在合适的时机自动恢复上下文，在对话结束后把值得保留的信息沉淀为结构化记忆。

### 2.1 仓库组成

| 模块 | 作用 |
|---|---|
| `storage` | 结构化记忆写入、治理、共享读模型发布 |
| `retrieval-runtime` | 召回、注入、写回检查、运行时观测 |
| `memory-native-agent` | 会话、工作区、工具、技能、MCP、宿主侧运行 |
| `visualization` | 页面、指标、轨迹、配置与文档入口 |
| `packages/axis-cli` | 安装、托管启动、宿主接入、统一 CLI |

### 2.2 典型链路

1. `MNA` 接收用户输入，组装会话、工作区、工具、技能和 MCP 上下文。
2. `MNA` 调用 `retrieval-runtime` 做触发、召回和注入。
3. 当前轮结束后，`retrieval-runtime` 生成写回候选并提交给 `storage`。
4. `storage` 做标准化、去重、合并和读模型投影。
5. `visualization` 读取结果并展示。

### 2.3 适用场景

- 长对话、多轮协作
- 需要跨任务延续状态的编码助手
- 需要保存用户偏好、项目约束的个人 agent
- 需要把召回、写回、治理做成产品化系统的团队

### 2.4 运行依赖

| 依赖 | 说明 |
|---|---|
| Node.js `>=22` | 仓库统一要求 |
| PostgreSQL `15+` + `pgvector` | 结构化记忆与向量存储 |
| Docker | 托管模式使用 |
| Embedding API | 已测试：OpenAI (`text-embedding-3-small`)、Ollama (`nomic-embed-text`) |
| 模型服务 | 主对话模型 + `memory_llm`，测试过的 provider 类型见 4.3 |

### 2.5 重要约束

- `axis start` 当前只正式支持 Windows。`npm run dev` 和单服务启动不受此限制。
- 文档统一用 `memory_llm` 指代写回/治理/召回评估链路使用的模型。

## 3. 启动与使用

### 3.1 安装

```powershell
npm install -g axis-agent
axis --help
```

### 3.2 托管启动

```powershell
axis start
axis ui
```

- 启动托管栈并拉起 `MNA`，默认页面 `http://127.0.0.1:3003`
- 局域网访问：`axis start --bind-host 0.0.0.0`
- 启动后自动打开页面：`axis start --open`

### 3.3 源码开发

前提：PostgreSQL 已准备，默认连接 `postgres://postgres:postgres@127.0.0.1:5432/agent_memory`。

```powershell
npm run dev
```

先跑 `storage` 和 `retrieval-runtime` 的迁移，然后同时启动 5 个服务：

| 服务 | 地址 |
|---|---|
| `storage` | `127.0.0.1:3001` |
| `retrieval-runtime` | `127.0.0.1:3002` |
| `visualization` | `127.0.0.1:3003` |
| `memory-native-agent` | `127.0.0.1:4193` |
| `storage worker` | — |

### 3.4 单服务调试

`storage`：

```powershell
cd services/storage && npm run migrate && npm run dev
# 另开终端
cd services/storage && npm run dev:worker
```

其余服务类似：进目录 → `npm run migrate`（如有）→ `npm run dev`。

### 3.5 managed 与 manual 模式

项目有两套配置路径：

| 模式 | 配置目录 | 适用场景 |
|---|---|---|
| **managed**（托管） | `~/.axis/managed/` | `axis start` 拉起，页面设置即写即生效 |
| **manual**（手工） | `~/.mna/` + `<项目>/.mna/` | 自己启动 `MNA`，手工维护配置文件 |

`axis start` 走 managed 路径，页面设置写入 `~/.axis/managed/`。自己用 `npm run dev` 调 `MNA` 时，走 manual 路径，配置由 `~/.mna/config.yaml` 和工作区 `.mna/config.yaml` 控制。

### 3.6 宿主接入

#### Codex

```powershell
axis codex
```

`codex` 或 `codex use` 用桥接方式启动已接好 Axis 的 Codex，记忆由平台强制注入。常见环境变量：`MEMORY_RUNTIME_BASE_URL`、`MEMORY_CODEX_CLIENT_COMMAND`、`CODEX_APP_SERVER_COMMAND`。Codex 侧 `MEMORY_MCP_COMMAND` 默认为 `off`，主链路走平台注入。旧版 MCP 注册可用 `axis codex uninstall` 清理。

#### Claude Code

```powershell
axis claude
```

默认插件目录 `~/.axis/claude-plugin`。`axis claude` 会先确认插件是否已安装，未安装时自动安装，然后直接启动 `claude --plugin-dir ~/.axis/claude-plugin`。`axis claude install` / `axis claude uninstall` 仍保留给手动管理使用。可选参数：`--plugin-dir`、`--package`、`--force`。

### 3.7 页面入口

| 入口 | 做什么 |
|---|---|
| `Agent` | 对话、切换会话和工作区、管理 MCP、修改配置子集、查看注入和依赖状态 |
| `记忆` | 查看结构化记忆目录、筛选共享读模型 |
| `指标` | 查看 storage 和 runtime 聚合指标 |
| `轨迹` | 查看触发、召回、注入、写回链路 |
| `治理` | 查看治理执行历史和结果 |
| `文档` | 这份文档 |

最常用的是 Agent 页：支持 `/skill` 和所有已导入、允许用户触发的技能命令。

## 4. 配置

### 4.1 配置来源与优先级

配置来自 6 层，从高到低：CLI 参数 → 服务环境变量 → 工作区配置 → 全局配置 → 托管 JSON 文件 → 内置默认值。

判断一项配置属于哪层：先看页面能不能改 → 是不是 agent/技能/MCP 域 → 是不是 embedding/memory_llm 这类平台共享依赖 → 是不是某个服务自己的运行参数。

### 4.2 配置落点

| 路径 | 作用 |
|---|---|
| `~/.axis/` | 托管模式根目录 |
| `~/.axis/managed/mna/config.json` | 托管 MNA 配置子集 |
| `~/.axis/managed/embedding-config.json` | 托管 embedding 配置 |
| `~/.axis/managed/memory-llm-config.json` | 托管 memory_llm 配置 |
| `~/.mna/config.yaml|yml|json` | 全局 MNA 配置（manual） |
| `<项目>/.mna/config.yaml|yml|json` | 工作区 MNA 配置（manual） |
| `~/.mna/workspaces.json` | 工作区映射 |

页面和 `axis start` 写入 `~/.axis/managed/`；手工维护 `MNA` 时常用 `~/.mna/` 和工作区 `.mna/`。

### 4.3 平台共享配置

#### provider（主对话模型）

支持的 kind：`openai-compatible`、`anthropic`、`ollama`、`demo`、`record-replay`。

| 字段 | 环境变量 |
|---|---|
| `kind` | `MNA_PROVIDER_KIND` |
| `model` | `MNA_PROVIDER_MODEL` |
| `base_url` | `MNA_PROVIDER_BASE_URL` |
| `api_key` | `MNA_PROVIDER_API_KEY` |
| `api_key_env` | `MNA_PROVIDER_API_KEY_ENV` |
| `temperature` | — |
| `effort` | — |
| `max_tokens` | — |

#### embedding（向量嵌入）

| 字段 | 环境变量 |
|---|---|
| `base_url` | `EMBEDDING_BASE_URL` |
| `model` | `EMBEDDING_MODEL` |
| `api_key` | `EMBEDDING_API_KEY` |

#### memory_llm（写回/治理/召回评估模型）

| 字段 | 环境变量 |
|---|---|
| `base_url` | `MEMORY_LLM_BASE_URL` |
| `model` | `MEMORY_LLM_MODEL` |
| `api_key` | `MEMORY_LLM_API_KEY` |
| `protocol` | `MEMORY_LLM_PROTOCOL` |
| `timeout_ms` | `MEMORY_LLM_TIMEOUT_MS` |
| `effort` | `MEMORY_LLM_EFFORT` |
| `max_tokens` | `MEMORY_LLM_MAX_TOKENS` |

#### memory_mode（记忆作用域）

| 值 | 行为 |
|---|---|
| `workspace_only` | 仅在当前工作区内召回和写入记忆。跨项目不会共享，适合单项目使用。 |
| `workspace_plus_global` | 工作区记忆 + 全局用户记忆（偏好、习惯等）。适合多项目开发、需要跨项目延续个人设置。 |

`memory_mode` 是会话级状态，不写入配置文件。

### 4.4 Agent 侧配置

`MNA` 支持的全部配置域：

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

一个完整的 `.mna/config.yaml` 示例：

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

各字段说明：

- **`runtime`**：retrieval-runtime 地址和超时。环境变量 `RUNTIME_BASE_URL`。
- **`memory`**：`mode` 和 `user_id`，见 4.3。
- **`tools`**：
  - `approval_mode`：`confirm`（每次工具调用需确认）或 `auto`（自动批准安全工具）。
  - `shell_exec.deny_patterns`：禁止执行的命令模式。
- **`planning`**：
  - `plan_mode`：`advisory`（展示计划但不阻塞执行）或 `confirm`（等待用户确认再执行）。
- **`context`**：上下文窗口管理，`compaction_strategy` 当前为 `truncate`。
- **`skills`**：发现路径默认为 `.mna/skills`、`.claude/skills`、`.claude/commands`、`~/.codex/skills`。最小结构为 `my-skill/SKILL.md`。
- **`mcp.servers`**：`transport=stdio` 必须有 `command`，`transport=http` 必须有 `url`。
- **`locale`**：`zh-CN` 或 `en-US`。补充环境变量 `MNA_LOCALE`、`MNA_HOME`、`MNA_HOST`、`MNA_PORT`、`MNA_WORKSPACE_CWD`、`MNA_PLATFORM_USER_ID`。

### 4.5 页面可编辑子集

| 页面字段 | 对应配置 | 持久化位置 |
|---|---|---|
| 主模型 kind/model/base_url/api_key/effort/max_tokens | `provider.*` | `~/.axis/managed/mna/config.json` + `provider-secret.json` |
| 审批模式 | `tools.approval_mode` | `~/.axis/managed/mna/config.json` |
| 计划模式 | `planning.plan_mode` | `~/.axis/managed/mna/config.json` |
| MCP servers | `mcp.servers` | `~/.axis/managed/mna/config.json` |
| 向量地址、模型、密钥 | `embedding.*` | `~/.axis/managed/embedding-config.json` |
| 写回模型 | `memory_llm.*` | `~/.axis/managed/memory-llm-config.json` |
| 语言 | `locale` | 浏览器本地存储 `axis.agent.locale` |

页面设置不会改仓库源码。

### 4.6 服务私有环境变量

#### 共享依赖

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | PostgreSQL 连接串 |

#### storage

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3001` | API 端口 |
| `STORAGE_SCHEMA_PRIVATE` | `storage_private` | 私有写模型 schema |
| `STORAGE_SCHEMA_SHARED` | `storage_shared_v1` | 共享读模型 schema |
| `WRITE_JOB_POLL_INTERVAL_MS` | `1000` | worker 轮询间隔 |
| `WRITE_JOB_BATCH_SIZE` | `10` | 单批处理数量 |
| `WRITE_JOB_MAX_RETRIES` | `3` | 写任务最大重试 |

#### retrieval-runtime

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3002` | 端口 |
| `READ_MODEL_SCHEMA` | `storage_shared_v1` | 共享读模型 schema |
| `STORAGE_WRITEBACK_URL` | — | storage 写回地址 |
| `QUERY_CANDIDATE_LIMIT` | `30` | 查询候选上限 |
| `INJECTION_TOKEN_BUDGET` | `1500` | 注入 token 预算 |
| `SEMANTIC_TRIGGER_THRESHOLD` | `0.72` | 语义触发阈值 |
| `IMPORTANCE_THRESHOLD_DEFAULT` | `3` | 默认重要性阈值 |
| `INJECTION_DEDUP_ENABLED` | `true` | 是否启用近期注入去重 |
| `RECALL_LLM_JUDGE_ENABLED` | — | 是否启用 LLM 召回判断 |
| `WRITEBACK_MAX_CANDIDATES` | — | 写回候选上限 |
| `WRITEBACK_MAINTENANCE_ENABLED` | — | 是否启用维护任务 |
| `FINALIZE_IDEMPOTENCY_TTL_MS` | — | 幂等缓存时长 |

#### visualization

| 变量 | 默认值 | 说明 |
|---|---|---|
| `NEXT_PUBLIC_MNA_BASE_URL` | `http://127.0.0.1:4193` | 浏览器访问 MNA 地址 |
| `STORAGE_READ_MODEL_DSN` | — | 读模型数据库连接 |
| `STORAGE_API_BASE_URL` | — | storage API 地址 |
| `RUNTIME_API_BASE_URL` | — | runtime API 地址 |
| `MNA_TOKEN_PATH` | `~/.mna/token.txt` | MNA token 路径 |
| `DEFAULT_PAGE_SIZE` | `20` | 分页大小 |

## 5. API 参考

### 5.1 基础接口

| 接口 | 作用 |
|---|---|
| `GET /healthz` | 存活状态 |
| `GET /readyz` | 就绪状态 |
| `GET /v1/agent/openapi.json` | 接口总览 |
| `GET /v1/agent/dependency-status` | 依赖状态 |
| `GET /v1/agent/config` | 当前配置 |
| `POST /v1/agent/config` | 更新可编辑配置子集 |
| `GET /v1/agent/metrics` | 运行指标 |

### 5.2 会话接口

| 接口 | 作用 |
|---|---|
| `POST /v1/agent/sessions` | 创建会话 |
| `GET /v1/agent/sessions` | 会话列表 |
| `GET /v1/agent/sessions/{id}` | 会话详情 |
| `PATCH /v1/agent/sessions/{id}` | 改标题 |
| `DELETE /v1/agent/sessions/{id}` | 关闭或清理 |
| `POST /v1/agent/sessions/{id}/mode` | 修改 memory_mode |
| `POST /v1/agent/sessions/{id}/provider` | 修改下一轮模型 |

### 5.3 工作区与文件

| 接口 | 作用 |
|---|---|
| `GET /v1/agent/fs/tree` | 工作区文件树 |
| `GET /v1/agent/fs/file` | 读取工作区文件 |
| `GET /v1/agent/workspaces` | 列出已知工作区 |
| `POST /v1/agent/workspaces` | 注册工作区 |
| `POST /v1/agent/workspaces/pick` | 打开原生目录选择器 |

### 5.4 技能与 MCP

| 接口 | 作用 |
|---|---|
| `GET /v1/skills` | 列出技能 |
| `POST /v1/skills/import` | 从本地导入技能 |
| `GET /v1/agent/mcp/servers` | 查看 MCP 服务与工具 |
| `POST /v1/agent/mcp/servers/{name}/restart` | 重启 MCP 服务 |

### 5.5 页面与 API 对应

- 设置保存 → `POST /v1/agent/config`
- 切换记忆模式 → `POST /v1/agent/sessions/{id}/mode`
- 依赖检查 → `POST /v1/agent/dependency-status/embeddings/check` 和 `memory-llm/check`

## 6. 排障

### 6.1 先看状态

```powershell
axis status
axis status --json  # 机器可读
```

各服务健康接口：`storage GET /health`、`retrieval-runtime GET /healthz`、`visualization GET /api/health/readiness`、`MNA GET /healthz`。

### 6.2 页面打不开

1. `axis status` 确认 visualization 是否 healthy
2. 检查 `3003` 端口是否被占用
3. 源码开发：看 `npm run dev` 是否在迁移阶段失败
4. 托管模式：`npm run stop` 再 `npm run start`

### 6.3 配置没生效

1. 确定配置属于哪一层（见 4.1）
2. 有没有被更高优先级覆盖
3. 改的是仓库文件还是托管目录文件
4. 格式和校验是否满足要求

典型错误：把 MNA 配置写进了 visualization 的环境变量；页面改了配置但去仓库源码里找结果；`http transport` 缺 `url`；`stdio transport` 缺 `command`。

### 6.4 模型或向量依赖异常

Agent 页右侧依赖卡片看四项：runtime、provider、embeddings、memory_llm。再做两步：设置面板里执行 embedding 检查 → 执行 memory_llm 检查。如果未配置或不可用，回头查对应的环境变量和托管 JSON 文件。

### 6.5 MCP 和技能异常

- MCP 不工作：检查页面 MCP panel → `GET /v1/agent/mcp/servers` → transport 和必填字段是否对应
- 技能未出现：检查 `skills.enabled`、`skills.auto_discovery`、`skills.discovery_paths`、目录结构（`SKILL.md`）、是否允许用户触发

### 6.6 工作区异常

检查：页面注册的工作区是否正确 → `~/.mna/workspaces.json` → `MNA_WORKSPACE_CWD` 是否指向当前项目。重新注册可走页面手动添加或 `POST /v1/agent/workspaces`。

### 6.7 常用排障文件

- `~/.axis/state.json` — 托管状态
- `~/.axis/logs` — 托管日志
- `~/.axis/managed/mna/config.json` — MNA 配置
- `~/.axis/managed/embedding-config.json` — embedding 配置
- `~/.axis/managed/memory-llm-config.json` — memory_llm 配置
- `~/.mna/workspaces.json` — 工作区映射

查看 MNA 日志：`axis mna logs`。页面改的配置在托管目录，不在仓库源码。
