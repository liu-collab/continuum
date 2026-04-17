# 数据库与表结构设计

## 1. 文档目的

这份文档只解决一个问题：

整个系统的表到底要怎么设计，每张表存什么，哪些表是私有表，哪些表是共享只读模型。

这里不讨论产品目标，只讨论落地数据结构。

## 2. 设计前提

这份表设计严格遵守下面这些前提：

- 三部分是独立服务：`storage`、`retrieval-runtime`、`visualization`
- 允许共享由 `storage` 发布的只读数据库读模型
- 不允许共享写模型、私有表结构、私有运行状态
- `storage` 负责正式记忆数据
- `retrieval-runtime` 负责运行时过程数据
- `visualization` 首版尽量做无状态服务，只消费前两部分的正式输出

## 2.1 当前实现说明

这份文档要和当前代码保持一致。

当前已经确认的实现口径：

- 共享读模型正式字段是 `details` 和 `source`，不再拆成旧的 `details_preview_json / source_type / source_ref`
- `origin_workspace_id` 当前收在 `source` JSON 里，不是单独列
- 共享读模型已经补齐 `created_at`
- 治理动作已经包含 `invalidate`
- 读模型刷新任务已经有 `retry_count` 和 `embedding_updated_at`

## 3. 数据库边界

首版建议使用同一个 `PostgreSQL`（关系型数据库）集群，但按逻辑边界拆成三层：

### 3.1 `storage_private`

`storage` 私有写模型。

只有 `storage` 服务自己能读写。

### 3.2 `storage_shared_v1`

`storage` 发布的共享只读模型。

`retrieval-runtime` 和 `visualization` 只能读，不能写。

### 3.3 `runtime_private`

`retrieval-runtime` 私有运行数据。

只有 `retrieval-runtime` 服务自己能读写。

### 3.4 `visualization`

首版不强制要求自己的业务表。

如果后面确实要做缓存或聚合，再单独加表，但首版先按无状态处理。

## 4. storage 私有表

### 4.1 `memory_records`

这张表是正式记忆主表，保存当前有效的记忆记录。

建议字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `UUID` | 主键 |
| `workspace_id` | `UUID` | 工作区标识 |
| `user_id` | `UUID` | 用户标识，可为空，`workspace`（工作区级）记忆可不绑定用户 |
| `task_id` | `UUID` | 任务标识，可为空 |
| `session_id` | `UUID` | 会话标识，可为空 |
| `memory_type` | `TEXT` | `fact_preference`（事实与偏好）/ `task_state`（任务状态）/ `episodic`（情节） |
| `scope` | `TEXT` | `session` / `task` / `user` / `workspace` |
| `status` | `TEXT` | `active` / `superseded` / `archived` / `pending_confirmation` / `deleted` |
| `summary` | `TEXT` | 面向检索和注入的简短摘要 |
| `details_json` | `JSONB` | 结构化详情，不存完整聊天原文 |
| `importance` | `SMALLINT` | 重要度，1 到 5 |
| `confidence` | `NUMERIC(3,2)` | 可信度，0 到 1 |
| `dedupe_key` | `TEXT` | 去重键 |
| `source_type` | `TEXT` | 来源类型，如 `user_input`、`task_update` |
| `source_ref` | `TEXT` | 来源引用，比如某次 turn id |
| `created_by_service` | `TEXT` | 由哪个服务写入 |
| `last_confirmed_at` | `TIMESTAMPTZ` | 最近一次被确认时间 |
| `created_at` | `TIMESTAMPTZ` | 创建时间 |
| `updated_at` | `TIMESTAMPTZ` | 更新时间 |
| `archived_at` | `TIMESTAMPTZ` | 归档时间，可为空 |
| `deleted_at` | `TIMESTAMPTZ` | 删除时间，可为空 |
| `version` | `INT` | 当前版本号 |

约束：

- `importance` 只能在 1 到 5 之间
- `confidence` 只能在 0 到 1 之间
- `summary` 不能为空
- `details_json` 必须是结构化 JSON

建议索引：

- `(user_id, scope, memory_type, status)`
- `(workspace_id, scope, memory_type, status)`
- `(task_id, status)`
- `(dedupe_key)`
- `(updated_at DESC)`

