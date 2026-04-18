# visualization 改进建议

## 1. 文档目的

这份文档记录对 `services/visualization/` **现状实现**与**规划中的 agent 功能（T11）**的审视结论，按优先级列出建议改动。

- 现状描述见 `visualization-internals.md`
- 涉及 agent 功能的条目会明确标注 🔜
- 每条建议独立成一段，可以单独拆成一个修复任务

## 2. 审视依据

- 代码位置：`services/visualization/src/`（当前版本）
- 对齐契约：`docs/memory-module-contract.md`、`docs/architecture-independence.md`、`docs/current-phase-closure-plan.md`、`docs/memory-native-agent/T11-visualization-frontend.md`
- 使用场景：本地单用户观测 + 治理 + 未来的 agent 对话

## 3. 优先级总览

| 编号 | 标题 | 优先级 | 类别 |
| :--- | :--- | :--- | :--- |
| V01 | 界面全英文，与中文产品语境不一致 | **P0** | 产品体验 |
| V02 | 治理历史无 UI（对应 storage S10） | **P0** | 治理闭环 |
| V03 | /runs 页面筛选与 runtime 实际支持漂移 | **P0** | 契约一致性 |
| V04 | 治理动作后列表不实时反映（read-model 延迟） | P1 | 交互体验 |
| V05 | 直连 PG 的连接池与 HTTP 客户端配置分散 | P1 | 运维 |
| V06 | 无错误详情透传，用户只能看到"unavailable" | P1 | 可调试性 |
| V07 | visualization 自身无鉴权，未来多机器访问风险 | P2 | 安全 |
| V08 | React Query 缓存策略未明确 | P2 | 性能 |
| V09 | 缺少"刷新 read-model 状态"的诊断指示 | P2 | 可观测 |
| V10 | 🔜 agent 功能前端工程预备不足 | P1 | 实施准备 |
| V11 | 🔜 mna token 文件读取的错误路径缺失 | P1 | 可靠性 |
| V12 | 🔜 Playwright / WebSocket 测试基础设施缺位 | P2 | 质量 |

## 4. P0：mna / 治理闭环前必须修

### V01 — 界面全英文，与中文产品语境不一致

**现状**（`app/layout.tsx:49-56`）：
```tsx
<h1>Structured memory, run traces, and failure signals in one console.</h1>
<p>Visualization stays online even when upstream sources fail...</p>
```
顶部导航 `Overview / Memories / Runs / Dashboard`、空状态文案、错误状态文案、各 label/explanation 全部英文。

**为什么不合理**：
- `docs/product-baseline.md`、`docs/memory-module-contract.md` 全中文
- 面向本地部署的中文用户，UI 英文增加理解成本
- 运行轨迹里 `buildNarrative`、`buildPhaseNarratives` 生成的段落全英文，截屏分享给非英文使用者不直观

**建议改动**：
- 引入 `next-intl` 或自建简易 i18n 表，不追求多语言，但把所有展示文本集中到 `src/lib/i18n/zh-cn.ts`
- 第一步：把 `layout.tsx`、`format.ts`（label / explanation 函数）、features 里的 narrative 字符串改为中文
- 保留代码内部 key（英文）用于 API 字段、测试断言
- 对 `buildNarrative / buildPhaseNarratives` 输出的文案改为中文模板字符串
- 保留 `eyebrow` "Agent Memory Observatory" 作为品牌名即可

**验收**：
- 所有用户可见文本中文化（列表 label、空状态、错误状态、narrative）
- 开发者可见字符串（code identifier、API field name、logs）保持英文
- 现有 snapshot / 字符串断言测试同步更新

### V02 — 治理历史无 UI

**现状**：
- `memories/[id]/page.tsx` 展示当前记录状态 + GovernancePanel（可执行治理动作）
- **没有展示**该记录的历史（archive 了几次？谁 confirm 过？上一版 summary 是什么？）
- storage 侧数据齐全（`memory_record_versions` + `memory_governance_actions`），但没 API 暴露（storage S10）
- visualization 侧也没有对应 UI 框架

**为什么不合理**：
- `current-phase-closure-plan.md` 第 7 节明确要求"页面至少补记录详情页的确认/失效/归档/删除/恢复版本入口"
- 其中 `restore_version` 需要用户能看到**有哪些历史版本可选**——当前实现里恢复版本只能凭 version_no 数字盲填
- 治理闭环依赖可见历史，否则用户不知道自己改了什么

