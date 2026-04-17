# storage 当前阶段开发提示词

## 1. 这份提示词给谁

这份提示词给负责继续推进 `services/storage` 的开发 agent。

你的任务不是再解释边界，而是按当前首版口径，把 `storage` 真正收成一层可落库、可治理、可向外发布“全局记忆 / 工作区记忆”正式结果的服务。

## 2. 先读哪些文档

开始改代码前，先完整阅读下面这些文档，并以它们为准：

- `docs/current-phase-closure-plan.md`
- `docs/api-contract.md`
- `docs/architecture-independence.md`
- `docs/memory-module-contract.md`
- `docs/storage/memory-storage-product.md`
- `docs/storage/database-schema-design.md`
- `docs/storage/storage-service-design.md`
- `docs/storage/storage-implementation-spec.md`
- `services/storage/README.md`

如果文档之间出现冲突，优先级按下面执行：

1. `docs/api-contract.md`
2. `docs/current-phase-closure-plan.md`
3. `docs/memory-module-contract.md`
4. `docs/storage/storage-implementation-spec.md`
5. 其他说明文档

## 并行开发约束

这份提示词允许并行开发，但要严格遵守下面这些约束：

- 你只允许修改 `services/storage` 和必要的契约文档，不要直接改 `services/retrieval-runtime` 或 `services/visualization` 的实现代码。
- 对外接口、共享读模型字段、状态语义一律以 `docs/api-contract.md` 为准；如果你认为契约要变，先改契约文档，再改实现。
- 共享读模型是 `storage` 对外发布的唯一正式数据面；不要要求其他服务读取 `storage_private` 写表来完成联调。
- 即使 `retrieval-runtime` 还没完全切到新写回契约，这一层也要保留兼容适配，不要因为联调未完成阻塞当前服务落地。
- 会被 `visualization` 直接消费的字段，例如 `created_at`、`origin_workspace_id`、`last_confirmed_at`、`status`，一旦正式发布，就不要在并行开发中临时改名或删掉。
- 每次提交只改当前服务范围内的代码和文档；如果有外部依赖未完成，在本文档里把状态标成 `进行中`，不要擅自改成 `已完成`。
- 每完成一项功能，就必须立即回写这份文档里的对应状态；功能状态、外部依赖状态、测试状态都要同步更新。
- 没有完成的项不要模糊描述成“基本可用”。

## 3. 当前代码现状

基于当前仓库代码和已跑过的测试，`storage` 这轮收口主线已经大部分落地，不再只是工程骨架。

现在已经收实的部分：

- `session / task / workspace / user` 四类 scope 已经进入正式契约和写入主链路
- `scope=user` 已经按“当前本地用户跨工作区共享”处理，`workspace_id` 作为来源工作区保留
- `confirm / invalidate / delete / edit / archive / restore_version` 已经有正式路由、service 和治理实现
- 共享读模型已经补齐 `created_at`，并且会发布 `source.origin_workspace_id`
- embedding 失败不会阻塞正式记录写入，降级情况已有指标
- runtime 正式批量写回契约已经支持 `session / task / workspace / user`，旧口径保留在兼容层里
- `GET /v1/storage/records` 已经按正式契约收成 `workspace_id` 必填 + `page / page_size` 分页
- `POST /v1/storage/write-back-candidates` 已经统一返回 `jobs`，同时保留 `submitted_jobs` 兼容字段
- 冲突治理已经收成双边闭环：新候选和旧记录都会成为可治理对象，冲突单会记录双方 id

当前阶段代码闭环已经完成，后续主要是保持契约、实现和联调口径持续一致，不再有本阶段剩余功能缺口。

## 4. 当前阶段边界

当前阶段的正式边界固定如下：

- 默认模式是 `single_local_user`
- 当前正式开放 `session`、`task`、`workspace`、`user`
- `user` 表示全局记忆
- `workspace` 表示工作区记忆
- 当前不做多用户权限系统

这里有一个必须写进代码的约定：

