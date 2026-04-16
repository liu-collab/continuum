# visualization 补齐验收提示词

## 1. 这份提示词给谁

这份提示词给负责继续完善 `services/visualization` 的开发 agent。

当前这层已经不是空目录，也不是只有页面骨架。

现在的状态是：

- `Next.js` 工程可以启动
- `lint`、`typecheck`、`build`、`test` 已通过
- 目录页、运行轨迹页、指标看板页、健康接口都已经有实现

但它还不能按现有文档通过正式验收。

你的任务不是重写整个前端，而是把现在这层补到可以按当前文档通过验收的状态。

## 2. 先读哪些文档

开始改代码前，先完整阅读下面这些内容，并以它们为准：

- `docs/architecture-independence.md`
- `docs/memory-module-contract.md`
- `docs/visualization/visualization-implementation-spec.md`
- `docs/visualization/visualization-development-agent-prompt.md`
- `services/visualization/README.md`

然后再读当前实现：

- `services/visualization/src/app/`
- `services/visualization/src/features/`
- `services/visualization/src/lib/server/`
- `services/visualization/src/components/`
- `services/visualization/tests/`

## 3. 当前为什么还不能通过验收

当前实现已经能跑，但下面这些问题还没有补齐。

### 3.1 `retrieval-runtime` 真实返回结构和当前页面适配层没有完全对上

现在 `visualization` 的 `runtime-observe-client` 仍然按“嵌套 detail 对象”或 `items[]` 列表去解析运行轨迹。

但当前 `retrieval-runtime` 的正式观测输出已经是：

- `turns`
- `trigger_runs`
- `recall_runs`
- `injection_runs`
- `writeback_submissions`
- `dependency_status`

也就是说，当前 `visualization` 还没有真正按上游正式契约把这些分段结果重新聚合成运行轨迹页需要的对象。

### 3.2 运行轨迹页还没有真正消费独立的 `trigger` 记录

当前页面里 `Trigger` 区块主要还是从 `recallRuns[0]` 取 `triggerType` 和 `triggerReason`。

但当前 runtime 侧已经把 `trigger` 单独建模了。

这意味着页面还没有真正把：

- `turn`
- `trigger`
- `recall`
- `injection`
- `writeback`

这五段正式串起来。

### 3.3 指标看板对 runtime 指标的字段映射不完整

当前 runtime 指标适配里仍然在找 `actual_injection_rate`，但正式输出字段已经是 `injection_rate`。

这会导致部分指标在页面上一直显示为空或不准。

### 3.4 健康状态实现还没有完全符合“健康状态分离”约束

当前 `source-health` 会在外部依赖异常时把本服务 `readiness` 直接降成 `degraded`。

但架构约束里已经明确：

- 只要本服务还能接收请求并返回明确结果，`readiness` 就保持可用
- 外部依赖状态应该单独显示在 `dependencies`

所以这一层的健康状态语义还要收紧。

### 3.5 页面上还没有把本服务 `liveness` / `readiness` 和外部 `dependencies` 分开展示

虽然已经有：

- `/api/health/liveness`
- `/api/health/readiness`
- `/api/sources/health`

但页面级健康面板目前主要展示的是数据源依赖状态，还没有把：

- 本服务自己的 `liveness`
- 本服务自己的 `readiness`
- 外部 `dependencies`

明确分开展示。

### 3.6 看板还不够支撑“最近出了什么问题”的排查

当前看板主要是指标卡片和诊断摘要。

但实施规格要求页面能回答：

- 是不是最近开始频繁查空
- 是不是最近冲突率突然升高
- 是不是最近写回任务积压
- 是不是查询变慢但存储没问题

现在没有真正的趋势视图或时间维度展示，这部分还不够。

### 3.7 测试还没有覆盖正式上游契约

当前测试主要覆盖：

- 查询参数解析
- 空态说明
- narrative 解释逻辑
- 诊断逻辑

但没有覆盖：

- runtime 正式观测契约解析
- 健康状态分离规则
- 本服务健康面板展示
- 趋势数据聚合
- 上游真实字段变化时的适配稳定性

