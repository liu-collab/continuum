# visualization 实质缺口提示词

## 1. 这份提示词给谁

这份提示词给负责继续收口 `services/visualization` 的开发 agent。

当前这层已经不是“缺页面骨架”，也不是“只有空壳”。

现在的状态是：

- `Next.js` 工程可以启动
- `lint`、`typecheck`、`build`、`test` 已通过
- 目录页、运行轨迹页、指标看板页、健康接口都已经有实现
- 前一轮补齐验收已经修正了 runtime 观测适配、指标字段映射和健康状态分离

但它还没有通过“正式可接入、正式可联调、正式可验收”这一层要求。

原因不是页面功能缺失，而是还剩几处会直接影响真实联调和真实排查体验的实质缺口。

你的任务不是重写前端，而是把这些最后的硬缺口补齐。

## 2. 先读哪些文档

开始改代码前，先完整阅读下面这些内容，并以它们为准：

- `docs/architecture-independence.md`
- `docs/memory-module-contract.md`
- `docs/visualization/visualization-implementation-spec.md`
- `docs/visualization/visualization-remediation-agent-prompt.md`
- `services/visualization/README.md`

然后重点读当前实现：

- `services/visualization/src/lib/server/`
- `services/visualization/src/features/`
- `services/visualization/src/app/`
- `services/visualization/tests/`

联调口径必须同时核对：

- `services/storage/src/api/app.ts`
- `services/storage/src/contracts.ts`
- `services/retrieval-runtime/src/api/schemas.ts`

## 3. 当前还剩哪些实质缺口

### 3.1 目录页双视图在显式 `scope` 下还存在真实边界问题

当前 `queryCatalogView()` 采用“两路查询再合并”的方式：

- 一路查当前工作区
- 一路查当前用户全局记忆

这种做法在默认视图下基本成立，但当请求里显式带 `scope` 时仍有实质缺口：

- `workspace_only + scope=user` 可能查出不该出现的全局记忆
- `workspace_plus_global + scope=workspace/task/session` 可能把其他工作区的非全局记录查进来
- `workspace_plus_global + scope=user` 可能把同一条全局记忆重复合并

### 3.2 页面级治理闭环还没有完全成立

当前实现里：

- `edit` API route 已有
- `restore-version` API route 已有

但详情页没有对应 UI。

这意味着治理后端入口已经有了，但对产品用户来说，这两项能力还不能算正式可用。

### 3.3 `visualization` API 错误响应仍和统一契约不一致

当前多个 API route 仍然返回：

- `{ error: "..." }`

而正式通用契约要求：

- `{ error: { code, message } }`

这是会影响真实联调和统一错误处理的硬缺口。

### 3.4 轨迹页 `Turn` 段字段展示仍然偏弱

当前五段 narrative 和聚合已经成立，但 `Turn` 段还没有把文档承诺的原始字段完整展示出来。

当前最明显的是：

- `session_id`
- `host`

## 4. 你的目标

这次开发目标只有一个：

把 `visualization` 从“页面功能基本补齐”补到“正式联调可用、正式排查可用、正式验收可通过”。

## 5. 你必须补齐的内容

### 5.1 收紧目录页双视图边界

确保：

- `workspace_only` 不返回全局记忆
- `workspace_plus_global` 只把 `scope=user` 走全局查询
- 双路聚合去重和总数正确

### 5.2 补齐页面级 `edit / restore_version`

确保详情页不是只有四个按钮，而是真的把当前阶段承诺的治理能力补完整。

### 5.3 统一 API 错误响应结构

确保 `visualization` 自己对外的 API 在错误时也遵守统一契约。

### 5.4 补齐轨迹页 Turn 原始字段展示

确保文档里承诺展示的字段，页面上真的能看到。

### 5.5 补测试

至少覆盖：

- 双视图边界
- 双路去重
- API 错误响应
- 页面级治理入口

## 6. 这次开发不要做什么

- 不要重写整个 UI
- 不要改 storage 或 retrieval-runtime 的代码
- 不要扩展新的产品功能
- 不要只改 README 不改实现

## 7. 完成标准

### 7.1 轨迹页

- 五段独立展示且正确聚合
- 缺段时有明确标注

### 7.2 目录页

- 字段映射和 storage 最新共享读模型一致
- 双视图边界正确

### 7.3 API

- 错误响应和统一契约一致

### 7.4 治理入口

- 页面级 `edit / restore_version` 可用

### 7.5 测试

- 新增功能有对应测试
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm test`

都通过

## 8. 最后交付时你要说明什么

1. 目录页双视图边界是怎么修正的
2. 页面级 `edit / restore_version` 怎么补进来的
3. API 错误响应怎么统一的
4. 轨迹页 Turn 段补了哪些字段
5. 新增了哪些测试
6. 还有没有剩余风险
