# visualization 实施规格

## 1. 文档定位

这份文档只讲 `visualization` 这一层怎么真正落地。

它不再停留在“有记忆列表、有轨迹、有指标”这种页面清单层，而是直接回答：

- 这一层到底解决哪些排查问题
- 页面背后怎么聚合数据
- 每个接口要返回什么
- 上游挂了时页面怎么继续活
- 页面怎么把问题解释清楚

配套文档：

- `memory-observability-product.md`
- `visualization-service-design.md`

## 1.1 当前验收状态

基于当前仓库实现和现有校验，这一层已经不是“待落地设计”，而是“主页面和聚合主链路已完成，少数页面闭环和契约口径还待补齐”的状态。

当前已经确认的结果：

- 目录页、详情页、轨迹页、看板页、健康面板：`已完成`
- runtime 五段轨迹聚合、看板趋势计算、健康状态分离：`已完成`
- 详情页最小治理动作 `confirm / invalidate / archive / delete`：`已完成`
- `lint / typecheck / build / test`：`已完成`

当前还没有完全收口的点：

- 目录页双视图在 `memory_view_mode + scope` 组合筛选下还存在串视图和重复风险
- 页面级治理入口还没有覆盖 `edit / restore_version`
- API 错误响应还没有对齐统一错误契约
- 轨迹页 `Turn` 段还没有把文档承诺的部分原始字段展示完整

## 2. 这一层真正要解决的问题

`visualization` 首版固定解决 5 类问题。

### 2.1 记忆库里到底有什么，看不清

问题：

- 记忆不是聊天记录，用户和开发都需要看结构化结果
- 如果只能查数据库或日志，成本太高

解决方案：

- 做统一记忆目录页
- 直接展示正式读模型里的结构化记忆

### 2.2 一轮里为什么查了、为什么没查，看不清

问题：

- 出现错误回答时，首先要知道是不是召回出了问题

解决方案：

- 做运行轨迹页
- 让一轮里的触发、查询、注入、写回都能顺着看

### 2.3 系统慢在哪里，看不清

问题：

- 用户说“记忆不好用”，可能是：
  - 没触发
  - 查空了
  - 裁掉了
  - 写回失败了
  - 依赖挂了

解决方案：

- 做统一指标看板
- 做数据源状态面板

### 2.4 上游服务没启动时，页面不能一起死

问题：

- 这层本身是观测入口
- 如果上游挂了它也起不来，排查价值就没了

解决方案：

- `visualization` 自己保持可启动
- 对每个数据源做独立健康检查
- 页面分区显示缺失状态

### 2.5 页面不能直接绑死上游内部实现

问题：

- 如果页面直接读私有表，后面边界会越来越乱

解决方案：

- 只接：
  - `storage` 共享读模型
  - `storage` 观测接口
  - `retrieval-runtime` 观测接口

## 3. 这一层的设计结论

基于上面的问题，`visualization` 首版固定成三层结构：

1. 数据源适配层
2. 查询聚合层
3. 页面展示层

一句话说：

它不负责改数据，也不负责做决策，只负责把正式结果和运行过程解释出来。

## 4. 核心页面不是三个名词，而是三个问题视图

## 4.1 记忆目录页

它解决的问题不是“看条目”，而是：

- 当前系统沉淀了哪些正式记忆
- 这些记忆是不是状态正确
- 某条记忆为什么现在还能被召回

### 页面必须展示的字段

- `id`
- `memory_type`
- `scope`
- `scope_explanation`
- `status`
- `summary`
- `importance`
- `confidence`
- `source_type`
- `source_ref`
- `origin_workspace_id`
- `last_confirmed_at`
- `updated_at`

### 页面必须支持的筛选

- 按当前目录视图模式（`workspace_only` / `workspace_plus_global`）
- 按当前工作区上下文
- 按当前用户上下文
- 按 `memory_type`
- 按 `scope`
- 按 `status`
- 按更新时间范围

### 页面必须能回答的问题

- 为什么这条记忆还在 `active`
- 为什么这条记忆是 `pending_confirmation`
- 为什么这条任务状态没有被归档
- 这条全局记忆是从哪个工作区沉淀来的
- 为什么它会在当前工作区视图里出现

## 4.2 运行轨迹页

它解决的问题不是“看日志”，而是：

- 这一轮为什么触发了召回
- 查了哪些记忆
- 为什么最后只注入了这些
- 为什么写回了，或者为什么没写回

### 页面按什么作为主键

主入口固定按：

- `turn_id`

正式筛选：

- `session_id`
- `trace_id`
- `page`
- `page_size`

### 页面结构固定五段

#### 第一段：Turn

展示：

- `turn_id`
- `session_id`
- `phase`
- `host`
- 当前输入摘要

