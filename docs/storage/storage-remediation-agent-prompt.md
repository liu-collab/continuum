# storage 补齐验收提示词

## 1. 这份提示词给谁

这份提示词给负责继续完善 `services/storage` 的开发 agent。

当前这层已经不是空目录，也不是只有表结构。

现在的状态是：

- 服务可以启动
- `check`、`build`、`test` 已通过
- 写回接收、异步处理、治理接口、观测接口、健康接口都已经有实现

但它还不能按现有正式契约完全通过验收。

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

当前实现主链路已经能跑，主要缺口已经收窄到下面几项。

### 3.1 `GET /v1/storage/records` 正式契约还没和代码完全一致

`docs/api-contract.md` 里对这个接口的说明，和当前代码实现还有两个明确差异：

- 契约写的是 `workspace_id` 必填，但当前代码里它仍然是可选
- 契约写的是正式分页口径，但当前代码只有 `limit`

这不是功能缺失，而是“正式承诺”和“真实行为”还没对齐。

### 3.2 `POST /v1/storage/write-back-candidates` 返回体还没完全收成统一口径

当前实现里：

- 批量写回返回的是 `submitted_jobs`
- 单条写回返回的是 `accepted(...)` 包裹结构

这说明接口已经可用，但还不能说“正式返回契约已经完全收口”。

### 3.3 冲突治理还不是完整双边闭环

当前冲突路径已经能做到：

- 识别冲突
- 把现有记录转成 `pending_confirmation` 或 `superseded`
- 打开冲突单

但在不能自动解决的分支里，新的冲突候选还没有作为第二个正式可对比对象完整落库。

这意味着：

- “冲突已发现、已挂起、可治理”是成立的
- “冲突双方可完整对比、可完整恢复、可完整审计”还没有完全成立

### 3.4 真实 PostgreSQL 验收覆盖还不够完整

当前 `check`、`build`、`test` 已通过，但测试里仍有一部分真实数据库场景是 `skip`。

这会留下一个剩余风险：

- 主链路在内存仓储和当前集成测试里可用
- 但对“真实 PostgreSQL 迁移 + 真实共享读模型 + 真实冲突治理”这类场景，验收证据还不够强

## 4. 你的目标

这次开发目标只有一个：

把 `storage` 从“主链路已可运行”补到“正式契约一致、冲突治理闭环更完整、真实数据库验收证据充分”的状态。

## 5. 你必须补齐的内容

### 5.1 收紧 `records` 查询接口的正式契约

你要在“改代码”或“改契约文档”之间做出一致选择，并且两边同步。

至少要收清楚：

- `workspace_id` 到底是不是正式必填
- 列表到底是 `limit` 口径，还是 `page / page_size` 正式分页口径

### 5.2 把写回接收接口返回体收成统一正式口径

你要明确单条写回和批量写回的正式返回结构，并把代码和契约改成同一套口径。

要求：

- 不要让单条和批量接口继续各自返回不同风格的数据结构
- 返回体里要保留任务映射关系，不能丢掉 `job_id`

### 5.3 把冲突治理补到更完整的双边闭环

你要补的是“冲突双方”的正式治理能力，而不是重新实现冲突检测。

至少要做到：

- 新冲突候选和旧记录都能成为可对比对象
- 治理页面或治理接口能明确知道“冲突双方是谁”
- 后续确认、恢复、归档、删除不会只作用在单边历史残影上

### 5.4 补真实 PostgreSQL 验收测试

你要为下面这些场景补到更强的验收证据：

- 正式接口契约在真实数据库路径上可用
- 冲突治理在真实数据库路径上可验证
- 共享读模型投影结果在真实数据库路径上可验证

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

### 7.1 契约层

- `GET /v1/storage/records` 的正式契约和真实代码行为一致
- `POST /v1/storage/write-back-candidates` 的返回体正式口径统一

### 7.2 冲突治理层

- 冲突双方都能进入正式治理闭环
- 冲突记录不再只有单边信息可追

### 7.3 测试层

- 新增功能有对应测试
- `npm run check`
- `npm run build`
- `npm test`

都通过

## 8. 最后交付时你要说明什么

完成后，请明确汇报下面这些内容：

1. 哪些验收缺口已经补齐
2. `records` 查询接口最后定成了什么正式口径
3. 写回接收接口返回体最后定成了什么正式口径
4. 冲突双方是怎么进入正式治理闭环的
5. 新增了哪些真实数据库或契约级测试
6. 还有没有剩余风险
