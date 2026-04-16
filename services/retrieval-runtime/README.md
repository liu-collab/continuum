# retrieval-runtime

这是 `retrieval-runtime`（运行时检索与注入）首版服务实现。

当前这版已经包含：

- `Fastify`（Web 框架）HTTP 服务骨架
- `prepare-context`、`finalize-turn`、`session-start-context`、观测接口
- `Claude Code plugin`（Claude Code 插件）和 `Codex app-server adapter`（Codex 应用服务适配器）输入适配
- `trigger-engine`（触发引擎）、`query-engine`（查询引擎）、`packet-builder`（记忆包组装）、`injection-engine`（注入裁剪）、`writeback-engine`（写回检查）
- 依赖超时与显式降级
- `runtime_private`（运行时私有表）持久化仓储，失败时回退到内存仓储
- `Vitest`（测试框架）基础测试

## 运行方式

```bash
npm install
npm run dev
```

默认监听：

- `HOST=0.0.0.0`
- `PORT=3002`

## 环境变量

`.env.example` 已经列出正式字段。关键项如下：

- `DATABASE_URL`
  用于读取 `storage`（存储服务）发布的共享读模型
- `READ_MODEL_SCHEMA` / `READ_MODEL_TABLE`
  默认读取 `storage_shared_v1.memory_read_model_v1`
- `STORAGE_WRITEBACK_URL`
  写回候选提交目标
- `EMBEDDING_BASE_URL` / `EMBEDDING_MODEL`
  语义触发与软排序使用的向量服务
- `QUERY_TIMEOUT_MS` / `EMBEDDING_TIMEOUT_MS` / `STORAGE_TIMEOUT_MS`
  所有跨服务调用都有限时

约束保持如下：

- `storage`（存储服务）没启动时，本服务仍可启动
- 查询或写回失败时，返回显式 `degraded`（降级）结果
- 不直接读取 `storage` 私有写表

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
