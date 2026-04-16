# storage 补齐验收提示词

## 1. 这份提示词给谁

这份提示词给负责继续完善 `services/storage` 的开发 agent。

当前这层已经不是空目录，也不是只有表结构。

现在的状态是：

- 服务可以启动
- `check`、`build`、`test` 已通过
- 写回接收、异步处理、治理接口、观测接口、健康接口都已经有实现

但它还不能按现有文档通过正式验收。

你的任务不是重写整层服务，而是把现在这层补到可以按当前文档通过验收的状态。

## 2. 先读哪些文档

开始改代码前，先完整阅读下面这些内容，并以它们为准：

- `docs/architecture-independence.md`
- `docs/memory-module-contract.md`
- `docs/storage/storage-implementation-spec.md`
- `docs/storage/database-schema-design.md`
- `docs/storage/storage-development-agent-prompt.md`
- `services/storage/README.md`

然后再读当前实现：

- `services/storage/src/api/`
- `services/storage/src/domain/`
- `services/storage/src/db/`
- `services/storage/src/jobs/`
- `services/storage/src/services.ts`
- `services/storage/tests/`

如果你需要联调上下文，再补读：

- `services/retrieval-runtime/src/writeback/storage-client.ts`
- `services/retrieval-runtime/src/query/postgres-read-model-repository.ts`

目的不是跨服务开发，而是确认 `storage` 发布出来的正式契约已经真的能被上游消费。

## 3. 当前为什么还不能通过验收

当前实现已经能跑，但下面这些问题还没有补齐。

### 3.1 写回接口契约和 `retrieval-runtime` 现在对不上

当前 `storage` 的：

- `POST /v1/storage/write-back-candidates`

只接受单个 `WriteBackCandidate`。

但当前 `retrieval-runtime` 的 `HttpStorageWritebackClient` 实际发送的是：

- `{ candidates: [...] }`

这意味着两边虽然都各自可运行，但真实跨服务写回现在还接不通。

这属于正式契约未对齐，不是小问题。

### 3.2 共享读模型字段和查询侧消费字段没有完全对齐

当前 `storage` 发布的共享表是：

- `details_preview_json`
- `source_type`
- `source_ref`
- `summary_embedding`

但当前 `retrieval-runtime` 查询实现读取的是：

- `details`
- `source`
- `summary_embedding`

也就是说：

- 向量字段虽然存在
- 但结构化详情和来源字段没有按统一 DTO 对齐

如果不修，查询侧即使连上库，也拿不到完整的正式共享对象。

### 3.3 `summary_embedding` 字段只是建了表，还没有形成正式生成链路

当前迁移和 schema 里已经有：

- `summary_embedding vector(1536)`

但当前 `read-model-projector` 和 `readModelRepository.upsert` 并没有：

- 生成 embedding
- 更新 embedding
- 删除时处理 embedding 相关状态

而检索实施规格里已经明确：

- `summary_embedding` 要用于软排序

所以现在共享读模型还没有真正达到“支持运行时语义排序”的状态。

### 3.4 读模型刷新重试策略没有真正落地

当前配置里已经有：

- `READ_MODEL_REFRESH_MAX_RETRIES`

但当前刷新任务失败后只是：

- `markRefreshFailed`
- `retry_count + 1`

没有真正基于重试上限做：

- 停止重试
- 死信或终态标记
- 超限后的观测归类

这和文档里“刷新失败会记录并重试，不会无限重试拖垮系统”的要求还不一致。

### 3.5 健康状态分离语义还不够准确

当前 `services/storage/src/services.ts` 里，如果配置了：

- `REDIS_URL`

就会把 `readiness` 直接降成 `degraded`，即使当前实现里 Redis 只是可选依赖，而且服务仍然可以继续接收请求并返回结果。

但架构约束已经明确：

- 只要本服务还能正常或降级返回，就不该因为可选依赖缺失直接判定自己没准备好
- 外部或可选依赖问题应留在 `dependencies`

所以健康语义还要再收紧。

### 3.6 当前实现和文档里的队列技术口径不一致

文档口径写的是：

- `Redis + BullMQ`

但当前实现实际是：

- PostgreSQL job table
- polling worker

这不一定不能接受。

但现在的问题是：

- 要么文档修正为当前正式方案
- 要么实现补到文档口径

不能继续保持“说明文档是一套、正式实现是另一套”。

### 3.7 测试还没有覆盖正式验收缺口

当前测试主要覆盖：

- API 基础校验
- 标准化、去重、冲突规则
- worker 基本主流程

但没有覆盖：

- `retrieval-runtime` 正式写回契约
- 共享读模型正式字段映射
- embedding 生成与刷新
- 刷新任务重试上限
- 健康状态分离语义
- 治理动作后的共享读模型刷新闭环

## 4. 你的目标

这次开发目标只有一个：