**建议改动**（依赖 storage S10 的 `GET /records/:id/history` / `versions` 端点）：
1. visualization `storage-governance-client.ts` 加两个方法：`getRecordHistory(id)` / `getRecordVersions(id)`
2. `memories/[id]/page.tsx` 下方加一个 `HistoryTimeline` 组件：时间倒序展示 governance action + version create 合并的时间线
3. `RestoreVersionDialog` 改为弹窗显示版本列表，用户点选版本号而不是手填
4. 历史项上点击"查看差异"时，fetch 两个 version 的 snapshot 对比（Monaco diff view，复用 T11 要引入的 Monaco）

**验收**：
- 用户在记录详情页看到"X 分钟前由 operator 归档"这样的条目
- `restore_version` 流程从"填数字"变成"选版本卡片"
- 可选：diff 展示（nice-to-have）

### V03 — /runs 页面筛选与 runtime 实际支持漂移

**现状**：`current-phase-closure-plan.md` 第 5.4 节明确规定运行轨迹页正式筛选只保留 `turn_id / session_id / trace_id / page / page_size`。

但 runtime 补齐 mna 多 phase 能力后（I11 改进），会新增 `phase` 维度。如果不同步 visualization，会继续出现"页面有筛选但后端不支持"或"后端有维度但页面不暴露"的漂移。

**为什么不合理**：
- `current-phase-closure-plan.md` 第 4.3 / 4.4 节明令"不支持的能力不能假装支持 / 契约、页面、测试同口径"
- mna 落地后每轮最多 4 次 phase，轨迹必然按 phase 分段查看

**建议改动**（与 retrieval-runtime 改进 I11 配套）：
1. 先等 runtime 侧 recall/trigger/injection 记录新增 `phase` 字段
2. runtime observe runs 接口增加 `phase` 查询参数 + 返回字段
3. visualization `/runs` 页面：
   - 筛选栏加 `phase`（下拉：all / session_start / task_start / task_switch / before_plan / before_response）
   - 详情右侧按 phase 分栏（单轮多 phase 时每 phase 一个 card）
4. `buildPhaseNarratives` 扩展为 `buildPhaseNarrativesByPhase(detail, phase)`，每 phase 独立一套 5 段
5. 自动化契约测试：页面筛选项必须和 `GET /v1/runtime/observe/runs` 支持的 query 参数一一对应

**验收**：
- 后端新增的筛选项一周内页面跟上
- 后端未支持的筛选项在页面不出现
- 契约快照测试通过

## 5. P1：体验与运维

### V04 — 治理动作后列表不实时反映

**现状**：
- 用户在 `/memories/<id>` 点 archive
- storage governance 路径：`updateRecord → enqueueRefresh(readModel)`
- 刷新 job 由 storage worker 异步处理（轮询 1s + embedding 耗时）
- visualization 列表页立即刷新仍从 `memory_read_model_v1` 读，可能看到旧状态

**为什么不合理**：
- 用户操作与结果脱节，容易重复点击或以为操作失败
- 没有"处理中"的中间态提示
- read-model 延迟对用户不可见

**建议改动**：
方案 A（沿用当前 RSC + `router.refresh()`）：
- 治理动作成功后，在 `GovernancePanel` 本地 state 里先标记 `pendingActionAt`
- 当前详情页先显示"刚刚归档，读模型刷新中..."角标或提示条
- 10 秒后再触发一次刷新，验证 read-model 已追上

方案 B（后端补同步读取）：
- storage 治理 endpoint 的响应里附带"已执行的更新 snapshot"，visualization 直接信任这份 snapshot 渲染
- 列表页主动轮询刷新 job 状态（`GET /v1/storage/observe/write-jobs?record_id=<id>`）

方案 A 简单，方案 B 准确。首版建议 A 先落地。

**验收**：点 archive 后，列表该条目 ≤ 1s 显示"刚刚归档"标记，≤ 10s 读模型刷新完，标记消失。

### V05 — 直连 PG 的连接池配置分散

**现状**：
- `storage-read-model-client.ts` 自建一个 `pg.Pool`
- storage 服务也是一份独立连接池
- mna worker（如果未来加）又一份
- 共用同一 PG，但连接数总和可能超 `max_connections`

**为什么不合理**：
- visualization 被部署多份（Next.js dev server、SSR、API route）时每份都建池
- 没有统一的 `max` 限制
- 故障时很难定位"哪个服务吃了连接"

