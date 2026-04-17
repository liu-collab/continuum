# visualization 当前阶段开发提示词

## 1. 这份提示词给谁

这份提示词给负责继续推进 `services/visualization` 的开发 agent。

你的任务不是只做页面壳子，而是把“全局记忆 / 工作区记忆查看 + 运行轨迹解释 + 治理入口 + 指标排查”这一层补成当前首版可以直接使用的独立平台。

## 2. 先读哪些文档

开始改代码前，先完整阅读下面这些文档，并以它们为准：

- `docs/current-phase-closure-plan.md`
- `docs/api-contract.md`
- `docs/architecture-independence.md`
- `docs/memory-module-contract.md`
- `docs/visualization/memory-observability-product.md`
- `docs/visualization/visualization-service-design.md`
- `docs/visualization/visualization-implementation-spec.md`
- `services/visualization/README.md`

然后再读当前实现：

- `services/visualization/src/lib/contracts.ts`
- `services/visualization/src/lib/format.ts`
- `services/visualization/src/lib/server/storage-read-model-client.ts`
- `services/visualization/src/features/memory-catalog/service.ts`
- `services/visualization/src/app/memories/page.tsx`
- `services/visualization/src/app/memories/[id]/page.tsx`
- `services/visualization/src/features/run-trace/service.ts`
- `services/visualization/src/app/runs/page.tsx`
- `services/visualization/src/features/dashboard/service.ts`
- `services/visualization/src/features/source-health/service.ts`

如果文档之间出现冲突，优先级按下面执行：

1. `docs/api-contract.md`
2. `docs/current-phase-closure-plan.md`
3. `docs/memory-module-contract.md`
4. `docs/visualization/visualization-implementation-spec.md`
5. 其他说明文档

## 并行开发约束

这份提示词允许并行开发，但要严格遵守下面这些约束：

- 你只允许修改 `services/visualization` 和必要的契约文档，不要直接改 `services/storage` 或 `services/retrieval-runtime` 的实现代码。
- 页面 DTO、治理接口、运行轨迹字段一律以 `docs/api-contract.md` 为准；不要在前端层自创字段名去“猜”上游返回。
- 如果 `storage` 的治理接口或 `runtime` 的观测字段还没完全就绪，这一层先把 client、DTO、空态、降级态和占位解释补齐，不要通过读取对方私有实现来绕过契约。
- 目录页、详情页、轨迹页、看板页都只能消费正式接口和共享读模型；不要因为并行联调方便去直接连上游私有表或进程内状态。
- 外部依赖状态要单独标记；例如 `storage` 治理接口没好、`runtime` 观测字段没齐，都只能记成 `进行中`，不能在本服务里写成 `已完成`。
- 每次提交只改当前服务范围内的代码和文档；如果上游还没完成，你也要保证当前服务可以独立启动并局部降级。
- 每完成一项功能，就必须立即回写这份文档里的对应状态；功能状态、外部依赖状态、测试状态都要同步更新。

## 3. 当前代码现状

基于当前仓库代码和已跑过的校验，这一层已经不是空壳，目录页、详情页、轨迹页、看板页和健康面板都已经有正式实现。

已经有的基础：

- `memory-catalog/service.ts` 已经能把共享读模型转成页面 DTO
- `run-trace/service.ts` 已经能聚合 runtime 轨迹
- `dashboard/service.ts` 已经能聚合 runtime / storage 指标
- `source-health/service.ts` 已经有上游状态检查
- `storage-governance-client.ts` 和详情页治理 API routes 已经接通
- `lint`、`typecheck`、`build`、`test` 都已通过

当前真正还没完全收好的地方：

- 上游契约仍然可能继续补字段，所以 `storage` / `runtime` 的外部依赖状态仍需单独跟踪
- 目录页聚合、治理入口和轨迹解释已经收口，但后续如果上游契约变更，需要继续按 `docs/api-contract.md` 同步

