# visualization 实质缺口提示词

## 1. 这份提示词给谁

这份提示词给负责继续收口 `services/visualization` 的开发 agent。

当前这层已经不是"缺页面骨架"，也不是"只有空壳"。

现在的状态是：

- `Next.js` 工程可以启动
- `lint`、`typecheck`、`build`、`test` 已通过
- 目录页、运行轨迹页、指标看板页、健康接口都已经有实现
- 前一轮补齐验收已经修正了 runtime 观测适配、指标字段映射和健康状态分离

但它还没有通过"正式可接入、正式可联调、正式可验收"这一层要求。

原因不是页面功能缺失，而是还剩几处会直接影响真实联调和真实排查体验的实质缺口。

你的任务不是重写前端，而是把这些最后的硬缺口补齐。

## 2. 先读哪些文档

开始改代码前，先完整阅读下面这些内容，并以它们为准：

- `docs/architecture-independence.md`
- `docs/memory-module-contract.md`
- `docs/visualization/visualization-implementation-spec.md`
- `docs/visualization/visualization-remediation-agent-prompt.md`
- `services/visualization/README.md`

然后重点读当前实现：

- `services/visualization/src/lib/server/`
- `services/visualization/src/features/`
- `services/visualization/src/app/`
- `services/visualization/tests/`

联调口径必须同时核对：

- `services/storage/src/api/app.ts`
- `services/storage/src/contracts.ts`
- `services/retrieval-runtime/src/api/schemas.ts`

## 3. 当前还剩哪些实质缺口

### 3.1 运行轨迹页和 runtime 正式输出的聚合还不完整

当前 runtime 侧已经把运行轨迹拆成了五段独立记录：

- `turns`
- `trigger_runs`
- `recall_runs`
- `injection_runs`
- `writeback_submissions`

前一轮补齐验收虽然修正了适配层的字段映射，但轨迹页是否真正能把这五段按 `turn_id` 聚合成一条完整链路，还需要验证。

特别是：

- `trigger_runs` 是否能独立展示，而不是从 `recall_runs[0]` 取代
- 一轮没有触发时，是否正确显示"未触发"而不是空白
- 一轮有触发但查空时，是否正确区分"查空"和"没触发"

### 3.2 记忆目录页和 storage 共享读模型的正式字段还没有端到端验证

storage 共享读模型经过多轮修正，正式字段已经从 `details_preview_json` / `source_type` / `source_ref` 收敛为 `details` / `source`。

但当前 visualization 的目录页 client 和 DTO 是否已经完全对齐最新的共享读模型结构，还需要验证。

如果不对齐，页面上的来源和详情字段会显示为空或报错。

### 3.3 看板的趋势视图缺少时间粒度控制

前一轮补齐验收要求补趋势视图，但当前看板是否真正支持用户选择时间窗口（如最近 1 小时、最近 24 小时、最近 7 天）还不确定。

如果只有一个固定时间窗口，无法回答"最近是不是开始频繁查空"这类需要对比不同时段的排查问题。

### 3.4 数据源健康面板还缺"最近成功响应时间"

实施规格要求展示：

- 最近检查时间
- 最近成功响应时间
- 错误摘要

当前面板是否展示了"最近一次成功"的时间戳，还需要验证。这个字段对排查"是刚刚断的还是已经断了很久"非常关键。

## 4. 你的目标

这次开发目标只有一个：

把 `visualization` 从"页面功能基本补齐"补到"正式联调可用、正式排查可用、正式验收可通过"。

## 5. 你必须补齐的内容

### 5.1 端到端验证运行轨迹五段聚合

验证并修正运行轨迹页的五段展示，确保：

- `trigger` 段独立展示
- 五段按 `turn_id` 正确聚合
- 缺段时有明确标注

### 5.2 端到端验证记忆目录页字段映射

验证并修正目录页 DTO 和 storage 共享读模型最新字段的对齐。

### 5.3 补看板时间粒度控制

让看板趋势视图支持至少两个时间窗口选择，能对比不同时段的指标变化。

### 5.4 补健康面板的"最近成功时间"展示

确保面板能区分"刚刚断的"和"已经断了很久"。

### 5.5 补测试

至少覆盖：

- 五段轨迹聚合的边界场景
- 目录页字段映射和 storage 最新契约一致
- 看板时间窗口切换
- 健康面板完整字段展示

## 6. 这次开发不要做什么

- 不要重写整个 UI
- 不要改 storage 或 retrieval-runtime 的代码
- 不要扩展新的产品功能
- 不要只改 README 不改实现

## 7. 完成标准

### 7.1 轨迹页

- 五段独立展示且正确聚合
- 缺段时有明确标注

### 7.2 目录页

- 字段映射和 storage 最新共享读模型一致

### 7.3 看板

- 趋势视图支持时间窗口选择

### 7.4 健康面板

- 展示最近成功响应时间

### 7.5 测试

- 新增功能有对应测试
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm test`

都通过

## 8. 最后交付时你要说明什么

1. 五段轨迹聚合是怎么验证和修正的
2. 目录页字段映射最后对齐了什么
3. 看板时间窗口是怎么实现的
4. 健康面板补了哪些字段
5. 新增了哪些测试
6. 还有没有剩余风险
