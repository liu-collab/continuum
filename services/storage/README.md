# storage 服务

## 当前实现

- HTTP 接口：写回接收、治理、观测、健康检查
- 私有写模型：正式记录、版本、写任务、冲突、治理审计、读模型刷新任务
- 共享读模型：`storage_shared_v1.memory_read_model_v1`
- 后台处理：基于 PostgreSQL job table + polling worker 异步做标准化、去重、合并、冲突、读模型投影

## 技术栈

- `TypeScript`（类型脚本）
- `Fastify`（轻量 HTTP 框架）
- `PostgreSQL + pgvector`（关系库与向量扩展）
- `Drizzle`（表结构定义）
- `Pino`（日志）
- `Vitest`（测试）

## 运行方式

```bash
npm install
npm run migrate
npm run dev
```

另开一个终端启动 worker：

```bash
npm run dev:worker
```

## 配置说明

- `DATABASE_URL`（数据库连接串）：必填
- `STORAGE_SCHEMA_PRIVATE`（私有写模型 schema）：默认 `storage_private`
- `STORAGE_SCHEMA_SHARED`（共享读模型 schema）：默认 `storage_shared_v1`
  迁移和运行时都会使用这两个配置，不再只在运行时生效
- `WRITE_JOB_POLL_INTERVAL_MS`（worker 轮询间隔）
- `WRITE_JOB_BATCH_SIZE`（单轮处理任务数）
- `WRITE_JOB_MAX_RETRIES`（写任务最大重试次数）
- `READ_MODEL_REFRESH_MAX_RETRIES`（读模型刷新重试上限）
- `EMBEDDING_BASE_URL`（embedding 服务地址）：未配置时仍会发布读模型，但 `summary_embedding`（摘要向量）为空
- `EMBEDDING_API_KEY`（embedding 鉴权）
- `EMBEDDING_MODEL`（embedding 模型名）
- `REDIS_URL`（可选依赖地址）：未配置不影响启动

## 对外接口

- `POST /v1/storage/write-back-candidates`
  支持三种正式口径：
  单条 `WriteBackCandidate`（写回候选）
  批量 `{ candidates: WriteBackCandidate[] }`
  `retrieval-runtime`（运行时检索）批量 `{ workspace_id, user_id, session_id, task_id?, source_service, candidates: [...] }`
  成功仅表示异步接收
- `GET /v1/storage/write-back-candidates/:jobId`
  查看写任务状态
- `GET /v1/storage/records`
  治理侧查看正式记录
- `PATCH /v1/storage/records/:recordId`
  编辑正式记录并写版本
- `POST /v1/storage/records/:recordId/archive`
  归档记录
- `POST /v1/storage/records/:recordId/confirm`
  确认记录并更新 `last_confirmed_at`（最近确认时间）
- `POST /v1/storage/records/:recordId/invalidate`
  失效记录；当前阶段会转成 `archived`（归档）并保留治理审计
- `POST /v1/storage/records/:recordId/delete`
  软删除记录，并从共享读模型移除
- `POST /v1/storage/records/:recordId/restore-version`
  从历史版本恢复
- `GET /v1/storage/conflicts`
  查看冲突池
- `POST /v1/storage/conflicts/:conflictId/resolve`
  手动解决冲突
- `GET /v1/storage/observe/metrics`
  查看写入量、冲突量、投影失败量
- `GET /v1/storage/observe/write-jobs`
  查看最近写任务
- `GET /v1/storage/health/liveness`
  只返回进程存活状态
- `GET /v1/storage/health/readiness`
  只返回是否可接收请求，核心只看数据库
- `GET /v1/storage/health/dependencies`
  单独返回 `database`（数据库）、`redis`（可选缓存）、`embedding_service`（向量服务）依赖状态
- `GET /health`
  兼容旧探针，聚合返回 `liveness`（存活状态）、`readiness`（就绪状态）、`dependencies`（依赖状态）

## 设计约束

- 不接收完整对话原文；`details`（结构化详情）会拒绝 `transcript`（完整对话）一类 payload
- 同步接口只做校验和入队，不做重处理
- 共享读模型固定发布字段：`summary`、`details`、`source`、`summary_embedding` 等正式 DTO
- 共享读模型正式发布 `created_at`，并在 `source.origin_workspace_id` 中保留来源工作区
- 读模型刷新失败会单独记录并重试，超限后进入 `dead_letter`（最终失败），不回滚正式写入
- embedding 生成属于读模型刷新的一部分，失败时共享读模型仍会发布，只是 `summary_embedding` 为空
- `storage` 可单独启动；`readiness`（就绪状态）只受数据库影响，可选依赖异常只体现在 `dependencies`（依赖状态）里
