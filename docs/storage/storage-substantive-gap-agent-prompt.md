# storage 实质改进提示词

## 1. 这份提示词给谁

这份提示词给负责继续收口 `services/storage` 的开发 agent。

当前这层已经不是“缺主链路”，也不是“只有表结构和接口骨架”。

现在的状态是：

- 服务能启动
- `check`、`build`、`test` 已通过
- 写回入口、异步处理、共享读模型、治理刷新、embedding 刷新、健康接口都已经有实现

但这层还没有达到“正式可迁移、正式可联调、正式可验收”的状态。

问题已经不在基础功能，而在剩余几个会影响真实部署和真实联调的硬缺口。

你的任务不是重写 `storage`，而是把这些剩余改进项收口。

## 2. 先读哪些文档

开始改代码前，先完整阅读下面这些内容，并以它们为准：

- `docs/architecture-independence.md`
- `docs/memory-module-contract.md`
- `docs/storage/storage-implementation-spec.md`
- `docs/storage/database-schema-design.md`
- `docs/storage/storage-remediation-agent-prompt.md`
- `services/storage/README.md`

然后重点读当前实现：

- `services/storage/migrations/`
- `services/storage/src/api/`
- `services/storage/src/services.ts`
- `services/storage/src/contracts.ts`
- `services/storage/src/db/`
- `services/storage/tests/`

联调口径还要核对：

- `services/retrieval-runtime/src/shared/types.ts`
- `services/retrieval-runtime/src/writeback/storage-client.ts`
- `services/retrieval-runtime/src/host-adapters/types.ts`

## 3. 当前还剩哪些实质改进项

### 3.1 新库迁移链路还不稳

当前迁移顺序是：

- `0001_storage_init.sql`
- `0002_read_model_contract.sql`

但 `0002` 里仍然直接引用旧列：

- `details_preview_json`
- `source_type`
- `source_ref`

而 `0001` 已经按新共享读模型结构创建：

- `details`
- `source`

这会导致一个非常实际的问题：

- 在全新数据库上执行迁移时，`0002` 很可能直接报列不存在

这不是文档问题，而是会直接影响 `npm run migrate` 在正式环境的可用性。

### 3.2 migration 和运行时配置的 schema 口径还没统一

当前服务配置支持：

- `STORAGE_SCHEMA_PRIVATE`
- `STORAGE_SCHEMA_SHARED`

但 SQL 迁移文件里仍然把 schema 名写死成：

- `storage_private`
- `storage_shared_v1`

这意味着只要配置改掉，运行时会去新的 schema 找表，但迁移仍然把表建在默认 schema。

结果就是：

- 配置看起来可用
- 实际迁移和运行根本不在一套路径上

### 3.3 `retrieval-runtime` 批量写回的字段约束还不够严

当前 `runtimeWriteBackBatchRequestSchema` 对：

- `session_id`
- `task_id`

使用的是普通字符串，而不是 `UUID`。

但 `storage` 正式写模型和 `retrieval-runtime` 宿主输入契约里，这两个字段本来就是 UUID 语义。

这会带来一个实质问题：

- 接口会先返回 `202 accepted_async`
- 非法值直到异步 worker 真写库时才失败

也就是说，当前同步接入面对这类错误是“晚失败”，不是“早拒绝”。

### 3.4 还缺真实数据库级验收测试

当前测试已经覆盖了：

- API 基础校验
- runtime 批量写回入口
- worker 主流程
- embedding 降级
- 治理刷新

但还没有覆盖下面这些更接近正式验收的场景：

- 全新库执行迁移
- 迁移后共享读模型字段真实可读
- 配置自定义 schema 时迁移和运行一致
- runtime 批量写回字段非法时同步拒绝

现在的测试更多还是：

- 内存仓储级
- 单模块级

还差一层“真实数据库口径”的验收。

### 3.5 源码目录里还有编译产物混入

当前 `services/storage/src/` 目录下有：