## 4. 你的目标

这次开发目标只有一个：

把 `visualization` 从“页面可运行”补到“可以按当前文档通过验收”。

## 5. 你必须补齐的内容

### 5.1 把 runtime 观测适配层改成正式契约驱动

你要基于当前 `retrieval-runtime` 的正式输出结构重写或补齐适配层。

至少要支持：

- `turns`
- `trigger_runs`
- `recall_runs`
- `injection_runs`
- `writeback_submissions`

并把它们聚合成运行轨迹页真正要消费的 DTO。

要求：

- 页面不直接知道上游原始结构细节
- 聚合逻辑留在适配层或 service 层
- `turn_id` 仍然是主入口

### 5.2 让运行轨迹页真正展示五段结构

你要把运行轨迹页补到真正按下面五段组织：

- `turn`
- `trigger`
- `recall`
- `injection`
- `writeback`

要求：

- 不能再把 `trigger` 混在 `recall` 里假装存在
- 要能解释“没触发”“查空了”“查到了但没注入”“写回失败”

### 5.3 修正 runtime 指标字段映射

你要补齐并校正 runtime 指标字段映射。

要求：

- 正式字段名优先
- 兼容旧字段名可以保留，但不能以旧字段作为唯一来源
- 页面展示出来的指标要和当前 `retrieval-runtime` 输出一致

### 5.4 把健康状态分离做对

你要让这层健康语义符合架构约束。

要求：

- `liveness` 只反映本服务进程是否正常
- `readiness` 只反映本服务是否还能接收请求并返回正常或降级结果
- 上游异常必须单独显示在 `dependencies`
- 不能因为上游挂了，就把本服务 `readiness` 直接等价成依赖失败

### 5.5 把健康状态面板补完整

页面上需要单独展示：

- 本服务 `liveness`
- 本服务 `readiness`
- 外部 `dependencies`

要求：

- 页面结构一眼能分清“是我自己挂了”还是“上游挂了”
- 不要只展示依赖列表

### 5.6 补趋势视图或时间维度展示

你要把看板补到能回答“最近发生了什么变化”。

可以用：

- 趋势图
- 时间窗对比
- 序列指标卡

但结果上必须能支持这些问题：

- 最近是否开始频繁查空
- 最近是否写回任务积压
- 最近是否冲突率突然升高
- 最近是否 runtime 慢但 storage 正常

### 5.7 补测试

你要为上面新增的内容补测试。

至少覆盖：

- runtime 正式观测结构解析
- 五段轨迹聚合
- 健康状态分离
- 本服务健康面板 DTO
- 趋势数据或时间窗口聚合

## 6. 这次开发不要做什么

这次不要偏题。

不要把精力花在下面这些方向：

- 不要改写 `storage` 或 `retrieval-runtime`
- 不要把上游内部实现直接引用进来
- 不要重做整套 UI 风格
- 不要顺手扩展新的产品能力
- 不要用“只要能显示就行”的方式绕开正式契约适配

## 7. 完成标准

完成后，至少要满足下面这些条件：

### 7.1 页面层

- 记忆目录页可用
- 运行轨迹页可用
- 指标看板页可用
- 健康状态面板可用

### 7.2 契约层

- runtime 观测适配已对齐当前正式输出结构
- storage 读模型和观测接口适配保持独立
- 页面不依赖上游私有实现

### 7.3 解释层

- 运行轨迹页能真正解释五段流程
- 看板能回答“最近出了什么问题”
- 健康面板能区分本服务和依赖状态

### 7.4 容错层

- 单个数据源失败时只影响对应区域
- 本服务仍可启动并提供降级页面
- 页面明确显示“数据源不可用”而不是空白

### 7.5 测试层

- 新增功能有对应测试
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm test`

都通过

## 8. 最后交付时你要说明什么

完成后，请明确汇报下面这些内容：

1. 哪些验收缺口已经补齐
2. runtime 正式契约适配放在哪里
3. 健康状态分离是怎么实现的
4. 趋势视图或时间窗对比是怎么做的
5. 新增了哪些测试
6. 还有没有剩余风险
