# Memory-Native-Agent 分级记忆注入改造方案

> 这份文档只解决一件事：
> 让 `MNA`（memory-native-agent）把“召回到的记忆”分级注入到模型上下文里，同时保持 provider（模型适配层）协议稳定，不引入非标准 `role`（角色）。

---

## 当前状态

- [x] 已确认现状链路：`prepare-context`（准备上下文）先召回，再由 `Conversation.buildMessages()` 直接拼成一个或多个 `<memory_injection>` 的 `system`（系统）消息
- [x] 已确认现有 provider 仅稳定支持 `system / user / assistant / tool`
- [x] 已确认存储主链路不需要因为“注入分级”而改 schema（表结构）
- [x] 已确认真正需要改的是 `runner / prompt 组装 / 调试回放 / 可观测展示`
- [x] 分级记忆注入已完成第一阶段实现，内部已支持 `high / medium / summary`
- [x] 调试接口与提示词检查面板已能看到 `prompt_segments`（提示片段）分层结果
- [ ] `record-replay`（录制回放）增强项 `debug_prompt_segments`（调试片段摘要）仍未启用，不影响当前主链路

---

## 1. 目标先定清楚

这次要做的不是：

- 给模型真的新增一个 `role: "memory"`
- 让 OpenAI / Anthropic / Ollama 都去接收一个新的外部消息协议
- 修改记忆库的存储结构，让每条记忆都永久带上注入层级

这次真正要做的是：

- 在 `MNA` 内部引入 `memory segment`（记忆片段）这一层抽象
- 先把召回结果整理成“高优先记忆 / 中优先记忆 / 摘要记忆”
- 再把这些内部片段编译成标准 `system` 消息发给模型

一句话就是：

`内部有分级，外部仍然只发标准消息`

---

## 2. 为什么不直接加 `role: "memory"`

这个结论已经比较明确：

1. 当前 provider 类型只支持：
   - `system`
   - `user`
   - `assistant`
   - `tool`
2. `openai-compatible`、`anthropic`、`ollama` 这三层都默认按标准聊天协议转发消息
3. 如果直接把 `memory` 当真实外部角色发出去：
   - 有的模型接口不会接受
   - 有的模型即便接受，也不一定有一致语义
   - `record-replay` 的消息摘要、调试接口、前端类型、会话回放都会一起被打穿

所以这里的正确边界应该是：

- `memory role` 只作为内部抽象存在
- 发给模型之前必须编译成标准 `ChatMessage[]`

---

## 3. 设计结论

### 3.1 外部协议保持不变

最终发给模型的结构仍然是：

```json
[
  { "role": "system", "content": "core system prompt" },
  { "role": "system", "content": "<memory_injection tier=\"high\">...</memory_injection>" },
  { "role": "system", "content": "<memory_injection tier=\"medium\">...</memory_injection>" },
  { "role": "system", "content": "<memory_summary>...</memory_summary>" },
  { "role": "user", "content": "..." }
]
```

### 3.2 内部引入 `PromptSegment`

`Conversation`（对话窗口）不再直接从“记忆注入结果”生成最终消息，而是先生成提示片段：

```ts
type PromptSegment =
  | { kind: "core_system"; priority: "fixed"; content: string }
  | { kind: "memory_high"; priority: "high"; content: string; source: MemorySegmentSource }
  | { kind: "memory_medium"; priority: "medium"; content: string; source: MemorySegmentSource }
  | { kind: "memory_summary"; priority: "low"; content: string; source: MemorySegmentSource }
  | { kind: "history_summary"; priority: "low"; content: string }
  | { kind: "conversation"; priority: "dynamic"; message: ChatMessage };
```

然后单独做一步：

`PromptSegment[] -> ChatMessage[]`

### 3.3 分级逻辑先放在 `memory-native-agent`

第一阶段不改 `retrieval-runtime` 的对外返回结构。

也就是说：

- `retrieval-runtime` 仍然返回一个 `injection_block`
- `MNA` 在本地对 `injection_block.memory_records` 做二次分级
- 分级完成后生成多段 `memory segment`

这样改动面最小，也更容易验证。

### 3.4 存储层先不动主 schema

这次不改：

- 记忆写入表
- 读模型表
- 向量列
- 记忆回写逻辑

只在 `MNA` 自己的会话调试存储里补充“分段提示”的可观察数据。

---

## 4. 分阶段实施策略

