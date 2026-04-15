# visualization 服务设计文档

## 1. 文档目标

这份文档只讲 `visualization` 服务怎么落地。

重点回答：

- 这个服务到底要展示什么
- 每个页面解决什么问题
- 需要从另外两个服务拿什么数据
- 它自己要暴露什么接口
- 页面在上游不可用时怎么处理

## 2. 这个服务要解决什么问题

`visualization` 要解决下面这些问题：

- 记忆库里有什么，看不清
- 这一轮为什么查了、为什么注入了、为什么写回了，看不清
- 系统是查询慢、写入慢还是策略错了，看不清
- 哪个数据源挂了，看不清

一句话说：

它负责把“记忆内容”和“运行过程”清楚展示出来。

## 3. 服务职责

`visualization` 首版职责固定如下：

- 展示结构化记忆列表
- 展示运行轨迹
- 展示核心指标
- 展示数据源状态
- 提供统一筛选和查看能力

## 4. 服务边界

`visualization` 不负责：

- 改写记忆
- 控制召回逻辑
- 控制 agent 推理
- 直接依赖其他服务私有实现

它是独立服务。

## 5. 内部模块设计

首版代码层建议拆成下面 6 个模块：

### 5.1 `datasource-adapter`

职责：

- 连接 `storage` 和 `retrieval-runtime`
- 读取共享读模型
- 调用观测接口

### 5.2 `query-aggregator`

职责：

- 整理页面查询参数
- 统一数据格式
- 聚合多个来源的数据

### 5.3 `memory-catalog-page`

职责：

- 渲染记忆库页面
- 支持筛选类型、范围、状态

### 5.4 `run-trace-page`

职责：

- 渲染单轮运行轨迹
- 把触发、查询、注入、写回按顺序展示

### 5.5 `metrics-dashboard-page`

职责：

- 渲染系统指标看板
- 展示趋势和关键耗时

### 5.6 `source-health-panel`

职责：

- 展示 `storage` 和 `retrieval-runtime` 是否可用
- 把“数据源不可用”和“页面服务不可用”区分开

## 6. 页面要做什么

### 6.1 记忆库页面

要解决的问题：

- 当前有哪些正式记忆
- 它们是什么类型
- 它们是什么状态
- 它们来自哪里

页面展示字段：

- `id`
- `memory_type`
- `scope`
- `status`
- `summary`
- `importance`
- `confidence`
- `source_type`
- `source_ref`
- `updated_at`

数据来源：

- `storage` 发布的共享读模型

### 6.2 运行轨迹页面

要解决的问题：

- 本轮为什么触发
- 触发后查了什么
- 最后注入了什么
- 为什么写回或没写回

页面展示字段：

- `turn_id`
- `trigger_type`
- `requested_types`
- `selected_record_ids`
- `injected_summary`
- `write_back_candidates`
- `storage_job_id`
- `degraded`
- `dependency_status`
- `latency_ms`

数据来源：

- `retrieval-runtime` 的运行轨迹接口

### 6.3 指标看板页面

要解决的问题：

- 查询链路慢不慢
- 写入链路稳不稳
- 召回是不是噪声太大
- 当前有没有数据源异常

页面展示指标：

- 查询耗时
- 写入耗时
- 空检索率
- 噪声检索率
- 召回命中率
- 实际注入率
- 写回接受率
- 合并率
- 重复记录率
- 冲突率

数据来源：

- `storage` 指标接口
- `retrieval-runtime` 指标接口

### 6.4 数据源状态面板

要解决的问题：

- 是页面自己挂了，还是上游服务挂了

页面展示：

- `storage` 状态
- `retrieval-runtime` 状态
- 最近检查时间
- 错误摘要

## 7. 需要从另外两个服务拿什么

### 7.1 从 storage 拿什么

`visualization` 首版固定拿下面两类：

- 共享读模型
- 存储观测接口

具体来源：

- `storage_shared_v1.memory_read_model_v1`
- `GET /v1/storage/observe/metrics`
- `GET /v1/storage/observe/write-jobs`

### 7.2 从 retrieval-runtime 拿什么

`visualization` 首版固定拿下面两类：

- 运行轨迹
- 运行时指标

具体来源：

- `GET /v1/runtime/observe/runs`
- `GET /v1/runtime/observe/metrics`

## 8. 自己要暴露什么接口

如果 `visualization` 采用前后端分离，建议它自己的后端提供下面这些接口给前端页面用。

### 8.1 记忆列表接口

`GET /api/memories`

作用：

- 返回记忆库页面需要的数据

### 8.2 运行轨迹接口

`GET /api/runs`

作用：

- 返回运行轨迹页面数据

### 8.3 指标接口

`GET /api/dashboard`

作用：

- 返回看板指标

### 8.4 数据源状态接口

`GET /api/sources/health`

作用：

- 返回各上游数据源状态

## 9. 这些功能怎么被使用

- 运营或开发人员打开记忆库页面
  查看正式记忆和状态

- 排查某一轮为什么回答带了某段旧信息
  打开运行轨迹页面

- 判断系统整体是不是退化了
  打开指标看板

- 判断是页面自己问题还是数据源问题
  看数据源状态面板

## 10. 约束条件

首版强约束：

- 不允许直接读取 `storage` 私有写表
- 不允许直接读取 `retrieval-runtime` 私有运行内存
- 不允许直接改记忆
- 不允许调用 agent 主链路控制接口
- 不允许因为上游未启动就让页面服务自己不可运行

## 11. 数据源不可用时怎么处理

### 11.1 `storage` 不可用

- 页面服务自己继续运行
- 记忆库页面显示“数据源不可用”
- 看板里对应的存储指标显示缺失状态

### 11.2 `retrieval-runtime` 不可用

- 页面服务自己继续运行
- 运行轨迹页面显示“数据源不可用”
- 看板里对应运行时指标显示缺失状态

### 11.3 两者都不可用

- 页面仍然能打开
- 数据区显示不可用
- 数据源状态面板明确标红

## 12. 首批落地任务

1. 实现 `datasource-adapter`
2. 接共享读模型
3. 接 `storage` 指标接口
4. 接 `retrieval-runtime` 运行轨迹接口
5. 接 `retrieval-runtime` 指标接口
6. 实现记忆库页面
7. 实现运行轨迹页面
8. 实现指标看板页面
9. 实现数据源状态面板
10. 实现无数据源时的空态和错误态

## 13. 一句话方案

`visualization` 服务的落地方案是：

用共享读模型和观测接口做一个独立页面服务，把正式记忆、运行轨迹、关键指标和数据源状态统一展示出来。
