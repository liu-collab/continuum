# 统一 API 契约

这份文档是三个服务所有对外接口的统一定义。

如果其他文档中的接口描述和本文档冲突，以本文档为准。

## 1. storage 服务接口

基础地址：`http://{STORAGE_HOST}:{STORAGE_PORT}`

默认端口：`3001`

### 1.1 写回候选接收

`POST /v1/storage/write-back-candidates`

作用：接收来自 `retrieval-runtime` 的写回候选。

请求体：

```json
{
  "workspace_id": "UUID",
  "user_id": "UUID",
  "candidates": [
    {
      "candidate_type": "fact_preference | task_state | episodic",
      "scope": "session | task | user | workspace",
      "summary": "string，必填，可复用短句",
      "details": "object，结构化详情",
      "importance": "1-5",
      "confidence": "0-1",
      "write_reason": "string，写回理由",
      "source": {
        "source_type": "string，如 user_input、task_update",
        "source_ref": "string，来源引用",
        "service_name": "string，来源服务名"
      },
      "task_id": "UUID，可选",
      "session_id": "UUID，可选"
    }
  ]
}
```

返回体：

```json
{
  "jobs": [
    {
      "job_id": "UUID",
      "status": "accepted_async",
      "received_at": "ISO8601"
    }
  ]
}
```

### 1.2 记录查询

`GET /v1/storage/records`

作用：给治理侧查看正式记录。不是运行时查询接口。

查询参数：

- `workspace_id`（必填）
- `user_id`
- `memory_type`
- `scope`
- `status`
- `task_id`
- `page`
- `page_size`

### 1.3 记录编辑

`PATCH /v1/storage/records/{recordId}`

作用：修正摘要、状态、作用范围或结构化详情。

约束：不允许直接改 `created_at`，不允许跳过版本记录。

### 1.4 记录归档

`POST /v1/storage/records/{recordId}/archive`

作用：把不再活跃的记录归档。

### 1.5 冲突解决

`POST /v1/storage/conflicts/{conflictId}/resolve`

作用：手动解决冲突记忆。

### 1.6 存储指标

`GET /v1/storage/observe/metrics`

返回：写入接收量、正式入库量、忽略重复率、合并率、冲突率、死信量、投影延迟。

### 1.7 写入任务查看

`GET /v1/storage/observe/write-jobs`

返回：最近写入任务及其状态。

### 1.8 健康检查

`GET /v1/storage/health/liveness` — 进程存活状态

`GET /v1/storage/health/readiness` — 是否能接收请求

`GET /v1/storage/health/dependencies` — 外部依赖状态

## 2. retrieval-runtime 服务接口

基础地址：`http://{RUNTIME_HOST}:{RUNTIME_PORT}`

默认端口：`3002`

### 2.1 会话启动恢复

`POST /v1/runtime/session-start-context`

作用：会话刚启动时恢复用户稳定偏好和活跃任务。

请求体：

```json
{
  "host": "claude_code | codex | custom",
  "session_id": "string",
  "cwd": "string，可选",
  "source": "string，可选",
  "user_id": "UUID",
  "workspace_id": "UUID"
}
```

返回体：

```json
{
  "additional_context": "string",
  "active_task_summary": "string，可选",
  "dependency_status": "object"
}
```

### 2.2 当前轮上下文准备

`POST /v1/runtime/prepare-context`

作用：在当前轮开始前做记忆检索和注入。

请求体：

```json
{
  "workspace_id": "UUID",
  "user_id": "UUID",
  "task_id": "UUID，可选",
  "session_id": "string",
  "thread_id": "string，可选",
  "turn_id": "string，可选",
  "phase": "session_start | task_start | task_switch | before_plan | before_response",
  "current_input": "string",
  "recent_context_summary": "string，可选"
}
```

返回体：

```json
{
  "trigger": "boolean",
  "trigger_reason": "string",
  "memory_packet": "MemoryPacket，可选",
  "injection_block": {
    "injection_reason": "string",
    "memory_summary": "string",
    "memory_records": "array",
    "token_estimate": "number"
  },
  "degraded": "boolean",
  "dependency_status": "object"
}
```