你这轮要做的，是把这些地方改成真正可排查、可治理、可解释。

## 4. 当前阶段边界

当前阶段的正式边界固定如下：

- 默认模式是 `single_local_user`
- 当前产品不是多用户权限系统
- 页面要明确区分 `user`（全局记忆）和 `workspace`（工作区记忆）
- 用户可以查看“只看工作区记忆”或“工作区 + 全局记忆”的结果
- 页面不仅要能看，还要支撑最小治理动作

## 5. 可视化要解决什么问题

### 5.1 全局记忆和工作区记忆看不清

用户要能一眼看明白：

- 这条记忆是不是全局记忆
- 这条记忆是不是当前工作区记忆
- 如果是全局记忆，它最早是从哪个工作区沉淀来的
- 为什么它会在当前工作区里出现

### 5.2 某一轮为什么查了或没查、注入了或没注入看不清

要能按 `turn_id` 把一轮完整解释出来：

- `turn`
- `trigger`
- `recall`
- `injection`
- `writeback`

### 5.3 错误记忆虽然能看到，但改不了

页面不能继续停留在只读状态。

当前阶段至少要支撑：

- 确认
- 修正
- 失效
- 归档
- 删除
- 恢复版本

### 5.4 最近出了什么问题看不清

看板要能直接回答：

- 最近是不是开始频繁查空
- 最近是不是全局 / 工作区使用有问题
- 最近是不是写回积压
- 最近是不是冲突率升高

### 5.5 上游挂了时页面不能一起死

页面自己先能启动，再把数据源失败清楚显示出来。

## 6. 具体方案怎么做

### 6.1 目录页不要只做“查表显示”，要做成两种视图

这是第一优先级。

当前阶段目录页建议正式支持两种视图：

- `workspace_only`
- `workspace_plus_global`

具体做法：

- 在 `services/visualization/src/lib/contracts.ts` 里补 `memoryViewMode`
- 在 `services/visualization/src/app/memories/page.tsx` 加筛选项
- 在 `services/visualization/src/features/memory-catalog/service.ts` 里按视图聚合数据

聚合规则建议如下：

- `workspace_only`
  - 只查当前工作区的 `scope=workspace`
  - 同时保留和当前任务/会话有关的 `task/session`

- `workspace_plus_global`
  - 查两批数据：
    - 当前工作区的 `workspace/task/session`
    - 当前用户的 `scope=user`
  - 最后在页面服务里合并、排序、分页

不要指望一条旧 SQL 直接把所有视图都查出来。

### 6.2 全局记忆 / 工作区记忆要有明确解释文案

当前页面不能只显示 `scope=user` 或 `scope=workspace`。

你要在下面这些位置统一解释：

- 列表页
- 详情页
- 轨迹页

固定解释：

- `scope=user` = 全局记忆
- `scope=workspace` = 工作区记忆

如果有来源工作区，要显示：

- `来源工作区`

你要改的代码：

- `services/visualization/src/lib/format.ts`
- `services/visualization/src/features/memory-catalog/service.ts`
- `services/visualization/src/app/memories/page.tsx`
- `services/visualization/src/app/memories/[id]/page.tsx`

### 6.3 详情页补最小治理入口

当前详情页还是只读。

你要把最小治理链打通：

- 显示当前记录
- 输入原因
- 点按钮发起治理
- 页面反馈成功或失败

建议做法：

- 新增 `services/visualization/src/lib/server/storage-governance-client.ts`
- 新增 API 路由：
  - `src/app/api/memories/[id]/confirm/route.ts`
  - `src/app/api/memories/[id]/invalidate/route.ts`
  - `src/app/api/memories/[id]/archive/route.ts`
  - `src/app/api/memories/[id]/delete/route.ts`
  - `src/app/api/memories/[id]/restore-version/route.ts`
  - `src/app/api/memories/[id]/route.ts` 用于 `edit`

前端最小实现可以先做：

- 原因输入框
- `confirm`
- `invalidate`
- `archive`
- `delete`

