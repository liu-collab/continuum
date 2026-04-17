# storage 服务设计文档

## 1. 文档目标

这份文档只讲 `storage` 服务怎么落地。

重点回答：

- 这个服务要做什么
- 解决什么问题
- 内部模块怎么拆
- 对外暴露什么接口
- 这些能力在哪些地方被使用
- 它和 `retrieval-runtime`、`visualization` 怎么协作

## 1.1 当前验收状态

当前代码已经把 `storage` 的主服务能力大部分落地，不再停留在设计阶段。

已经落地：

- 写回接收、异步处理、标准化、去重、冲突判断、正式入库、读模型投影
- `confirm / invalidate / delete / edit / archive / restore_version` 治理动作
- `scope=user` 的跨工作区共享语义和 `scope=workspace` 的工作区边界
- 共享读模型的主要对外字段和 embedding 降级处理
- `GET /v1/storage/records` 已按正式分页契约返回 `items / total / page / page_size`
- `POST /v1/storage/write-back-candidates` 已统一返回 `jobs`，同时保留 `submitted_jobs` 兼容字段
- 冲突治理已经收成双边闭环：新候选和旧记录都会落成可治理对象

表结构细节单独见：

- `database-schema-design.md`

## 2. 这个服务要解决什么问题

`storage` 负责解决下面这些问题：

- 哪些内容能进记忆库
- 记忆入库后如何标准化
- 同一事实重复出现时如何去重
- 冲突信息如何标记和治理
- 运行时查询要读取什么稳定数据
- 可视化页面要展示什么正式数据

一句话说：

它负责把记忆“写好、管好、发出来”。

## 3. 服务职责

`storage` 首版职责固定如下：

- 接收写回候选
- 做标准化和打分
- 做去重、合并、冲突判断
- 管理记忆状态和生命周期
- 维护正式记忆主表
- 发布共享只读读模型
- 对外提供治理接口
- 输出存储侧观测数据

## 4. 服务边界

`storage` 的职责边界和不负责事项见 `memory-storage-product.md` 第 6 节。

概括来说：它是独立服务，但允许发布共享只读数据库读模型。不负责运行时召回判断、注入策略和页面渲染。

## 5. 内部模块设计

首版代码层建议拆成下面 7 个模块：

### 5.1 `writeback-api`

职责：

- 接收来自 `retrieval-runtime` 的写回候选
- 做最基本的结构校验
- 生成异步写入任务
- 快速返回接收结果

应用位置：

- agent 一轮响应结束后，由 `retrieval-runtime` 调用

### 5.2 `normalizer`

职责：

- 把候选转换成标准记忆记录格式
- 计算默认 `importance`（重要度）和 `confidence`（可信度）
- 生成 `dedupe_key`

应用位置：

- 异步写入 worker 内部

### 5.3 `merge-engine`

职责：

- 查找同类已有记录
- 判断是新增、覆盖还是合并
- 生成版本变更

应用位置：

- 正式写库前

### 5.4 `conflict-engine`

职责：

- 检测事实冲突、偏好冲突、作用范围冲突
- 无法自动解决时生成冲突记录
- 把目标记录标成 `pending_confirmation`（待确认）

应用位置：

- 合并阶段内

### 5.5 `governance-engine`

职责：

- 确认
- 编辑
- 失效
- 归档
- 删除
- 恢复版本
- 解决冲突

应用位置：

- 运营治理
- 错误记忆修正

### 5.6 `read-model-projector`

职责：

- 根据正式记忆主表刷新共享只读模型
- 控制共享读模型字段和版本
- 保证外部读取不依赖私有写表

应用位置：

- 每次写入成功后
- 治理动作完成后

### 5.7 `storage-observer`

职责：

- 统计写入量、接受率、合并率、重复率、冲突率
- 输出写入任务状态
- 提供给 `visualization`

应用位置：

- 指标页面
- 运行排查

## 6. 核心流程设计

### 6.1 写回候选入库流程

1. `retrieval-runtime` 调用写回接口
2. `writeback-api` 校验结构
3. 生成 `memory_write_jobs`
4. 返回 `accepted_async`（已异步接收）
5. worker 拉取任务
6. `normalizer` 做标准化
7. `merge-engine` 做去重或合并
8. `conflict-engine` 处理冲突
9. 写入 `memory_records`
10. 记录 `memory_record_versions`
11. `read-model-projector` 刷新 `memory_read_model_v1`
12. `storage-observer` 更新指标

### 6.2 治理流程

1. 运营或系统发起治理动作
2. `governance-engine` 修改正式记录
3. 记录审计日志
4. 刷新共享读模型
5. 输出治理事件给观测层

### 6.3 读模型发布流程

1. 正式记录发生变化
2. `read-model-projector` 重新生成或增量更新 `memory_read_model_v1`
3. 外部服务读取更新后的只读数据