#### 第二段：Trigger

展示：

- `phase`
- `trigger_type`
- `trigger_hit`
- `trigger_reason`
- `memory_mode`
- 请求 scope

#### 第三段：Recall

展示：

- 请求类型
- 查询范围
- 候选数
- 命中数
- 各 scope 命中数
- 选中的 `record_ids`
- 查询耗时
- 是否降级

#### 第四段：Injection

展示：

- 最终 `memory_summary`
- 实际注入记录
- 最终保留的 scope
- 被裁掉记录
- 裁剪原因
- token 预算估算

#### 第五段：WriteBack

展示：

- 是否生成写回候选
- 候选数量
- 每条候选最终 scope
- `storage_job_id`
- 提交状态
- 错误信息

### 页面必须能回答的问题

- 这轮是不是没触发
- 这轮是不是查空了
- 这轮是不是查到了但被裁了
- 这轮是不是写回失败了
- 这轮当前是不是 `workspace_only`
- 这轮为什么用了全局记忆，或者为什么没用全局记忆

## 4.3 指标看板页

它解决的问题不是“看图表”，而是：

- 当前系统是策略问题、数据问题，还是依赖问题

### 首版必须展示的指标

#### retrieval-runtime 侧

- 触发率
- 召回命中率
- 空检索率
- 实际注入率
- 注入裁剪率
- 查询 P95
- 注入 P95
- 写回提交率

#### storage 侧

- 写入接收量
- 写入成功量
- 重复忽略率
- 合并率
- 冲突率
- 死信任务量
- 读模型刷新失败率

### 看板必须能回答的问题

- 是不是最近开始频繁查空
- 是不是最近冲突率突然升高
- 是不是最近写回任务积压
- 是不是查询变慢但存储没问题

## 4.4 数据源状态面板

它解决的问题：

- 到底是系统策略差，还是上游没活着

必须展示：

- `storage` 健康状态
- `retrieval-runtime` 健康状态
- 最近检查时间
- 错误摘要
- 最近成功响应时间

## 5. 内部模块到底怎么分工

### 5.1 `datasource-adapter`

解决的问题：

- 上游两个服务的返回格式不同，页面不应该直接知道它们各自细节

具体做法：

- 一个 adapter（适配器）接 `storage`
- 一个 adapter 接 `retrieval-runtime`
- 统一输出内部 DTO（数据传输对象）

### 5.2 `query-aggregator`

解决的问题：

- 一个页面经常要同时读多个来源

具体做法：

- 统一解析查询参数
- 统一分页、排序、时间范围
- 组合多个数据源结果

### 5.3 `memory-catalog-service`

解决的问题：

- 记忆目录页不能直接读共享表然后把原样数据扔给前端

具体做法：

- 读取 `memory_read_model_v1`
- 统一转换成页面字段
- 补状态解释字段

当前实现边界：

- 默认 `workspace_only` 和 `workspace_plus_global` 两种视图已经成立
- 但当目录页同时带 `memory_view_mode` 和显式 `scope` 时，当前聚合还没有完全收住
- 特别是 `workspace_plus_global + scope=user` 可能出现重复，全局视图和工作区视图的边界也可能被错误打穿

### 5.4 `run-trace-service`

解决的问题：

- 运行轨迹跨多个 runtime 表，前端不应该自己拼

具体做法：

- 用 `turn_id` 聚合：
  - `runtime_turns`
  - `runtime_trigger_runs`
  - `runtime_recall_runs`
  - `runtime_injection_runs`
  - `runtime_writeback_submissions`

当前实现边界：

- 五段聚合和叙事解释已经成立
- 但页面当前更偏“解释型展示”，还没有把 `Turn` 段承诺的所有原始字段完整展开

### 5.5 `dashboard-service`

解决的问题：

- 指标来源分散，页面不应该自己算

具体做法：

- 拉取两个服务的指标接口
- 做统一时间窗聚合
- 输出单一 dashboard DTO

### 5.6 `source-health-service`

解决的问题：

- 页面要明确显示上游状态，而不是把所有错误都混成“页面失败”

具体做法：

- 定时探活
- 保存最近一次成功和失败快照
- 输出统一健康状态

## 6. 数据源到底怎么接

## 6.1 从 storage 读什么

固定只接下面三类：

- `memory_read_model_v1`
- `GET /v1/storage/observe/metrics`
- `GET /v1/storage/observe/write-jobs`

不做的事：

- 不读 `storage_private`
- 不直接读版本表
- 不直接读冲突私有表，除非后续 `storage` 暴露正式接口

## 6.2 从 retrieval-runtime 读什么

固定只接下面两类：

- `GET /v1/runtime/observe/runs`
- `GET /v1/runtime/observe/metrics`