### 4.2 `memory_record_versions`

这张表保存记忆历史版本，用于回溯和治理。

建议字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `UUID` | 主键 |
| `record_id` | `UUID` | 对应 `memory_records.id` |
| `version_no` | `INT` | 版本号 |
| `snapshot_json` | `JSONB` | 该版本完整快照 |
| `change_type` | `TEXT` | `create` / `update` / `merge` / `archive` / `delete` |
| `change_reason` | `TEXT` | 变更原因 |
| `changed_by_type` | `TEXT` | `system` / `user` / `operator` |
| `changed_by_id` | `TEXT` | 变更发起人 |
| `changed_at` | `TIMESTAMPTZ` | 变更时间 |

建议索引：

- `(record_id, version_no DESC)`
- `(changed_at DESC)`

### 4.3 `memory_write_jobs`

这张表保存异步写入任务状态。

建议字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `UUID` | 主键 |
| `idempotency_key` | `TEXT` | 幂等键 |
| `workspace_id` | `UUID` | 工作区标识 |
| `user_id` | `UUID` | 用户标识 |
| `candidate_json` | `JSONB` | 原始写回候选 |
| `candidate_hash` | `TEXT` | 候选内容哈希 |
| `source_service` | `TEXT` | 来源服务，通常是 `retrieval-runtime` |
| `job_status` | `TEXT` | `queued` / `processing` / `succeeded` / `failed` / `dead_letter` |
| `result_record_id` | `UUID` | 成功后对应的记录 id，可为空 |
| `error_code` | `TEXT` | 错误码 |
| `error_message` | `TEXT` | 错误信息 |
| `retry_count` | `INT` | 重试次数 |
| `received_at` | `TIMESTAMPTZ` | 接收时间 |
| `started_at` | `TIMESTAMPTZ` | 开始处理时间 |
| `finished_at` | `TIMESTAMPTZ` | 结束时间 |

建议索引：

- `(job_status, received_at)`
- `(workspace_id, user_id, received_at DESC)`
- `(idempotency_key)`

### 4.4 `memory_conflicts`

这张表保存无法自动解决的冲突。

建议字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `UUID` | 主键 |
| `workspace_id` | `UUID` | 工作区标识 |
| `user_id` | `UUID` | 用户标识 |
| `record_id` | `UUID` | 当前记录 |
| `conflict_with_record_id` | `UUID` | 冲突记录 |
| `pending_record_id` | `UUID` | 待人工确认的新候选记录，可为空 |
| `existing_record_id` | `UUID` | 已存在的旧记录，可为空 |
| `conflict_type` | `TEXT` | `fact_conflict` / `preference_conflict` / `scope_conflict` |
| `conflict_summary` | `TEXT` | 冲突摘要 |
| `status` | `TEXT` | `open` / `resolved` / `ignored` |
| `resolution_type` | `TEXT` | `manual_fix` / `auto_merge` / `dismissed` |
| `resolved_by` | `TEXT` | 谁处理的 |
| `created_at` | `TIMESTAMPTZ` | 创建时间 |
| `resolved_at` | `TIMESTAMPTZ` | 解决时间 |

建议索引：

- `(status, created_at DESC)`
- `(record_id)`
- `(conflict_with_record_id)`
- `(pending_record_id)`
- `(existing_record_id)`

### 4.5 `memory_governance_actions`

这张表保存治理动作审计日志。

建议字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `UUID` | 主键 |
| `record_id` | `UUID` | 被治理记录 |
| `action_type` | `TEXT` | `edit` / `archive` / `delete` / `confirm` / `invalidate` / `restore_version` |
| `action_payload` | `JSONB` | 动作详情 |
| `actor_type` | `TEXT` | `system` / `user` / `operator` |
| `actor_id` | `TEXT` | 动作发起人 |
| `created_at` | `TIMESTAMPTZ` | 操作时间 |

建议索引：

- `(record_id, created_at DESC)`
- `(action_type, created_at DESC)`

## 5. storage 共享只读模型

### 5.1 `memory_read_model_v1`

这是给 `retrieval-runtime` 和 `visualization` 读取的正式共享表。