- `contracts.ts`
- `contracts.js`

这会带来两个风险：

- 开发态和测试态可能误吃旧 JS 产物
- 后续继续改 TS 时，源码目录里出现双份定义，增加排查成本

这不一定立刻导致功能错误，但它属于需要收掉的工程隐患。

## 4. 你的目标

这次开发目标只有一个：

把 `storage` 从“主链路已经能跑”补到“迁移可落地、配置可兑现、联调入口能早失败、验收路径完整”。

## 5. 你必须补齐的内容

### 5.1 修正迁移脚本在新库上的执行问题

你要让 `0001` 和 `0002` 在下面两种场景都能稳定执行：

- 全新数据库
- 已有旧共享读模型结构的数据库

要求：

- 不能再让 `0002` 在新库上直接引用不存在的旧列
- 老结构升级到新结构时，数据迁移仍然能完成
- 迁移脚本执行顺序保持清楚可控

### 5.2 统一 migration 和配置的 schema 口径

你要处理“配置支持自定义 schema，但迁移写死默认 schema”的问题。

要求：

- 要么明确收回成固定 schema，并同步修正文档和配置口径
- 要么让迁移真正支持当前配置项

二选一，但最终只能保留一套正式行为。

### 5.3 收紧 runtime 批量写回入口校验

你要把 `runtimeWriteBackBatchRequestSchema` 收紧到和正式契约一致。

至少要处理：

- `workspace_id`
- `user_id`
- `session_id`
- `task_id`

这些标识字段的类型约束。

要求：

- 非法值要在同步入口被拒绝
- 不要让明显错误的 payload 先入队再异步失败
- `retrieval-runtime` 当前正式契约能继续正常通过

### 5.4 补数据库级验收测试

你要为下面这些场景补测试：

- 全新库迁移成功
- 老共享读模型结构升级成功
- 自定义 schema 口径下迁移和运行一致
- runtime 批量写回非法标识字段被同步拒绝

如果当前仓库测试策略不方便直接接真实数据库，也要至少补到：

- 迁移 SQL 结构级检查
- 契约级集成测试

但目标必须是能覆盖“正式落库路径”，不只是内存仓储路径。

### 5.5 清理源码目录里的混入产物

你要处理 `src/contracts.js` 这类混入源码目录的编译产物。

要求：

- 源码目录保持单一来源
- 不让开发态和测试态误读旧 JS 文件
- 构建产物和源码边界清楚

## 6. 这次开发不要做什么

这次不要偏题。

不要把精力花在下面这些方向：

- 不要重写领域规则
- 不要扩展新的记忆类型
- 不要顺手改 `retrieval-runtime` 逻辑
- 不要只改 README 不改真实行为
- 不要只补内存仓储测试，绕开真实迁移问题

## 7. 完成标准

完成后，至少要满足下面这些条件：

### 7.1 迁移层

- 全新数据库执行迁移成功
- 旧读模型结构可以升级到新契约
- 不再因为旧列不存在导致迁移失败

### 7.2 配置层

- schema 配置和真实迁移行为一致
- 文档、配置、运行时、迁移脚本口径一致

### 7.3 接入层

- runtime 批量写回入口对关键标识字段做正式校验
- 非法 payload 会同步拒绝

### 7.4 测试层

- 新增测试覆盖这些改进项
- `npm run check`
- `npm run build`
- `npm test`

都通过

### 7.5 工程层

- 源码目录不再混入编译产物
- 源码和构建产物边界清楚

## 8. 最后交付时你要说明什么

完成后，请明确汇报下面这些内容：

1. 迁移脚本是怎么修正的
2. 新库和老库升级分别怎么保证可用
3. schema 口径最后定成了什么
4. runtime 批量写回入口收紧了哪些字段
5. 新增了哪些数据库级或契约级测试
6. 清理了哪些混入源码目录的产物
7. 还有没有剩余风险
