# retrieval-runtime 实施规格

## 当前验收状态（2026-04-16）

### 已完成

- 运行时主链路已完成，包括触发判断、查询读模型、生成 `MemoryPacket`、生成注入块、结束后写回检查。
- 触发阶段的依赖降级已完成，语义回退现在走统一依赖守卫，失败时会明确记录 `degraded` 和 `degradation_reason`。
- 查询阶段的超时与连接释放已完成，读模型查询具备 `statement_timeout`、取消和连接回收闭环。
- 写回正式契约已完成，候选类型已经收敛到 `fact_preference`、`task_state`、`episodic`，来源字段也已经按正式结构输出。
- 运行轨迹持久化已完成，`turn / trigger / recall / injection / writeback` 五段记录已经能落到运行时仓储。
- 同一轮 `prepare-context / finalize-turn` 已经能复用同一条 `trace_id`，五段轨迹现在可以真实闭合。
- 宿主生命周期接线已完成，`Claude Code` 和 `Codex` 两侧都已经能把宿主事件转进运行时服务。
- `Codex` MCP 工具已经补齐 `memory_search` 和 `memory_explain_hit`，不再使用伪造 identity fallback。
- 当前实现已通过 `npm run check`、`npm run build`、`npm test`。

### 当前结论

- `retrieval-runtime` 当前阶段主运行链路和宿主工具面都可以标记为已完成。

## 1. 文档定位

这份文档只讲 `retrieval-runtime` 这一层怎么真正落地。

它不再停留在“有触发、有注入、有写回”这种职责描述层，而是直接回答：

- 这一层具体解决哪些问题
- 每个问题对应什么处理链路
- 运行时表怎么配合
- 宿主调用时到底传什么、拿回什么
- 失败和边界场景怎么降级

配套文档：

- `memory-retrieval-product.md`
- `memory-injection-product.md`
- `retrieval-runtime-service-design.md`
- `host-integration-implementation-plan.md`

## 2. 这一层真正要解决的问题

`retrieval-runtime` 首版固定解决 7 类问题。

### 2.1 该查的时候要稳定查，不靠模型自己想起

问题：

- 模型不会稳定主动调用记忆
- 同一个场景里，有时会查，有时不会查

解决方案：

- 召回触发固定由宿主生命周期驱动
- `retrieval-runtime` 只接收明确的 phase（阶段）和上下文
- 触发判断由规则引擎完成，不交给模型决定

### 2.2 查询必须快，而且要先过滤再排序

问题：

- 记忆不是全文检索
- 先做结构化约束，再做语义相关，才不会乱召回

解决方案：

- 只读 `memory_read_model_v1`
- 固定两段式查询：
  - 硬过滤
  - 软排序

### 2.3 查到了也不能原样塞进 prompt

问题：

- 候选记录太多
- 很多记录对当前轮不是主信息
- 原样塞进去会抢上下文预算

解决方案：

- 先组 `MemoryPacket`
- 再裁剪成 `InjectionBlock`
- 最终只输出当前轮需要的最小可用块

### 2.4 上下文预算必须受控

问题：

- 记忆和当前任务抢上下文
- 情节记忆很容易把真正重要的约束挤掉

解决方案：

- 固定优先级
- 固定条数上限
- 固定 token（令牌）预算估算

### 2.5 写回不能什么都收

问题：

- 每一轮都会产生很多无价值信息
- 如果全写，`storage` 很快被噪声淹掉

解决方案：

- `writeback-engine` 先做提取
- 再做可写判定
- 只把明确值得沉淀的内容提交给 `storage`

### 2.6 依赖失败不能把宿主拖挂

问题：

- `storage` 可能没启动
- 读模型可能短时不可用
- 运行时服务自己也可能超时

解决方案：

- 所有依赖调用都带超时和显式降级
- 没有记忆增强时，宿主照常回答
- 失败只影响当前轮记忆效果，不影响宿主活性

### 2.7 必须留下足够的运行轨迹

问题：

