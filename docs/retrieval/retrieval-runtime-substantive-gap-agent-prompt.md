# retrieval-runtime 实质缺口提示词

## 1. 这份提示词给谁

这份提示词给负责继续收口 `services/retrieval-runtime` 的开发 agent。

当前这层已经不是“没做完主链路”，也不是“只有骨架”。

现在的状态是：

- 服务能启动
- `check`、`build`、`test` 已通过
- 宿主接入目录、运行轨迹仓储、查询阶段超时闭环、基础观测都已经有实现

但它还没有通过“正式可接入、正式可联调、正式可验收”这一层要求。

原因不是页面小问题，也不是文档细节，而是还剩几处会直接影响真实接入和真实联调的实质缺口。

你的任务不是重写服务，而是把这些最后的硬缺口补齐。

## 2. 先读哪些文档

开始改代码前，先完整阅读下面这些内容，并以它们为准：

- `docs/architecture-independence.md`
- `docs/memory-module-contract.md`
- `docs/retrieval/retrieval-runtime-implementation-spec.md`
- `docs/retrieval/host-integration-implementation-plan.md`
- `docs/retrieval/retrieval-runtime-remediation-agent-prompt.md`
- `services/retrieval-runtime/README.md`

然后重点读当前实现：

- `services/retrieval-runtime/src/writeback/`
- `services/retrieval-runtime/src/trigger/`
- `services/retrieval-runtime/src/query/`
- `services/retrieval-runtime/src/host-adapters/`
- `services/retrieval-runtime/host-adapters/`
- `services/retrieval-runtime/tests/`

联调口径必须同时核对下面这些文件：

- `services/storage/src/api/app.ts`
- `services/storage/src/contracts.ts`
- `services/storage/src/db/schema.ts`

这一步不是让你改 `storage` 内部实现，而是保证 `retrieval-runtime` 最终交付出来的正式契约真的能和 `storage` 对上。

## 3. 当前还剩哪些实质缺口

### 3.1 写回正式契约还没有和 `storage` 真正打通

当前 `retrieval-runtime` 的写回链路存在三层不一致：

- HTTP 形态发的是 `{ candidates: [...] }`
- `candidate_type` 里还会产出 `commitment`、`important_event`
- `source` 用的是宿主侧结构：`host`、`session_id`、`thread_id`、`turn_id`

但当前 `storage` 的正式写回契约要求的是：

- 单条或明确约定的批量写回对象
- `candidate_type` 必须符合 `storage` 当前正式支持的类型
- `source` 必须是 `source_type`、`source_ref`、`service_name` 这一套

这意味着当前 `retrieval-runtime` 虽然本地测试能过，但真实联调时仍然可能：

- 直接 400
- 被校验拒绝
- 被 `storage` 误判成不合法候选

### 3.2 `semantic fallback` 还绕开了正式依赖保护

当前查询阶段已经走了：

- `DependencyGuard`
- `AbortSignal`
- 数据库 `statement_timeout`

但 `trigger-engine` 里的 `semantic fallback` 仍然直接调用：

- `embeddingsClient.embedText`
- `readModelRepository.searchCandidates`

没有走统一的超时、取消和依赖状态记录。

这会带来两个问题：

- 触发阶段仍可能被慢依赖拖住
- 依赖失败会被吞成“没触发”，而不是显式 `degraded`

也就是说，现在只有“查询阶段”完成了有界调用，`prepare-context` 整条主链路还没有完全闭环。

### 3.3 `Codex` 宿主接入里仍有占位产物

当前 `memory-codex-adapter` 目录已经有脚本和配置，但其中的：

- `mcp/memory-mcp-server.mjs`

还是占位实现，不是真正可用的 `MCP server`。

这意味着当前交付物更接近“目录骨架齐了”，还不是“用户照着启动就能接进去”的状态。

### 3.4 宿主身份映射仍然有高风险默认值

当前桥接脚本在拿不到宿主字段时，会回退到：

- `unknown-user`
- `unknown-workspace`

这会带来明显风险：

- 查不到真实命名空间下的记忆
- 不同会话可能混入同一个假命名空间
- 写回数据可能落到错误作用域

这不是简单的“兜底更稳”，而是会直接破坏记忆边界。

## 4. 你的目标

