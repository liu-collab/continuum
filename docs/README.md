# 文档目录说明

当前 `docs` 按三部分管理：

- `storage`：记忆存储相关文档
- `retrieval`：记忆检索与运行时召回相关文档
- `visualization`：可视化与观测平台相关文档

另外补一个独立交付层说明：

- `delivery-cli.md`：统一命令入口、安装与启动编排说明

另外，`docs` 根目录保留六篇公共文档：

- `product-baseline.md`：整体产品基线
- `memory-module-contract.md`：跨模块契约
- `product-readiness.md`：产品补全层，覆盖场景边界、治理闭环、验收机制
- `architecture-independence.md`：架构独立性约束，要求三部分可独立拆出、独立治理、独立运行
- `api-contract.md`：统一 API 契约，三个服务所有对外接口的正式定义
- `deployment-guide.md`：部署与运维指南，含依赖清单、环境变量汇总、本地开发步骤
当前整体架构口径是：

- 三部分是独立服务
- 统一 CLI 作为独立交付层存在，但不算第四个业务服务
- 允许共享由 `storage` 发布的只读数据库读模型
- 不允许共享写模型或私有表结构
- 任意一个服务未启动或不可达，都不能影响其他服务自身的运行状态

## 目录结构

### 1. storage

这一部分主要回答：

- 记忆怎么写入
- 记忆怎么结构化保存
- 记忆怎么去重、合并、归档
- 存储层如何为后续快速检索做准备

当前文档：

- `storage/memory-storage-product.md`
- `storage/database-schema-design.md`
- `storage/storage-service-design.md`
- `storage/storage-implementation-spec.md`
- `storage/storage-development-agent-prompt.md`
- `storage/storage-remediation-agent-prompt.md`
- `storage/storage-substantive-gap-agent-prompt.md`

### 2. retrieval

这一部分主要回答：

- 什么时候发起检索
- 检索请求长什么样
- 检索结果怎么返回
- 记忆怎么被放进 agent 当前上下文

当前文档：

- `retrieval/memory-retrieval-product.md`
- `retrieval/memory-injection-product.md`
- `retrieval/retrieval-runtime-service-design.md`
- `retrieval/agent-host-integration-research.md`
- `retrieval/host-integration-implementation-plan.md`
- `retrieval/retrieval-runtime-implementation-spec.md`
- `retrieval/retrieval-development-agent-prompt.md`
- `retrieval/retrieval-runtime-remediation-agent-prompt.md`
- `retrieval/retrieval-runtime-substantive-gap-agent-prompt.md`

说明：

`记忆注入` 文档放在 `retrieval` 目录下，是因为它属于运行时召回链路的一部分。
这个目录表示“运行时取用记忆”，不是单指底层查询接口。

### 3. visualization

这一部分主要回答：

- 记忆库里现在有什么
- 某一轮为什么查了、为什么注入了、为什么写回了
- 当前系统关键指标表现如何

当前文档：

- `visualization/memory-observability-product.md`
- `visualization/visualization-service-design.md`
- `visualization/visualization-implementation-spec.md`
- `visualization/visualization-development-agent-prompt.md`
- `visualization/visualization-remediation-agent-prompt.md`
- `visualization/visualization-substantive-gap-agent-prompt.md`