- 为什么查了、为什么没查、为什么注入了、为什么没写回，如果不留轨迹，后面根本查不清

解决方案：

- 运行时过程统一写入 `runtime_private`
- 一轮至少留下 `turn`、`trigger`、`recall`、`injection`、`writeback` 五层记录

## 3. 这一层的设计结论

基于上面的问题，`retrieval-runtime` 首版固定设计成五段运行链路，并且对外观测、页面解释和测试验收都按同一套五段口径收：

1. `turn`
2. `trigger`
3. `recall`
4. `injection`
5. `writeback`

一句话说：

它不负责“记忆存什么”，只负责“在正确时刻把正确记忆变成当前轮可用上下文”。

## 4. 核心运行对象

为了让实现不发散，先固定 6 个运行对象。

### 4.1 `TriggerContext`

这是所有运行入口的统一输入。

必填字段：

- `host`
- `workspace_id`
- `user_id`
- `session_id`
- `phase`
- `current_input`

可选字段：

- `task_id`
- `thread_id`
- `turn_id`
- `recent_context_summary`
- `memory_mode`

### 4.2 `RetrievalQuery`

这是查询引擎内部对象。

字段：

- `scope_filter`
- `memory_type_filter`
- `status_filter`
- `importance_threshold`
- `semantic_query_text`
- `candidate_limit`

### 4.3 `CandidateMemory`

这是从共享读模型读出的候选记录。

字段来自：

- `memory_read_model_v1`

首版用到：

- `id`
- `memory_type`
- `scope`
- `summary`
- `importance`
- `confidence`
- `last_confirmed_at`
- `updated_at`

### 4.4 `MemoryPacket`

这是召回结果的中间组织结构。

字段：

- `packet_id`
- `trigger_reason`
- `memory_mode`
- `requested_scopes`
- `selected_scopes`
- `packet_summary`
- `records[]`
- `priority_breakdown`

### 4.5 `InjectionBlock`

这是最终给宿主的输出对象。

字段：

- `injection_reason`
- `memory_summary`
- `memory_records[]`
- `token_estimate`
- `memory_mode`
- `requested_scopes`
- `selected_scopes`
- `trimmed_record_ids`
- `trim_reasons`

### 4.6 `WriteBackCandidate`

这是提交给 `storage` 的候选对象。

字段：

- `candidate_type`
- `scope`
- `summary`
- `details`
- `importance`
- `confidence`
- `write_reason`
- `source`

## 5. 内部模块到底怎么分工

### 5.1 `host-adapter-sdk`

解决的问题：

- 不同宿主不能直接感知内部查询和降级细节

具体做法：

- 统一接收宿主回调
- 统一转成 `TriggerContext`
- 统一调用内部服务
- 统一返回宿主可消费格式

### 5.2 `trigger-engine`

解决的问题：

- 什么时候查记忆必须固定，不靠模型临场发挥

具体做法：

- 根据 phase（阶段）先做硬触发判断
- 再做轻量语义兜底

输出：

- `trigger_hit`
- `trigger_type`
- `requested_memory_types`

### 5.3 `query-engine`

解决的问题：

- 查询必须既快又准

具体做法：

- 只读共享读模型
- 先结构化过滤
- 再相似度排序
- 最后补权重重排

### 5.4 `packet-builder`

解决的问题：

- 查询结果太散，不能直接交给注入引擎

具体做法：

- 把候选按类型和优先级归组
- 生成一个主摘要
- 给出候选裁剪顺序

### 5.5 `injection-engine`

解决的问题：

- 上下文预算有限，必须严格裁剪

具体做法：

- 按优先级保留记录
- 估算 token
- 生成最终 `InjectionBlock`

### 5.6 `writeback-engine`

解决的问题：

- 当前轮结束后，什么该写、什么不该写，不能交给上游随意决定

具体做法：

- 从本轮输入、输出、工具摘要中提取事实
- 判定是否值得沉淀
- 生成 `WriteBackCandidate[]`

### 5.7 `runtime-repository`