### 第一阶段：只改 `memory-native-agent`

目标：

- 内部支持分级
- 最终仍发送标准 `system` 消息
- 调试与面板能看到分层结果

状态：

- [x] 已完成

### 第二阶段：增强 `retrieval-runtime`

目标：

- 让检索侧直接产出更明确的 `tiered_injection_plan`（分级注入计划）
- 把分级职责从 `MNA` 前移到注入引擎

状态：

- [ ] 暂不启动

### 第三阶段：做策略迭代

目标：

- 根据线上效果调分级规则
- 优化 token 预算和注入收益

状态：

- [ ] 暂不启动

---

## 5. 第一阶段完整开发范围

## 5.1 `runner`（运行时主链路）

### 5.1.1 新增内部提示片段模型

要做什么：

- 在 `services/memory-native-agent/src/runner` 下新增 `prompt-segments.ts`
- 定义：
  - `PromptSegment`
  - `MemorySegmentSource`
  - `TieredInjectionResult`
  - `compilePromptSegments()`（编译为标准消息）
- 明确片段顺序规则：
  1. `core_system`
  2. `memory_high`
  3. `memory_medium`
  4. `memory_summary`
  5. `history_summary`
  6. 最近会话消息

对应状态：

- [x] 已完成

### 5.1.2 从“直接拼 system message”改成“先产 segment”

当前现状：

- `Conversation.buildMessages()` 直接把记忆注入块转成 `system` 消息

要改成：

- `Conversation.buildPromptSegments()` 返回 `PromptSegment[]`
- `Conversation.buildMessages()` 内部调用 `compilePromptSegments()`
- 对外保留 `buildMessages()`，避免一次性打穿其他调用点

对应文件：

- `src/runner/conversation.ts`

对应状态：

- [x] 已完成

### 5.1.3 在 `agent-runner` 增加“分级决策”步骤

要做什么：

- 在收到 `prepare-context` 返回的 `injection_block` 之后，不再直接塞进 `injections`
- 先调用 `tierMemoryInjection()` 之类的方法，把：
  - `memory_summary`
  - `memory_records`
  - `phase`
  - `scope`
  - `importance`
  - `confidence`
  组装成分级结果

第一阶段建议的简单分级规则：

1. `high`
   - `memory_type = fact_preference`
   - 且 `importance >= 0.85`
   - 或 `confidence >= 0.9`
2. `medium`
   - `memory_type = task_state`
   - 或 `fact_preference / episodic` 但分数没进高优先
3. `summary`
   - 所有未进入前两层但本轮有价值的记录，只保留聚合摘要，不逐条展开

要注意的点：

- `high` 不能过多，建议最多 3 条
- `medium` 建议最多 5 条
- `summary` 只保留一段短文本
- phase 不同的注入结果合并时，仍保留 phase 来源

对应文件：

- `src/runner/agent-runner.ts`
- 新增 `src/runner/memory-tiering.ts`

对应状态：

- [x] 已完成

### 5.1.4 保留 token budget 约束

要做什么：

- 分级之后，仍然要接入现有 token budget（token 预算）机制
- 优先保证：
  - `core_system`
  - `memory_high`
  - 当前用户消息
- `memory_medium` 和 `memory_summary` 可被裁剪
- 历史摘要应该低于高优先记忆，但高于很旧的对话消息

这一步不能只按消息条数裁剪，必须继续走 token 估算。

对应文件：

- `src/runner/conversation.ts`
- `src/runner/token-budget.ts`

对应状态：

- [x] 已完成

---

## 5.2 分级规则模块

### 5.2.1 新增可测试的纯函数模块

要做什么：

- 新增一个纯函数模块，不把规则散落在 `agent-runner`
- 输入：
  - `phase`
  - `injection_block`
  - 配置阈值
- 输出：
  - `highRecords`
  - `mediumRecords`
  - `summaryText`
  - `droppedRecords`

建议输出形态：

```ts
interface TieredInjectionResult {
  phase: string;
  high: InjectionRecord[];
  medium: InjectionRecord[];
  summary: string | null;
  dropped: Array<{ id: string; reason: "limit" | "score" | "duplicate" }>;
}
```

对应状态：

- [x] 已完成

### 5.2.2 先用静态规则，不接模型

这一步不要做：

- 不要让模型自己判断某条记忆进哪一层
- 不要引入新的 LLM 分类请求

第一阶段就用规则法：

- 稳
- 可解释
- 可测
- 易回归

