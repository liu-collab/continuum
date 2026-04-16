# retrieval-runtime 补齐验收提示词

## 1. 这份提示词给谁

这份提示词给负责继续完善 `services/retrieval-runtime` 的开发 agent。

当前这层不是从零开始，也不是缺服务骨架。

现在的状态是：

- 服务已经能启动
- 主链路已经有实现
- `check`、`build`、`test` 已通过

但它还不能通过正式验收。

你的任务不是重写一套新实现，而是把现在这层补到可以按现有文档通过验收的状态。

## 2. 先读哪些文档

开始改代码前，先完整阅读下面这些内容，并以它们为准：

- `docs/architecture-independence.md`
- `docs/memory-module-contract.md`
- `docs/retrieval/retrieval-runtime-implementation-spec.md`
- `docs/retrieval/host-integration-implementation-plan.md`
- `docs/retrieval/retrieval-development-agent-prompt.md`
- `services/retrieval-runtime/README.md`

然后再读当前实现：

- `services/retrieval-runtime/src/index.ts`
- `services/retrieval-runtime/src/runtime-service.ts`
- `services/retrieval-runtime/src/host-adapters/`
- `services/retrieval-runtime/src/query/`
- `services/retrieval-runtime/src/observability/`
- `services/retrieval-runtime/src/writeback/`
- `services/retrieval-runtime/tests/runtime-service.test.ts`

## 3. 当前为什么还不能通过验收

当前实现已经有主链路，但下面这些问题还没有补齐。

### 3.1 宿主正式接入产物没有交付

现在只有：

- `Claude Code` 输入适配器
- `Codex` 输入适配器

还没有交付实施方案要求的正式宿主接入产物，比如：

- `Claude Code plugin`
- `hooks/hooks.json`
- `.mcp.json`
- `memory-bridge`
- `memory-runtime-bootstrap`
- `Codex` 启动适配器侧正式目录和脚本

这意味着现在只是“服务端支持某些宿主输入格式”，还不是“宿主接入已经完成”。

### 3.2 运行轨迹还没有写进 `runtime_private`

现在启动时还是内存版运行轨迹仓储。

这可以让服务先跑起来，但还不符合实施规格里“运行时过程统一写入 `runtime_private`”的要求。

### 3.3 读模型查询超时没有形成真正闭环

当前 `DependencyGuard` 会在上层超时返回，但读模型仓储没有真正接住 `AbortSignal`，数据库查询可能继续执行。

这不算真正完成“依赖调用带超时和显式降级”。

### 3.4 观测层还不够解释清楚

当前轨迹里有：

- `turn`
- `recall`
- `injection`
- `writeback`

但还没有单独把 `trigger` 段落正式落出来。

另外 `filtered_count` 目前写死为 `0`，说明写回过滤数量没有真正记录。

### 3.5 测试还没有覆盖这些缺口

当前测试主要覆盖：

- 主链路
- HTTP 结构
- 降级
- 注入裁剪

但没有覆盖：

- 宿主正式接入产物
- `runtime_private` 持久化实现
- 查询取消或超时闭环
- `trigger` 级观测
- 写回过滤计数

## 4. 你的目标

这次开发目标只有一个：

把 `retrieval-runtime` 从“主链路可运行”补到“可以按当前文档通过验收”。

## 5. 你必须补齐的内容

### 5.1 补齐宿主接入正式交付物

你要把实施方案里已经约定的宿主接入产物补出来。

至少包括：

- `Claude Code plugin` 目录骨架
- `plugin.json`
- `hooks/hooks.json`
- `.mcp.json`
- `memory-bridge`
- `memory-runtime-bootstrap`
- `Codex` 启动适配器目录或脚本

要求：

- 宿主差异继续留在适配层
- 服务内部主链路不要混进宿主脚本细节
- 这些产物至少要达到“可交付、可看懂、可接线”的程度

### 5.2 实现 `runtime_private` 持久化仓储

你要新增正式的运行轨迹仓储实现，而不是只保留内存版。

至少要做到：

- 运行时轨迹能写入 `runtime_private`
- `turn`
- `trigger`
- `recall`
- `injection`
- `writeback`

都能被正式记录

要求：

- 内存版可以保留给测试用
- 正式启动路径不能再只用内存仓储
- 轨迹查询接口和指标接口要能从正式仓储读取

### 5.3 把读模型查询超时做成真正闭环

你要补齐查询取消或真正有界执行能力。

要求：

- 上层超时不是只返回错误
- 下层查询也要被真正限制住
- 不能出现请求已经降级返回，但数据库查询还在后台长期执行的情况

具体怎么做你来定，但必须满足“调用有界”这个结果。

### 5.4 把观测层补到验收标准

你要补齐下面这些观测缺口：

- 单独记录 `trigger`
- 能清楚区分：
  - 没触发
  - 查空了
  - 查到了但没注入
  - 写回失败
- 写回过滤数量不能再写死
- 过滤原因要能追踪

### 5.5 补测试

你要为上面新增的内容补测试。

至少覆盖：

- 宿主接入产物存在且结构正确
- `runtime_private` 仓储读写
- 读模型查询超时或取消
- `trigger` 观测记录
- 写回过滤计数和过滤原因

## 6. 这次开发不要做什么

这次不要偏题。

不要把精力花在下面这些方向：

- 不要重写现有主链路
- 不要改成直接读取 `storage` 私有写表
- 不要把可视化页面逻辑写进来
- 不要扩展新的记忆类型
- 不要顺手做一堆与验收缺口无关的优化

## 7. 完成标准

完成后，至少要满足下面这些条件：

### 7.1 接入层

- `Claude Code` 正式接入产物存在
- `Codex` 正式接入产物存在
- 宿主桥接说明清楚

### 7.2 运行轨迹层

- 正式启动路径使用可持久化仓储
- `runtime_private` 相关读写跑通
- 不再只依赖内存仓储

### 7.3 查询层

- 读模型查询具备真正的超时或取消闭环
- 超时后不会留下不可控长尾查询

### 7.4 观测层

- 能看到 `turn / trigger / recall / injection / writeback`
- `filtered_count` 真实可用
- 失败和降级原因能追踪

### 7.5 测试层

- 新增功能有对应测试
- `npm run check`
- `npm run build`
- `npm test`

都通过

## 8. 最后交付时你要说明什么

完成后，请明确汇报下面这些内容：

1. 哪些验收缺口已经补齐
2. 宿主接入产物放在哪里
3. `runtime_private` 仓储放在哪里
4. 查询超时闭环是怎么实现的
5. 新增了哪些测试
6. 还有没有剩余风险