- `scope=user` 的记录，对当前本地用户是跨工作区共享可读的
- `scope=workspace` 的记录，只在对应工作区内可读
- `workspace_id` 在 `scope=user` 的情况下，先作为来源工作区保留，不再作为全局记忆的可见性边界

## 5. store 里面到底要存什么

你要把上游写回候选收成下面四类正式记忆，并且每类都要有稳定的 `summary + details` 结构。

### 5.1 `user`（全局记忆）

这类内容跨工作区稳定成立。

应该存：

- 用户长期偏好
- 回复风格偏好
- 长期工作习惯
- 长期约束

`details` 建议至少包含：

- `subject`
- `predicate`
- `evidence`
- `stability=long_term`

最小例子：

```json
{
  "subject": "response_style",
  "predicate": "prefer concise chinese output",
  "evidence": "user explicitly requested concise chinese responses",
  "stability": "long_term"
}
```

### 5.2 `workspace`（工作区记忆）

这类内容只对当前工作区成立。

应该存：

- 项目约束
- 仓库规则
- 目录结构约定
- 工具链约定
- 当前仓库背景

`details` 建议至少包含：

- `rule_kind`
- `rule_value`
- `repo_path`
- `evidence`

### 5.3 `task`

这类内容只跟当前任务有关。

应该存：

- 当前任务目标
- 当前任务状态
- 下一步动作
- 当前阻塞点

`details` 建议至少包含：

- `state_key`
- `state_value`
- `next_step`
- `blocked_by`

### 5.4 `session`

这类内容只在当前会话里短期有效。

应该存：

- 当前轮临时上下文
- 当前轮临时约定
- 对后续几轮有帮助但不值得长期沉淀的短期信息

`details` 建议至少包含：

- `topic`
- `expires_hint`
- `evidence`

## 6. 这层要解决的核心问题

### 6.1 全局记忆和工作区记忆不能混写

要避免两类错误：

- 把项目约束写成全局记忆
- 把用户稳定偏好写成工作区记忆

### 6.2 全局记忆必须真的跨工作区

如果某条全局记忆是在工作区 A 里写入的，它在工作区 B 里也应该可被 runtime 读取。

### 6.3 原始对话不能直接入库

正式记忆只允许结构化摘要和结构化详情，不允许整段原始 transcript。

### 6.4 重复写入不能把库写脏

要按作用范围、类型和 `dedupe_key` 判断：

- 插入
- 更新
- 合并
- 忽略重复
- 进入冲突

### 6.5 错误记忆必须能被治理

当前阶段必须支持：

- `confirm`
- `edit`
- `invalidate`
- `archive`
- `delete`
- `restore_version`

### 6.6 查询侧不能读私有写表

`retrieval-runtime` 和 `visualization` 只能读共享读模型，不允许碰 `storage_private` 写表。

## 7. 具体方案怎么做

### 7.1 先把 `scope=user` 的语义收实

这是第一优先级。

具体做法：

- 保留 `memory_records.workspace_id`，但把它定义成 `origin_workspace_id` 的含义
- 不新增多租户字段，不做权限设计
- 对 `scope=user` 的记录：
  - 写入时记录来源工作区
  - 去重时忽略工作区边界
  - 发布到读模型后允许 runtime 按 `user_id` 跨工作区读取

当前这部分已经主要落在下面这些代码里：

- `services/storage/src/db/repositories.ts`
- `services/storage/src/domain/writeback-processor.ts`
- `services/storage/src/domain/normalizer.ts`

落地规则：

- `scope=user`：按 `user_id + scope + dedupe_key` 去重
- `scope=workspace`：按 `workspace_id + scope + dedupe_key` 去重
- `scope=task`：按 `workspace_id + task_id + dedupe_key` 去重
- `scope=session`：按 `workspace_id + session_id + dedupe_key` 去重

### 7.2 把 scope 分类做成独立规则，不要散在接口层

当前分类规则已经收在 `services/storage/src/domain` 范围内，不再散在接口层。

你要把下面这组规则写死：