**建议改动**：
- visualization 内：用模块级单例 pool（`getOrCreatePool()`），所有 server-only 代码共享
- 在 `env.ts` 增加 `DATABASE_POOL_MAX` 配置（默认 5，visualization 只做读，小池足够）
- 日志里启动时打印 `database pool max=N`
- 在现有 `/api/sources/health` 返回值里补充"当前活跃连接数 / 上限"；如果后续新增统一依赖健康端点，也沿用同一字段

**验收**：重启服务后连接数不爆，`ps aux + pg_stat_activity` 可以看到 visualization 连接稳定 ≤ N。

### V06 — 错误详情不透传

**现状**：`source-health-panel.tsx` 和列表页空状态只显示 `"Memory source unavailable"` 和 `detail ?? "The shared read model could not be queried..."`。但 `lib/server/*` 抓住 error 后只保留 code，**原始 error message 被吞**。

**为什么不合理**：
- 用户反馈"页面坏了"，开发者只能从日志翻
- 有些错误（schema 缺失、DB 权限拒绝）从文案完全看不出原因

**建议改动**：
- `lib/server/*` 客户端在错误路径把 `error.message` 保留到 `SourceStatus.detail`
- 但不暴露敏感信息（连接串、SQL 全文）——通过白名单化的错误代码分类：
  ```
  { status: "unavailable", code: "pg_connection_refused", detail: "无法连接 PostgreSQL，请检查 DATABASE_URL" }
  ```
- 按 code 在页面文案层做中文解释，不直接显示原始 error.message

**验收**：用户触发常见故障（DB 挂、schema 错、PORT 占用）能在页面看到中文解释和处理建议，不需要看日志。

### V10 🔜 — agent 功能前端工程预备

**现状**：T11 文档规划完整，但当前代码库里：
- 没装 `@monaco-editor/react`
- 没装 `openapi-typescript`
- 浏览器端代码放置口径还没统一：有的文档写 `lib/browser/`，有的文档写 `app/agent/_lib/`
- 没有 WebSocket 客户端封装的参考
- Playwright 没装

**为什么不合理**：
- T11 开工时会"突击装"很多东西，风格容易跑偏
- 浏览器端代码放置不统一，前端很容易一部分写到路由内，一部分写到全局 `lib/`，后面不好收口

**建议改动**（可以在 mna T01 之前先做）：
1. 明确首版 agent 前端的浏览器端代码统一放在 `src/app/agent/_lib/`，这是 route-local 约定；只有跨 feature 复用后才上提到全局 `src/lib/`
2. 在 `src/app/agent/_lib/` 下固定 `mna-client.ts`、`event-reducer.ts`、`openapi-types.ts`、`config.ts`
3. `package.json` 预装依赖（`@monaco-editor/react`、`openapi-typescript` devDep）
4. 在 README 里补一节"agent 前端文件放置约定 / 如何刷新生成类型"

这样 T11 开工时直接按规范走。

**验收**：T11 开工没有"放哪"的讨论，所有新文件有明确位置。

### V11 🔜 — mna token 文件读取的错误路径

**现状（T11/T12 规划）**：
- mna 启动写 `~/.mna/token.txt`
- visualization 需要一个轻量 `app/api/agent/token/route.ts` 读文件后返回给浏览器
- 浏览器拿到 token 后，仍然直接调 mna 的 HTTP / WebSocket，不经过 visualization 代理主链路

**容易漏的场景**：
- mna 还没启动 → 文件不存在
- 权限问题 → 文件存在但读不了
- 文件被手动改坏 → 内容非 hex 串
- mna 重启换 token → 浏览器端 token 过期 → 所有 WS/REST 请求 401

T11 文档里这些场景处理得比较粗（只提到"mna 不可达 → 显示离线"），没细化 token 生命周期。

**建议改动**：
- 在 T11 交付物里把 `app/api/agent/token/route.ts` 明确列为必做项
- `/api/agent/token` 返回统一结构：`{ status, token?, reason?, mnaBaseUrl? }`
  - `status=ok, token="..."`
  - `status=mna_not_running`
  - `status=token_missing`
  - `status=token_invalid`
- 浏览器端 mna-client 收到 401 时自动重新 fetch `/api/agent/token`，失败则展示"agent 离线"并提供启动命令
- Next.js server 端对文件读取设 100ms 超时，避免网络挂载目录卡住请求

