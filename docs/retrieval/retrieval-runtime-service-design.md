# retrieval-runtime 服务设计文档

## 当前验收状态（2026-04-16）

### 已完成

- 服务主职责已经落地，触发、检索、注入、写回检查和运行轨迹都已经形成完整链路。
- 对 agent 进程的处理方式已经落地成生命周期接入，而不是侵入模型推理本身。
- 依赖失败时的降级行为已经接好，`storage`、读模型或 embedding 失败不会拖挂宿主进程。
- 运行时观测已经能分段记录 `turn / trigger / recall / injection / writeback`，可以回看每轮发生了什么。
- 同一轮 `prepare-context / finalize-turn` 现在会复用同一条 `trace_id`，运行轨迹详情已经能真实按五段聚合。
- `Codex` 宿主工具面已经包含正式可用的 `memory_search` 和 `memory_explain_hit`。

### 当前结论

- 这份服务设计文档对应的核心服务能力已经落地完成，当前阶段可以按正式能力验收。

## 1. 文档目标

这份文档只讲 `retrieval-runtime` 服务怎么落地。

重点回答：

- 这个服务要做什么
- 它对 agent 进程要做什么处理
- 运行时要怎么查、怎么注入、怎么写回
- 要暴露什么接口
- 这些接口怎么被 agent 使用

## 2. 这个服务要解决什么问题

`retrieval-runtime` 要解决下面这些问题：

- 模型自己不会稳定查记忆
- 什么时候触发召回需要外部系统固定判断
- 检索结果不能原样丢给模型
- 上下文预算必须受控
- 一轮结束后哪些内容该写回，需要有固定检查

一句话说：

它负责把“存好的记忆”在运行时变成“当前轮可用的上下文”。

## 3. 服务职责

`retrieval-runtime` 首版职责固定如下：

- 判断触发时机
- 构造检索请求
- 从共享读模型读取候选记忆
- 排序、裁剪、生成记忆包
- 生成注入块
- 在响应结束后提取写回候选
- 调用 `storage` 提交写回
- 输出运行时观测数据
- 提供 agent 侧 SDK

## 4. 服务边界

`retrieval-runtime` 的职责边界和不负责事项见 `memory-retrieval-product.md` 第 6 节和 `memory-injection-product.md` 第 6 节。

概括来说：它是独立服务，允许读取 `storage` 发布的共享只读读模型。不负责正式记忆入库和治理、数据库写表维护、页面展示逻辑、代替 agent 做任务推理。

## 5. 对 agent 进程要做什么处理

这部分是首版最关键的落地点。

### 5.1 不侵入模型推理本身

`retrieval-runtime` 不嵌进模型内部，也不改模型推理引擎。

它对 agent 做的是生命周期接入，而不是模型内改造。

### 5.2 在 agent 进程里的接入点

首版固定 6 个接入点：

- `onSessionStart`
- `onTaskStart`
- `onTaskSwitch`
- `onBeforePlan`
- `onBeforeResponse`
- `onAfterResponse`

### 5.3 对 agent 的具体处理方式

#### 5.3.1 `onBeforeResponse`

要做的事：

- 判断这轮是否需要召回
- 如果需要，就查记忆
- 生成 `injection_block`
- 返回给 agent

agent 的处理：

- 把 `injection_block` 放进 prompt（提示词）或上下文装配层
- 再继续正常推理

#### 5.3.2 `onAfterResponse`

要做的事：

- 接收本轮输入摘要和输出摘要
- 做写回检查
- 提取写回候选
- 提交给 `storage`

agent 的处理：

- 正常结束当前轮
- 不等待异步写入完成

### 5.4 对 agent 的运行要求

- 如果 `retrieval-runtime` 正常，agent 能拿到注入块
- 如果 `retrieval-runtime` 超时或依赖不可用，agent 继续回答，只是没有记忆增强
- 依赖失败不能把 agent 主进程拖挂

## 6. 内部模块设计

首版代码层建议拆成下面 8 个模块：

### 6.1 `sdk`

职责：

- 给 agent 暴露生命周期方法
- 封装 HTTP 调用
- 做超时和降级包装

### 6.2 `trigger-engine`

职责：

- 判断是不是会话开始、任务开始、任务切换、规划前、历史提及、响应后
- 没命中固定触发时，再做语义兜底判断

### 6.3 `query-engine`

职责：

- 读取共享读模型
- 先做结构化过滤
- 再做向量排序
- 返回候选记录

### 6.4 `packet-builder`

职责：

- 把候选记录整理成 `MemoryPacket`
- 补上 `packet_summary`
- 补上 `injection_hint`

### 6.5 `injection-engine`

职责：

- 根据优先级决定保留哪些记录
- 做预算控制
- 生成最终注入块

### 6.6 `writeback-engine`

职责：

- 从回合结果里提取可写回信息
- 生成 `WriteBackCandidate`
- 调用 `storage`

### 6.7 `dependency-guard`

职责：

- 处理 `storage` 不可用
- 处理查询超时
- 返回显式降级状态

### 6.8 `runtime-observer`