- 长期偏好、长期表达风格、长期工作习惯 -> `user`
- 仓库规则、项目约束、目录约定、工具链背景 -> `workspace`
- 任务目标、任务状态、下一步动作 -> `task`
- 当前会话临时上下文 -> `session`
- 不确定时优先保守落 `workspace`

不要在 `api/app.ts` 里硬编码这些判断。

### 7.3 补齐治理接口

当前实现已经有下面这些正式治理接口：

- `POST /v1/storage/records/{recordId}/confirm`
- `POST /v1/storage/records/{recordId}/invalidate`
- `POST /v1/storage/records/{recordId}/delete`

这一组接口当前已经在 `contracts`、`api`、`services`、`governance-engine` 里落地。

后续继续开发时，这一节不再是“补接口”，而是保持行为和正式契约一致，并补齐页面治理所需的解释字段。

当前实现的状态处理口径如下：

- `confirm`
  - 目标状态：`active`
  - 同时更新 `last_confirmed_at`
  - 写治理审计
  - 触发读模型刷新

- `invalidate`
  - 当前阶段先不新增 `invalidated` 状态
  - 先落成：`action_type=invalidate` + 记录转 `archived`
  - 必须写原因，后续页面通过治理动作解释“这是失效而不是普通归档”

- `delete`
  - 目标状态：`deleted`
  - 设置 `deleted_at`
  - 从共享读模型删除

- `restore_version`
  - 当前实现已存在
  - 保持“恢复成新版本，不回滚审计”

### 7.4 补齐 runtime 兼容写回契约

当前阶段这部分已经收成“两层口径”：

- 正式契约已经支持 `session | task | workspace | user`
- 正式 `candidate_type` 已经收成 `fact_preference | task_state | episodic`
- `commitment`、`important_event` 和旧 scope 仍保留在兼容层里，由适配逻辑折叠进正式类型

后续继续开发时，这里只保留一个约束：

- 兼容层可以继续存在，但不要把兼容输入误写成当前正式对外契约

### 7.5 把读模型字段收成上游直接可用

当前阶段共享读模型至少要稳定提供：

- `id`
- `workspace_id`
- `user_id`
- `task_id`
- `session_id`
- `memory_type`
- `scope`
- `status`
- `summary`
- `details`
- `source`
- `importance`
- `confidence`
- `created_at`
- `updated_at`
- `last_confirmed_at`
- `summary_embedding`

当前读模型已经补齐 `created_at`，也已经把来源解释信息投影到 `source`。

这一节后续还剩的工作不是补字段，而是把“正式契约承诺了什么”和“接口实际返回了什么”继续对齐，不要让上游通过代码猜字段行为。

### 7.6 把 `source` 写得够解释

当前阶段 `source` 不只是来源字符串，还要能让页面解释“这条全局记忆从哪来的”。

建议在投影时把 `source` 固定收成：

```json
{
  "source_type": "user_input | assistant_final | tool_trace_summary",
  "source_ref": "turn_id or session_id",
  "service_name": "retrieval-runtime",
  "origin_workspace_id": "UUID",
  "confirmed_by_user": true
}
```

当前这部分主要落在下面这些代码里：

- `services/storage/src/db/read-model-projector.ts`
- `services/storage/src/db/repositories.ts`

### 7.7 `summary_embedding` 失败时不要拖挂主写入

这条主线保持不变，但要收得更完整。

你要保证：

- 正式记录先写成功
- 读模型刷新任务单独入队
- embedding 失败只影响向量字段，不影响记录可见性
- 指标里能看到 `projector_embedding_degraded_jobs`

## 8. 后续收口主要代码落点

如果继续补当前阶段剩余缺口，主要会落在下面这些位置：

### 8.1 `services/storage/src/contracts.ts`

后续主要关注：

- `recordQuerySchema` 和 `docs/api-contract.md` 的一致性维护
- 写回接收接口正式口径与兼容字段边界维护
- 兼容层和正式契约的边界说明

### 8.2 `services/storage/src/api/app.ts`

后续主要关注：

- `GET /v1/storage/records` 正式查询参数和返回结构的持续一致性
- `POST /v1/storage/write-back-candidates` 正式返回口径和兼容字段的持续一致性

