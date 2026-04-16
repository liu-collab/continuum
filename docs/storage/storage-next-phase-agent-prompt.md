# storage 下一阶段开发提示词

## 1. 这份提示词给谁

给负责把 `services/storage` 推进到"可正式部署、可真实联调"的开发 agent。

## 2. 先读什么

读代码前先通读下面文档（冲突时按此顺序优先）：

1. `docs/api-contract.md`
2. `docs/architecture-independence.md`
3. `docs/storage/storage-implementation-spec.md`

然后读当前实现：

- `services/storage/src/api/app.ts` — 路由注册
- `services/storage/src/services.ts` — StorageService + getHealth()
- `services/storage/src/jobs/job-worker.ts` — processRefreshJobs()
- `services/storage/src/db/read-model-projector.ts` — embedding 生成
- `services/storage/src/db/migration-runner.ts` — 迁移执行
- `services/storage/src/worker.ts` — worker 进程
- `services/storage/src/config.ts` — StorageConfig

## 3. 当前已有什么（不需要重做）

以下模块已经完整实现，不要重写：

- 写回候选接收（3 种格式：单条 / 批量 / runtime 批量）
- 领域模块：normalizer、merge-engine、conflict-engine、governance-engine、scoring
- 异步 job-worker + writeback-processor（PostgreSQL job table + polling）
- drizzle-orm schema + repositories
- read-model-projector（含 embedding 降级）
- embeddings-client（HttpEmbeddingsClient）
- 迁移脚本（0001 + 0002）+ migration-runner（含占位符替换）
- 测试：api / domain / governance / worker / migrations 共 5 个文件

## 4. 要做的事（6 项）

### 4.1 把 `GET /health` 拆成三个独立端点

**改什么文件**：`src/api/app.ts`、`src/services.ts`

**当前问题**：`src/api/app.ts:55` 只注册了 `GET /health`，`src/services.ts:136-175` 的 `getHealth()` 把 liveness/readiness/dependencies 混在一个响应里。readiness 逻辑在 Redis 配置了但不可用时不应该降级（Redis 是可选依赖）。

**具体做法**：

1. 在 `app.ts` 新增三个路由：
```
GET /v1/storage/health/liveness   → { status: "alive" }
GET /v1/storage/health/readiness  → { status: "ready" | "not_ready", reason? }
GET /v1/storage/health/dependencies → { dependencies: DependencyStatus[] }
```

2. 在 `services.ts` 拆 `getHealth()` 为三个方法：
   - `getLiveness()`: 直接返回 alive，不检查任何依赖
   - `getReadiness()`: 只检查数据库（核心依赖）。数据库不可用 → `not_ready`。Redis 不可用 → 仍然 `ready`
   - `getDependencies()`: 返回所有依赖状态（database、redis、embedding_service）

3. readiness 判定规则：
   - 数据库 ping 成功 → `ready`
   - 数据库 ping 失败 → `not_ready`（因为没有数据库就无法写入）
   - Redis 不可达 → 不影响 readiness，只在 dependencies 里显示
   - embedding 不可达 → 不影响 readiness，只在 dependencies 里显示

4. 保留旧的 `GET /health` 路由做兼容，内部调用新的三个方法组合返回。

### 4.2 验证迁移脚本在新库上的完整执行

**改什么文件**：可能改 `migrations/0002_read_model_contract.sql`

**当前状态**：`migration-runner.ts:69-84` 已经实现了占位符替换（`__PRIVATE_SCHEMA_IDENT__` → `quoteIdentifier(config.storage_schema_private)` 等），这部分是完整的。

**需要验证的是**：`0002_read_model_contract.sql` 在**全新数据库**上执行时，0001 已经用 `details` 和 `source` 字段创建了读模型表，0002 的 `ADD COLUMN IF NOT EXISTS details` 不会出错，但 0002 里的 `IF EXISTS` 检查旧列（`details_preview_json`、`source_type`）在新库上不会触发，因为旧列不存在。

**具体做法**：

1. 写一个测试验证：从空 PostgreSQL 开始，依次执行 0001 → 0002，断言所有表和列都存在、约束正确。
2. 如果 0002 在新库上有问题（比如 `ADD COLUMN IF NOT EXISTS details` 和 0001 已有的 `details` 冲突），修正脚本。
3. 测试放在 `tests/migrations.test.ts` 里扩展（当前已有这个文件）。

**测试环境**：如果 CI 没有 PostgreSQL，标记为 `describe.skipIf(!process.env.DATABASE_URL)` 并在本地验证。

### 4.3 验证 embedding 生成链路是否完整闭环

**涉及文件**：`src/db/read-model-projector.ts`、`src/jobs/job-worker.ts`