职责：

- 输出触发、查询、注入、写回事件
- 输出运行时指标

## 7. 核心流程设计

### 7.1 查询与注入流程

1. agent 调 SDK 的 `onBeforeResponse`
2. `trigger-engine` 判断触发原因
3. `query-engine` 读取共享读模型
4. `packet-builder` 生成 `MemoryPacket`
5. `injection-engine` 生成 `injection_block`
6. SDK 把结果返回给 agent
7. agent 把 `injection_block` 加入上下文
8. agent 正常调用模型

### 7.2 写回流程

1. agent 调 SDK 的 `onAfterResponse`
2. `writeback-engine` 判断是否产生新记忆
3. 生成 `WriteBackCandidate`
4. 调用 `storage`
5. 收到 `accepted_async` 或失败状态
6. 输出运行时观测数据

## 8. 运行时查询怎么做

### 8.1 查询来源

查询只读取：

- `storage` 发布的 `memory_read_model_v1`

不读取：

- `storage` 私有写表

### 8.2 查询步骤

固定两步：

1. 硬过滤
2. 软排序

硬过滤字段：

- `workspace_id`
- `user_id`
- `task_id`
- `scope`
- `memory_type`
- `status`
- `importance`

固定过滤规则：

- `scope=workspace` 时必须落在当前 `workspace_id`
- `scope=user` 时只按当前 `user_id` 过滤，`workspace_id` 只保留为来源工作区解释
- `scope=task` 时要求 `workspace_id + task_id`
- `scope=session` 时要求 `workspace_id + session_id`
- `memory_mode=workspace_only` 时默认不查 `scope=user`
- `memory_mode=workspace_plus_global` 时允许同时查 `scope=workspace + scope=user`

软排序字段：

- `summary_embedding`

### 8.3 查询结果怎么用

查询结果不会直接给 agent。

必须经过：

- `packet-builder`
- `injection-engine`

最后只给 agent 一个结构化注入块。

## 9. 注入怎么做

### 9.1 注入输出格式

注入块固定三部分：

- `injection_reason`
- `memory_summary`
- `memory_records`

### 9.2 注入优先级

固定顺序：

1. `fact_preference`
2. `task_state`
3. `episodic`

### 9.3 注入预算规则

- 单次默认只注入一个主记忆包
- 记录条数默认上限 3 到 7 条
- 优先保留摘要
- 预算不够时先删支撑记录
- 预算还不够时先删情节记忆

## 10. 写回怎么做

### 10.1 写回提取对象

首版只提取：

- 新偏好
- 新事实
- 任务目标变化
- 任务状态变化
- 明确承诺
- 重要事件

### 10.2 写回提交方式

固定调用：

- `POST /v1/storage/write-back-candidates`

### 10.3 写回提交规则

- 不阻塞当前轮结束
- 异步接收即可
- 失败时记录运行日志
- 不把失败伪装成成功

## 11. 对外接口设计

接口完整定义见 `docs/api-contract.md` 第 2 节。以下仅列出接口清单和用途。

### 11.1 上下文准备接口

`POST /v1/runtime/prepare-context`

作用：

- 给 agent 返回本轮注入块

请求体关键字段：

- `host`（支持 `claude_code_plugin`、`codex_app_server`、`custom_agent`、`memory_native_agent`）
- `workspace_id`
- `user_id`
- `task_id`
- `session_id`
- `thread_id`
- `memory_mode`
- `phase`
- `current_input`

返回体关键字段：

- `trigger`
- `memory_packet`
- `injection_block`
- `degraded`
- `dependency_status`

### 11.2 回合结束接口

`POST /v1/runtime/finalize-turn`

作用：

- 响应结束后做写回检查并提交 `storage`

请求体关键字段：

- `host`（支持 `claude_code_plugin`、`codex_app_server`、`custom_agent`、`memory_native_agent`）
- `workspace_id`
- `user_id`
- `task_id`
- `session_id`
- `thread_id`
- `memory_mode`
- `current_input`
- `assistant_output`
- `tool_results_summary`

返回体关键字段：

- `write_back_candidates`
- `submitted_jobs`
- `degraded`

### 11.3 运行轨迹接口

`GET /v1/runtime/observe/runs`

作用：

- 给 `visualization` 查看每一轮触发、查询、注入、写回轨迹

正式筛选参数只保留：

- `turn_id`
- `session_id`
- `trace_id`
- `page`
- `page_size`

### 11.4 运行指标接口

`GET /v1/runtime/observe/metrics`

作用：

- 给 `visualization` 看召回命中率、注入率、查询耗时等

## 12. 这些接口在哪里应用

- `POST /v1/runtime/prepare-context`
  用在 agent 回答前

- `POST /v1/runtime/finalize-turn`
  用在 agent 回答后

- 观测接口
  用在可视化运行轨迹页和指标看板

## 13. agent 怎么使用

首版 agent 接入方案固定如下：

### 13.1 主接入方式选型

结论先写清楚：

- 主方案不是 `MCP`（模型上下文协议）
- 主方案是 `HTTP 服务 + Agent 宿主侧中间件/薄 SDK`

