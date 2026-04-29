# retrieval-runtime

这是 `retrieval-runtime`（运行时检索与注入）首版服务实现。

## 沟通与语言约定

本项目默认使用中文沟通，包括日常讨论、需求说明、评审意见和文档说明；只有在明确要求英文时，才切换为英文。

代码、命令、日志、配置项、接口名和错误信息保持原文。需要解释英文术语时，使用 `term`（术语说明）这样的写法，尽量保持表达口径一致。

当前这版已经包含：

- `Fastify`（Web 框架）HTTP 服务骨架
- `prepare-context`、`finalize-turn`、`session-start-context`、观测接口
- `Claude Code plugin`（Claude Code 插件）和 `Codex app-server adapter`（Codex 应用服务适配器）输入适配
- `trigger-engine`（触发引擎）、`query-engine`（查询引擎）、`packet-builder`（记忆包组装）、`injection-engine`（注入裁剪）、`writeback-engine`（写回检查）
- 依赖超时与显式降级
- `runtime_private`（运行时私有表）持久化仓储，失败时回退到内存仓储
- `Vitest`（测试框架）基础测试

## 安装步骤

本地安装前，先准备下面几项：

- `Node.js`（Node.js 运行时）`22` 或更高版本
- `npm`（Node.js 包管理器）
- 一个可连接的 `PostgreSQL`（PostgreSQL 数据库），用于 `DATABASE_URL` 和迁移脚本

完整能力还会依赖 `storage`（存储服务）和向量服务；如果这两类依赖暂时没启动，服务仍然可以先启动，但相关能力会返回显式 `degraded`（降级）结果。

如果只是先把服务启动起来，最少需要准备：

- `DATABASE_URL`
- `STORAGE_WRITEBACK_URL`

`RUNTIME_SCHEMA`、`HOST`、`PORT` 等字段都有默认值；语义检索、记忆编排和真实写回能力可以在服务先跑通后再继续补。

如果只是想先把服务完整拉起来，可以先按下面这组最短命令执行一遍：

```powershell
cd services/retrieval-runtime
npm ci
Copy-Item .env.example .env
Get-Content .env | Where-Object { $_ -and -not $_.StartsWith('#') } | ForEach-Object {
  $name, $value = $_ -split '=', 2
  if ($name) {
    Set-Item -Path "Env:$name" -Value $value
  }
}
npm run migrate
npm run build
npm run dev
```

其中 `.env` 至少先填好 `DATABASE_URL` 和 `STORAGE_WRITEBACK_URL`。服务启动后，可以另开一个终端检查：

```bash
curl http://127.0.0.1:3002/healthz
```

下面是逐步说明。

可以按下面做：

1. 进入服务目录，并确认 `Node.js`（Node.js 运行时）版本不低于 `22`：

```bash
cd services/retrieval-runtime
node --version
```

2. 安装依赖。仓库包含 `package-lock.json`，本地首次安装推荐使用 `npm ci`，确保依赖版本和锁文件一致：

```bash
npm ci
```

如果需要按当前 `package.json` 重新解析依赖，可以改用 `npm install`。

3. 准备环境变量。仓库带了 `.env.example`，但当前启动脚本不会自动读取 `.env` 文件，所以复制模板后，还需要把变量导入当前终端，或者在进程管理器里显式注入：

```powershell
Copy-Item .env.example .env
```

然后按本地环境调整 `.env`。最少先确认这些值：

- `DATABASE_URL`
- `STORAGE_WRITEBACK_URL`

如果想直接在当前 `PowerShell`（PowerShell 终端）会话里加载 `.env`，可以这样做：

```powershell
Get-Content .env | Where-Object { $_ -and -not $_.StartsWith('#') } | ForEach-Object {
  $name, $value = $_ -split '=', 2
  Set-Item -Path "Env:$name" -Value $value
}
```

如果要打开语义检索和记忆编排器，再继续补这些项：

- `EMBEDDING_BASE_URL`
- `EMBEDDING_MODEL`
- `MEMORY_LLM_BASE_URL`
- `MEMORY_LLM_MODEL`

