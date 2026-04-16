# 部署与运维指南

## 1. 系统依赖

### 1.1 必需依赖

| 依赖 | 最低版本 | 说明 |
|------|---------|------|
| Node.js | 18+ | 三个服务的运行时 |
| PostgreSQL | 15+ | 数据持久化 |
| pgvector | 0.5+ | PostgreSQL 向量扩展，用于语义排序 |

### 1.2 可选依赖

| 依赖 | 说明 |
|------|------|
| embedding 服务 | 兼容 OpenAI Embeddings API 的服务（如 OpenAI、本地部署的 text-embedding 模型）。未配置时，storage 仍可入库但向量字段为空，retrieval-runtime 退回纯结构化过滤 |
| Redis | storage 的可选缓存依赖。未配置不影响服务启动和核心功能 |

## 2. 服务列表

| 服务 | 默认端口 | 目录 | 说明 |
|------|---------|------|------|
| storage | 3001 | `services/storage` | 记忆写入、治理、共享读模型发布 |
| retrieval-runtime | 3002 | `services/retrieval-runtime` | 运行时检索、注入、写回检查 |
| visualization | 3003 | `services/visualization` | 可视化与观测平台 |

三个服务可独立部署、独立启动、独立回滚。任一服务未启动不影响其他服务运行。

## 3. 环境变量汇总

### 3.1 storage

| 变量 | 默认值 | 必填 | 说明 |
|------|-------|------|------|
| `PORT` | `3001` | 否 | HTTP 监听端口 |
| `HOST` | `0.0.0.0` | 否 | HTTP 监听地址 |
| `LOG_LEVEL` | `info` | 否 | 日志级别 |
| `DATABASE_URL` | - | 是 | PostgreSQL 连接串 |
| `STORAGE_SCHEMA_PRIVATE` | `storage_private` | 否 | 私有写模型 schema |
| `STORAGE_SCHEMA_SHARED` | `storage_shared_v1` | 否 | 共享只读模型 schema |
| `WRITE_JOB_POLL_INTERVAL_MS` | `1000` | 否 | 异步写任务轮询间隔 |
| `WRITE_JOB_BATCH_SIZE` | `10` | 否 | 单次 worker 批大小 |
| `WRITE_JOB_MAX_RETRIES` | `3` | 否 | 写任务最大重试次数 |
| `READ_MODEL_REFRESH_MAX_RETRIES` | `3` | 否 | 读模型刷新最大重试次数 |
| `EMBEDDING_BASE_URL` | - | 否 | embedding 服务地址 |
| `EMBEDDING_API_KEY` | - | 否 | embedding 服务鉴权 key |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | 否 | embedding 模型名 |
| `REDIS_URL` | - | 否 | 可选 Redis 地址 |

### 3.2 retrieval-runtime

| 变量 | 默认值 | 必填 | 说明 |
|------|-------|------|------|
| `PORT` | `3002` | 否 | HTTP 监听端口 |
| `HOST` | `0.0.0.0` | 否 | HTTP 监听地址 |
| `LOG_LEVEL` | `info` | 否 | 日志级别 |
| `DATABASE_URL` | - | 是 | PostgreSQL 连接串 |
| `READ_MODEL_SCHEMA` | `storage_shared_v1` | 否 | 共享读模型 schema |
| `READ_MODEL_TABLE` | `memory_read_model_v1` | 否 | 共享读模型表名 |
| `RUNTIME_SCHEMA` | `runtime_private` | 否 | 运行时私有 schema |
| `STORAGE_WRITEBACK_URL` | `http://localhost:3001` | 是 | storage 服务地址 |
| `EMBEDDING_BASE_URL` | - | 是 | embedding 服务地址 |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | 否 | embedding 模型名 |
| `EMBEDDING_API_KEY` | - | 否 | embedding 服务鉴权 key |
| `QUERY_TIMEOUT_MS` | `800` | 否 | 查询超时 |
| `STORAGE_TIMEOUT_MS` | `800` | 否 | storage 调用超时 |
| `EMBEDDING_TIMEOUT_MS` | `800` | 否 | embedding 调用超时 |
| `QUERY_CANDIDATE_LIMIT` | `30` | 否 | 硬过滤后最大候选数 |
| `PACKET_RECORD_LIMIT` | `10` | 否 | 记忆包最大记录数 |
| `INJECTION_RECORD_LIMIT` | `3` | 否 | 注入最大记录数 |
| `INJECTION_TOKEN_BUDGET` | `450` | 否 | 注入 token 预算 |
| `TRIGGER_COOLDOWN_MS` | `120000` | 否 | 触发冷却时间 |
| `SEMANTIC_TRIGGER_THRESHOLD` | `0.85` | 否 | 语义兜底触发阈值 |

