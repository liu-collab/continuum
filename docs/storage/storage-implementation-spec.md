# storage 实施规格

## 1. 文档定位

这份文档不是产品定义，也不是单独的表结构清单。

它只回答一件事：

`storage` 这一层到底怎么工作，为什么要这么做，表和接口怎么配合，失败时怎么处理。

配套文档：

- `memory-storage-product.md`：讲这一层为什么存在
- `database-schema-design.md`：讲有哪些表
- 这份文档：讲这些表和模块怎么一起工作

## 2. 这一层真正要解决的问题

`storage` 这一层首版要解决 6 类问题。

### 2.1 原始对话不能直接变成记忆

问题：

- 原始对话太长
- 噪声太多
- 很多表达不是稳定事实
- 后续很难检索和治理

解决方案：

- 上游只允许提交 `写回候选`
- `storage` 只接收结构化候选，不接收整段聊天原文
- 入库前必须经过标准化、去重、冲突判断

### 2.2 同一条记忆会被反复写

问题：

- 用户偏好会重复提到
- 任务状态会连续更新
- 同一事实会多次被确认

解决方案：

- 每条候选都生成 `dedupe_key`
- 按 `memory_type + scope + dedupe_key` 查找已有记录
- 不满足新增条件时，不新建主记录，而是更新、合并或忽略

### 2.3 新信息可能和旧信息冲突

问题：

- 用户先说喜欢 A，后面又说不喜欢 A
- 同一个任务状态前后不一致
- 工作区级和用户级信息可能互相打架

解决方案：

- 写入前做冲突检测
- 可自动决策的直接转成 `superseded`
- 不能自动决策的写入 `memory_conflicts`
- 必要时把记录标成 `pending_confirmation`

### 2.4 记忆不是写进去就结束

问题：

- 任务做完了，过程状态应该失效
- 旧偏好被新偏好替换
- 错误记忆需要人工纠正

解决方案：

- 正式记录维护生命周期状态
- 每次变化都写版本表
- 通过治理接口做编辑、归档、恢复、确认

### 2.5 运行时查询不能直接读私有写表

问题：

- 写模型字段很多，变化频繁
- 上游直接读写表会让边界失控
- 运行时只需要稳定、轻量、可排序的数据

解决方案：

- `storage` 自己维护私有写表
- 写成功后投影到共享只读表 `memory_read_model_v1`
- `retrieval-runtime` 和 `visualization` 只读共享读模型

### 2.6 写可以慢一点，但不能把查拖慢

问题：

- 写入链路天然更复杂
- 要做去重、合并、冲突判断、向量刷新

解决方案：

- `writeback-api` 只负责收任务
- 真正处理放到异步 worker
- 读模型刷新走异步投影
- 写失败不影响运行时查询

## 3. 这一层的设计结论

基于上面的问题，`storage` 层首版固定成下面这个结构：

- 一个同步接入面：接收写回候选
- 一个异步处理面：标准化、去重、冲突、入库
- 一个治理面：人工修正和审计
- 一个只读发布面：共享读模型

一句话说：

`storage` 不负责“什么时候查”，只负责“把可查的东西稳定沉淀出来”。

## 4. 核心数据对象

为了让后续代码实现不发散，这一层先固定 5 个对象。

### 4.1 `WriteBackCandidate`

这是上游提交给 `storage` 的最小输入单位。

必填字段：

- `workspace_id`
- `user_id`
- `candidate_type`
- `scope`
- `summary`
- `details`
- `source`
- `write_reason`

规则：

- `summary` 必须是可复用短句
- `details` 必须结构化
- 不接受完整聊天原文

### 4.2 `NormalizedMemory`

这是 `normalizer` 输出的标准内部对象。

新增字段：

- `memory_type`
- `importance`
- `confidence`
- `dedupe_key`
- `source_type`
- `source_ref`

### 4.3 `MergeDecision`

这是 `merge-engine` 输出的决策结果。

取值固定为：

- `insert_new`
- `update_existing`
- `merge_existing`
- `ignore_duplicate`
- `open_conflict`

### 4.4 `RecordSnapshot`

这是写入版本表时保存的完整快照。

要求：

- 任何正式记录变化，都必须生成快照
- 快照必须能单独回放

### 4.5 `ReadModelEntry`

这是发布给外部服务的只读对象。

要求：

- 不暴露私有治理字段
- 可直接用于运行时过滤、排序和展示

## 5. 内部模块到底怎么分工

现有模块名可以保留，但职责收得更死一点。

### 5.1 `writeback-api`

解决的问题：