### 2.3 回合结束

`POST /v1/runtime/finalize-turn`

作用：响应结束后做写回检查并提交 storage。

请求体：

```json
{
  "workspace_id": "UUID",
  "user_id": "UUID",
  "task_id": "UUID，可选",
  "session_id": "string",
  "thread_id": "string，可选",
  "turn_id": "string，可选",
  "current_input": "string",
  "assistant_output": "string",
  "tool_results_summary": "string，可选"
}
```

返回体：

```json
{
  "write_back_candidates": "array",
  "submitted_jobs": "array",
  "degraded": "boolean"
}
```

### 2.4 运行轨迹查询

`GET /v1/runtime/observe/runs`

返回：按 turn 组织的运行轨迹，包含 trigger、recall、injection、writeback 分段。

查询参数：

- `workspace_id`
- `user_id`
- `session_id`
- `task_id`
- `turn_id`
- `page`
- `page_size`

### 2.5 运行指标

`GET /v1/runtime/observe/metrics`

返回：触发率、召回命中率、空检索率、实际注入率、注入裁剪率、查询 P95、注入 P95、写回提交率。

### 2.6 健康检查

`GET /v1/runtime/health/liveness` — 进程存活状态

`GET /v1/runtime/health/readiness` — 是否能接收请求

`GET /v1/runtime/health/dependencies` — 外部依赖状态

## 3. visualization 服务接口

基础地址：`http://{VIZ_HOST}:{VIZ_PORT}`

默认端口：`3003`

### 3.1 记忆目录

`GET /api/memories`

返回：记忆列表，数据来自 storage 共享读模型。

### 3.2 运行轨迹

`GET /api/runs`

返回：运行轨迹列表或单轮详情，数据来自 retrieval-runtime 观测接口。

### 3.3 指标看板

`GET /api/dashboard`

返回：聚合后的 storage 和 retrieval-runtime 指标。

### 3.4 数据源状态

`GET /api/sources/health`

返回：storage 和 retrieval-runtime 的健康状态。

### 3.5 自身健康检查

`GET /api/health/liveness` — 进程存活状态

`GET /api/health/readiness` — 是否能接收请求

## 4. 共享读模型

### 4.1 `storage_shared_v1.memory_read_model_v1`

这是 storage 发布给 retrieval-runtime 和 visualization 的只读表。

正式字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `UUID` | 记忆 id |
| `workspace_id` | `UUID` | 工作区标识 |
| `user_id` | `UUID` | 用户标识 |
| `task_id` | `UUID` | 任务标识 |
| `session_id` | `UUID` | 会话标识 |
| `memory_type` | `TEXT` | 记忆类型 |
| `scope` | `TEXT` | 作用范围 |
| `status` | `TEXT` | 当前状态 |
| `summary` | `TEXT` | 摘要 |
| `details` | `JSONB` | 结构化详情 |
| `importance` | `SMALLINT` | 重要度 |
| `confidence` | `NUMERIC(3,2)` | 可信度 |
| `source` | `JSONB` | 来源信息（含 source_type、source_ref） |
| `last_confirmed_at` | `TIMESTAMPTZ` | 最近确认时间 |
| `last_used_at` | `TIMESTAMPTZ` | 最近被召回时间 |
| `updated_at` | `TIMESTAMPTZ` | 更新时间 |
| `summary_embedding` | `VECTOR(1536)` | 向量排序用 embedding |

约束：

- 只有 `storage` 能写入此表
- `retrieval-runtime` 和 `visualization` 只能只读访问
- 字段变更必须通过版本管理

## 5. 接口通用约定

### 5.1 错误响应格式

所有服务的错误响应统一采用：

```json
{
  "error": {
    "code": "string，错误码",
    "message": "string，错误描述"
  }
}
```

### 5.2 超时约定

- 所有跨服务调用都必须有超时上限
- 超时后必须返回显式错误，不能无限等待
- 超时不能把调用方进程拖挂

### 5.3 版本策略

- 接口路径统一使用 `/v1/` 前缀
- 接口变更通过版本升级管理
- 共享读模型表名包含版本号（`memory_read_model_v1`）