其中 `MEMORY_LLM_*`（记忆模型配置）是可选的；未配置时，写回和召回相关链路会退回规则模式。

4. 初始化数据库。正式运行建议先执行迁移，这样会启用 `runtime_private`（运行时私有表）持久化仓储；如果数据库可连但还没迁移，相关表不会自动创建：

```bash
npm run migrate
```

默认会在 `DATABASE_URL` 指向的数据库里创建或更新 `runtime_private` 相关表。

5. 检查类型和本地构建是否正常：

```bash
npm run check
npm run build
```

6. 启动开发服务，并用健康检查确认服务可访问：

```bash
npm run dev
```

另开一个终端检查：

```bash
curl http://127.0.0.1:3002/healthz
```

如果只想快速验证“服务能启动”，也可以在启动前只设置最少两个环境变量：

```powershell
$env:DATABASE_URL = "postgres://postgres:postgres@localhost:5432/agent_memory"
$env:STORAGE_WRITEBACK_URL = "http://localhost:3001"
npm run dev
```

## 运行方式

```bash
npm run dev
```

默认监听：

- `HOST=0.0.0.0`
- `PORT=3002`

如果已经完成构建，也可以直接用 `npm script`（npm 脚本）启动打包产物。例如，临时改成只监听本机回环地址：

```powershell
npm run build
$env:HOST = "127.0.0.1"
$env:PORT = "3102"
npm run start
```

如果已经执行过 `npm run build`，也可以直接调用启动脚本。脚本本身不解析命令行参数，运行配置仍然从环境变量读取。例如，临时改成只监听本机回环地址：

```powershell
npm run build
$env:HOST = "127.0.0.1"
$env:PORT = "3102"
node bin/axis-runtime.mjs
```

## 环境变量

`.env.example` 已经列出正式字段。关键项如下：

- `DATABASE_URL`
  用于读取 `storage`（存储服务）发布的共享读模型
- `LOG_LEVEL` / `LOG_SAMPLE_RATE`
  控制日志等级和低等级日志采样；采样只影响 `trace`（追踪）、`debug`（调试）、`info`（信息），`warn`（警告）及以上始终保留
- `READ_MODEL_SCHEMA` / `READ_MODEL_TABLE`
  默认读取 `storage_shared_v1.memory_read_model_v1`
- `STORAGE_WRITEBACK_URL`
  写回候选提交目标
- `EMBEDDING_BASE_URL` / `EMBEDDING_MODEL`
  语义触发与软排序使用的向量服务
- `EMBEDDING_CACHE_TTL_MS` / `EMBEDDING_CACHE_MAX_ENTRIES`
  控制嵌入请求的本地短缓存；任一项设为 `0` 时关闭缓存
- `FINALIZE_IDEMPOTENCY_TTL_MS` / `FINALIZE_IDEMPOTENCY_MAX_ENTRIES`
  控制 `finalize-turn`（结束当前轮）响应的本地幂等缓存，用来避免短时间重复提交重复执行
- `AXIS_EMBEDDING_CONFIG_PATH` / `AXIS_MEMORY_LLM_CONFIG_PATH`
  读取托管的 JSON 配置对象；文件里的有效字段会覆盖同名环境变量
- `QUERY_TIMEOUT_MS` / `EMBEDDING_TIMEOUT_MS` / `STORAGE_TIMEOUT_MS`
  所有跨服务调用都有限时

托管配置文件适合放模型连接这类不希望散落在环境变量里的配置。`AXIS_EMBEDDING_CONFIG_PATH` 和 `AXIS_MEMORY_LLM_CONFIG_PATH` 都指向本地 `JSON`（配置对象）文件；文件里只读取当前支持的字段，空值或非法值会被忽略。同一字段同时出现在 `.env` 和配置文件时，配置文件里的有效值优先。

`AXIS_EMBEDDING_CONFIG_PATH` 指向的配置对象示例：

```json
{
  "version": 1,
  "baseUrl": "http://localhost:8090/v1",
  "model": "text-embedding-3-small",
  "apiKey": "replace-me"
}
```

