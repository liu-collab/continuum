# memory-injection 当前阶段开发提示词

## 1. 这份提示词给谁

这份提示词给负责继续推进 `services/retrieval-runtime` 里注入层的开发 agent。

你的任务不是重写整个 `retrieval-runtime`，而是把“触发判断 + scope 选择 + 注入块生成 + 写回 scope 判断”这一层按当前首版口径收成正式主链路。

## 2. 先读哪些文档

开始改代码前，先完整阅读下面这些文档，并以它们为准：

- `docs/current-phase-closure-plan.md`
- `docs/api-contract.md`
- `docs/architecture-independence.md`
- `docs/memory-module-contract.md`
- `docs/retrieval/memory-retrieval-product.md`
- `docs/retrieval/memory-injection-product.md`
- `docs/retrieval/retrieval-runtime-service-design.md`
- `docs/retrieval/retrieval-runtime-implementation-spec.md`
- `services/retrieval-runtime/README.md`

然后再读当前实现：

- `services/retrieval-runtime/src/shared/types.ts`
- `services/retrieval-runtime/src/api/schemas.ts`
- `services/retrieval-runtime/src/runtime-service.ts`
- `services/retrieval-runtime/src/trigger/trigger-engine.ts`
- `services/retrieval-runtime/src/query/query-engine.ts`
- `services/retrieval-runtime/src/query/postgres-read-model-repository.ts`
- `services/retrieval-runtime/src/injection/packet-builder.ts`
- `services/retrieval-runtime/src/injection/injection-engine.ts`
- `services/retrieval-runtime/src/writeback/writeback-engine.ts`

如果文档之间出现冲突，优先级按下面执行：

1. `docs/api-contract.md`
2. `docs/current-phase-closure-plan.md`
3. `docs/memory-module-contract.md`
4. `docs/retrieval/retrieval-runtime-implementation-spec.md`
5. 其他说明文档

## 并行开发约束

这份提示词允许并行开发，但要严格遵守下面这些约束：

- 你只允许修改 `services/retrieval-runtime` 和必要的契约文档，不要直接改 `services/storage` 或 `services/visualization` 的实现代码。
- 读模型字段、观测字段、请求入参字段一律以 `docs/api-contract.md` 为准；不要在代码里自创新的对外字段名。
- `retrieval-runtime` 只能读取 `storage` 正式发布的共享读模型，不能因为并行联调方便去读取 `storage_private` 私有表。
- 写回 scope 分类、运行轨迹字段、`memory_mode` 这些会被其他服务消费的能力，必须先按契约落字段，再落实现，不要先做本地私有约定。
- 如果 `storage` 或 `visualization` 还没完成联调，这一层也要先把 DTO、观测字段和降级逻辑按正式契约补齐，不要等对方代码 ready 才开始改主链路。
- 每次提交只改当前服务范围内的代码和文档；如果有外部依赖未完成，在本文档里把状态标成 `进行中`，不要擅自改成 `已完成`。
- 每完成一项功能，就必须立即回写这份文档里的对应状态；功能状态、外部依赖状态、测试状态都要同步更新。

## 3. 当前代码现状

基于当前仓库代码，这一层已经有完整主链路，但还没有按这次收口口径收实。

已经有的基础：

- `runtime-service.ts` 已经有 `prepareContext / finalizeTurn`
- `trigger-engine.ts` 已经有 phase 触发、历史引用触发、语义兜底
- `query-engine.ts` 已经有结构化过滤 + 向量重排
- `injection-engine.ts` 已经有预算裁剪
- `writeback-engine.ts` 已经有写回提取和提交

现在还没收好的地方：

- `services/retrieval-runtime/src/shared/types.ts` 里的 `ScopeType` 还没有 `workspace`
- 还没有正式 `memory_mode`
- `trigger-engine.ts` 里 scope 映射还是旧的 `user/task/session`
- `postgres-read-model-repository.ts` 现在强制 `workspace_id = 当前工作区 and user_id = 当前用户`，这会把全局记忆错误绑死在写入它的工作区里
- `writeback-engine.ts` 现在还是直接把偏好写到 `user`、其他写到 `task/session`，还没有正式工作区分类
- 运行轨迹里还缺 `memory_mode`、实际 scope 解释、写回 scope 决策解释

你这轮要做的，不是补一点字段，而是把这几条真正接进主链路。

## 4. 当前阶段边界

当前阶段的正式边界固定如下：