**当前状态**：
- `ReadModelProjector.project()` (read-model-projector.ts:11-51) 在投影时调用 `generateEmbedding(record.summary)`，如果 `embeddingsClient` 存在就调用 `embedText`，失败时降级返回 `embedding: null`。这部分逻辑是完整的。
- `JobWorker.processRefreshJobs()` (job-worker.ts:63-99) 在刷新失败时调用 `markRefreshFailed`，并检查 `nextRetryCount > this.options.read_model_refresh_max_retries` 后调用 `markRefreshDeadLetter`。这部分**已经有终态处理**。

**需要验证的是**：
1. `ReadModelProjector` 的 `embeddingsClient` 是否在 `JobWorker` 构造时被正确传入。查看 `job-worker.ts:26`：`this.projector = new ReadModelProjector(repositories.readModel, embeddingsClient)` — 是的，传入了。
2. worker.ts 启动时如果 `EMBEDDING_BASE_URL` 为空，是否正确创建了无 embeddingsClient 的 worker。查看 `worker.ts:13-14`：只有配置了 `embedding_base_url` 才创建 client — 正确。

**结论**：embedding 链路已经闭环。不需要改代码，但需要补一个测试验证：
- 有 embeddingsClient 时：记录入库 → 刷新 → embedding 被写入读模型
- 无 embeddingsClient 时：记录入库 → 刷新 → embedding 为 null，记录仍在读模型
- embedding 调用失败时：刷新降级，记录仍入库

把这个测试补到 `tests/worker.test.ts` 里。

### 4.4 验证读模型刷新重试终态

**涉及文件**：`src/jobs/job-worker.ts:63-99`

**当前状态**：代码已经有终态处理：
```ts
if (nextRetryCount > this.options.read_model_refresh_max_retries) {
  await this.repositories.readModel.markRefreshDeadLetter(job.id, message);
  continue;
}
await this.repositories.readModel.markRefreshFailed(job.id, message);
```

**需要验证的是**：`markRefreshDeadLetter` 是否真的更新 `job_status` 为 `dead_letter`。查看 `repositories.ts` 确认。

**具体做法**：
1. 在 `tests/worker.test.ts` 补一个测试：mock 一个 refresh job，让 `projector.project()` 连续失败超过 `read_model_refresh_max_retries` 次，断言最终状态为 `dead_letter`。
2. 确认指标接口 `GET /v1/storage/observe/metrics` 能区分暂时失败和终态失败。

### 4.5 补 worker 优雅退出验证

**涉及文件**：`src/worker.ts`

**当前状态**：worker.ts:24-27 已经有 SIGINT/SIGTERM 处理：
```ts
let active = true;
const stop = async () => {
  active = false;
  await database.close();
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
```

while 循环在 `active = false` 后会在当前 `processWriteJobs()` 完成后退出。

**问题**：`database.close()` 在 `stop()` 里被立即调用，但此时 `processWriteJobs()` 可能还在执行中使用数据库连接。应该先等当前批次完成再关闭连接。

**具体做法**：

改 `worker.ts` 为：
```ts
let active = true;
const stop = () => { active = false; };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

while (active) {
  try {
    await service.processWriteJobs();
  } catch (error) {
    logger.error({ error }, "storage worker cycle failed");
  }
  if (active) {
    await delay(config.write_job_poll_interval_ms);
  }
}

logger.info("storage worker shutting down");
await database.close();
```

### 4.6 补数据库级集成测试

**改什么文件**：新建 `tests/integration.test.ts`

**具体要覆盖的场景**：

1. **迁移测试**：全新 schema → 执行 `runMigrations()` → 断言 `storage_private.memory_records`、`storage_shared_v1.memory_read_model_v1` 等表存在
2. **写回全链路**：调 `service.submitWriteBackCandidate()` → 调 `service.processWriteJobs()` → 查 `memory_records` 断言记录存在 → 查 `memory_read_model_v1` 断言读模型已刷新
3. **runtime 批量格式**：调 `service.submitRuntimeWriteBackBatch()` → 断言 `commitment` 被映射为 `episodic`，`source` 结构被正确转换
4. **非法字段拒绝**：POST 非 UUID 的 `workspace_id` → 断言 400

用 `describe.skipIf(!process.env.TEST_DATABASE_URL)` 保护，CI 无数据库时跳过。

## 5. 不要做的事

- 不要重写领域规则（normalizer / merge / conflict）
- 不要改 retrieval-runtime 或 visualization
- 不要引入 Redis / BullMQ 替换当前 PostgreSQL job table
- 不要新增记忆类型

## 6. 完成标准

- 三个健康端点可用，语义符合架构约束
- `npm run migrate` 在全新数据库上成功（有测试验证）
- embedding 链路有三种场景的测试覆盖
- 读模型刷新终态有测试覆盖
- worker 优雅退出不会在处理中关闭数据库连接
- 新增集成测试覆盖上述场景
- `npm run check && npm run build && npm test` 全部通过
