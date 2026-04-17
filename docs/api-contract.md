# 统一 API 契约

这份文档是三个服务所有对外接口的统一定义。

如果其他文档中的接口描述和本文档冲突，以本文档为准。

## 0. 当前阶段收口口径

当前契约按首版收口方案先固定下面几条：

- 默认运行模式是 `single_local_user`（单本地用户）
- 当前正式开放的作用范围是 `session`、`task`、`workspace`、`user`
- `user` 表示全局记忆，`workspace` 表示工作区记忆
- 用户可以选择“只使用工作区记忆”或“使用工作区记忆 + 全局记忆”
- 页面和接口只保留已经实现或当前阶段明确承诺实现的筛选项和字段

收口方案细节见 `current-phase-closure-plan.md`。

## 0.1 当前阶段边界说明

当前阶段不是多用户权限系统。

因此这里的重点不是“多租户身份鉴权”，而是“当前本地用户下，工作区记忆和全局记忆怎么区分使用”。

约束如下：

- `user_id` 在当前阶段表示当前本地安装实例的全局记忆空间
- `workspace_id` 表示当前工作区边界
- `workspace_id` 不能为空；当前首版所有运行时请求都必须落在某个工作区上下文里
- 运行时需要支持“只用工作区记忆”或“工作区 + 全局记忆”两种模式
- 对 `scope=user` 的正式记忆，`workspace_id` 只表示来源工作区，不再作为全局记忆的可见性边界

## 0.2 当前阶段正式能力范围

当前阶段正式开放：

- `session`
- `task`
- `workspace`
- `user`

其中：

- `user` = 全局记忆
- `workspace` = 工作区记忆

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
      "scope": "session | task | workspace | user",
      "summary": "string，必填，可复用短句",
      "details": "object，结构化详情",
      "importance": "1-5",
      "confidence": "0-1",
      "write_reason": "string，写回理由",
      "source": {
        "source_type": "string，如 user_input、task_update",
        "source_ref": "string，来源引用",
        "service_name": "string，来源服务名",
        "origin_workspace_id": "UUID，可选；当 scope=user 时表示来源工作区"
      },
      "task_id": "UUID，可选",
      "session_id": "UUID，可选"
    }
  ]
}
```

约束补充：

- 当前阶段写回接收接口正式接受 `session | task | workspace | user`
- 写回到 `user` 时表示写入全局记忆
- 写回到 `workspace` 时表示写入当前工作区记忆

返回体：

```json
{
  "jobs": [
    {
      "job_id": "UUID",
      "status": "accepted_async",
      "received_at": "ISO8601"
    }
  ],
  "submitted_jobs": [
    {
      "job_id": "UUID",
      "status": "accepted_async",
      "candidate_summary": "string，可选；当前兼容字段"
    }
  ]
}
```

补充说明：

- 正式返回口径是 `jobs`
- 当前实现仍保留 `submitted_jobs` 兼容字段，方便尚未完成切换的调用方继续解析

### 1.2 记录查询

`GET /v1/storage/records`

作用：给治理侧查看正式记录。不是运行时查询接口。

查询参数：

- `workspace_id`（必填，表示当前工作区上下文；当 `scope=user` 时不作为全局可见性过滤条件）
- `user_id`
- `memory_type`
- `scope`
- `status`
- `task_id`
- `page`
- `page_size`

返回体：

```json
{
  "items": [
    {
      "id": "UUID",
      "workspace_id": "UUID",
      "user_id": "UUID，可空",
      "task_id": "UUID，可空",
      "session_id": "UUID，可空",
      "memory_type": "fact_preference | task_state | episodic",
      "scope": "session | task | workspace | user",
      "status": "active | superseded | archived | pending_confirmation | deleted",
      "summary": "string",
      "details_json": "object",
      "importance": "1-5",
      "confidence": "0-1",
      "dedupe_key": "string",
      "source_type": "string",
      "source_ref": "string",
      "created_by_service": "string",
      "last_confirmed_at": "ISO8601，可空",
      "created_at": "ISO8601",
      "updated_at": "ISO8601",
      "archived_at": "ISO8601，可空",
      "deleted_at": "ISO8601，可空",
      "version": "number"
    }
  ],
  "total": "number",
  "page": "number",
  "page_size": "number"
}
```

### 1.3 记录编辑

`PATCH /v1/storage/records/{recordId}`

作用：修正摘要、状态、作用范围或结构化详情。

约束：不允许直接改 `created_at`，不允许跳过版本记录。

### 1.4 记录确认

`POST /v1/storage/records/{recordId}/confirm`

作用：把一条待确认记录显式确认成可继续参与默认召回的正式记录。

约束：

- 必须写治理审计
- 必须记录操作人和原因
- 必须触发共享读模型刷新

### 1.5 记录失效

`POST /v1/storage/records/{recordId}/invalidate`

作用：把错误或不再可信的记录标记为失效，不再参与默认召回。

约束：

- 失效后默认不再进入 runtime 默认召回
- 必须保留历史版本和治理审计

### 1.6 记录删除

`POST /v1/storage/records/{recordId}/delete`

作用：执行软删除。

约束：

- 删除后记录保留审计信息
- 删除后默认不再进入共享读模型的默认可召回集合
- 不允许跳过审计直接物理删除

### 1.7 记录归档

`POST /v1/storage/records/{recordId}/archive`

作用：把不再活跃的记录归档。

### 1.8 冲突解决

`POST /v1/storage/conflicts/{conflictId}/resolve`

作用：手动解决冲突记忆。

### 1.9 存储指标

`GET /v1/storage/observe/metrics`

返回：写入接收量、正式入库量、忽略重复率、合并率、冲突率、死信量、投影延迟。

### 1.10 写入任务查看

`GET /v1/storage/observe/write-jobs`

返回：最近写入任务及其状态。

### 1.11 健康检查

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
  "host": "claude_code_plugin | codex_app_server | custom_agent",
  "session_id": "string",
  "cwd": "string，可选",
  "source": "string，可选",
  "memory_mode": "workspace_only | workspace_plus_global，可选",
  "user_id": "UUID",
  "workspace_id": "UUID"
}
```