- 默认模式是 `single_local_user`
- 当前产品不是多用户权限系统
- 当前正式开放 `session`、`task`、`workspace`、`user`
- `user` 表示全局记忆
- `workspace` 表示工作区记忆
- runtime 正式支持两种模式：
  - `workspace_only`
  - `workspace_plus_global`

默认值：

- `memory_mode` 默认 `workspace_plus_global`

## 5. 注入层要解决什么问题

### 5.1 当前轮到底该读工作区还是全局记忆

runtime 不能继续只按旧的 `task/user/session` 临时处理。

当前阶段要明确：

- 什么时候读 `workspace`
- 什么时候读 `user`
- 什么时候两者都读
- 什么时候只读 `workspace`

### 5.2 工作区切换时不能把旧工作区记忆带进来

只要工作区换了，就必须保证：

- 新工作区只读自己的 `workspace` 记忆
- 旧工作区的 `workspace` 记忆不会继续混入
- 但 `user` 全局记忆仍然可以继续读

### 5.3 注入层不能把所有候选都塞进上下文

即使查到了记忆，也要继续判断：

- 当前有没有必要注入
- 哪些 scope 更该保留
- 哪些记录该被裁掉

### 5.4 写回不能把项目信息误写成全局记忆

你要明确区分：

- 全局偏好
- 工作区约束
- 任务状态
- 会话临时信息

### 5.5 运行轨迹必须能解释本轮为什么这样做

页面后面要能解释：

- 这轮是什么 `memory_mode`
- 实际查了哪些 scope
- 为什么没注入 / 为什么被裁掉
- 为什么最后写回到 `workspace` 或 `user`

## 6. 具体方案怎么做

### 6.1 先把 `memory_mode` 做成正式输入

这是第一优先级。

你要改的代码：

- `services/retrieval-runtime/src/shared/types.ts`
- `services/retrieval-runtime/src/api/schemas.ts`
- `services/retrieval-runtime/src/host-adapters/*`
- `services/retrieval-runtime/src/runtime-service.ts`

具体做法：

- 新增：
  - `type MemoryMode = "workspace_only" | "workspace_plus_global"`
- 在 `TriggerContext` 里加：
  - `memory_mode?: MemoryMode`
- 在 API 入参里允许宿主显式传 `memory_mode`
- 在运行时内部统一补默认值：
  - 未传时一律按 `workspace_plus_global`

不要把 `memory_mode` 做成只存在于前端或宿主的松散约定。

### 6.2 把 `workspace` 加进正式类型

当前 `ScopeType` 还是旧的：

- `user`
- `task`
- `session`

你要把它改成：

- `workspace`
- `user`
- `task`
- `session`

你要改的代码：

- `services/retrieval-runtime/src/shared/types.ts`
- `services/retrieval-runtime/src/trigger/trigger-engine.ts`
- `services/retrieval-runtime/src/query/*`
- `services/retrieval-runtime/src/injection/*`
- `services/retrieval-runtime/src/writeback/*`

### 6.3 phase 到 scope 的映射按当前方案重写

你要把旧的 scope 选择规则换成下面这套正式口径：

- `session_start`
  - 默认：`workspace + user`

- `task_start`
  - 默认：`workspace + task + user`

- `task_switch`
  - 默认：`workspace + task + user`

- `before_plan`
  - 默认：`workspace + task + user`

- `before_response`
  - `workspace_plus_global`：`workspace + task + session + user`
  - `workspace_only`：`workspace + task + session`

- `after_response`
  - 不做召回，只做写回

具体做法：

- 把 scope 选择收进 `trigger-engine.ts`
- 或者抽成一个独立的 `scope-plan` 小模块
- 让 `TriggerDecision` 明确输出：
  - `memory_mode`
  - `requested_scopes`
  - `scope_reason`

不要把这部分写死在 `runtime-service.ts` 里。

### 6.4 查询层要按 scope 可见性重写 SQL

这是第二个关键点。

当前 `postgres-read-model-repository.ts` 的 SQL 是：

- `workspace_id = 当前工作区`
- `user_id = 当前用户`
- `scope = ANY($4)`

这会导致一个错误：

- 某条 `scope=user` 全局记忆如果最早写在工作区 A
- 当前切到工作区 B
- runtime 就查不到它

正确做法不是简单删掉 `workspace_id` 过滤，而是按 scope 分支。

建议 SQL 语义改成：

- `scope=workspace`
  - 必须 `workspace_id = 当前工作区`

- `scope=user`
  - 必须 `user_id = 当前用户`
  - 不再要求 `workspace_id = 当前工作区`