- 上游写回不能直接阻塞复杂入库链路

具体做法：

- 校验请求结构
- 生成 `idempotency_key`
- 把原始候选写入 `memory_write_jobs`
- 返回 `accepted_async`

不做的事：

- 不做去重
- 不做合并
- 不做冲突判断

### 5.2 `job-worker`

解决的问题：

- 把同步接入和真正写入解耦

具体做法：

- 轮询或订阅 `memory_write_jobs`
- 把 `queued` 改成 `processing`
- 调后续模块
- 最终回写任务结果

### 5.3 `normalizer`

解决的问题：

- 上游写回候选格式不够统一

具体做法：

- 统一 `memory_type`
- 统一 `scope`
- 计算 `importance`
- 计算 `confidence`
- 生成 `dedupe_key`

输出：

- `NormalizedMemory`

### 5.4 `merge-engine`

解决的问题：

- 同一内容不能无限新增

具体做法：

- 查询 `memory_records`
- 按 `workspace_id + user_id + scope + dedupe_key` 找候选
- 根据类型做决策

规则固定如下：

- `fact_preference`
  同 key 且内容一致：忽略重复
  同 key 但内容有增强：更新现有记录
  同 key 但结论相反：交给冲突引擎

- `task_state`
  同任务同状态键：更新现有记录并把旧版本保存在版本表

- `episodic`
  时间窗口内高度相似：合并
  否则新增

### 5.5 `conflict-engine`

解决的问题：

- 新旧记录相互冲突时不能静默覆盖

具体做法：

- 生成 `memory_conflicts`
- 对涉及记录加冲突状态
- 返回 `open_conflict`

自动解决边界：

- 同一字段明显“新值覆盖旧值”且来源可信度更高，可以直接把旧记录标成 `superseded`
- 其他情况都进冲突表

### 5.6 `record-repository`

解决的问题：

- 正式记录、版本、治理动作必须一起落库，不能分散在业务代码里

具体做法：

- 负责操作：
  - `memory_records`
  - `memory_record_versions`
  - `memory_governance_actions`
- 所有正式写入都走事务

### 5.7 `read-model-projector`

解决的问题：

- 外部不能读私有写表，但又要拿到稳定结果

具体做法：

- 监听正式记录变化
- 根据记录状态刷新 `memory_read_model_v1`
- 刷新结果写 `memory_read_model_refresh_jobs`

### 5.8 `governance-engine`

解决的问题：

- 需要人工修正时，不能直接改主表而没有审计

具体做法：

- 编辑、归档、恢复版本、确认冲突都走治理接口
- 所有治理动作都写 `memory_governance_actions`
- 治理后重建只读模型

## 6. 正式记录状态机

`memory_records.status` 首版按下面状态流转。

- `active`
  当前有效，可被召回

- `superseded`
  被新版本覆盖，不再参与召回

- `archived`
  历史保留，不参与默认召回

- `pending_confirmation`
  进入冲突或需要确认，默认不参与自动召回

- `deleted`
  逻辑删除，只保留审计和版本

允许流转：

- `active -> superseded`
- `active -> archived`
- `active -> pending_confirmation`
- `pending_confirmation -> active`
- `pending_confirmation -> archived`
- `archived -> active`
- `* -> deleted`

不允许直接做的事：

- `deleted -> active`

如果要恢复，必须从版本恢复为新记录。

## 7. 写入任务状态机

`memory_write_jobs.job_status` 固定如下：

- `queued`
- `processing`
- `succeeded`
- `failed`
- `dead_letter`

流转规则：

- 接口接收成功后：`queued`
- worker 开始处理：`processing`
- 正式入库完成：`succeeded`
- 可重试错误：`failed`
- 超过重试次数：`dead_letter`

## 8. 一次写入到底怎么走

### 8.1 主链路

1. `retrieval-runtime` 调 `POST /v1/storage/write-back-candidates`
2. `writeback-api` 校验字段
3. 生成 `idempotency_key`
4. 在 `memory_write_jobs` 新增一条 `queued`
5. 返回 `job_id + accepted_async`
6. `job-worker` 取到任务并改成 `processing`
7. `normalizer` 生成 `NormalizedMemory`
8. `merge-engine` 查重并给出决策
9. 如果是冲突，`conflict-engine` 开冲突单
10. 如果是新增或更新，`record-repository` 写正式记录和版本
11. `read-model-projector` 刷新 `memory_read_model_v1`
12. `memory_write_jobs` 更新为 `succeeded`

### 8.2 这一条链路里每张表怎么协作

- `memory_write_jobs`
  保存“请求到了没有、处理到了哪一步”

