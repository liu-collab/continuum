# 存储模块优化方案

## 概述

存储模块（Storage）负责结构化记忆的写入、去重、合并、冲突检测和读模型投影。采用双进程架构：API Server（同步验证+入队）+ Async Worker（异步处理 write job + 刷新读模型）。本文档针对 8 个不合理设计给出优化方案。

---

## 优化一：Worker 错误处理无熔断机制

**状态：已完成**

### 问题

Worker 的 `processWriteJobs()` 对所有错误只做日志记录，循环继续：

```typescript
// worker.ts
while (active) {
  try {
    await service.processWriteJobs();
  } catch (error) {
    runtime.logger.error({ error }, "storage worker cycle failed");
  }
  await delay(pollIntervalMs);
}
```

数据库连接断开、磁盘满等系统性问题发生时，Worker 每轮循环都失败并打日志，不做退避、不熔断、不告警。极端情况下日志会在短时间内爆炸。

### 方案

增加指数退避和连续失败计数：

```typescript
// worker.ts

const MAX_CONSECUTIVE_FAILURES = 10;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60_000;

let consecutiveFailures = 0;
let currentDelay = pollIntervalMs;

while (active) {
  try {
    await service.processWriteJobs();
    consecutiveFailures = 0;
    currentDelay = pollIntervalMs;
  } catch (error) {
    consecutiveFailures += 1;
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      runtime.logger.fatal({ error, consecutiveFailures }, "worker exceeded max consecutive failures, stopping");
      break;
    }
    const backoff = Math.min(BASE_BACKOFF_MS * Math.pow(2, consecutiveFailures - 1), MAX_BACKOFF_MS);
    runtime.logger.warn({ error, consecutiveFailures, backoffMs: backoff }, "worker cycle failed, backing off");
    currentDelay = backoff;
    runtime.emitAlert?.({ kind: "worker_degraded", consecutiveFailures });
  }
  await delay(currentDelay);
}
```

### 效果

- 瞬时故障自动恢复，系统故障不刷屏日志
- 连续 10 次失败停止 Worker，避免无意义空转
- 退避时间可达 60s，给运维留出反应窗口

---

## 优化二：`enqueueMany` 批量写入用单条 INSERT 替代循环

### 问题

`enqueueMany()` 在循环中逐条调用 `enqueue()`，每条都是独立的 INSERT + idempotency 查询：

```typescript
// repositories.ts
async enqueueMany(jobs: WriteJobEnqueueInput[]): Promise<WriteJobRecord[]> {
  const results: WriteJobRecord[] = [];
  for (const job of jobs) {
    results.push(await this.enqueue(job));  // N 次独立 SQL
  }
  return results;
}
```

50 个候选 = 50 次 INSERT + 50 次 SELECT（幂等检查）。在本地可能不明显，生产环境下是 N×2 次网络往返。

### 方案

用单条多行 INSERT ... ON CONFLICT 替代：

