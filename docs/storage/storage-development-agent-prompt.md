# storage 开发提示词

## 1. 这份提示词给谁

这份提示词给负责 `services/storage` 的开发 agent。

你的任务不是继续讨论方案，而是按现有文档直接把 `storage` 这一层落成可开发、可测试、可独立运行的服务骨架和核心链路。

## 2. 先读哪些文档

开始写代码前，先完整阅读下面这些文档，并以它们为准：

- `docs/architecture-independence.md`
- `docs/memory-module-contract.md`
- `docs/storage/memory-storage-product.md`
- `docs/storage/database-schema-design.md`
- `docs/storage/storage-service-design.md`
- `docs/storage/storage-implementation-spec.md`
- `services/storage/README.md`

如果文档之间出现冲突，优先级按下面执行：

1. `architecture-independence.md`
2. `memory-module-contract.md`
3. `storage-implementation-spec.md`
4. `database-schema-design.md`
5. 其他说明文档

## 3. 你负责的范围

你只负责 `storage` 这一层。

代码目录固定在：

- `services/storage`

这层要做的是：

- 接收来自 `retrieval-runtime` 的结构化写回候选
- 在后台完成标准化、去重、合并、冲突判断、生命周期更新
- 维护正式写模型和版本快照
- 发布共享只读读模型，供 `retrieval-runtime` 和 `visualization` 使用
- 提供治理接口和观测接口

这层不做的是：

- 不决定什么时候触发记忆召回
- 不负责把记忆注入 agent prompt
- 不负责页面展示逻辑
- 不直接依赖 `retrieval-runtime` 和 `visualization` 的内部实现

## 4. 这层要解决什么问题

你要通过代码解决下面这些问题：

### 4.1 原始内容不能直接入库

需要保证上游提交的是 `WriteBackCandidate`，而不是整段对话原文。

### 4.2 重复写入不能把库写脏

需要通过 `dedupe_key`、范围和类型组合判断重复、更新、合并还是忽略。

### 4.3 新旧记忆会冲突

需要把可自动处理的冲突转成状态迁移，把不能自动处理的冲突进入冲突队列或待确认状态。

### 4.4 记忆有生命周期，不是写进去就结束

需要支持 `active`、`superseded`、`archived`、`pending_confirmation` 等状态演进，并保留版本历史。

### 4.5 查询侧不能读私有写模型

需要把内部写表投影成稳定的共享只读模型。

### 4.6 写入可以异步，但查询侧不能被拖慢

需要把接收写回和复杂处理拆开，前台快速接收，后台异步处理。

## 5. 你具体要做什么

### 5.1 初始化服务工程

在 `services/storage` 下补齐这批基础文件：

- `package.json`
- `tsconfig.json`
- `vitest.config.ts`
- `drizzle.config.ts`
- `.env.example` 的正式字段说明
- 启动入口
- 日志、配置、错误处理基础设施

### 5.2 落数据库迁移

按文档把这些内容落成迁移和表定义：

- 正式写模型表
- 版本快照表
- 冲突表
- 写任务表
- 共享读模型表
- 必要索引和约束

### 5.3 实现同步接入面

至少实现这些接口：

- `writeback-api`
- 治理接口
- 观测接口
- 健康检查接口

接口要求：

- 只接收结构化对象
- 有明确校验
- 返回显式状态
- 不把复杂入库逻辑放在同步请求里

### 5.4 实现异步处理面

至少实现这些模块：

- `job-worker`
- `normalizer`
- `merge-engine`
- `conflict-engine`
- `governance-engine`
- `read-model-projector`

### 5.5 实现共享读模型发布

要保证 `retrieval-runtime` 和 `visualization` 只需要读 `storage` 正式发布的读模型，不需要知道私有写表。

### 5.6 实现降级和容错

要保证：

- `retrieval-runtime` 没启动时，`storage` 仍可独立运行
- `visualization` 没启动时，`storage` 仍可独立运行
- 队列异常、向量刷新异常、读模型刷新异常不会把进程直接拖挂

## 6. 这层的输出物

你最终要交付的内容至少包括：

- `services/storage` 的可运行项目骨架
- 数据库迁移
- API 路由
- 异步 worker
- 核心领域模块
- 基础测试
- 面向接入方的接口说明

## 7. 开发约束

你必须遵守下面这些约束：

- 只能开发 `storage` 自己的代码，不允许把运行时检索或可视化逻辑写进来
- 不允许直接引用其他服务的内部目录
- 不允许要求其他服务先启动，`storage` 才能启动
- 对外只通过正式 REST 接口和共享读模型协作
- 不允许把完整对话原文直接落正式记忆表
- 依赖失败必须显式返回错误或降级状态

## 8. 验收标准

完成后，至少要满足下面这些验收项：

### 8.1 工程层

- `services/storage` 可以单独安装依赖并启动
- 启动时不依赖 `retrieval-runtime` 或 `visualization` 在线
- 配置缺失时返回明确错误

### 8.2 数据层

- 迁移可以创建正式写表、任务表、冲突表、版本表和共享读模型表
- 去重、合并、冲突、状态迁移都有明确落点
- 共享读模型和私有写模型边界清楚

### 8.3 接口层

- 写回接口只接收结构化候选
- 接口参数和错误响应有统一格式
- 健康接口能区分 `liveness`、`readiness`、`dependencies`

### 8.4 运行层

- 同步写回请求是快速接收，不阻塞完整处理链路
- 异步 worker 能把任务从接收推进到最终结果
- 读模型刷新失败会记录并重试，不会导致服务不可启动

### 8.5 边界层

- `storage` 不包含记忆注入逻辑
- `storage` 不包含页面逻辑
- 其他服务未启动时，`storage` 自身仍保持可运行

### 8.6 测试层

- 至少覆盖公开接口
- 至少覆盖去重、合并、冲突三个核心规则
- 至少覆盖依赖失败或任务失败时的错误分支

## 9. 开发完成时怎么自检

请按这个顺序自检：

1. 目录结构是否只包含 `storage` 自己的职责
2. 私有写模型和共享读模型是否分开
3. 同步 API 是否只做接收和校验
4. 异步 worker 是否承接真正处理
5. 健康检查是否符合独立运行约束
6. 测试是否覆盖核心规则和失败场景