它不是私有写表的镜像，而是经过裁剪后的共享读模型。

建议字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `UUID` | 记忆 id |
| `workspace_id` | `UUID` | 工作区标识；当 `scope=user` 时表示来源工作区 |
| `user_id` | `UUID` | 用户标识 |
| `task_id` | `UUID` | 任务标识 |
| `session_id` | `UUID` | 会话标识 |
| `memory_type` | `TEXT` | 记忆类型 |
| `scope` | `TEXT` | 作用范围 |
| `status` | `TEXT` | 当前状态，首版主要读 `active` |
| `summary` | `TEXT` | 摘要 |
| `details` | `JSONB` | 对外发布的结构化详情，可为空 |
| `importance` | `SMALLINT` | 重要度 |
| `confidence` | `NUMERIC(3,2)` | 可信度 |
| `source` | `JSONB` | 来源解释对象，包含 `source_type`、`source_ref`、`service_name`、`origin_workspace_id`、`confirmed_by_user` |
| `last_confirmed_at` | `TIMESTAMPTZ` | 最近确认时间 |
| `last_used_at` | `TIMESTAMPTZ` | 最近被召回时间 |
| `created_at` | `TIMESTAMPTZ` | 创建时间 |
| `updated_at` | `TIMESTAMPTZ` | 更新时间 |
| `summary_embedding` | `VECTOR` | 向量排序用 embedding，可为空，降级时允许缺失 |

建议索引：

- `(user_id, scope, memory_type, status)`
- `(workspace_id, scope, memory_type, status)`
- `(task_id, status)`
- `(updated_at DESC)`
- `summary_embedding` 的向量索引

### 5.2 `memory_read_model_refresh_jobs`

这张表用来观察共享读模型刷新状态。

建议字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `UUID` | 主键 |
| `source_record_id` | `UUID` | 来源记录 |
| `refresh_type` | `TEXT` | `insert` / `update` / `delete` |
| `job_status` | `TEXT` | `queued` / `processing` / `succeeded` / `failed` / `dead_letter` |
| `retry_count` | `INT` | 当前重试次数 |
| `error_message` | `TEXT` | 错误信息 |
| `embedding_updated_at` | `TIMESTAMPTZ` | 最近一次 embedding 刷新时间 |
| `created_at` | `TIMESTAMPTZ` | 创建时间 |
| `started_at` | `TIMESTAMPTZ` | 开始处理时间 |
| `finished_at` | `TIMESTAMPTZ` | 完成时间 |

## 6. retrieval-runtime 私有表

### 6.1 `runtime_turns`

这张表保存每一轮运行的上下文摘要。

建议字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `UUID` | 主键 |
| `workspace_id` | `UUID` | 工作区标识 |
| `user_id` | `UUID` | 用户标识 |
| `task_id` | `UUID` | 任务标识 |
| `session_id` | `UUID` | 会话标识 |
| `phase` | `TEXT` | `session_start` / `before_response` / `after_response` 等 |
| `input_summary` | `TEXT` | 当前输入摘要 |
| `assistant_output_summary` | `TEXT` | 输出摘要，可为空 |
| `turn_status` | `TEXT` | `started` / `completed` / `failed` |
| `created_at` | `TIMESTAMPTZ` | 创建时间 |
| `completed_at` | `TIMESTAMPTZ` | 完成时间 |

建议索引：

- `(workspace_id, user_id, created_at DESC)`
- `(task_id, created_at DESC)`
- `(session_id, created_at DESC)`

### 6.2 `runtime_recall_runs`

这张表保存每次召回执行记录。

建议字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `UUID` | 主键 |
| `turn_id` | `UUID` | 对应 `runtime_turns.id` |
| `trigger_type` | `TEXT` | 固定触发或 `semantic_fallback` |
| `trigger_hit` | `BOOLEAN` | 是否命中 |
| `requested_types_json` | `JSONB` | 请求的记忆类型 |
| `query_scope_json` | `JSONB` | 查询范围 |
| `packet_id` | `TEXT` | 对应记忆包 id |
| `selected_record_ids_json` | `JSONB` | 命中的记录 id 列表 |
| `degraded` | `BOOLEAN` | 是否降级 |
| `dependency_status` | `TEXT` | 依赖状态 |
| `latency_ms` | `INT` | 耗时 |
| `created_at` | `TIMESTAMPTZ` | 创建时间 |