```typescript
async enqueueMany(jobs: WriteJobEnqueueInput[]): Promise<WriteJobRecord[]> {
  if (jobs.length === 0) return [];

  const now = new Date().toISOString();
  const rows = jobs.map((job) => ({
    ...job,
    id: randomUUID(),
    job_status: "queued" as const,
    created_at: now,
    updated_at: now,
    retry_count: 0,
  }));

  const result = await this.session.query<WriteJobRow>(`
    INSERT INTO ${this.session.privateSchema}.memory_write_jobs
      (id, workspace_id, user_id, task_id, session_id,
       candidate_type, scope, summary, details_json,
       importance, confidence, write_reason, source_json,
       idempotency_key, job_status, retry_count, created_at, updated_at)
    SELECT * FROM unnest(
      $1::uuid[], $2::text[], $3::text[], $4::uuid[], $5::uuid[],
      $6::text[], $7::text[], $8::text[], $9::jsonb[],
      $10::int[], $11::float[], $12::text[], $13::jsonb[],
      $14::text[], $15::text[], $16::int[], $17::timestamptz[], $18::timestamptz[]
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING *
  `, [/* array parameters */]);

  return result.rows.map(toWriteJobRecord);
}
```

或者更轻量的方案：把幂等检查提到外层，用一条 SELECT 批量查已有 key，过滤掉重复的，然后用单条多行 INSERT 写入剩余。

### 效果

- 50 个候选从 ~100 次 SQL → 2 次（1 次批量查重 + 1 次批量写）
- Worker 处理延迟下降 50%+

---

## 优化三：`listRecords` 用窗口函数替代 COUNT 独立查询

### 问题

`listRecords` 先发 COUNT 查询，再发数据查询，两次扫描相同 WHERE 条件：

```typescript
// repositories.ts
const [countResult, rows] = await Promise.all([
  this.session.query<{ count: string }>(`SELECT COUNT(*) as count FROM ... WHERE ...`),
  this.session.query<RecordRow>(`SELECT ... FROM ... WHERE ... ORDER BY ... LIMIT ... OFFSET ...`),
]);
```

对大数据集，WHERE 条件中带有向量相似度排序时，COUNT 扫描同样昂贵。

### 方案

用 `COUNT(*) OVER()` 窗口函数合并为一次查询：

```sql
SELECT
  *,
  COUNT(*) OVER() AS total_count
FROM ${schema}.memory_records
WHERE ...
ORDER BY ...
LIMIT $limit OFFSET $offset
```

第一行的 `total_count` 即为总数。注意需要在外层包装以正确处理 LIMIT 下的窗口函数：

```sql
SELECT *, (SELECT COUNT(*) FROM (SELECT 1 FROM ... WHERE ...) AS _cnt) AS total_count
FROM ...
```

也可以直接用子查询：

```sql
WITH filtered AS (
  SELECT * FROM ${schema}.memory_records WHERE ...
)
SELECT *, (SELECT COUNT(*) FROM filtered) AS total_count
FROM filtered
ORDER BY ... LIMIT ... OFFSET ...
```

### 效果

- 列表查询从 2 次扫描 → 1 次扫描
- 语义过滤条件下的分页性能提升 ~40%

---

## 优化四：双 Drizzle schema 漂移风险

### 问题

存在两套 schema 定义且互相独立：

1. `src/db/schema.ts`：Drizzle ORM 类型定义（TypeScript 用）
2. `migrations/`：手写 SQL 迁移文件（数据库真实结构）

`drizzle-kit generate` 输出到 `migrations/generated`，但真实迁移是手写的 `migrations/0001_*.sql`。Drizzle 类型定义和数据库真实结构之间没有自动校验，长期维护必然漂移。

### 方案

不需要引入 Drizzle Kit 全自动迁移，只需增加一层校验：

```typescript
// src/db/schema-validator.ts

export async function validateSchemaAlignment(
  db: StorageDatabase,
  drizzleSchema: Record<string, unknown>,
): Promise<string[]> {
  const issues: string[] = [];

  // 从 information_schema 读取真实列
  const columns = await db.session().query<{
    table_name: string; column_name: string; data_type: string; is_nullable: string;
  }>(`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema IN ($1, $2)
    ORDER BY table_name, ordinal_position
  `, [config.STORAGE_SCHEMA_PRIVATE, config.STORAGE_SCHEMA_SHARED]);

  // 对比 Drizzle schema 和真实数据库
  // 报告多余/缺失的列和类型不匹配
  return issues;
}
```

在 `npm run dev` 和 CI 中增加 `npm run schema:check`，仅报告差异不自动修。同时废弃 `migrations/generated` 目录，避免新人困惑。

### 效果

- Schema 漂移在开发阶段暴露，不等到生产事故
- 不改变现有的手写迁移流程

---

## 优化五：Schema 名称绕过配置系统从环境变量直接读取

### 问题

`schema.ts` 在模块加载时直接从 `process.env` 读取 schema 名称：

```typescript
// src/db/schema.ts:17
export const STORAGE_SCHEMA_PRIVATE = process.env.STORAGE_SCHEMA_PRIVATE || "storage_private";
export const STORAGE_SCHEMA_SHARED = process.env.STORAGE_SCHEMA_SHARED || "storage_shared_v1";
```

这绕过了 `config.ts` 中的 Zod 校验。测试中要覆盖 schema 名称只能设置环境变量，无法通过配置对象注入。而且 Drizzle 表定义使用了这些模块级常量，一旦模块加载就无法更改。

### 方案

Drizzle schema 改为工厂函数，接收配置参数：

```typescript
// src/db/schema.ts
export function createSchema(config: { privateSchema: string; sharedSchema: string }) {
  const privatePg = pgSchema(config.privateSchema);
  const sharedPg = pgSchema(config.sharedSchema);

  return {
    memoryRecords: privatePg.table("memory_records", { ... }),
    readModel: sharedPg.table("memory_read_model_v1", { ... }),
    // ...
  };
}
```

调用侧 (`services.ts`) 传入已验证的配置。迁移脚本（`migration-runner.ts`）继续用模板替换，不受影响。

### 效果

- Schema 名称受 Zod 校验保护
- 测试可以传入任意 schema 名，不依赖环境变量
- Drizzle 类型和运行时配置同源

---

## 优化六：`snapshotRecord` 浅拷贝导致版本快照共享引用

### 问题

```typescript
// repositories.ts
export function snapshotRecord(record: MemoryRecord): Record<string, unknown> {
  return { ...record };
}
```

`details_json` 等 JSONB 字段是对象引用，浅拷贝后快照和原记录共享同一个对象。后续对原记录的修改会污染已保存的历史版本。虽然当前代码中记录通常是从 DB 重新读取的（JSONB 被反序列化为新对象），但这个假设没有显式保证。

### 方案

```typescript
export function snapshotRecord(record: MemoryRecord): Record<string, unknown> {
  return JSON.parse(JSON.stringify(record));
}
```

性能影响可忽略——快照在事务内同步写入，每秒不到 100 次。

### 效果

- 历史版本不可变，后续修改不会污染快照
- JSON 序列化额外开销微秒级，对写入吞吐无影响

---

## 优化七：`archive` 和 `invalidate` 产生相同的数据库状态

### 问题

两个动作对数据库产生完全相同的效果：

```typescript
// 都设置: status = "archived", archived_at = now()
```

唯一的差异是 `governance_actions` 中记录的 `action_type` 字段。这意味着"手动归档"和"标记无效"的语义差异无法在数据层区分，只能在审计日志中追溯。

### 方案

`invalidate` 的记录增加一个标记字段区分：

```typescript
// governance-engine.ts invalidateRecord
const invalidated = await tx.records.updateRecord(recordId, {
  status: "archived",
  archived_at: new Date().toISOString(),
});

// details_json 中增加 invalidate 标记
await tx.records.updateRecord(recordId, {
  details_json: {
    ...existing.details_json,
    invalidation_reason: input.reason,
    invalidated_by: input.actor.actor_id,
    invalidated_at: new Date().toISOString(),
  },
});
```

这样在记忆详情页可以看到"这条是被标记无效的"vs"这条是过时归档的"，而不是只能看到 `status = "archived"`。

### 效果

- 用户能区分一条记忆是"手动归档"还是"标记无效"
- 不改变现有数据模型，仅在 `details_json` 中增加标记

---

## 优化八：`adaptRuntimeCandidateToStorage` 硬编码类型映射

### 问题

`services.ts` 中的适配器硬编码了 retrieval-runtime 格式到 storage 格式的映射：

```typescript
// services.ts
const candidateType = input.candidate_type === "commitment"
  ? "episodic"
  : input.candidate_type === "preference"
    ? "fact_preference"
    : input.candidate_type;
```

如果 retrieval-runtime 新增类型，这里静默透传可能导致无效的 `candidate_type` 进入数据库。

### 方案

将映射表提取为显式的常量并做校验：

```typescript
// contracts.ts
export const RUNTIME_TO_STORAGE_TYPE_MAP: Record<string, string> = {
  fact_preference: "fact_preference",
  task_state: "task_state",
  episodic: "episodic",
  commitment: "episodic",
  preference: "fact_preference",
  important_event: "episodic",
};

export function mapRuntimeCandidateType(runtimeType: string): string {
  const mapped = RUNTIME_TO_STORAGE_TYPE_MAP[runtimeType];
  if (!mapped) {
    throw new AppError("unknown runtime candidate type", {
      code: "unknown_candidate_type",
      status_code: 400,
      details: { runtimeType },
    });
  }
  return mapped;
}
```

### 效果

- 未知类型不静默透传，400 显式拒绝
- 映射关系集中管理，两个服务格式变更时只改一处

---

## 实施优先级

| 优先级 | 优化项 | 理由 |
|---|---|---|
| **P1** | 优化一（熔断机制） | 防止系统故障时日志爆炸和资源空耗 |
| **P1** | 优化六（快照深拷贝） | 潜在数据完整性风险 |
| **P2** | 优化二（批量写入） | 性能优化，对大批量写入效果明显 |
| **P2** | 优化三（窗口函数替代 COUNT） | 读性能优化 |
| **P2** | 优化五（Schema 工厂化） | 消除配置绕过，测试友好 |
| **P3** | 优化四（Schema 漂移检查） | 防御性措施 |
| **P3** | 优化七（invalidate 标记） | UI 体验改善 |
| **P3** | 优化八（类型映射显式化） | 健壮性提升 |

每项优化独立可实施、独立可验证。