返回体：

```json
{
  "additional_context": "string",
  "active_task_summary": "string，可选",
  "memory_mode": "workspace_only | workspace_plus_global",
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
  "memory_mode": "workspace_only | workspace_plus_global，可选",
  "phase": "session_start | task_start | task_switch | before_plan | before_response",
  "current_input": "string",
  "recent_context_summary": "string，可选"
}
```

约束补充：

- 当前阶段正式可查询的 scope 允许 `session | task | workspace | user`
- runtime 需要支持按当前 `memory_mode` 决定是否同时查询 `workspace + user`
- `memory_mode` 未显式传入时，默认按 `workspace_plus_global`

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
    "token_estimate": "number",
    "memory_mode": "workspace_only | workspace_plus_global",
    "requested_scopes": "array",
    "selected_scopes": "array",
    "trimmed_record_ids": "array，可选",
    "trim_reasons": "array，可选"
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
  "memory_mode": "workspace_only | workspace_plus_global，可选",
  "current_input": "string",
  "assistant_output": "string",
  "tool_results_summary": "string，可选"
}
```

约束补充：

- 当前阶段写回候选的正式可用 `scope` 允许 `session | task | workspace | user`
- runtime 需要明确区分全局记忆写回和工作区记忆写回
- `memory_mode` 未显式传入时，默认按 `workspace_plus_global`

返回体：

```json
{
  "write_back_candidates": "array",
  "submitted_jobs": "array",
  "memory_mode": "workspace_only | workspace_plus_global",
  "degraded": "boolean"
}
```

### 2.4 运行轨迹查询

`GET /v1/runtime/observe/runs`

返回：按 turn 组织的运行轨迹，包含 `turn`、`trigger`、`recall`、`injection`、`writeback` 五段。

查询参数：

- `session_id`
- `turn_id`
- `trace_id`
- `page`
- `page_size`

当前阶段收口后，正式对外只保留下列查询参数：

- `session_id`
- `turn_id`
- `trace_id`
- `page`
- `page_size`

如果页面或宿主需要其他筛选项，必须在 runtime 端正式实现并更新本文档后才能开放。

轨迹返回的正式解释字段至少包括：

- 当前 `memory_mode`
- `trigger` 阶段的请求 scope 与决策原因
- `recall` 阶段的实际查询 scope 与各 scope 命中数量
- `injection` 阶段的最终保留 scope 与裁剪记录
- `writeback` 阶段每条候选最终落到哪个 scope

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

当前阶段页面正式筛选范围只允许：

- `turn_id`
- `session_id`
- `trace_id`
- `page`
- `page_size`

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
| `workspace_id` | `UUID` | 工作区标识；当 `scope=user` 时表示来源工作区 |
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
| `source` | `JSONB` | 来源信息（含 source_type、source_ref，可附带 origin_workspace_id） |
| `last_confirmed_at` | `TIMESTAMPTZ` | 最近确认时间 |
| `last_used_at` | `TIMESTAMPTZ` | 最近被召回时间 |
| `created_at` | `TIMESTAMPTZ` | 创建时间 |
| `updated_at` | `TIMESTAMPTZ` | 更新时间 |
| `summary_embedding` | `VECTOR(1536)` | 向量排序用 embedding |

约束：

- 只有 `storage` 能写入此表
- `retrieval-runtime` 和 `visualization` 只能只读访问
- 字段变更必须通过版本管理
- 如果页面展示某个字段，该字段必须先在共享读模型正式发布，不能再用临时补值或空值占位
- 当前阶段 `scope=user` 表示全局记忆，`scope=workspace` 表示工作区记忆
- 对 `scope=user` 的记录，`workspace_id` 和 `source.origin_workspace_id` 都表示来源工作区，不作为跨工作区读取时的过滤边界

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
