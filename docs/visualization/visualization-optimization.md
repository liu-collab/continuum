# 可视化模块优化方案

## 概述

可视化模块（Visualization）基于 Next.js 15 App Router，提供 Agent 工作台、记忆目录、运行轨迹、治理历史和指标看板。本文档针对 15 个设计问题给出优化方案。

---

## 优化一：补齐所有页面的 error.tsx 和 loading.tsx

**状态：已完成**

### 问题

只有 `/dashboard` 有 `error.tsx` 和 `loading.tsx`。`/memories`、`/runs`、`/governance`、`/agent` 在服务端渲染抛出异常时直接白屏，无任何降级 UI。

### 方案

为每个缺失路由添加标准的错误边界和加载骨架，统一放在 `src/components/` 中复用：

```tsx
// src/components/page-error-boundary.tsx
"use client";

export function PageError({
  error,
  reset,
  title = "页面加载失败",
}: {
  error: Error;
  reset: () => void;
  title?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <p className="text-lg font-semibold text-destructive">{title}</p>
      <p className="text-sm text-muted-foreground max-w-md text-center">
        {error.message || "服务暂时不可用，请稍后重试"}
      </p>
      <button onClick={reset} className="px-4 py-2 rounded-md bg-primary text-primary-foreground">
        重试
      </button>
    </div>
  );
}
```

每个缺失路由下创建：

```tsx
// src/app/memories/error.tsx
"use client";
import { PageError } from "@/components/page-error-boundary";
export default function MemoriesError({ error, reset }: { error: Error; reset: () => void }) {
  return <PageError error={error} reset={reset} title="记忆目录加载失败" />;
}
```

loading.tsx 复用 dashboard 已有的骨架样式，抽取为 `PageSkeleton` 组件。

### 效果

- 所有页面有统一的错误恢复 UI，不会白屏
- 加载时有骨架屏，避免布局跳动

---

## 优化二：合并两套 i18n 系统

**状态：已完成**

### 问题

全局用 `lib/i18n/`，Agent 用 `app/agent/_i18n/`，两套独立的 Provider、messages、locale-switch。切语言时各自为政。

### 方案

（a）Agent 的 i18n 合并到 `lib/i18n/messages.ts` 中，按命名空间区分：

```typescript
// lib/i18n/messages.ts
const dictionaries = {
  "zh-CN": {
    common: { /* 当前全局 key */ },
    agent: { /* 当前 Agent 独有 key */ },
  },
  "en-US": {
    common: { /* ... */ },
    agent: { /* ... */ },
  },
};
```

`createTranslator` 增加 `namespace` 参数：

```typescript
const t = createTranslator(locale, "agent");
// t("turn.input") 读取 dictionaries[locale].agent["turn.input"]
```

（b）删掉 `app/agent/_i18n/` 目录，Agent 组件统一引用 `@/lib/i18n`。

（c）`AgentI18nProvider` 的逻辑合并到全局 `AppI18nProvider` 中，Agent 组件不再需要独立的 Provider。

### 效果

- 一套 i18n 机制覆盖全局 + Agent，切语言实时联动
- 翻译 key 集中管理，不会出现全局有翻译但 Agent 没有的情况

---

## 优化三：错误处理显式化，停止静默吞咽

**状态：已完成**

### 问题

`fetchMemoryById` 对所有异常返回 `null`，"记录不存在"和"数据库挂了"对外表现相同。所有 API routes 的 catch 丢弃原始错误对象。

### 方案

（a）`fetchMemoryById` 区分 not found 和 error：

```typescript
// lib/server/storage-read-model-client.ts
export async function fetchMemoryById(id: string): Promise<MemoryRecord | null> {
  try {
    const result = await runQuery(...);
    if (!result) return null;  // 真不存在
    return result;
  } catch (error) {
    // 重新抛出带上下文的错误，让调用方感知
    throw new StorageUnavailableError("failed to fetch memory by id", { recordId: id, cause: error });
  }
}
```

或者改为返回 discriminated union：

```typescript
type FetchResult<T> =
  | { status: "ok"; data: T }
  | { status: "not_found" }
  | { status: "error"; message: string };
```

（b）API routes 统一用 `console.error` 记录原始错误再返回客户端安全的消息：

```typescript
// 所有 API route handler 的 catch 块改为：
catch (error) {
  console.error(`[api] ${req.method} ${req.url}:`, error);
  // 生产环境不泄露内部错误细节给客户端
  const message = process.env.NODE_ENV === "development"
    ? error instanceof Error ? error.message : String(error)
    : "服务内部错误";
  return NextResponse.json({ status: "error", error: { message } }, { status: 500 });
}
```