原因：

- 这套记忆系统的核心要求是“系统主动触发召回”，而不是“模型想起来再调用工具”
- 如果把基础记忆召回做成 `MCP` 工具，默认会退回到模型驱动，和前面的产品约束冲突
- 所以 `MCP` 最多只能做补充能力，不能做主接入方式

这里固定一个原则：

`retrieval-runtime` 接在 agent 宿主层，不接在模型脑内。

### 13.2 MCP 在这套方案里的位置

首版口径固定如下：

- 不用 `MCP` 做基础记忆召回
- 可以在后续作为可选补充能力存在

如果以后要引入 `MCP`，建议只放在下面这类场景：

- 手动调试
- 人工排查
- 非主链路的深查工具

不建议把下面这些做成 `MCP`：

- 基础召回触发
- 上下文注入
- 回合结束写回

### 13.3 真正接入 agent 的位置

要接的不是“模型调用工具”这一层，而是 agent 宿主的请求编排层。

具体接入点一般在下面这些位置之一：

- `orchestrator`（编排器）
- `controller`（控制器）
- `middleware`（中间件）
- `runner`（执行器）

也就是说：

- 在宿主准备调用模型之前，先调 `retrieval-runtime`
- 在宿主拿到模型输出之后，再调 `retrieval-runtime`

### 13.4 对 agent 的具体接线方式

### 13.1 使用方式

- agent 引入 SDK
- 在生命周期节点调用 SDK
- SDK 调 `retrieval-runtime`

当前支持的宿主枚举已经统一为：

- `claude_code_plugin`
- `codex_app_server`
- `custom_agent`
- `memory_native_agent`

这里把调用链写成最直白的形式：

1. agent 收到用户输入
2. agent 宿主先调用 SDK 的 `onBeforeResponse`
3. SDK 请求 `POST /v1/runtime/prepare-context`
4. `retrieval-runtime` 返回 `injection_block`
5. agent 宿主把 `injection_block` 拼进当前轮上下文
6. agent 宿主再去调用模型
7. 模型返回结果后，agent 宿主调用 SDK 的 `onAfterResponse`
8. SDK 请求 `POST /v1/runtime/finalize-turn`
9. `retrieval-runtime` 做写回检查并提交 `storage`

所以“注入到 agent 里面”的动作，不是模型自己做的，而是 agent 宿主在调用模型前主动做的。

### 13.5 最小接法

最小只接两个点：

- `onBeforeResponse`
- `onAfterResponse`

这样就已经能跑：

- 运行时召回
- 注入
- 写回

### 13.6 完整接法

完整接六个点，能覆盖：

- 会话开始
- 任务开始
- 任务切换
- 规划前
- 响应前
- 响应后

### 13.7 一个最小接入示例

下面这个伪代码就是首版推荐接法：

```ts
async function runTurn(input: string, context: AgentContext) {
  const prepared = await memorySdk.onBeforeResponse({
    workspaceId: context.workspaceId,
    userId: context.userId,
    taskId: context.taskId,
    sessionId: context.sessionId,
    phase: "before_response",
    currentInput: input,
  });

  const modelMessages = buildMessages({
    input,
    injectionBlock: prepared.injectionBlock,
  });

  const output = await model.generate(modelMessages);

  await memorySdk.onAfterResponse({
    workspaceId: context.workspaceId,
    userId: context.userId,
    taskId: context.taskId,
    sessionId: context.sessionId,
    currentInput: input,
    assistantOutput: output.text,
  });

  return output;
}
```

这个例子里真正的关键点只有一个：

`injectionBlock` 不是模型自己查出来的，是 agent 宿主在调用模型之前主动塞进去的。

## 14. 约束条件

首版强约束：

- 不允许在 agent 进程里直接读数据库
- 不允许让模型自己决定基础召回
- 不允许把检索结果原样塞给 agent
- 不允许写回阻塞当前轮结束
- 不允许因为 `storage` 未启动就让 `retrieval-runtime` 服务退出

## 15. 服务未启动时的要求

如果 `storage` 未启动：

- `retrieval-runtime` 自己仍然启动
- 查询请求快速返回 `dependency_unavailable`
- 写回请求快速返回 `dependency_unavailable`
- 只影响当前请求，不影响服务状态

如果 `visualization` 未启动：

- 不影响 `retrieval-runtime` 自身运行

## 16. 首批落地任务

1. 实现 SDK
2. 实现 `trigger-engine`
3. 实现 `query-engine`
4. 实现 `packet-builder`
5. 实现 `injection-engine`
6. 实现 `writeback-engine`
7. 实现 `dependency-guard`
8. 实现 `prepare-context` 接口
9. 实现 `finalize-turn` 接口
10. 实现运行轨迹接口
11. 实现运行指标接口

## 17. 一句话方案

`retrieval-runtime` 服务的落地方案是：

在 agent 生命周期节点做固定触发、运行时检索、最小注入和回合结束写回检查，并把这些过程稳定暴露成独立服务接口和 SDK。