`AXIS_MEMORY_LLM_CONFIG_PATH` 指向的配置对象示例：

```json
{
  "version": 1,
  "baseUrl": "https://api.example.test/v1",
  "model": "gpt-5.4",
  "apiKey": "replace-me",
  "protocol": "openai-compatible",
  "timeoutMs": 15000,
  "effort": "low",
  "maxTokens": 1000
}
```

约束保持如下：

- `storage`（存储服务）没启动时，本服务仍可启动
- 查询或写回失败时，返回显式 `degraded`（降级）结果
- 不直接读取 `storage` 私有写表
- 本地缓存只做加速，不改变原有语义结果；缓存键会带上影响结果的输入维度
```

例如，直接检查多个环境变量文件，不写入修改：

```bash
npm run build
node scripts/migrate-memory-llm-config.mjs --check .env deploy/.env.production
```

## CSV 导入校验工具

`src/importer` 提供轻量的 `CSV`（逗号分隔值）行校验能力，适合在正式写入前先做字段映射、必填检查、类型转换和业务校验。调用方传入字段定义和原始行数据后，`validateCsvImportRows` 会返回可直接写入的 `validRows`，以及按表头或行号组织的错误；如果需要生成错误文件，可以用 `buildCsvImportErrorReportRows` 把错误展开成扁平行。

字段定义支持：

- `header` 和 `aliases`，按大小写不敏感方式匹配表头
- `required`，检查必填表头和必填值
- `parse`，把字符串转换成目标类型
- `validate`，返回一个或多个结构化错误

单独验证导入校验逻辑时可以运行：

```bash
npm run test:importer
```

## 对外接口

### `POST /v1/runtime/session-start-context`

会话启动恢复入口，返回：

- `additional_context`
- `active_task_summary`
- `dependency_status`

### `POST /v1/runtime/prepare-context`

当前轮注入入口，返回：

- `trigger`
- `trigger_reason`
- `memory_packet`
- `injection_block`
- `degraded`
- `dependency_status`

### `POST /v1/runtime/finalize-turn`

响应结束写回检查入口，返回：

- `write_back_candidates`
- `submitted_jobs`
- `candidate_count`
- `writeback_submitted`

### 观测接口

- `GET /healthz`
- `GET /v1/runtime/dependency-status`
- `GET /v1/runtime/observe/runs`
- `GET /v1/runtime/observe/metrics`

`observe/runs` 现在会返回：

- `turns`
- `trigger_runs`
- `recall_runs`
- `injection_runs`
- `writeback_submissions`

## 宿主接入

当前实现把宿主差异收在 `src/host-adapters/`，正式交付物放在 `host-adapters/`：

- `claude_code_plugin`
- `codex_app_server`
- `custom_agent`

正式宿主产物目录：

- `host-adapters/memory-claude-plugin`
- `host-adapters/memory-codex-adapter`

其中包含：

- `Claude Code plugin`（Claude Code 插件）骨架
- `hooks/hooks.json`
- `.mcp.json`
- `memory-bridge`
- `memory-runtime-bootstrap`
- `Codex` 启动入口、proxy（代理）和配置示例

### `Codex` 调用约定

`Codex` 侧默认走平台强制注入：平台在 `turn/start` 前调用 `prepare-context`，拿到 `injection_block` 后通过 proxy 的 `thread/inject_items` 把上下文交付给 Codex 输入。是否已经获得记忆，只按平台交付事实和 runtime 观测轨迹判断，不要求 Codex 主动调用工具，也不依赖 Codex 输出自证。

可以按下面约定接入：

- proxy 在 `turn/start` 前调用 `prepare-context`
- 有可用 `injection_block` 时，将记忆摘要和记录事实格式化为 developer 输入项
- 无相关记忆或准备失败时，也会交付一段明确的“无相关历史记忆”上下文，避免让模型自行判断是否走记忆链路
- `memory-codex-proxy` 会输出 `memory_delivery` 平台交付事实，包含 `trace_id`、`record_ids`、`content_sha256` 等观测字段
- `memory-mcp-server.mjs` 仅作为调试/旁路能力保留，不是 Codex 主链路
- 最终只保留对用户有用的答案内容

如果需要把这条约定写进宿主提示词，可以直接使用下面这段：

```text
你会先收到一段平台已经准备好的长期记忆上下文。
回答时优先使用这段已提供的上下文来判断是否存在相关历史信息。
只有当上下文给出可用事实时，才将其中对当前问题直接有用的信息自然融入回答。
当上下文明确无相关历史记忆，或上下文准备失败时，直接按普通问题正常回答。
不要解释长期记忆上下文的来源，不要输出 MCP、tool、memory_search 等排查信息。
最终只保留对用户有用的答案内容。
```

如果要单独验证 `Codex` 侧的 `MCP server`（MCP 服务）调试入口，也可以直接调用打包后的脚本。脚本走标准输入输出，不参与默认强制注入主链路；本地手动验证时，可以先这样设置：

```powershell
npm run build
$env:MEMORY_RUNTIME_BASE_URL = "http://127.0.0.1:3002"
$env:MEMORY_WORKSPACE_ID = "550e8400-e29b-41d4-a716-446655440000"
$env:MEMORY_USER_ID = "550e8400-e29b-41d4-a716-446655440001"
$env:MEMORY_SESSION_ID = "550e8400-e29b-41d4-a716-446655440002"
node bin/axis-mcp-server.mjs
```

三类输入都会先转成统一的 `TriggerContext`（触发上下文）或 `FinalizeTurnInput`（回合结束输入），查询、注入、写回层不感知宿主细节。

## 运行轨迹仓储

正式启动路径现在优先使用：

- `src/observability/postgres-runtime-repository.ts`

如果数据库不可用或 `runtime_private` 初始化失败，会回退到：

- `src/observability/in-memory-runtime-repository.ts`

统一入口在：

- `src/observability/fallback-runtime-repository.ts`

这样保持了：

- 正式环境可持久化
- 本地和测试可降级
- 主链路不直接依赖具体仓储实现

## 查询超时闭环

读模型查询现在不是只在上层超时返回。

实际闭环做法是：

1. `DependencyGuard` 传入 `AbortSignal`（中止信号）
2. `QueryEngine` 把信号继续传给读模型仓储
3. `PostgresReadModelRepository` 在数据库连接上设置 `SET LOCAL statement_timeout`
4. 一旦超时或中止，会销毁当前数据库连接，避免后台长尾查询继续执行

这样满足“调用有界”和“显式降级”两个要求。

## 测试

```bash
npm test
```

`npm test` 只跑普通单测，不包含 `tests/e2e/**` 和真实模型评测。

```bash
npm run test:e2e
npm run test:memory-orchestrator-eval
npm run test:real-user-experience
```

真实用户体验 A/B 评测仍走 `eval:*` 命令，不进入默认测试链路。

脚本调用时，`npm run` 后面的 `--` 会把参数传给实际脚本。例如，只跑 `Claude Code`（Claude Code 插件）真实宿主 A/B 评测的前 10 条任务：

```bash
npm run eval:real-user-experience:host -- --host claude --limit 10
```

如果要跑轻量离线版真实用户体验 A/B 评测，也可以直接这样调用：

```bash
npm run eval:real-user-experience -- --seed --limit 10 --concurrency 1
```

记忆编排器真实模型离线评测也使用同样的参数传递方式：

```bash
npm run eval:memory-orchestrator-real -- --base-url http://localhost:8090/v1 --model gpt-5.4 --protocol openai-compatible --timeout-ms 45000
```

如果要直接调用轻量离线评测脚本，也可以这样跑，参数格式保持一致：

```bash
node tests/e2e/real-user-experience/run-ab-eval.mjs --seed --limit 10 --concurrency 1
```

当前测试覆盖了：

- 触发命中和未命中
- 查询降级
- 查询取消闭环
- 注入裁剪
- 写回过滤和提交流程
- `trigger`（触发）观测
- `runtime_private`（运行时私有表）仓储读写
- 宿主接入产物目录结构
- HTTP 接口稳定输出结构