### 效果

- 排查问题时有日志可查，不会连错误堆栈都看不到
- 调用方能区分"不存在"和"出错了"

---

## 优化四：拆分巨型服务文件

**状态：已完成**

### 问题

| 文件 | 行数 | 职责 |
|---|---|---|
| `features/dashboard/service.ts` | 748 | 指标 + 趋势 + 诊断 + 缓存 + i18n |
| `features/run-trace/service.ts` | 812 | 轨迹组装 + 上下文解析 + 回退逻辑 |
| `lib/i18n/messages.ts` | 1528 | zh-CN + en-US 双语字典 |

单文件过大导致定位困难、测试困难、合并冲突频繁。

### 方案

**dashboard 拆分：**

```
features/dashboard/
  service.ts            (~80 行，组装 + 缓存编排)
  metric-computer.ts    (~200 行，指标计算)
  trend-analyzer.ts     (~150 行，趋势分析)
  diagnosis-engine.ts   (~200 行，诊断逻辑)
```

**run-trace 拆分：**

```
features/run-trace/
  service.ts            (~100 行，组装入口)
  phase-narrator.ts     (~250 行，阶段叙述构建)
  context-resolver.ts   (~200 行，注入上下文解析)
  item-builder.ts       (~150 行，列表项构建)
```

**i18n 拆分：**

```
lib/i18n/
  index.ts
  messages/
    zh-CN/
      common.ts         (~400 行)
      agent.ts          (~350 行)
    en-US/
      common.ts         (~400 行)
      agent.ts          (~350 行)
```

### 效果

- 每个文件单一职责，修改一个指标不至于波及整个 service
- 拆出的模块可以独立测试
- 翻译按命名空间分开，新增语言只需加目录

---

## 优化五：消除代码重复

**状态：已完成**

### 问题

五类重复：

1. `Row` 组件在三处内联实现
2. 5 个治理 API routes 模板克隆
3. `statusTone` 三处独立定义
4. 筛选表单模式三页重复
5. `api-client.ts` 未使用但仍存在

### 方案

**（a）提取共享 Row 组件：**

```tsx
// src/components/detail-row.tsx
export function DetailRow({ label, value, tone }: {
  label: string;
  value: React.ReactNode;
  tone?: "active" | "archived" | "deleted" | "pending" | "success" | "error";
}) {
  const toneClass = TONE_CLASSES[tone ?? "active"];
  return (
    <div className="flex items-baseline justify-between py-2 border-b border-border">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={`text-sm font-mono ${toneClass}`}>{value}</dd>
    </div>
  );
}
```

三页删除内联实现，改为引入 `DetailRow`。

**（b）合并治理 API routes 为参数化 handler：**

```typescript
// src/app/api/memories/[id]/actions/route-utils.ts
const GOVERNANCE_ACTIONS = {
  archive:  { method: archiveRecord,  successStatus: 200 },
  confirm:  { method: confirmRecord,  successStatus: 200 },
  delete:   { method: deleteRecord,   successStatus: 200 },
  invalidate:{ method: invalidateRecord, successStatus: 200 },
  "restore-version": { method: restoreVersion, successStatus: 200 },
} as const;

export async function handleGovernanceAction(
  action: keyof typeof GOVERNANCE_ACTIONS,
  recordId: string,
  body: unknown,
) {
  // 统一的 parse → call → error handling
}
```

删掉 5 个独立 route 文件，改由一个 `route.ts` + action 参数处理。

**（c）删除 `api-client.ts`**：未被任何地方引用，直接删除。

### 效果

- Row 改一处，三页同步生效
- 治理 API 新增 action 只需加配置，不用新建文件
- 死代码清理后数据流更清晰

---

## 优化六：`governance/page.tsx` 用 `<Link>` 替代 `<a>` 标签

**状态：已完成**

### 问题

```tsx
// governance/page.tsx — 当前
<a href={`?executionId=${item.id}`} onClick={...}>
```

每次点击触发整页刷新，不走 Next.js 客户端导航。

### 方案

```tsx
<Link href={`/governance?executionId=${item.id}`} scroll={false}>
```

### 效果

- 治理详情切换不重新加载整页，响应速度提升
- 和 runs/page.tsx 保持一致的导航风格

---

## 优化七：诊断阈值配置化

**状态：已完成**

### 问题

`features/dashboard/service.ts` 中全部阈值硬编码：

