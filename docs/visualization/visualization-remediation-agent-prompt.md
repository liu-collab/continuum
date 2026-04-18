# visualization 补齐验收提示词

## 1. 这份提示词给谁

这份提示词给负责继续完善 `services/visualization` 的开发 agent。

当前这层已经不是空目录，也不是只有页面骨架。

现在的状态是：

- `Next.js` 工程可以启动
- `lint`、`typecheck`、`build`、`test` 已通过
- 目录页、运行轨迹页、指标看板页、健康接口都已经有实现

但它还不能按现有文档通过正式验收。

你的任务不是重写整个前端，而是把现在这层补到可以按当前文档通过验收的状态。

## 2. 先读哪些文档

开始改代码前，先完整阅读下面这些内容，并以它们为准：

- `docs/architecture-independence.md`
- `docs/memory-module-contract.md`
- `docs/visualization/visualization-implementation-spec.md`
- `docs/visualization/visualization-development-agent-prompt.md`
- `services/visualization/README.md`

然后再读当前实现：

- `services/visualization/src/app/`
- `services/visualization/src/features/`
- `services/visualization/src/lib/server/`
- `services/visualization/src/components/`
- `services/visualization/tests/`

## 3. 当前为什么还不能通过验收

当前实现主链路已经能跑，主要缺口已经收窄到下面几项。

### 3.1 目录页双视图在 `memory_view_mode + scope` 组合下还没有完全闭环

当前 `queryCatalogView()` 会把“当前工作区数据”和“当前用户全局数据”分两路查询后再合并。

但当请求里显式带 `scope` 时，当前逻辑还没有完全按视图边界收住：

- `workspace_only + scope=user` 仍可能查到来源工作区匹配的全局记忆
- `workspace_plus_global + 非 user scope` 时，也可能把其他工作区的非全局记录查进来
- `workspace_plus_global + scope=user` 还存在重复合并风险

### 3.2 详情页治理闭环还缺页面级 `edit / restore_version`

当前 `storage-governance-client` 和对应 API routes 已经有：

- `edit`
- `restore_version`

但详情页 UI 仍只有：

- `confirm`
- `invalidate`
- `archive`
- `delete`

也就是说，治理链路的后端入口在，但页面闭环还没有完全成立。

### 3.3 `visualization` 自己的 API routes 错误响应还没对齐统一契约

`docs/api-contract.md` 当前约定统一错误结构为：

- `{ error: { code, message } }`

但当前 `visualization` 的 API routes 仍然返回：

- `{ error: "..." }`

这会影响前端消费和跨服务联调时的统一错误处理。

### 3.4 轨迹页 `Turn` 段字段展示还没有完全对齐文档

当前五段聚合和 narrative 已经成立，但页面和 DTO 还没有把文档里承诺的部分 Turn 原始字段完整展示出来。

当前最明显的是：

- `session_id`
- `host`

这些字段要么还没进入最终 DTO，要么没有在页面上展示。

### 3.5 测试还没有覆盖目录视图边界和 API 契约缺口

当前测试已经覆盖了：

- runtime 观测解析
- 五段 narrative
- 趋势聚合
- 健康状态分离

但还没有覆盖：

- `memory_view_mode + scope` 组合边界
- 双路聚合的重复结果
- API 错误响应结构

## 4. 你的目标

这次开发目标只有一个：

把 `visualization` 从“页面可运行”补到“目录视图边界正确、治理入口完整、API 契约一致”的状态。

## 5. 你必须补齐的内容

### 5.1 收紧目录页双视图的聚合边界

你要把 `workspace_only` 和 `workspace_plus_global` 在显式 `scope` 过滤下的语义收正。

至少要做到：

- `workspace_only` 永远不返回全局记忆
- `workspace_plus_global` 只把 `scope=user` 当作全局路由，不把其他 scope 打到跨工作区查询
- 双路聚合时去重和总数计算正确

### 5.2 补齐详情页的 `edit / restore_version` 页面入口

你要把已经存在的 API route 和 client 接到页面上，形成真正可操作的详情页治理闭环。

### 5.3 统一 `visualization` API 的错误结构

你要把 `/api/memories`、`/api/runs`、`/api/dashboard`、治理 routes 的错误响应统一到正式错误契约。

### 5.4 补齐轨迹页 `Turn` 段原始字段展示

你要把当前已经拿到的原始字段真正展示出来，并把缺的字段从 DTO 补到页面。

### 5.5 补测试

至少覆盖：

- `memory_view_mode + scope` 组合边界
- 双路聚合去重
- API 错误响应结构
- 详情页 `edit / restore_version` 入口

## 6. 这次开发不要做什么

这次不要偏题。

不要把精力花在下面这些方向：

- 不要改写 `storage` 或 `retrieval-runtime`
- 不要把上游内部实现直接引用进来
- 不要重做整套 UI 风格
- 不要顺手扩展新的产品能力
- 不要用“只要能显示就行”的方式绕开正式契约适配

## 7. 完成标准

完成后，至少要满足下面这些条件：

### 7.1 页面层

- 记忆目录页可用
- 运行轨迹页可用
- 指标看板页可用
- 健康状态面板可用

### 7.2 契约层

- 目录页双视图在显式 `scope` 过滤下结果可靠
- `visualization` API 错误响应已对齐统一契约

### 7.3 解释层

- 轨迹页继续保持五段解释
- `Turn` 段展示字段和当前文档一致

### 7.4 容错层

- 单个数据源失败时只影响对应区域
- 本服务仍可启动并提供降级页面
- 页面明确显示“数据源不可用”而不是空白

### 7.5 测试层

- 新增功能有对应测试
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm test`

都通过

## 8. 最后交付时你要说明什么

完成后，请明确汇报下面这些内容：

1. 哪些验收缺口已经补齐
2. 目录页双视图边界最后怎么收的
3. 页面级 `edit / restore_version` 怎么接进详情页
4. API 错误结构怎么统一的
5. 新增了哪些测试
6. 还有没有剩余风险