- `memory_records`
  保存“现在生效的正式记录是什么”

- `memory_record_versions`
  保存“历史上变过什么”

- `memory_conflicts`
  保存“哪些内容不能自动决策”

- `memory_governance_actions`
  保存“谁改过、为什么改”

- `memory_read_model_v1`
  对外发布“现在可读、可查的正式结果”

- `memory_read_model_refresh_jobs`
  保存“投影是否刷新成功”

## 9. 去重和合并规则先定死

首版不做复杂机器学习判定，先走规则。

### 9.1 `fact_preference`

适合：

- 用户偏好
- 用户约束
- 稳定事实

去重键建议：

- `scope + normalized_subject + normalized_predicate`

处理规则：

- 完全一致：忽略
- 语义一致但描述更完整：更新
- 语义相反：冲突

### 9.2 `task_state`

适合：

- 当前任务目标
- 当前任务进度
- 当前任务阻塞点

去重键建议：

- `task_id + state_key`

处理规则：

- 同 `state_key` 只保留一个 `active`
- 更新时旧值进入版本表，新值覆盖主表

### 9.3 `episodic`

适合：

- 某次重要决策
- 某次重要失败
- 某次重要承诺

去重键建议：

- `scope + event_kind + time_bucket + semantic_hash`

处理规则：

- 时间窗口内相似事件合并
- 否则新增

## 10. 为什么要发布共享读模型

因为运行时查和页面展示都不需要看这么多内部细节。

共享读模型解决三个问题：

- 隐藏私有写表
- 给外部稳定字段
- 保证查和展示读到的是同一套正式结果

发布规则：

- 只发布 `active`、必要的 `archived` 预览
- 默认不发布 `deleted`
- `pending_confirmation` 是否发布由字段 `status` 明确表示，但运行时默认过滤掉

## 11. 接口怎么设计

### 11.1 写回接收接口

`POST /v1/storage/write-back-candidates`

解决的问题：

- 上游要有一个稳定的、幂等的写入口

行为约束：

- 接口成功只表示“收到”
- 不表示“已经正式入库”

返回固定字段：

- `job_id`
- `status=accepted_async`
- `received_at`

### 11.2 记录列表接口

`GET /v1/storage/records`

解决的问题：

- 治理页面要看正式记录，但不该直接查表

支持筛选：

- `workspace_id`
- `user_id`
- `memory_type`
- `scope`
- `status`
- `task_id`

### 11.3 冲突列表接口

`GET /v1/storage/conflicts`

解决的问题：

- 冲突不能只存在表里，治理侧必须能查

### 11.4 记录编辑接口

`PATCH /v1/storage/records/{recordId}`

解决的问题：

- 人工需要修正错误摘要、错误状态、错误详情

约束：

- 不允许直接改 `created_at`
- 不允许跳过版本记录

### 11.5 归档接口

`POST /v1/storage/records/{recordId}/archive`

解决的问题：

- 低价值或任务完成后的记录要退出默认召回

### 11.6 版本恢复接口

`POST /v1/storage/records/{recordId}/restore-version`

解决的问题：

- 人工修正错误时，需要回退到某个历史版本

### 11.7 指标接口

`GET /v1/storage/observe/metrics`

返回：

- 写入接收量
- 正式入库量
- 忽略重复率
- 合并率
- 冲突率
- 死信量
- 投影延迟

## 12. 失败和边界场景

### 12.1 上游重复提交

处理：

- 用 `idempotency_key` 或 `candidate_hash` 去重
- 返回已有 `job_id` 或复用已有处理结果

### 12.2 worker 中途崩溃

处理：

- `processing` 超时回收
- 重新置回 `queued` 或标 `failed`

### 12.3 向量生成失败

处理：

- 正式记录先入库
- `memory_read_model_refresh_jobs` 标记失败
- 记录仍可展示，但暂不参与向量排序

### 12.4 冲突过多

处理：

- 不阻塞其他正常写入
- 冲突记录独立进入治理池

### 12.5 storage 自己没启动

结果：

- 只影响写回成功率
- 不影响其他服务自身启动

## 13. 开发时先按这个顺序落地

1. `writeback-api`
2. `memory_write_jobs`
3. `job-worker`
4. `normalizer`
5. `merge-engine`
6. `record-repository`
7. `read-model-projector`
8. `governance-engine`
9. 观测接口

## 14. 最后一句话

`storage` 这一层的真正实现目标不是“多几张表”，而是把上游写回候选变成一套可治理、可追溯、可发布、可稳定查询的正式记忆系统。