- `scope=task`
  - 必须 `workspace_id = 当前工作区`
  - 必须 `task_id = 当前任务`

- `scope=session`
  - 必须 `workspace_id = 当前工作区`
  - 必须 `session_id = 当前会话`

你要改的代码：

- `services/retrieval-runtime/src/query/postgres-read-model-repository.ts`
- `services/retrieval-runtime/src/query/read-model-repository.ts`
- `services/retrieval-runtime/src/query/in-memory-read-model-repository.ts`

不要再用一个统一的 `workspace_id = $1 and user_id = $2` 把所有 scope 一起卡死。

### 6.5 把 `workspace_only` 真正做成行为差异

不是只多一个枚举值。

你要保证：

- `workspace_only`
  - 不查询 `scope=user`
  - 不在轨迹里显示“本轮使用了全局记忆”

- `workspace_plus_global`
  - 查询 `scope=workspace` 和 `scope=user`
  - 页面能解释这是“工作区 + 全局”

你要改的代码：

- `services/retrieval-runtime/src/trigger/trigger-engine.ts`
- `services/retrieval-runtime/src/query/query-engine.ts`
- `services/retrieval-runtime/src/runtime-service.ts`

### 6.6 注入块要补解释信息

当前 `InjectionBlock` 只有：

- `injection_reason`
- `memory_summary`
- `memory_records`
- `token_estimate`

这还不够页面解释。

当前阶段建议至少补：

- `memory_mode`
- `requested_scopes`
- `selected_scopes`
- `trimmed_record_ids`
- `trim_reasons`

如果你不想把这些都暴露给宿主，也至少要保证它们进入运行轨迹。

你要改的代码：

- `services/retrieval-runtime/src/shared/types.ts`
- `services/retrieval-runtime/src/injection/packet-builder.ts`
- `services/retrieval-runtime/src/injection/injection-engine.ts`
- `services/retrieval-runtime/src/runtime-service.ts`
- `services/retrieval-runtime/src/observability/*`

### 6.7 写回 scope 判断单独做成一个分类步骤

当前 `writeback-engine.ts` 里主要是按简单规则直接给 scope。

这一轮要把它收成正式分类步骤。

建议做法：

- 在 `writeback-engine.ts` 里加一个明确的 scope classifier
- LLM 提取只负责抽候选，不直接决定最终 scope
- 最终 scope 一律由 runtime 本地规则二次判定

当前阶段规则固定如下：

- 长期偏好、风格偏好、长期工作习惯 -> `user`
- 仓库规则、项目约束、目录约定、工作区背景 -> `workspace`
- 任务目标和任务状态 -> `task`
- 当前会话临时上下文 -> `session`
- 不确定时优先 `workspace`

最小做法：

- 先按 `candidate_type + details + source_type` 分类
- 再按关键词兜底
- LLM 结果只作为参考，不直接落库

你要改的代码：

- `services/retrieval-runtime/src/writeback/writeback-engine.ts`

### 6.8 运行轨迹要把 scope 和模式写出来

当前 `runtime-service.ts` 已经会写：

- `turn`
- `trigger`
- `recall`
- `injection`
- `writeback`

但还不够解释“为什么用了全局 / 为什么没有用全局”。

你要补的最少信息：

- `trigger_run`
  - `memory_mode`
  - `requested_scopes`

- `recall_run`
  - 实际查询 scope
  - 查询结果里各 scope 的命中数量

- `injection_run`
  - 最终保留了哪些 scope
  - 哪些记录被裁掉

- `writeback_submission`
  - 每条候选最终落到哪个 scope

## 7. 代码落点怎么分

### 7.1 `services/retrieval-runtime/src/shared/types.ts`

要改：

- 新增 `MemoryMode`
- `ScopeType` 加 `workspace`
- `TriggerContext` 带 `memory_mode`
- `TriggerDecision`、`MemoryPacket`、`InjectionBlock`、观测记录都补模式和 scope 解释字段

### 7.2 `services/retrieval-runtime/src/api/schemas.ts`

要改：

- `prepare-context`
- `session-start-context`
- 其他宿主入口

都要支持 `memory_mode`

### 7.3 `services/retrieval-runtime/src/trigger/trigger-engine.ts`

要改：

- 重写 phase 到 scope 的映射
- 让 `workspace_only` 和 `workspace_plus_global` 真正产生差异

### 7.4 `services/retrieval-runtime/src/query/postgres-read-model-repository.ts`

要改：

- 查询条件按 scope 分支
- `scope=user` 改成按 `user_id` 全局可见
- `scope=workspace` 只按当前 `workspace_id`