建议索引：

- `(turn_id)`
- `(trigger_type, created_at DESC)`
- `(created_at DESC)`

### 6.3 `runtime_injection_runs`

这张表保存注入决策和实际注入结果。

建议字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `UUID` | 主键 |
| `recall_run_id` | `UUID` | 对应 `runtime_recall_runs.id` |
| `injection_reason` | `TEXT` | 注入原因 |
| `injected_summary` | `TEXT` | 实际注入摘要 |
| `injected_record_ids_json` | `JSONB` | 注入的记录 id |
| `dropped_record_ids_json` | `JSONB` | 被裁掉的记录 id |
| `drop_reason_json` | `JSONB` | 裁剪原因 |
| `token_estimate` | `INT` | 注入长度估算 |
| `created_at` | `TIMESTAMPTZ` | 创建时间 |

建议索引：

- `(recall_run_id)`
- `(created_at DESC)`

### 6.4 `runtime_writeback_submissions`

这张表保存写回候选和提交结果。

建议字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `UUID` | 主键 |
| `turn_id` | `UUID` | 对应 `runtime_turns.id` |
| `candidate_json` | `JSONB` | 写回候选 |
| `submit_status` | `TEXT` | `not_applicable` / `submitted` / `failed` / `rejected` |
| `storage_job_id` | `UUID` | `storage` 返回的 job id |
| `error_code` | `TEXT` | 错误码 |
| `error_message` | `TEXT` | 错误信息 |
| `created_at` | `TIMESTAMPTZ` | 创建时间 |

建议索引：

- `(turn_id)`
- `(submit_status, created_at DESC)`

### 6.5 `runtime_dependency_status`

这张表保存依赖状态快照，服务本身状态不要和依赖状态混在一起。

建议字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `UUID` | 主键 |
| `dependency_name` | `TEXT` | 比如 `storage` |
| `status` | `TEXT` | `healthy` / `unavailable` / `timeout` |
| `checked_at` | `TIMESTAMPTZ` | 检查时间 |
| `error_message` | `TEXT` | 错误详情 |

## 7. visualization 服务表设计

首版建议 `visualization` 尽量无状态，不强制要求自己的业务表。

理由：

- 它只做展示和聚合
- 不应该成为新的主数据源
- 可以直接读取共享读模型和观测接口

### 7.1 首版不强制建表

首版页面直接消费：

- `storage_shared_v1.memory_read_model_v1`
- `storage` 的观测接口
- `retrieval-runtime` 的观测接口

### 7.2 如果后面确实要加缓存

如果后面页面流量上来，需要缓存，可以再补下面两张表。

#### 7.2.1 `viz_metric_snapshots`

保存聚合后的看板快照。

#### 7.2.2 `viz_datasource_status`

保存各数据源可用性状态。

但这两张表不是首版必需。

## 8. 字段设计规则

为了避免表越写越乱，首版再固定几条字段规则：

- 所有主键统一用 `UUID`
- 所有时间统一用 `TIMESTAMPTZ`
- 结构化扩展字段统一用 `JSONB`
- 枚举先用 `TEXT + CHECK`（文本 + 约束），不急着做数据库枚举类型
- 所有跨服务共享字段命名保持一致

## 9. 最少必须落地的表

如果首版只做最小可用集，至少落这 8 张：

1. `storage_private.memory_records`
2. `storage_private.memory_record_versions`
3. `storage_private.memory_write_jobs`
4. `storage_private.memory_conflicts`
5. `storage_shared_v1.memory_read_model_v1`
6. `runtime_private.runtime_turns`
7. `runtime_private.runtime_recall_runs`
8. `runtime_private.runtime_writeback_submissions`

## 10. 一句话设计

整个表设计的核心思路是：

`storage` 用私有写表管理正式记忆和治理过程，再发布一张共享只读模型表给 `retrieval-runtime` 和 `visualization` 使用；`retrieval-runtime` 只保存运行过程表；`visualization` 首版尽量不持久化业务数据。