如果需要看单轮详情，优先要求它扩单条查询接口，而不是页面自己去摸私有表。

## 7. 自己的接口怎么落

如果 `visualization` 做前后端分离，后端先固定下面四个接口。

### 7.1 记忆目录接口

`GET /api/memories`

返回字段：

- `items[]`
- `total`
- `page`
- `page_size`
- `source_status`

每个 item 至少包含：

- `id`
- `memory_type`
- `scope`
- `scope_explanation`
- `status`
- `summary`
- `importance`
- `confidence`
- `origin_workspace_id`
- `updated_at`
- `status_explanation`

当前实现说明：

- 接口和页面已经可用
- 但如果请求里同时带 `memory_view_mode` 和显式 `scope`，当前聚合结果还不能算完全可靠

### 7.2 运行轨迹接口

`GET /api/runs`

支持：

- 列表查询
- 按 `turn_id` 查单轮详情

返回字段：

- `turn`
- `trigger_runs[]`
- `recall_runs[]`
- `injection_runs[]`
- `writeback_runs[]`
- `dependency_status`

当前实现说明：

- 五段数据已经能返回
- 但页面最终展示还没有把 `Turn` 段的全部承诺字段完整露出

### 7.3 看板接口

`GET /api/dashboard`

返回字段：

- `retrieval_metrics`
- `storage_metrics`
- `trend_window`
- `source_status`

### 7.4 数据源状态接口

`GET /api/sources/health`

返回字段：

- `storage.status`
- `storage.last_ok_at`
- `storage.last_error`
- `runtime.status`
- `runtime.last_ok_at`
- `runtime.last_error`

当前实现说明：

- 本服务 `liveness / readiness` 与外部 `dependencies` 已经分开
- 页面也已经能显示最近成功时间，不再只是显示当前检查结果

## 8. 页面加载流程怎么定

### 8.1 记忆目录页

1. 前端调 `/api/memories`
2. 后端调 `memory-catalog-service`
3. service 读共享读模型
4. 整理字段并返回

### 8.2 运行轨迹页

1. 前端按 `turn_id` 调 `/api/runs`
2. 后端调 `run-trace-service`
3. service 聚合 runtime 五段记录
4. 返回一条完整轨迹

### 8.3 看板页

1. 前端调 `/api/dashboard`
2. 后端并发调两个上游指标接口
3. 聚合后返回

## 9. 页面怎么解释问题

首版页面不是只把原始值扔出来，还要补最小解释层。

### 9.1 对记忆状态给解释

例如：

- `active`
  当前可被召回

- `pending_confirmation`
  存在冲突或待确认，默认不参与自动召回

- `archived`
  历史保留，不参与默认召回

### 9.2 对运行结果给解释

例如：

- `no_trigger`
  当前轮未命中触发条件

- `empty_recall`
  已触发，但没有找到符合条件的记忆

- `injection_trimmed`
  查到候选，但因预算限制被裁剪

- `writeback_rejected`
  当前轮抽到了候选，但不满足沉淀条件

## 10. 无上游时怎么活

这是首版硬约束。

### 10.1 `storage` 没启动

页面行为：

- 页面服务正常启动
- 记忆目录页显示“数据源不可用”
- 看板里 `storage` 部分显示缺失

### 10.2 `retrieval-runtime` 没启动

页面行为：

- 页面服务正常启动
- 运行轨迹页显示“数据源不可用”
- 看板里 runtime 部分显示缺失

### 10.3 两个都没启动

页面行为：

- 页面仍然能打开
- 只显示空壳、状态面板和错误说明

### 10.4 页面自己的缓存策略

首版可以不落业务表，但允许做内存级短缓存：

- 指标缓存 15 到 30 秒
- 健康状态缓存 5 到 10 秒

目的：

- 降低上游压力
- 页面体验更稳

## 11. 边界场景

### 11.1 轨迹数据不完整

比如：

- 有 `turn`
- 没有 `injection`

处理：

- 页面明确标“链路不完整”
- 不要假装这轮没有注入

### 11.2 同一轮有多次召回

处理：

- 按时间顺序展示多条 `recall_run`
- 明确标记哪一次生成了最终注入

### 11.3 上游接口超时

处理：

- adapter 返回 `source_timeout`
- 页面显示数据源超时，不显示空数据

## 12. 首版开发顺序

1. `source-health-service`
2. `datasource-adapter`
3. `memory-catalog-service`
4. `run-trace-service`
5. `dashboard-service`
6. `/api/*` 接口
7. 三个页面
8. 异常态和空态

## 13. 最后一句话

`visualization` 这一层真正要落地的，不是“做几个页面”，而是给整个记忆系统提供一个独立、可解释、上游故障时依然可用的统一观察入口。