### 7.5 `services/retrieval-runtime/src/query/query-engine.ts`

要改：

- 接住新的 scope plan
- 保持原有重排和预算逻辑

### 7.6 `services/retrieval-runtime/src/injection/*`

要改：

- 让注入块带足够解释信息
- 不改变“摘要优先、支撑记录次之”的主策略

### 7.7 `services/retrieval-runtime/src/writeback/writeback-engine.ts`

要改：

- 新增正式 scope classifier
- 不确定项默认 `workspace`
- 保持写回候选上限和降级逻辑

## 当前阶段任务状态

### 已完成基础项

- `prepareContext / finalizeTurn` 主链路：`已完成`
- `trigger-engine` 的 phase 触发、历史引用触发、语义兜底：`已完成`
- `query-engine` 的结构化过滤 + 向量重排：`已完成`
- `injection-engine` 的预算裁剪主链路：`已完成`
- `writeback-engine` 的基础提取和提交链路：`已完成`
- 五段运行轨迹基础记录：`已完成`

### 当前开发项

- `6.1 memory_mode` 做成正式输入：`已完成`
- `6.2 workspace` 进入正式 `ScopeType`：`已完成`
- `6.3 phase -> scope` 映射按当前方案重写：`已完成`
- `6.4` 查询层按 scope 可见性重写 SQL：`已完成`
- `6.5 workspace_only` 做成真实行为差异：`已完成`
- `6.6` 注入块解释字段补齐：`已完成`
- `6.7` 写回 scope classifier 正式化：`已完成`
- `6.8` 运行轨迹补齐 `memory_mode / scope` 解释：`已完成`
- 五段轨迹按同一 `trace_id` 闭环：`已完成`
- `Codex` MCP `memory_search / memory_explain_hit`：`已完成`
- `Codex` 代理不再把 `finalize-turn` 失败伪装成成功：`已完成`

### 测试状态

- `workspace_only` 模式下不会读取 `scope=user`：`已完成`
- `workspace_plus_global` 模式下会同时读取 `workspace + user`：`已完成`
- 工作区切换后不会继续读旧工作区的 `workspace` 记忆：`已完成`
- 同一条 `user` 全局记忆可以在不同工作区被读到：`已完成`
- 写回分类能区分 `user` 和 `workspace`：`已完成`
- 注入预算裁剪仍然生效：`已完成`
- 运行轨迹能反映 `memory_mode` 和实际 scope：`已完成`
- `prepare-context / finalize-turn` 共用同一 `trace_id`：`已完成`
- `Codex` MCP 不再使用零 UUID fallback：`已完成`
- `Codex` 代理不会把 `finalize-turn` 失败伪装成已转发：`已完成`
- `npm run check`：`已完成`
- `npm run build`：`已完成`
- `npm test`：`已完成`

## 8. 建议开发顺序

1. 先改 `shared/types.ts` 和 `api/schemas.ts`
2. 再改 `trigger-engine.ts`，把 `memory_mode + workspace` 口径收正
3. 再改 `postgres-read-model-repository.ts` 和 `query-engine.ts`
4. 再改 `injection` 相关类型和轨迹字段
5. 最后改 `writeback-engine.ts`

## 9. 测试要补什么

至少补下面这些测试：

- `workspace_only` 模式下不会读取 `scope=user`
- `workspace_plus_global` 模式下会同时读取 `workspace + user`
- 工作区切换后不会继续读旧工作区的 `workspace` 记忆
- 同一条 `user` 全局记忆可以在不同工作区被读到
- 写回分类能区分 `user` 和 `workspace`
- 注入预算裁剪仍然生效
- 运行轨迹能反映 `memory_mode` 和实际 scope

## 10. 验收标准

完成后，至少要满足下面这些验收项：

- `memory_mode` 已经进入正式输入和主链路
- `workspace` 已经是正式可检索 scope
- `user` 已经明确表示全局记忆
- 工作区切换时不会带入旧工作区的 `workspace` 记忆
- 写回不会误把项目内容写成全局记忆
- 运行轨迹足够让页面解释为什么查了这些 scope

## 11. 开发完成时怎么自检

请按这个顺序自检：

1. `memory_mode` 是否已经接到正式入参
2. `workspace` 是否已经进入类型、查询、注入、轨迹全链路
3. `scope=user` 是否已经真正跨工作区可读
4. `workspace_only` 是否真的不读全局记忆
5. 写回 scope 是否不会误分类
6. 测试是否覆盖模式差异和工作区切换