对应状态：

- [x] 已完成

### 5.2.3 去重规则要提前定义

要做什么：

- 同一条 summary 重复时，只保留分数更高的一条
- 同一个 `memory_type + scope + normalized summary` 的记录，只保留一个
- 如果一条进了 `high`，就不要再出现在 `medium` 或 `summary` 中

对应状态：

- [x] 已完成

---

## 5.3 调试存储与会话检查

### 5.3.1 `dispatched_messages` 需要新增 `prompt_segments_json`

当前现状：

- `dispatched_messages` 只保存最终 `messages_json`

问题：

- 以后最终发给模型的仍然是标准 `system` 消息
- 如果只看 `messages_json`，你看不出来哪段是 `high memory`，哪段是 `summary`

所以要做：

- 在 `dispatched_messages` 表新增 `prompt_segments_json TEXT NULL`
- 每轮保存最终 `messages_json` 时，同时保存分段结构

建议字段内容：

```json
[
  { "kind": "core_system", "priority": "fixed", "preview": "你是 memory-native-agent..." },
  { "kind": "memory_high", "priority": "high", "phase": "before_response", "record_ids": ["mem_1"] },
  { "kind": "memory_summary", "priority": "low", "phase": "before_response", "preview": "用户长期偏好中文回答..." }
]
```

对应文件：

- `src/session-store/migrations/*`
- `src/session-store/sqlite-store.ts`
- `src/session-store/types.ts`

对应状态：

- [x] 已完成

### 5.3.2 HTTP 调试接口补充返回值

要做什么：

- `GET /v1/agent/turns/:turnId/dispatched-messages`
- 在现有返回里新增：
  - `prompt_segments`
  - 或 `prompt_segments_json` 解码结果

目的：

- 前端调试面板能直接显示“注入分层”

对应文件：

- `src/http/routes/sessions.ts`

对应状态：

- [x] 已完成

### 5.3.3 运行时事件里补充分级摘要

要做什么：

- `emitInjectionBanner` 保持兼容
- 但额外增加：
  - `tier_counts`
  - `high_summary`
  - `medium_summary`
  - `summary_only`

注意：

- 老前端字段先不要删
- 新字段增量加上去

对应文件：

- `src/http/state.ts`
- `src/runner/agent-runner.ts`

对应状态：

- [x] 已完成

---

## 5.4 前端可视化

### 5.4.1 类型层补充 `prompt_segments`

要做什么：

- 给前端 `openapi-types.ts` 加新字段
- 保持 `messages` 结构不变
- 另加一个 `prompt_segments?: PromptSegmentView[]`

对应文件：

- `services/visualization/src/app/agent/_lib/openapi-types.ts`

对应状态：

- [x] 已完成

### 5.4.2 提示词检查面板展示分层结果

要做什么：

- 在“本轮发给模型的消息”之外，增加一层“内部提示结构”展示
- 至少展示：
  - `core_system`
  - `memory_high`
  - `memory_medium`
  - `memory_summary`
  - `history_summary`

每层建议显示：

- 类型
- phase
- 条数
- preview
- record id 列表

对应状态：

- [x] 已完成

### 5.4.3 会话线程不新增 `memory` 气泡

这里要明确：

- 不要在普通聊天线程里把 `memory` 当用户可见消息展示
- 分级记忆属于调试信息，不是正常会话气泡

也就是说：

- 聊天线程 UI 不动
- 调试面板新增分级区块

对应状态：

- [x] 已完成

---

## 5.5 `record-replay`（录制回放）

### 5.5.1 需要兼容新的调试字段，但不要改变 provider 输入协议

当前现状：

- `record-replay` 通过最终 `messages` + `tools` 计算摘要 key

第一阶段建议：

- 不要把 `prompt_segments` 纳入 provider 请求摘要 key
- 仍然只以最终 `messages` 为准

原因：

- 回放系统关注的是“发给模型的最终请求是否一致”
- 内部分级结构是调试信息，不应强制使所有 fixture（样本）失效

对应状态：

- [x] 已完成

### 5.5.2 可选增加 `debug_prompt_segments`

要做什么：

- 录制文件里可以附带保存 `prompt_segments_digest`
- 但不进入匹配 key
- 只用于排查“内部片段变了，但最终消息没变”的情况

这一项是增强项，不阻塞主改造。

对应状态：

- [ ] 可选，暂不阻塞

---