`restore_version` 和 `edit` 可以放在详情页次级区块里。

### 6.4 轨迹页要按“五段解释”重做详情展示

当前 `run-trace/service.ts` 已经能聚合数据，但解释还不够。

你要把详情页固定成五段：

1. `turn`
2. `trigger`
3. `recall`
4. `injection`
5. `writeback`

而且每段都要能回答一个问题：

- `trigger`
  - 为什么触发或没触发
  - 当前是哪个 `memory_mode`

- `recall`
  - 实际查了哪些 scope
  - 为什么查空

- `injection`
  - 为什么注入这些
  - 为什么有些被裁掉

- `writeback`
  - 为什么产生写回候选
  - 为什么落到 `workspace` 或 `user`

这部分依赖 runtime 补字段后一起接。

你要改的代码：

- `services/visualization/src/lib/contracts.ts`
- `services/visualization/src/lib/server/runtime-observe-client.ts`
- `services/visualization/src/features/run-trace/service.ts`
- `services/visualization/src/app/runs/page.tsx`

### 6.5 看板要直接回答“问题偏在哪一层”

当前 `dashboard/service.ts` 已经有基础诊断，但还不够贴这次收口目标。

这一轮建议明确补四类诊断卡：

- 空检索趋势
- 全局 / 工作区使用问题
- 写回积压
- 冲突压力

具体做法：

- 保留现有 `runtime + storage` 指标聚合
- 新增 scope 相关诊断：
  - 全局记忆命中占比
  - 工作区记忆命中占比
  - 当前是否处于 `workspace_only`
- 如果 runtime 当前还没暴露这些字段，先把看板接口和 DTO 预留出来

还要顺手修一处当前实现问题：

- `dashboard/service.ts` 里现在对 `fetchRuntimeMetrics()` 和 `fetchStorageMetrics()` 是同窗口重复取两次
- 这一轮要改成：
  - 用 runs / write-jobs 自己算当前半窗和上一半窗
  - 不要拿两次同样的接口假装做趋势

### 6.6 `storage-read-model-client` 要支持“目录视图聚合”

当前 `storage-read-model-client.ts` 只适合单次列表查询。

这一轮建议你：

- 保留单次查询函数
- 额外补一个聚合函数，例如：
  - `queryCatalogView({ workspaceId, userId, memoryViewMode, ...filters })`

做法：

- `workspace_only`：一次查当前工作区
- `workspace_plus_global`：并发查当前工作区数据 + 当前用户 `scope=user` 数据
- 在可视化服务层合并排序

这样做的好处是：

- 不需要等 `storage` 立刻补一个新的目录聚合接口
- 当前阶段能直接落

### 6.7 健康状态面板保持“局部降级”

这部分现有基础可以保留。

你要保证：

- `storage` 挂了，目录区挂，不影响轨迹区
- `runtime` 挂了，轨迹区挂，不影响目录区
- 看板按来源局部标缺失，不要整页空白

## 7. 代码落点怎么分

### 7.1 `services/visualization/src/lib/contracts.ts`

要改：

- 增加 `memoryViewMode`
- 增加治理动作请求 / 响应 DTO
- 增加轨迹解释字段

### 7.2 `services/visualization/src/lib/server/storage-read-model-client.ts`

要改：

- 支持当前工作区视图
- 支持当前用户全局记忆视图
- 支持两者聚合

### 7.3 `services/visualization/src/features/memory-catalog/service.ts`

要改：

- 列表聚合逻辑
- scope 解释文案
- 空态解释

### 7.4 `services/visualization/src/app/memories/*`

要改：

- 列表页加视图模式
- 详情页加治理入口
- 详情页展示来源工作区和解释字段

### 7.5 `services/visualization/src/features/run-trace/service.ts`

要改：

- 接住 runtime 新增的 `memory_mode / scope` 字段
- 按五段生成解释

### 7.6 `services/visualization/src/features/dashboard/service.ts`