```typescript
emptyRecall >= 0.35
conflictRate >= 0.15
recallP95 >= 1200
writeP95 >= 1500
// ... 20+ 处
```

改阈值要改代码、重新构建、重新部署。

### 方案

在 `lib/env.ts` 中增加配置项，dashboard service 从配置读取：

```typescript
// lib/env.ts
DASHBOARD_EMPTY_RECALL_WARN_THRESHOLD: z.coerce.number().default(0.35),
DASHBOARD_CONFLICT_RATE_WARN_THRESHOLD: z.coerce.number().default(0.15),
DASHBOARD_RECALL_P95_WARN_MS: z.coerce.number().default(1200),
DASHBOARD_WRITE_P95_WARN_MS: z.coerce.number().default(1500),
```

dashboard service 中：

```typescript
const thresholds = {
  emptyRecall: config.DASHBOARD_EMPTY_RECALL_WARN_THRESHOLD,
  conflictRate: config.DASHBOARD_CONFLICT_RATE_WARN_THRESHOLD,
  recallP95: config.DASHBOARD_RECALL_P95_WARN_MS,
  writeP95: config.DASHBOARD_WRITE_P95_WARN_MS,
};
```

### 效果

- 调整阈值只需改环境变量，不需要改代码
- 不同部署环境可以用不同的阈值

---

## 优化八：缓存增加容量上限

**状态：已完成**

### 问题

`cache.ts` 用 `Map` 实现内存缓存，无上限。dashboard 每次换 locale + window 组合创建新 key，进程运行久了内存持续增长。

### 方案

增加 LRU 淘汰机制：

```typescript
// lib/cache.ts
const MAX_CACHE_ENTRIES = 200;

export function createCache<T>(ttlMs: number) {
  const store = new Map<string, { value: T; expiresAt: number }>();

  function evict() {
    if (store.size <= MAX_CACHE_ENTRIES) return;
    // 淘汰最早过期的条目
    const entries = [...store.entries()]
      .sort(([, a], [, b]) => a.expiresAt - b.expiresAt);
    for (const [key] of entries.slice(0, store.size - MAX_CACHE_ENTRIES)) {
      store.delete(key);
    }
  }

  function set(key: string, value: T) {
    evict();
    store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  return { get, set, clear, size: () => store.size };
}
```

### 效果

- 内存使用有确定上界
- LRU 语义保证热数据不被淘汰

---

## 优化九：共享组件拆分 `"use client"` 标记

**状态：已完成**

### 问题

`src/components/` 下 12 个文件全部标记 `"use client"`，包括 `EmptyState`、`ErrorState`、`FormField`、`BrandMark` 这些纯展示组件。它们被打进客户端 bundle，增加 JS 体积。

### 方案

逐个审查，只保留真正需要客户端能力的组件标记 `"use client"`：

| 组件 | 需要 `"use client"`? | 理由 |
|---|---|---|
| `EmptyState` | 否 | 纯展示 |
| `ErrorState` | 否 | 纯展示 |
| `FormField` | 否 | 纯展示 |
| `BrandMark` | 否 | 纯展示 |
| `FilterBar` | 否 | 纯展示 |
| `FilterModal` | 是 | 使用 `useState` |
| `SearchForm` | 是 | 使用 `useState` + `useRouter` |
| `DataTable` | 否 | 纯展示 |
| `SourceHealthPanel` | 是 | 使用 `useEffect` 轮询 |

去掉不必要的 `"use client"` 后，这些组件在服务端渲染成静态 HTML，零 JS 体积。

### 效果

- 客户端 JS bundle 体积减少
- 页面首屏渲染更快

---

## 优化十：`AgentRouteShell` 用 route params 替代 `usePathname()` 解析

### 问题

```typescript
// agent-route-shell.tsx
const pathname = usePathname();
const sessionId = pathname.split("/").pop();
```

手动解析 URL 来获取 sessionId。但 `[sessionId]/page.tsx` 已经通过 props 拿到了 sessionId，只是被忽略了。

### 方案

`[sessionId]/page.tsx` 把 `sessionId` 传给 layout 或通过 searchParams：

```tsx
// agent/[sessionId]/page.tsx
export default async function AgentSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <AgentRouteShell sessionId={sessionId} />;
}
```

删除 `AgentRouteShell` 中的 `usePathname()` + `.split()` 逻辑。

### 效果

- URL 结构调整（如嵌套更深）不会导致 sessionId 解析错误
- 符合 Next.js App Router 标准的 params 传递模式

---