这次开发目标只有一个：

把 `retrieval-runtime` 从“内部功能基本补齐”补到“正式宿主接入可用、正式跨服务联调可用、正式验收可通过”。

## 5. 你必须补齐的内容

### 5.1 收敛写回正式契约

你要把 `retrieval-runtime` 的写回对象收敛成和 `storage` 正式一致的一套。

至少要解决：

- 批量还是单条，到底采用哪种正式口径
- `candidate_type` 最终允许哪些值
- `source` 最终采用哪一套正式结构

要求：

- 最终只能有一套正式契约
- `retrieval-runtime` 不要再输出 `storage` 不接受的候选类型
- `retrieval-runtime` 不要再输出 `storage` 不认识的来源结构
- 改完后，联调请求必须能真实通过 `storage` 校验

如果你决定保留批量提交，就要把返回结构也一起定清楚。

如果你决定收回成单条提交，就要把 `retrieval-runtime` 的提交器和测试一起改齐。

### 5.2 把触发阶段也纳入正式超时闭环

你要把 `semantic fallback` 补到和查询阶段同样的治理标准。

要求：

- 调 embeddings 要有超时和取消
- 触发阶段读取样本也要有超时和取消
- 依赖状态要被记录到正式观测里
- 超时或依赖失败时，返回显式降级语义，而不是静默当成没触发

具体做法你来定，但结果上必须满足：

- `prepare-context` 全链路都是有界调用

### 5.3 把 `Codex` 的 `memory-mcp-server` 补成真实可用产物

你要处理当前 `Codex` 侧 `MCP` 产物仍是占位脚本的问题。

要求：

- 不再只是打印提示文本
- 至少达到“可启动、可连线、可解释用途”的程度
- 能承接文档里已经约定的工具面角色，哪怕首版只实现最小集

如果现阶段不打算在这个目录直接放完整实现，也必须：

- 给出正式的可执行桥接方式
- 不是占位文件

### 5.4 收紧宿主身份映射规则

你要去掉高风险的假身份默认值。

要求：

- `workspace_id`、`user_id` 这些关键边界字段不能再静默回退到 `unknown-*`
- 要么显式要求宿主传入
- 要么有明确、可解释、可配置的映射规则
- 缺失时要返回明确错误或明确禁用记忆，而不是落入错误命名空间

这部分的目标是：

- 宁可降级不用记忆，也不要把记忆边界写错

### 5.5 补测试

你要为上面这些实质缺口补测试。

至少覆盖：

- 写回正式契约和 `storage` 一致
- 触发阶段的依赖超时或取消
- `semantic fallback` 失败时的显式降级
- `Codex` 的 `memory-mcp-server` 不再是占位脚本
- 宿主身份缺失时不会落入 `unknown-*` 命名空间

## 6. 这次开发不要做什么

这次不要偏题。

不要把精力花在下面这些方向：

- 不要再补新的 UI 或观测页面
- 不要扩展新的记忆类型
- 不要顺手重写整个 trigger 或 query 引擎
- 不要只改 README，不改真实代码
- 不要只做“文件存在”级测试

## 7. 完成标准

完成后，至少要满足下面这些条件：

### 7.1 联调层

- `retrieval-runtime` 发给 `storage` 的写回请求可以真实通过正式契约
- 不再输出 `storage` 不接受的 `candidate_type`
- 不再输出 `storage` 不接受的 `source` 结构

### 7.2 触发层

- `semantic fallback` 纳入正式超时和取消闭环
- 依赖失败时有显式降级，不再静默吞掉

### 7.3 宿主层

- `Codex` 的 `memory-mcp-server` 不再是占位实现
- 宿主桥接脚本不会把关键身份字段默默回退成假值

### 7.4 测试层

- 新增测试覆盖这些实质缺口
- `npm run check`
- `npm run build`
- `npm test`

都通过

## 8. 最后交付时你要说明什么

完成后，请明确汇报下面这些内容：

1. 写回正式契约最后定成了什么
2. 为什么它现在能和 `storage` 真正打通
3. 触发阶段超时闭环是怎么做的
4. `Codex` 的 `memory-mcp-server` 最后如何交付
5. 宿主身份映射最后采用了什么规则
6. 新增了哪些测试
7. 还有没有剩余风险
