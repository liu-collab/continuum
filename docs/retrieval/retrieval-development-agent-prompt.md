# retrieval-runtime 开发提示词

## 1. 这份提示词给谁

这份提示词给负责 `services/retrieval-runtime` 的开发 agent。

你的任务是把“运行时检索 + 注入 + 写回检查”这一层直接落成服务，不要再停留在生命周期描述层。

## 2. 先读哪些文档

开始写代码前，先完整阅读下面这些文档，并以它们为准：

- `docs/architecture-independence.md`
- `docs/memory-module-contract.md`
- `docs/retrieval/memory-retrieval-product.md`
- `docs/retrieval/memory-injection-product.md`
- `docs/retrieval/retrieval-runtime-service-design.md`
- `docs/retrieval/agent-host-integration-research.md`
- `docs/retrieval/host-integration-implementation-plan.md`
- `docs/retrieval/retrieval-runtime-implementation-spec.md`
- `services/retrieval-runtime/README.md`

如果文档之间出现冲突，优先级按下面执行：

1. `architecture-independence.md`
2. `memory-module-contract.md`
3. `host-integration-implementation-plan.md`
4. `retrieval-runtime-implementation-spec.md`
5. 其他说明文档

## 3. 你负责的范围

你只负责 `retrieval-runtime` 这一层。

代码目录固定在：

- `services/retrieval-runtime`

这层要做的是：

- 接收宿主生命周期事件
- 判断当前是否应该召回记忆
- 查询 `storage` 发布的共享读模型
- 生成 `MemoryPacket` 和最终 `InjectionBlock`
- 在一轮结束后生成写回候选并提交给 `storage`
- 记录运行轨迹和关键指标

这层不做的是：

- 不直接管理正式记忆写表
- 不读取 `storage` 私有写模型
- 不承担可视化页面逻辑
- 不把“是否需要记忆”完全交给模型自己决定

## 4. 这层要解决什么问题

你要通过代码解决下面这些问题：

### 4.1 记忆召回不能靠模型临场想起

需要让召回由宿主阶段和触发规则驱动，而不是靠模型自己决定要不要调函数。

### 4.2 查询必须快，而且顺序正确

需要固定“先硬过滤，再软排序，再重排”的查询流程。

### 4.3 查到了也不能原样塞进上下文

需要先整理 `MemoryPacket`，再裁成当前轮真正可注入的 `InjectionBlock`。

### 4.4 上下文预算必须受控

需要限制注入条数、优先级和 token 预算。

### 4.5 写回不能什么都写

需要在响应结束后只提取有沉淀价值的内容，再结构化提交给 `storage`。

### 4.6 依赖失败不能把宿主拖挂

需要保证 `storage` 不可用、embedding 服务超时、读模型暂时不可用时，宿主还能正常继续。

### 4.7 必须能解释每一轮发生了什么

需要留下 turn、trigger、recall、injection、writeback 的完整运行轨迹。

## 5. 你具体要做什么

### 5.1 初始化服务工程

在 `services/retrieval-runtime` 下补齐这批基础文件：

- `package.json`
- `tsconfig.json`
- `vitest.config.ts`
- `.env.example` 的正式字段说明
- 启动入口
- 日志、配置、错误处理基础设施

### 5.2 实现宿主接入层

要把宿主调用统一转成内部运行对象。

首版至少要支持下面两类接入：

- `Claude Code plugin`（Claude Code 插件）
- `Codex app-server adapter`（Codex 应用服务适配器）

要求：

- 宿主差异留在适配层
- 内部统一转成 `TriggerContext`
- 不把宿主特定实现散落到查询和注入模块

### 5.3 实现运行时主链路

至少实现这些模块：

- `prepare-context` 接口
- `finalize-turn` 接口
- `trigger-engine`
- `query-engine`
- `packet-builder`
- `injection-engine`
- `writeback-engine`

### 5.4 实现查询链路

查询链路要满足：

- 只读共享读模型
- 明确超时
- 明确降级
- 支持结构化过滤
- 支持语义排序和重排

### 5.5 实现注入链路

注入链路要把召回结果整理成可直接交给宿主的结构，至少包括：

- `injection_reason`
- `memory_summary`
- `memory_records`
- `token_estimate`

### 5.6 实现写回检查链路

写回链路要做：

- 从当前轮提取候选
- 过滤无价值内容
- 结构化候选
- 向 `storage` 提交
- 接收明确结果或降级状态

### 5.7 实现运行轨迹和指标

至少要能记录：

- 触发是否命中
- 查询范围
- 候选数和命中数
- 注入结果
- 写回候选数量
- 降级原因
- 耗时

## 6. 这层的输出物

你最终要交付的内容至少包括：

- `services/retrieval-runtime` 的可运行项目骨架
- 宿主适配层
- 运行时主链路实现
- 写回提交实现
- 观测接口和轨迹存储
- 基础测试
- 面向宿主的接入说明

## 7. 开发约束

你必须遵守下面这些约束：

- 不能直接读 `storage` 的私有写表
- 不能把页面逻辑写进来
- 不能要求 `storage` 启动失败时本服务也退出
- 不能把是否触发召回交给大模型自由决定
- 不能把未裁剪的大段记忆原样塞进注入块
- 所有跨服务调用都必须有限时和显式错误

## 8. 验收标准

完成后，至少要满足下面这些验收项：

### 8.1 工程层

- `services/retrieval-runtime` 可以单独安装依赖并启动
- 即使 `storage` 未启动，本服务仍能启动并返回降级结果
- 配置缺失时返回明确错误

### 8.2 接入层

- 宿主输入能统一转换成 `TriggerContext`
- 不同宿主的差异被限制在适配层
- 宿主能拿到稳定的注入输出结构

### 8.3 查询层

- 查询只依赖共享读模型
- 查询链路支持硬过滤、软排序、重排
- 查询超时或依赖失败时能快速降级

### 8.4 注入层

- 生成的 `InjectionBlock` 有明确摘要和支撑记录
- 注入结果受条数和预算控制
- 裁剪原因可追踪

### 8.5 写回层

- 只有结构化候选会被提交给 `storage`
- 无价值信息会被过滤
- `storage` 不可用时返回显式降级，不影响宿主继续执行

### 8.6 观测层

- 一轮至少能看到 turn、trigger、recall、injection、writeback 五段信息
- 能区分“没触发”“查空了”“查到了但没注入”“写回失败”

### 8.7 边界层

- 本服务不包含正式存储治理逻辑
- 本服务不包含页面展示逻辑
- `storage` 或 `visualization` 未启动时，本服务自身仍保持可运行

### 8.8 测试层

- 至少覆盖公开接口
- 至少覆盖触发命中和未命中
- 至少覆盖查询降级
- 至少覆盖注入裁剪
- 至少覆盖写回过滤和提交流程

## 9. 开发完成时怎么自检

请按这个顺序自检：

1. 宿主接入是否都收敛到适配层
2. 查询是否只读共享读模型
3. 触发、查询、注入、写回是否分层清楚
4. 依赖失败时是否快速降级
5. 运行轨迹是否足够解释一轮行为
6. 测试是否覆盖主链路和失败分支