## 优化十一：治理配置入口与 retrieval-runtime 配置 API

**状态：已完成**

### 问题

自动治理（MaintenanceWorker 定期用 LLM 扫描、规划、执行）有多项可配置参数，但全部埋藏在 retrieval-runtime 的环境变量中，用户没有任何 UI 入口：

| 参数 | 作用 |
|---|---|
| `WRITEBACK_MAINTENANCE_ENABLED` | 是否启用自动治理 |
| `WRITEBACK_MAINTENANCE_INTERVAL_MS` | 扫描间隔 |
| `WRITEBACK_GOVERNANCE_VERIFY_ENABLED` | 是否启用 verifier 二次校验 |
| `WRITEBACK_GOVERNANCE_SHADOW_MODE` | 是否只统计不执行（调试/审计用） |
| `WRITEBACK_MAINTENANCE_MAX_ACTIONS` | 每次扫描最多执行多少动作 |

同时，Agent 设置面板中的"写回模型"标签具有误导性——这个 `memory_llm` 同时驱动 writeback 和 governance，但面板上完全没有提到治理。

根本原因是 retrieval-runtime 没有等价于 MNA `GET/PUT /v1/agent/config` 的配置端点，前端无法读写 runtime 配置。

### 方案

**（a）retrieval-runtime 增加配置 API：**

```typescript
// retrieval-runtime/src/api/routes/config.ts

// GET /v1/runtime/config — 返回当前治理相关配置（脱敏）
// PUT /v1/runtime/config — 更新可编辑配置子集

const editableConfigSchema = z.object({
  WRITEBACK_MAINTENANCE_ENABLED: z.boolean().optional(),
  WRITEBACK_MAINTENANCE_INTERVAL_MS: z.number().min(30_000).optional(),
  WRITEBACK_GOVERNANCE_VERIFY_ENABLED: z.boolean().optional(),
  WRITEBACK_GOVERNANCE_SHADOW_MODE: z.boolean().optional(),
  WRITEBACK_MAINTENANCE_MAX_ACTIONS: z.number().min(1).max(20).optional(),
});

// 修改后持久化到托管配置文件，和 embedding/memory_llm 配置同目录
// ~/.continuum/managed/runtime-config.json
```

runtime 启动时从配置文件加载，`PUT` 后热更新（MaintenanceWorker 下次循环生效）。

**（b）Agent 设置面板增加治理配置区：**

在现有 Agent 设置面板（`agent/_components/settings-panel.tsx`）中增加一个分节：

```
设置面板
  ├── 主模型（已有）
  ├── 审批/计划模式（已有）
  ├── 记忆模型 / Memory LLM  ← 改名，加说明"用于记忆写入与自动治理"
  │     base_url / model / api_key / protocol / timeout / effort
  ├── Embedding（已有）
  ├── MCP（已有）
  └── 自动治理 [新增]
        ├── 启用自动治理         toggle
        ├── 扫描间隔（分钟）       number
        ├── Verifier 二次校验     toggle
        ├── Shadow 模式（调试用）  toggle
        └── 每次扫描最大动作数     number
```

**（c）`/governance` 页面增加快速入口：**

治理页面顶部增加一个状态条，显示当前治理配置摘要和"配置"按钮，点击跳转到 Agent 设置面板的治理分区：

```
自动治理：已启用  |  扫描间隔：5 分钟  |  Verifier：已启用  |  [配置]
```

### 效果

- 用户不需要理解环境变量就能控制自动治理行为
- "写回模型"正名为"记忆模型"，和治理的关系透明化
- runtime 配置 API 为后续扩展（如 runtime 其他参数的页面化管理）打基础

---

## 实施优先级

| 优先级 | 优化项 | 理由 |
|---|---|---|
| **P1** | 优化一（补齐 error/loading 边界） | 当前缺陷，用户直接看到白屏 |
| **P1** | 优化三（错误处理显式化） | 排查效率、生产可靠性 |
| **P2** | 优化二（合并 i18n 系统） | 架构一致性 |
| **P2** | 优化五（消除重复） | 代码维护性 |
| **P2** | 优化六（Link 替代 a 标签） | 用户体验 |
| **P2** | 优化七（阈值配置化） | 运维效率 |
| **P3** | 优化四（拆分巨型文件） | 可测试性和可维护性 |
| **P3** | 优化八（缓存上限） | 内存安全 |
| **P3** | 优化九（拆分 client 标记） | 性能优化 |
| **P3** | 优化十（route params 替代手动解析） | 健壮性 |

每项优化独立可实施、独立可验证。