要改：

- 修正趋势计算
- 新增全局 / 工作区诊断
- 保持局部降级

## 当前阶段任务状态

### 已完成基础项

- 目录页、详情页、轨迹页、看板页、健康面板基础页面：`已完成`
- `memory-catalog/service.ts` 基础 DTO 转换：`已完成`
- `run-trace/service.ts` 基础轨迹聚合：`已完成`
- `dashboard/service.ts` 基础指标聚合：`已完成`
- `source-health/service.ts` 上游状态检查：`已完成`

### 当前开发项

- `6.1` 目录页双视图 `workspace_only / workspace_plus_global`：`已完成`
- `6.2` 全局记忆 / 工作区记忆解释文案：`已完成`
- `6.3` 详情页最小治理入口：`已完成`
- `6.4` 轨迹页五段解释与 `memory_mode / scope` 展示：`已完成`
- `6.5` 看板诊断卡与趋势修正：`已完成`
- `6.6 storage-read-model-client` 目录视图聚合：`已完成`
- `6.7` 局部降级和健康语义收实：`已完成`
- 外部依赖：`storage` 治理接口可接入：`已完成`
- 外部依赖：`runtime` 观测字段可接入：`已完成`

### 当前验收缺口

- 当前阶段页面能力验收缺口：`已清零`
- 后续关注点：`仅保留上游契约继续演进时的联动回归`

### 测试状态

- `npm run lint`：`已完成`
- `npm run typecheck`：`已完成`
- `npm run build`：`已完成`
- `npm test`：`已完成（34 passed）`
- `workspace_only` 目录视图只显示工作区记忆：`已完成`
- `workspace_plus_global` 目录视图会合并全局记忆：`已完成`
- `memory_view_mode + scope` 组合筛选不会串出其他工作区记录：`已完成`
- `workspace_plus_global + scope=user` 不会产生重复结果：`已完成`
- 详情页会把 `scope=user` 正确解释成全局记忆：`已完成`
- 治理动作请求构造正确：`已完成`
- 五段轨迹聚合正确：`已完成`
- 看板趋势不再依赖重复请求同一窗口：`已完成`
- 单个数据源失败时页面局部降级：`已完成`
- API 错误响应对齐统一错误契约：`已完成`

## 8. 建议开发顺序

1. 先改 `lib/contracts.ts`
2. 再改 `storage-read-model-client.ts` 和 `memory-catalog/service.ts`
3. 再补详情页治理入口和 API routes
4. 再改 `run-trace/service.ts`
5. 最后改 `dashboard/service.ts`

## 9. 测试要补什么

至少补下面这些测试：

- `workspace_only` 目录视图只显示工作区记忆
- `workspace_plus_global` 目录视图会合并全局记忆
- `memory_view_mode + scope` 组合筛选不会串出其他工作区记录
- `workspace_plus_global + scope=user` 不会产生重复结果
- 详情页会把 `scope=user` 正确解释成全局记忆
- 治理动作请求构造正确
- 五段轨迹聚合正确
- 看板趋势不再依赖重复请求同一窗口
- 单个数据源失败时页面局部降级
- API 错误响应结构对齐统一契约

当前这些测试已经补齐并通过。

## 10. 验收标准

完成后，至少要满足下面这些验收项：

- 目录页可区分全局记忆和工作区记忆
- 详情页可发起最小治理动作
- 轨迹页可解释五段流程和当前模式
- 看板可展示趋势并帮助判断问题偏在哪一层
- 上游挂了时页面仍可启动且局部降级

## 11. 开发完成时怎么自检

请按这个顺序自检：

1. 目录页有没有明确区分全局记忆和工作区记忆
2. 详情页治理入口是不是最小可用闭环
3. 轨迹页是不是已经能解释 `memory_mode + scope`
4. 看板是不是已经能看出全局 / 工作区问题
5. 上游失败时是不是局部降级
6. 测试是否覆盖当前阶段重点