### 8.3 `services/storage/src/domain/writeback-processor.ts`

后续主要关注：

- `open_conflict` 分支里双边治理结构的持续一致性
- 冲突单里双方 id 和状态流转的持续一致性

### 8.4 `services/storage/src/db/repositories.ts`

后续主要关注：

- 冲突双方的数据落点维护
- 记录查询接口和治理接口需要的查询能力维护

### 8.5 `services/storage/tests/`

后续主要关注：

- 真实 PostgreSQL 路径下的契约验收
- 冲突双边治理的数据库级验证
- 共享读模型投影的数据库级验证

## 当前阶段任务状态

### 已完成基础项

- `services/storage` 工程骨架、迁移、异步 worker：`已完成`
- 写回、合并、冲突、读模型投影主链路：`已完成`
- `edit / archive / restore_version` 基础治理能力：`已完成`
- 共享读模型刷新基础链路：`已完成`

### 当前开发项

- `7.1 scope=user` 语义收实：`已完成`
- `7.2 scope` 分类独立规则：`已完成`
- `7.3 confirm / invalidate / delete` 正式治理接口：`已完成`
- `7.4 runtime` 兼容写回契约收口：`已完成（兼容层仍保留）`
- `7.5` 共享读模型字段正式发布收口：`已完成`
- `7.6 source` 解释字段收实：`已完成`
- `7.7 summary_embedding` 失败不拖挂主写入与指标补齐：`已完成`

### 当前验收状态

- `GET /v1/storage/records` 契约对齐：`已完成`
- `POST /v1/storage/write-back-candidates` 返回体对齐：`已完成（保留 submitted_jobs 兼容字段）`
- 冲突治理双边闭环：`已完成`

### 测试状态

- 基础测试骨架：`已完成`
- `npm run check`：`已完成`
- `npm run build`：`已完成`
- `npm test`：`已完成（32 passed，5 skipped）`
- 同一个 `user` 记忆从工作区 A 写入后，在工作区 B 再写一次不会重复插入：`已完成`
- `workspace` 记忆只在当前工作区内去重：`已完成`
- 项目约束不会被错误落到 `user`：`已完成`
- `confirm` 会把记录变成 `active` 并刷新读模型：`已完成`
- `invalidate` 会进入非默认召回状态并写审计：`已完成`
- `delete` 会从共享读模型移除：`已完成`
- 读模型里的 `source.origin_workspace_id` 正确：`已完成`
- embedding 失败时正式记录仍可查：`已完成`

## 9. 当前建议

1. 保持 `docs/api-contract.md`、`contracts.ts`、`api/app.ts` 三者同步
2. 保持冲突双边治理结构和数据库迁移口径同步
3. 后续新增能力时继续补数据库级验收

## 10. 当前测试覆盖

当前已经覆盖：

- `GET /v1/storage/records` 的正式契约和真实代码行为一致
- `POST /v1/storage/write-back-candidates` 的单条 / 批量返回体一致
- 冲突新候选和旧记录都能进入正式治理闭环
- 真实 PostgreSQL 路径下共享读模型投影结果正确

## 11. 验收标准

完成后，至少要满足下面这些验收项：

- `user` 记忆已经是正式的全局记忆，不再被当前工作区绑定死
- `workspace` 记忆已经是正式的工作区记忆，不再只是字段存在
- `confirm / invalidate / delete / archive / edit / restore_version` 都能闭环
- 共享读模型字段足够让 `retrieval-runtime` 和 `visualization` 直接消费
- runtime 和 visualization 都不需要碰私有写表

## 12. 开发完成时怎么自检

请按这个顺序自检：

1. `scope=user` 是否已经真正跨工作区去重和可读
2. `scope=workspace` 是否仍然只在当前工作区生效
3. 分类规则是否没有散落在 API 层
4. `confirm / invalidate / delete` 是否已经正式可用
5. 共享读模型字段是否已经稳定
6. 测试是否覆盖全局 / 工作区差异