解决的问题：

- 运行轨迹不能散在业务代码里

具体做法：

- 统一维护：
  - `runtime_turns`
  - `runtime_recall_runs`
  - `runtime_injection_runs`
  - `runtime_writeback_submissions`
  - `runtime_dependency_status`

### 5.8 `dependency-guard`

解决的问题：

- 任意依赖失败时，主链路不能挂死

具体做法：

- 为读模型、向量检索、`storage` 写回提供统一超时和降级策略

## 6. 触发点到底怎么定

首版固定 6 个触发点。

### 6.1 `onSessionStart`

解决的问题：

- 新会话开始时要恢复稳定偏好和当前活跃上下文

默认召回：

- `fact_preference`
- 当前活跃 `task_state`

### 6.2 `onTaskStart`

解决的问题：

- 开一个已有任务时，需要把这个任务历史目标和状态拿回来

默认召回：

- 当前 `task_id` 相关 `task_state`
- 高重要度 `episodic`

### 6.3 `onTaskSwitch`

解决的问题：

- 用户切到另一个任务时，旧任务上下文要让位，新任务上下文要进来

默认召回：

- 新任务 `task_state`
- 与新任务相关的 `fact_preference`

### 6.4 `onBeforePlan`

解决的问题：

- 规划前不先恢复约束和任务状态，后续计划很容易偏

默认召回：

- `fact_preference`
- 当前 `task_state`

### 6.5 `onBeforeResponse`

解决的问题：

- 当前轮回答前要做最核心的一次主动注入

默认召回：

- 当前输入相关的所有候选类型

### 6.6 `onAfterResponse`

解决的问题：

- 一轮结束后要判断有没有新记忆可写

默认动作：

- 不做召回
- 只做写回检查

## 7. 触发判断规则先定死

### 7.1 硬触发

命中下列条件之一，直接查：

- `phase` 是 `session_start`
- `phase` 是 `task_start`
- `phase` 是 `task_switch`
- `phase` 是 `before_plan`
- 当前输入含历史提示词：
  - 中文：`上次`、`之前`、`你还记得`、`我一般`、`以前`、`之前说过`
  - 英文：`last time`、`previously`、`before`、`do you remember`、`I usually`、`I prefer`、`we discussed`
  - 首版先覆盖中英文，后续可按需扩展其他语言

### 7.2 语义兜底

只有硬触发没命中时才执行。

做法：

- 用当前输入 embedding（向量）和活跃记忆做快速比对
- 最高相似度超过阈值时，再触发一次查询

首版约束：

- 阈值设高
- 宁可漏掉，不乱触发

### 7.3 不触发条件

以下场景默认不查：

- 当前输入过短且无历史指向
- 系统正在做纯执行收尾，且当前轮不需要面向用户生成
- 前一轮刚完成同主题召回，且冷却窗口未过

## 8. 查询链路怎么做

### 8.1 查询来源

只读：

- `storage_shared_v1.memory_read_model_v1`

绝不读：

- `storage_private.*`

### 8.2 硬过滤字段

固定按下面规则收窄：

1. 先固定 `status=active`
2. 再按 `memory_mode` 决定本轮允许的 scope
3. `scope=workspace` 时要求 `workspace_id = 当前工作区`
4. `scope=user` 时要求 `user_id = 当前用户`，不再要求 `workspace_id = 当前工作区`
5. `scope=task` 时要求 `workspace_id = 当前工作区` 且 `task_id = 当前任务`
6. `scope=session` 时要求 `workspace_id = 当前工作区` 且 `session_id = 当前会话`
7. 最后再按 `memory_type` 和 `importance >= threshold` 收窄

当前阶段再补两条正式规则：

- `memory_mode=workspace_only` 时默认不读取 `scope=user`
- `memory_mode=workspace_plus_global` 时允许同时读取 `scope=workspace` 和 `scope=user`

### 8.3 软排序字段

排序输入包括：

- 向量相似度
- `importance`
- `confidence`
- `updated_at`
- `scope_boost`