把 `storage` 从“单服务主链路可运行”补到“可以按当前文档通过验收，并能和其他服务按正式契约联通”。

## 5. 你必须补齐的内容

### 5.1 修正写回接入契约

你要把 `storage` 的写回接口补到能正式接住 `retrieval-runtime` 当前的写回提交方式。

至少要支持下面二选一中的一个正式结果：

- 兼容批量提交 `{ candidates: [...] }`
- 或者明确调整两边契约并同步改齐

要求：

- 最终契约只能有一套正式口径
- `storage` 继续保持“快速接收 + 后台处理”
- 批量提交时要有单条结果或任务映射关系，不能只返回一个空壳成功

### 5.2 把共享读模型 DTO 对齐成正式契约

你要明确 `storage_shared_v1.memory_read_model_v1` 对外发布的正式字段语义，并把实现补齐。

至少要解决：

- `details_preview_json` 和查询侧 `details` 的契约映射
- `source_type` / `source_ref` 和查询侧 `source` 的契约映射
- `retrieval-runtime` 读取时不需要猜字段名

要求：

- 对外读模型字段语义固定
- 文档、SQL、仓储映射、上游消费口径一致
- 不允许继续靠“上游自己拼字段”来弥补契约不完整

### 5.3 补齐 `summary_embedding` 正式生成链路

你要让共享读模型里的 `summary_embedding` 真正可用。

至少要做到：

- 为新写入记录生成 embedding
- 为更新后的摘要刷新 embedding
- embedding 依赖失败时明确降级，不影响主写入
- 相关失败能被观测

具体做法你来定，可以是：

- 内置 `embeddings client`
- 单独刷新步骤
- 异步刷新任务

但结果上必须满足：

- 检索侧能稳定拿到可用于排序的向量字段

### 5.4 把读模型刷新失败策略做成闭环

你要把 `READ_MODEL_REFRESH_MAX_RETRIES` 真正落成系统行为。

至少要做到：

- 刷新任务达到上限后不再无限重试
- 超限任务进入明确终态
- 指标和观测能区分“暂时失败”和“最终失败”

要求：

- 写模型成功不应被读模型刷新拖回滚
- 但读模型刷新失败不能无边界积压

### 5.5 收紧健康状态分离语义

你要让健康接口符合架构独立性约束。

要求：

- `liveness` 只反映进程是否活着
- `readiness` 只反映当前服务是否还能接收请求并返回正常或降级结果
- 可选依赖或外部依赖问题单独落在 `dependencies`
- 不要因为可选 Redis 没连上，就把本服务 `readiness` 直接降级

### 5.6 对齐技术口径

你要处理当前“文档技术栈”和“实际实现”不一致的问题。

如果保留当前实现，就要：

- 把文档修正成 PostgreSQL job table + polling worker 的正式方案

如果要改成文档口径，就要：

- 真正补上 `Redis + BullMQ`

二选一，但要统一。

### 5.7 补测试

你要为上面新增内容补测试。

至少覆盖：

- 批量写回契约
- 共享读模型字段映射
- embedding 生成或降级
- 刷新任务重试上限
- 治理动作后的读模型刷新
- 健康状态分离

## 6. 这次开发不要做什么

这次不要偏题。

不要把精力花在下面这些方向：

- 不要重写整个写入领域模型
- 不要把 `retrieval-runtime` 或 `visualization` 的内部代码搬进来
- 不要绕开共享读模型，直接让上游读取私有写表
- 不要扩展新的记忆类型来掩盖当前契约问题
- 不要只改文档不改实现，或者只改实现不改文档

## 7. 完成标准

完成后，至少要满足下面这些条件：

### 7.1 接入层

- `retrieval-runtime` 的正式写回请求能被 `storage` 接住
- 批量或单条写回口径明确且稳定

### 7.2 共享读模型层

- `memory_read_model_v1` 的正式字段契约固定
- 查询侧能拿到完整且可消费的共享对象
- `summary_embedding` 真正可用

### 7.3 后台处理层

- 写模型成功后会驱动读模型刷新
- 刷新失败会重试
- 达到上限后进入明确终态

### 7.4 健康语义层

- `liveness` / `readiness` / `dependencies` 语义清楚
- 可选依赖问题不会错误污染本服务可用性判断

### 7.5 测试层

- 新增功能有对应测试
- `npm run check`
- `npm run build`
- `npm test`

都通过

## 8. 最后交付时你要说明什么

完成后，请明确汇报下面这些内容：

1. 哪些验收缺口已经补齐
2. 写回正式契约最后定成了什么
3. 共享读模型 DTO 最后定成了什么
4. `summary_embedding` 是怎么生成和刷新的
5. 刷新任务重试上限是怎么处理的
6. 健康状态分离是怎么实现的
7. 新增了哪些测试
8. 还有没有剩余风险