## 5.6 Provider 层

### 5.6.1 第一阶段不改 provider 消息协议

明确约定：

- `src/providers/types.ts` 里的 `ChatMessage.role` 先不新增 `memory`
- `openai-compatible`
- `anthropic`
- `ollama`
- `demo`
- `record-replay`

这些 provider 都继续接收标准消息

这部分的状态应该是：

- [x] 已确定不做协议变更

### 5.6.2 provider 测试只需要验证兼容性

要做什么：

- 补一组测试，确认多段 `system` memory block 仍能被各 provider 正常映射
- 不需要新增“memory role 转换测试”，因为第一阶段没有这个角色

对应状态：

- [x] 已完成

---

## 5.7 `retrieval-runtime`

### 5.7.1 第一阶段不改 API

当前结论：

- `prepare-context` 仍返回：
  - `memory_packet`
  - `injection_block`

不新增：

- `memory_tiers`
- `tiered_injection_plan`
- `prompt_segments`

这一步是为了控制改动面。

对应状态：

- [x] 已确定第一阶段不改

### 5.7.2 第二阶段可前移职责

后续如果第一阶段验证通过，可以再做：

- `InjectionEngine.build()` 不再只产一个扁平 `InjectionBlock`
- 改成产：
  - `high_records`
  - `medium_records`
  - `summary_text`
  - `trimmed_record_ids`

这样 `MNA` 只负责编译，不再负责业务分级。

这一项本轮不启动。

对应状态：

- [ ] 后续再议

---

## 5.8 存储层影响范围

### 5.8.1 记忆主存储不改

明确不改：

- `services/storage`
- 写回 outbox
- 读模型投影
- embeddings（向量）
- 记忆查回接口

对应状态：

- [x] 已确认不需要改

### 5.8.2 只改 `MNA` 本地会话调试存储

会动的只有：

- `dispatched_messages`
- 可能新增 migration
- 相关读取与 HTTP 返回

对应状态：

- [x] 已完成

---

## 6. 详细任务拆分

## T1. 建立内部分段模型

具体要做什么：

1. 新增 `src/runner/prompt-segments.ts`
2. 定义 `PromptSegment`、`PromptSegmentView`
3. 定义 `compilePromptSegments()`
4. 定义 segment 顺序常量
5. 为这套纯函数补单测

验收标准：

- 能把片段编译成稳定的 `ChatMessage[]`
- 顺序可预测
- 同样输入得到同样输出

状态：

- [x] 已完成

## T2. 建立记忆分级器

具体要做什么：

1. 新增 `src/runner/memory-tiering.ts`
2. 输入 `InjectionBlock`
3. 输出 `TieredInjectionResult`
4. 加入分数阈值、条数上限、去重规则
5. 补单测覆盖：
   - 高优先命中
   - 中优先命中
   - 只保留摘要
   - 重复去重
   - 限额裁剪

验收标准：

- 分级结果不依赖 provider
- 纯函数可回归

状态：

- [x] 已完成

## T3. 改造 `Conversation`

具体要做什么：

1. 让 `Conversation` 支持接收 `PromptSegment`
2. 把原来的 `buildInjectionBlock()` 拆掉或下沉为编译器的一部分
3. 接入 token budget
4. 保持工具消息、历史摘要、普通用户消息行为不变

验收标准：

- 不带记忆时行为与现在一致
- 带记忆时顺序符合新约定

状态：

- [x] 已完成

## T4. 改造 `AgentRunner`

具体要做什么：

1. `safePrepareContext()` 返回后先做 tiering
2. 构建 `prompt segments`
3. 保存 `prompt_segments_json`
4. 继续保存最终 `messages_json`
5. 保持多轮 tool loop 里每一轮重新构建消息时逻辑一致

验收标准：

- 第一轮和工具回合后的第二轮都能保留同样的分级记忆结构
- 不影响 `finalize-turn`

状态：

- [x] 已完成

## T5. 扩展 session store

具体要做什么：

1. 给 `dispatched_messages` 加 migration
2. 新增 `prompt_segments_json`
3. 更新保存接口类型
4. 更新读取接口类型
5. 保证旧库升级兼容

验收标准：

- 老数据库自动迁移后可读
- 新字段为空时旧逻辑不报错

状态：

- [x] 已完成

## T6. 扩展 HTTP 调试接口

具体要做什么：