### 8.4 重排公式

首版固定走规则重排，不用模型重排。

可以按下面思路实现：

- `semantic_score * 0.45`
- `importance_score * 0.25`
- `confidence_score * 0.15`
- `recency_score * 0.10`
- `scope_match_score * 0.05`

目的：

- 相关性优先
- 但不能让低可信、高相似的噪声记录排太前

### 8.5 条数控制

首版固定：

- 硬过滤后最多取前 30 条
- 重排后进入 `MemoryPacket` 的原始候选最多 10 条

## 9. 注入块怎么生成

### 9.1 优先级

固定顺序：

1. `fact_preference`
2. `task_state`
3. `episodic`

### 9.2 生成规则

1. 先生成一段 `memory_summary`
2. 再补少量支撑记录
3. 预算不够时先裁 `episodic`
4. 预算还不够时保留摘要，删支撑记录

### 9.3 默认预算

首版先固定：

- 主摘要 1 段
- 支撑记录最多 3 条
- 总 token 估算预算默认 300 到 600

### 9.4 注入格式

给宿主的结构固定如下：

- 为什么这轮注入
- 这一轮最重要的历史摘要
- 少量具体记录

目的是：

- 宿主容易拼接
- 模型容易理解
- 页面容易解释

## 10. 写回到底怎么判

### 10.1 首版允许写回的内容

- 新偏好
- 新稳定事实
- 任务目标变化
- 任务状态变化
- 明确承诺
- 对后续有影响的重要事件

### 10.2 首版拒绝写回的内容

- 一次性闲聊
- 推理中间草稿
- 未确认猜测
- 工具输出噪声
- 重复表达

### 10.3 写回提取流程

1. 读取当前轮输入摘要
2. 读取当前轮最终输出摘要
3. 读取工具结果摘要
4. 按规则抽取候选
5. 做重复判定和价值判定
6. 生成 `WriteBackCandidate[]`
7. 提交给 `storage`

### 10.4 为什么这里也要做重复判定

因为 `storage` 虽然也会去重，但这里先挡一层有两个好处：

- 降低无效写入量
- 减少存储层冲突和重复处理压力

### 10.5 写回提取的技术方案

首版写回提取采用 **轻量 LLM 调用 + 规则兜底** 的方案。

原因：

- 判断"这句话是不是新偏好"或"这段对话中是否包含任务目标变化"，纯关键词规则很难覆盖自然语言的多样性。
- 但写回提取不在用户等待的主链路上（它发生在 `onAfterResponse`，用户已经拿到回复），所以对延迟敏感度较低。

具体做法：

1. 用轻量 LLM（推荐 `haiku` 级别）对本轮输入 + 输出做结构化信息提取，输出格式固定为 `WriteBackCandidate[]`。
2. 如果 LLM 调用失败或超时，回退到基于关键词和模式匹配的规则提取，宁可漏掉也不阻塞。
3. 提取后仍然要经过重复判定和价值判定，LLM 的提取结果不直接等于最终写回候选。

约束：

- 首版 LLM 调用的超时上限固定为 5 秒。
- 超时或失败只记录降级日志，不影响当前轮结束。
- 每轮最多提取 3 条写回候选，超过部分按重要度排序截断。
- 后续如果 LLM 成本或延迟不可接受，可以退回纯规则方案，但首版先跑 LLM 方案验证提取质量。

## 11. 运行时表怎么配合

### 11.1 `runtime_turns`

记录：

- 一轮从哪来
- 当前是什么 phase
- 输入和输出摘要

它解决的问题：

- 后面查某一轮时，有主键可以挂住整条链路

### 11.2 `runtime_recall_runs`

记录：

- 这轮有没有触发召回
- 为什么触发
- 查了什么范围
- 命中了哪些记录

它解决的问题：

- “为什么查了这些记忆”可以追溯

### 11.3 `runtime_injection_runs`

记录：

- 实际注入了什么
- 哪些候选被裁掉
- 为什么裁掉