### 3.3 visualization

| 变量 | 默认值 | 必填 | 说明 |
|------|-------|------|------|
| `STORAGE_READ_MODEL_DSN` | - | 是 | 共享读模型数据库连接串 |
| `STORAGE_READ_MODEL_SCHEMA` | `storage_shared_v1` | 否 | 共享读模型 schema |
| `STORAGE_READ_MODEL_TABLE` | `memory_read_model_v1` | 否 | 共享读模型表名 |
| `STORAGE_READ_MODEL_TIMEOUT_MS` | `2000` | 否 | 读模型查询超时 |
| `STORAGE_API_BASE_URL` | `http://localhost:3001` | 是 | storage 观测接口地址 |
| `STORAGE_API_TIMEOUT_MS` | `2000` | 否 | storage 接口超时 |
| `RUNTIME_API_BASE_URL` | `http://localhost:3002` | 是 | retrieval-runtime 观测接口地址 |
| `RUNTIME_API_TIMEOUT_MS` | `2000` | 否 | runtime 接口超时 |
| `DEFAULT_PAGE_SIZE` | `20` | 否 | 默认分页大小 |
| `HEALTH_POLL_INTERVAL_MS` | `5000` | 否 | 健康检查轮询间隔 |

## 4. 数据库初始化

### 4.1 创建数据库

```sql
CREATE DATABASE agent_memory;
```

### 4.2 启用 pgvector 扩展

```sql
\c agent_memory
CREATE EXTENSION IF NOT EXISTS vector;
```

### 4.3 创建 schema

```sql
CREATE SCHEMA IF NOT EXISTS storage_private;
CREATE SCHEMA IF NOT EXISTS storage_shared_v1;
CREATE SCHEMA IF NOT EXISTS runtime_private;
```

### 4.4 执行迁移

```bash
cd services/storage && npm run migrate
cd services/retrieval-runtime && npm run migrate
```

## 5. 本地开发启动步骤

### 5.1 前置条件

1. 确保 PostgreSQL 已启动且可连接
2. 确保 pgvector 扩展已安装
3. 完成数据库初始化（第 4 节）

### 5.2 安装依赖

```bash
cd services/storage && npm install
cd services/retrieval-runtime && npm install
cd services/visualization && npm install
```

### 5.3 配置环境变量

每个服务目录下复制 `.env.example` 为 `.env` 并按需修改。

### 5.4 启动服务

三个服务可独立启动，顺序不影响功能，但建议按以下顺序方便调试：

```bash
# 终端 1：启动 storage
cd services/storage && npm run dev

# 终端 2：启动 retrieval-runtime
cd services/retrieval-runtime && npm run dev

# 终端 3：启动 visualization
cd services/visualization && npm run dev
```

### 5.5 验证服务状态

```bash
curl http://localhost:3001/v1/storage/health/liveness
curl http://localhost:3002/v1/runtime/health/liveness
curl http://localhost:3003/api/health/liveness
```

## 6. 启动顺序与依赖关系

```
storage ──────────────────────────── 独立启动
retrieval-runtime ────────────────── 独立启动（storage 不可用时降级运行）
visualization ────────────────────── 独立启动（上游不可用时降级展示）
```

三个服务没有启动顺序依赖。任一服务未启动不会阻塞其他服务启动。

## 7. 性能指标基线

| 指标 | P95 目标 | 所属服务 |
|------|---------|---------|
| 检索响应 | ≤ 200ms | retrieval-runtime |
| 记忆包组装 | ≤ 50ms | retrieval-runtime |
| 空结果返回 | ≤ 100ms | retrieval-runtime |
| 写回确认 | ≤ 500ms | storage |
| 写入完成（含去重合并） | ≤ 3s | storage |
| 页面数据查询 | ≤ 2s | visualization |
| 指标聚合刷新 | ≤ 30s | visualization |