1. `turns/:id/dispatched-messages` 增加 `prompt_segments`
2. 事件态里增加 tier 概览
3. 保持旧字段兼容

验收标准：

- 前端不改也不报错
- 前端改完后能直接读到层级信息

状态：

- [x] 已完成

## T7. 扩展前端调试面板

具体要做什么：

1. 增加类型定义
2. 增加分层展示区
3. 保持聊天线程不显示记忆气泡
4. 给高优先和摘要做不同视觉样式

验收标准：

- 能直接看出一轮请求里哪些记忆是高优先，哪些只是摘要

状态：

- [x] 已完成

## T8. 回归测试

具体要做什么：

1. `runner` 单测
2. `conversation` 单测
3. `session-store` 单测
4. `http` 单测
5. `visualization` 单测
6. `e2e` 至少补一条：
   - 触发写入
   - 下一轮召回
   - 调试面板能看到 tier 结果

验收标准：

- 新增用例通过
- 老的 provider 行为不回退

状态：

- [x] 已完成

---

## 7. 具体文件变更清单

### 必改

- `services/memory-native-agent/src/runner/agent-runner.ts`
- `services/memory-native-agent/src/runner/conversation.ts`
- `services/memory-native-agent/src/session-store/sqlite-store.ts`
- `services/memory-native-agent/src/session-store/types.ts`
- `services/memory-native-agent/src/http/routes/sessions.ts`
- `services/memory-native-agent/src/http/state.ts`
- `services/visualization/src/app/agent/_lib/openapi-types.ts`

### 新增

- `services/memory-native-agent/src/runner/prompt-segments.ts`
- `services/memory-native-agent/src/runner/memory-tiering.ts`
- `services/memory-native-agent/src/session-store/migrations/<new-migration>.sql`
- 对应测试文件

### 暂不改

- `services/memory-native-agent/src/providers/types.ts`
- `services/memory-native-agent/src/providers/openai-compatible.ts`
- `services/memory-native-agent/src/providers/anthropic.ts`
- `services/memory-native-agent/src/providers/ollama.ts`
- `services/retrieval-runtime/src/runtime-service.ts`
- `services/storage/*`

---

## 8. 风险与注意事项

### 8.1 不要把高优先记忆做成新的硬指令层

即便叫 `high`，它也还是“更值得被看到的事实”，不是“覆盖用户当前意图的命令”。

所以生成的文案仍要保留这个边界：

- 这是 recalled memory（召回事实）
- 不是 current instruction（当前任务指令）

状态：

- [x] 已确认

### 8.2 不要让 `high` 层无限膨胀

如果高优先层过长，就会重新变成今天的问题：

- 权重太高
- token 太贵
- 影响当前任务

所以第一阶段必须带硬上限。

状态：

- [x] 已确认

### 8.3 先保兼容，再谈更优雅的协议

第一阶段成功的标准不是“设计最漂亮”，而是：

- provider 不用改
- 前端能看懂
- 回放不炸
- 线上能稳定跑

状态：

- [x] 已确认

---

## 9. 推荐实施顺序

### Sprint 1

1. `PromptSegment` 模型
2. `memory-tiering` 纯函数
3. `Conversation` 改造
4. `runner` 接入

状态：

- [x] 已完成

### Sprint 2

1. `session-store` migration
2. HTTP 调试接口
3. 前端类型与提示词检查面板

状态：

- [x] 已完成

### Sprint 3

1. `e2e` 回归
2. 指标与展示微调
3. 评估是否前移到 `retrieval-runtime`

状态：

- [x] 已完成

---

## 10. 最终交付标准

这次改造完成后，至少要满足下面这些条件：

1. 最终发给模型的消息仍然是标准 `system / user / assistant / tool`
2. 内部已经能区分：
   - `memory_high`
   - `memory_medium`
   - `memory_summary`
3. 调试接口能直接看到 prompt segments（提示片段）
4. 前端面板能直接展示本轮记忆分层
5. `record-replay` 不因为内部结构调整而整体失效
6. 存储主链路不需要迁移记忆库 schema

当前状态：

- [x] 第一阶段开发、测试、调试展示与 `e2e`（端到端）回归已完成；第二阶段与可选增强项未启动

---

## 11. 一句话结论

这次改造最稳的路径是：

先在 `memory-native-agent` 内部引入分级提示片段，把召回记忆拆成多段标准 `system` 消息，同时补齐调试存储和面板展示；provider、retrieval-runtime、storage 主链路先不动。