它解决的问题：

- “为什么最后只注入这些”可以追溯

### 11.4 `runtime_writeback_submissions`

记录：

- 本轮抽了哪些写回候选
- 提交给 `storage` 的结果是什么

它解决的问题：

- “为什么没写回 / 为什么写回失败”可以追溯

### 11.5 `runtime_dependency_status`

记录：

- 读模型状态
- `storage` 状态
- 向量能力状态

它解决的问题：

- 页面可以区分“策略问题”和“依赖问题”

## 12. 接口怎么落

接口完整定义见 `docs/api-contract.md` 第 2 节。以下补充本层的行为约束和实现细节。

### 12.1 上下文准备接口

`POST /v1/runtime/prepare-context`

解决的问题：

- 宿主在当前轮开始前，需要拿到统一注入结果

请求体固定字段：

- `workspace_id`
- `user_id`
- `task_id`
- `session_id`
- `thread_id`
- `turn_id`
- `memory_mode`
- `phase`
- `current_input`
- `recent_context_summary`

返回固定字段：

- `trigger`
- `trigger_reason`
- `memory_packet`
- `injection_block`
- `degraded`
- `dependency_status`

### 12.2 回合结束接口

`POST /v1/runtime/finalize-turn`

解决的问题：

- 宿主在当前轮结束后，要统一做写回检查

请求体固定字段：

- `workspace_id`
- `user_id`
- `task_id`
- `session_id`
- `thread_id`
- `turn_id`
- `memory_mode`
- `current_input`
- `assistant_output`
- `tool_results_summary`

返回固定字段：

- `write_back_candidates`
- `submitted_jobs`
- `degraded`

### 12.3 运行轨迹接口

`GET /v1/runtime/observe/runs`

解决的问题：

- 页面需要按 turn 看完整轨迹

### 12.4 运行指标接口

`GET /v1/runtime/observe/metrics`

返回：

- 触发率
- 召回命中率
- 空检索率
- 实际注入率
- 注入裁剪率
- 写回提交率
- 查询 P95
- 注入 P95

## 13. 失败和边界场景

### 13.1 共享读模型不可用

处理：

- 返回 `degraded=true`
- `injection_block` 为空
- 宿主继续正常回答
- 写 `runtime_dependency_status`

### 13.2 向量能力不可用

处理：

- 只做结构化过滤
- 不做语义兜底和软排序
- 明确记成降级查询

### 13.3 `storage` 不可用

处理：

- 写回提交失败
- 只记录 `runtime_writeback_submissions`
- 不影响当前轮结束

### 13.4 当前输入过长

处理：

- 先做输入摘要
- 不直接拿整段大文本做查询向量

### 13.5 查询结果太多

处理：

- 在候选层限流
- 绝不把大列表直接交给注入引擎

### 13.6 连续重复触发

处理：

- 做 phase 冷却和主题冷却
- 同一 turn 内只允许一次主召回

## 14. 宿主接入时怎么用

这里和宿主适配方案保持一致。

### Claude Code

- 会话启动前后调用 `prepare-context`
- 回复完成后调用 `finalize-turn`

### Codex

- 在 `turn/start` 前调用 `prepare-context`
- 在 `turn/completed` 后调用 `finalize-turn`

### 自研 agent

- 用 SDK 的：
  - `onSessionStart`
  - `onTaskStart`
  - `onTaskSwitch`
  - `onBeforePlan`
  - `onBeforeResponse`
  - `onAfterResponse`

## 15. 开发顺序先按这个来

1. `runtime-repository`
2. `trigger-engine`
3. `query-engine`
4. `packet-builder`
5. `injection-engine`
6. `writeback-engine`
7. `dependency-guard`
8. `host-adapter-sdk`
9. 观测接口

## 16. 最后一句话

`retrieval-runtime` 这一层真正要落地的，不是“查一下记忆”，而是把宿主生命周期、查询排序、上下文裁剪和写回检查收成一条稳定、可解释、可降级的运行时链路。