**验收**：
- mna 停机 → `/agent` 页面 2s 内显示离线提示
- mna 重启换 token → 页面自动恢复工作（最多一次 401 重试）
- ~/.mna 目录不可读 → 页面显示具体原因（权限问题），不是静默空白

## 6. P2：清理与强化

### V07 — visualization 自身无鉴权

**现状**：`/api/memories/<id>/delete` 可以被同局域网任何人调用，只要他能访问 visualization 的 3000 端口。

**为什么不合理**：
- 首版 `single_local_user` + 127.0.0.1 绑定时不严重
- 一旦用户把 visualization 暴露到 LAN（比如 Next.js dev server 默认监听 `0.0.0.0`），任何人都能删记忆
- 更危险：`/api/memories/<id>/restore-version` 可以被未授权者触发，注入过时数据

**建议改动**：
- `next.config.ts` 强制 dev/start 都 `hostname: "127.0.0.1"`（与 mna 一致）
- 加一个简易 token（复用 mna token 机制或独立生成），server-only middleware 校验
- 文档里明确"首版只支持本地访问，多机器部署不在范围"

**验收**：`curl http://<lan-ip>:3000/api/memories/<id>/delete` 被拒绝。

### V08 — React Query 缓存策略未形成统一约定

**现状**：`providers.tsx` 已设置默认 `staleTime: 15_000`、`refetchOnWindowFocus: false`，但还没有 `gcTime` 约定；而且当前页面主链路主要是 RSC + `router.refresh()`，并没有真正使用 `react-query` 做列表/详情查询缓存。

**为什么不合理**：
- 现在已经有一部分默认值，但它们还没有和未来的 client query 设计统一起来
- 如果后续 `/agent` 或治理详情页开始大量使用 client query，没有统一 `gcTime`、`query key`、刷新策略，行为会很散

**建议改动**：
- 统一设置：`staleTime: 30_000, gcTime: 300_000, refetchOnWindowFocus: false`
- 真正开始引入 client query 后，再统一 `invalidateQueries`；当前治理详情页继续沿用 `router.refresh()`
- 抽到 `lib/query-keys.ts` 统一 query key 结构，避免字符串手拼

### V09 — 缺少 read-model 刷新积压的诊断指示

**现状**：read-model 刷新 job 如果积压（embedding 服务慢、大量治理动作），用户完全看不出来。

**建议改动**：
- storage 观测接口暴露 `read_model_refresh_pending_count` 和 `oldest_pending_age_ms`（对应 storage S04 改进）
- visualization `/dashboard` 加一个诊断卡片："读模型刷新积压：N 条，最老 X 秒前"
- 超阈值（>100 条或 >5min）显示 warning

### V12 🔜 — Playwright 与 WebSocket 测试基础设施

**现状**：当前测试全是 vitest + RTL 单测 + API route 契约测试。没有浏览器级 e2e。T10 要求 4 条 UI e2e 覆盖 agent 功能。

**建议改动**：
- 装 `@playwright/test`
- 新增 `tests/e2e/` 目录（区别于现有 `tests/` 单测）
- 共享 fixture：启停 mna/storage/runtime 测试桩
- CI 里加 Playwright 运行环境（或至少本地 `npm run test:e2e` 跑通）

## 7. 改进顺序建议

1. **先做 P0 三条**（V01 / V02 / V03）——治理闭环与产品一致性前置，mna 一起发。
2. 做 P1 五条（V04 / V05 / V06 / V10 / V11）——前四条是用户可感的体验，V10/V11 是 T11 开工前的工程预备。
3. P2 四条（V07 / V08 / V09 / V12）——安全与质量收尾。

## 8. 契约回写清单

- `docs/current-phase-closure-plan.md` 第 7.4 节：若 V02 落地，明确"记录详情页必须展示治理历史"
- `docs/current-phase-closure-plan.md` 第 5.4 节：若 V03 新增 phase 筛选，更新正式筛选范围
- `docs/visualization/visualization-service-design.md`：V05 / V07 落地后更新运行模型
- `docs/memory-native-agent/T11-visualization-frontend.md`：V10 / V11 确认后回写 token 生命周期、目录约定
- `docs/architecture-independence.md`、`docs/memory-module-contract.md`：只补跨服务前端嵌入的澄清，不改核心边界
- `docs/visualization/visualization-internals.md`（本系列文档）：每条改动合并后同步更新"现状"描述