## 7. 具体要存什么

`storage` 内部至少要维护下面这些正式数据：

- 正式记忆记录
- 记忆历史版本
- 异步写入任务
- 冲突记录
- 治理动作审计日志
- 共享只读读模型

具体字段见：

- `storage/database-schema-design.md`

## 8. 对外接口设计

接口完整定义见 `docs/api-contract.md` 第 1 节。以下仅列出接口清单和用途。

### 8.1 写回候选接收接口

`POST /v1/storage/write-back-candidates`

作用：

- 接收来自 `retrieval-runtime` 的写回候选

请求体关键字段：

- `workspace_id`
- `user_id`
- `task_id`
- `session_id`
- `candidate_type`
- `scope`
- `summary`
- `details`
- `importance`
- `confidence`
- `write_reason`
- `source`

返回体关键字段：

- `jobs`
- `submitted_jobs`（兼容字段）

### 8.2 记录查询接口

`GET /v1/storage/records`

作用：

- 给治理侧或后续运营工具查看正式记录

说明：

- 这不是运行时查询接口
- 运行时查询默认走共享读模型
- 当前正式分页返回 `items / total / page / page_size`

### 8.3 记录编辑接口

`PATCH /v1/storage/records/{recordId}`

作用：

- 修正文案、状态、作用范围或结构化详情

### 8.4 记录归档接口

`POST /v1/storage/records/{recordId}/archive`

作用：

- 把不再活跃的记录归档

### 8.5 记录确认接口

`POST /v1/storage/records/{recordId}/confirm`

作用：

- 把待确认或已治理记录重新确认为可召回状态

### 8.6 记录失效接口

`POST /v1/storage/records/{recordId}/invalidate`

作用：

- 把错误或过期记录退出默认召回，并保留治理审计

### 8.7 记录删除接口

`POST /v1/storage/records/{recordId}/delete`

作用：

- 把记录转成逻辑删除，并从共享读模型移除

### 8.8 冲突解决接口

`POST /v1/storage/conflicts/{conflictId}/resolve`

作用：

- 手动解决冲突记忆

### 8.9 存储指标接口

`GET /v1/storage/observe/metrics`

作用：

- 输出写入量、接受率、合并率、冲突率、耗时

### 8.10 写入任务接口

`GET /v1/storage/observe/write-jobs`

作用：

- 输出最近写入任务及其状态

## 9. 这些接口在哪里应用

- `POST /v1/storage/write-back-candidates`
  用在 `retrieval-runtime` 回合结束后的写回提交

- `POST /v1/storage/records/{recordId}/confirm`
  用在治理侧确认记录重新生效

- `POST /v1/storage/records/{recordId}/invalidate`
  用在治理侧标记错误或失效记录

- `POST /v1/storage/records/{recordId}/delete`
  用在治理侧做逻辑删除和读模型移除

- `GET /v1/storage/observe/metrics`
  用在 `visualization` 的指标看板

- `GET /v1/storage/observe/write-jobs`
  用在 `visualization` 的问题排查视图

- 治理接口
  用在后续运营或人工修正流程

## 10. 共享读模型怎么用

共享读模型由 `storage` 发布，给两个地方用：

- `retrieval-runtime`
  用它做运行时查询

- `visualization`
  用它展示记忆列表、状态、来源、更新时间

使用规则：

- 只能读
- 不能写
- 不能跳过版本管理
- 不能把它当 `storage` 私有表直接扩展

## 11. 约束条件

首版强约束：

- 不允许把完整聊天原文直接入正式记忆表
- 不允许 `retrieval-runtime` 直接写数据库
- 不允许 `visualization` 直接改记忆
- 不允许共享私有写表
- 不允许依赖其他服务启动后 `storage` 才能运行
- 写入处理可以慢，但不能把库写乱

## 12. 服务未启动时的要求

如果 `storage` 自己未启动：

- 不影响 `retrieval-runtime` 进程本身启动
- 不影响 `visualization` 进程本身启动
- 它们只会拿到显式的依赖不可用状态

## 13. 当前阶段状态

已完成：

1. 正式记忆主表、版本表、写入任务表、冲突表、治理审计表、共享读模型表
2. 写回候选接收接口、异步 worker、标准化、去重、合并、冲突处理、读模型刷新
3. 存储观测接口和主要治理接口

当前阶段和实现已对齐：

1. 记录列表接口已经按正式分页契约返回
2. 写回接收接口已经统一正式返回口径，并保留兼容字段
3. 冲突治理已经具备“新旧双方都可对比”的完整治理结构

## 14. 一句话方案

`storage` 服务的落地方案是：

把写回候选异步转成正式记忆记录，持续治理这些记录，并对外发布稳定的共享只读读模型和观测接口。
