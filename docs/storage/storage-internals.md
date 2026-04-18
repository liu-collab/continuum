# storage 模块内部机制

## 1. 文档目的

这份文档用于**理解**当前 `services/storage/` 的运行机制：

- 模块做了什么事
- 写回候选如何从 HTTP 接收变成最终的正式记忆
- 治理动作如何闭环
- 读模型如何刷新
- 各层失败时会发生什么

只描述**现状**，不讨论改进建议。改进建议见 `storage-improvement-proposals.md`。

不是服务设计文档（那是 `storage/storage-service-design.md`），也不是实现规范（那是 `storage/storage-implementation-spec.md`）。这份文档的定位是**阅读向导**。

## 2. 模块在产品里的位置

```
┌─────────────────────────────────────────────────────────────┐
│  retrieval-runtime                                          │
│   - 写回：POST /v1/storage/write-back-candidates             │
│   - 读取：SELECT FROM memory_read_model_v1（共享读模型）     │
└────┬──────────────────────────────────────────┬─────────────┘
     │ 写                                        │ 读
     ▼                                          ▲
┌─────────────────────────────────────────────────────────────┐
│  storage                                                    │
│                                                             │
│   HTTP server (server.ts)                                   │
│     └─ StorageService ─┬─ governance (sync)                │
│                        └─ jobs.enqueue (async 入队)        │
│                                                             │
│   Worker process (worker.ts)                                │
│     └─ JobWorker.processAvailableJobs                       │
│          ├─ WritebackProcessor  (merge/conflict decide)     │
│          └─ ReadModelProjector  (embed + upsert)            │
│                                                             │
└────────────┬──────────────────────────┬─────────────────────┘
             │ 写 private 表              │ 写 shared 读模型
             ▼                          ▼
┌────────────────────────────┐  ┌──────────────────────────────┐
│  storage_private schema    │  │  storage_shared_v1 schema     │
│  - memory_records          │  │  - memory_read_model_v1       │
│  - memory_record_versions  │  │    （retrieval-runtime 只读）  │
│  - memory_write_jobs       │  └──────────────────────────────┘
│  - memory_conflicts        │
│  - memory_governance_actions│
│  - memory_read_model_refresh_jobs│
└────────────────────────────┘
                  ▲
                  │
┌─────────────────┴──────────┐
│  visualization             │
│  （只读 shared 读模型 + observe 接口）│
└────────────────────────────┘
```

storage 做两件事：

- **同步**：接收写回候选快速入队、执行治理动作（编辑/归档/确认/删除/恢复版本/解决冲突）
- **异步**：后台 worker 真正处理入库——规范化、去重、合并、冲突判断、版本追加、读模型刷新

## 3. 双进程模型

storage 分成两个**可独立部署**的进程：

### 3.1 `server.ts` — HTTP 接口

入口：`services/storage/src/server.ts`

启动时：
1. `loadConfig()` 从环境变量读配置（zod 校验）
2. `new StorageDatabase(config, logger)` 建 pg 连接池
3. `new HttpEmbeddingsClient(config)`（可选，若配置了 `EMBEDDING_BASE_URL`）
4. `createStorageService(...)` 组装 repositories + governance + worker（worker 对象仅用于按需触发，不自动运行）
5. `createApp(service)` 建 Fastify 实例
6. 监听 `host:port`（默认 0.0.0.0:3001）

处理请求时**不处理写入流水**，只：
- 把写回候选塞到 `memory_write_jobs` 队列（fast path）
- 同步执行治理动作（这些不走队列）
- 读取记录列表、冲突列表、健康检查

### 3.2 `worker.ts` — 后台作业

入口：`services/storage/src/worker.ts`

启动时：与 server 独立 new 一份 StorageDatabase 和 StorageService，启 `runWorker()` 循环：

```
while (active):
  service.processWriteJobs()    # 一次性处理 batch_size 条 write job + 所有 refresh job
  await delay(WRITE_JOB_POLL_INTERVAL_MS)  # 默认 1000ms
```

`SIGINT / SIGTERM` 触发 `active = false`，循环退出后关闭 DB 连接池。

### 3.3 共享的 `StorageService`

两个进程都持有 `StorageService` 实例。API 差异通过**调用哪些方法**来体现：

- server 只调写回入队 + 治理 + 查询
- worker 只调 `processWriteJobs()`

两者用同一份 `StorageRepositories` 和 `JobWorker`，底层 SQL 完全一致。

## 4. 数据库 schema 总览

分两个 PG schema：

### 4.1 `storage_private`（只本服务使用）

| 表 | 作用 |
| :--- | :--- |
| `memory_records` | 主记录：每条正式记忆一行。`status ∈ {active, pending_confirmation, superseded, archived, deleted}` |
| `memory_record_versions` | 每次变更追加一行快照，支持历史回溯与版本恢复 |
| `memory_write_jobs` | 写回候选队列，`job_status ∈ {queued, in_progress, succeeded, failed, dead_letter}` |
| `memory_conflicts` | 冲突记录。`status ∈ {open, resolved}`，关联胜者/败者 record_id |
| `memory_governance_actions` | 所有治理动作的审计流水（append-only） |
| `memory_read_model_refresh_jobs` | 读模型刷新队列（记录变更后异步重建 read model） |

### 4.2 `storage_shared_v1`（共享读模型）

| 表 | 作用 |
| :--- | :--- |
| `memory_read_model_v1` | `retrieval-runtime` 查询的唯一表。每条 record 一份投影，附带 `summary_embedding` 向量 |

### 4.3 schema 命名约束

迁移脚本用占位符 `__PRIVATE_SCHEMA_IDENT__` / `__SHARED_SCHEMA_IDENT__`，运行时由 `config.storage_schema_private` / `storage_schema_shared` 填充（默认 `storage_private` / `storage_shared_v1`）。

## 5. 核心对象链

写入侧：

```
WriteBackCandidate              # HTTP 接收的原始候选
      ↓ normalizeCandidate
NormalizedMemory                # 规范化 + 算 dedupe_key + candidate_hash
      ↓ enqueue (memory_write_jobs)
MemoryWriteJob                  # DB 队列行
      ↓ claimQueuedJobs (worker)
      ↓ WritebackProcessor.processJob
      ↓ decideMerge + evaluateConflict
MemoryRecord                    # 最终写入 memory_records
      ↓ enqueueRefresh (memory_read_model_refresh_jobs)
      ↓ ReadModelProjector.project（含 embedding）
ReadModelEntry                  # 落到 memory_read_model_v1
```

治理侧：

```
HTTP {patch|archive|confirm|invalidate|delete|restore-version}
      ↓ GovernanceEngine.xxx
更新 memory_records + appendVersion + appendGovernanceAction + enqueueRefresh
```

## 6. 内部子模块职责

| 目录 | 职责 | 入口 |
| :--- | :--- | :--- |
| `api/` | Fastify 路由 + 响应格式 | `createApp(service)` |
| `db/client.ts` | pg 连接池、`ping()`、`transaction()` | `StorageDatabase` |
| `db/repositories.ts` | 所有 SQL：records / versions / jobs / conflicts / governance / readModel / metrics | `createRepositories(db)` |
| `db/read-model-projector.ts` | 记录 → 读模型条目（含 embedding） | `ReadModelProjector.project(record)` |
| `db/embeddings-client.ts` | HTTP 调 embedding 服务 | `HttpEmbeddingsClient.embedText(text)` |
| `domain/normalizer.ts` | 候选规范化、dedupe_key / candidate_hash、scope 分类 | `normalizeCandidate(candidate)` |
| `domain/merge-engine.ts` | 决定"新增 / 更新 / 合并 / 忽略 / 冲突" | `decideMerge(normalized, matches)` |
| `domain/conflict-engine.ts` | 冲突类型识别、能否自动胜出 | `evaluateConflict(existing, normalized)` |
| `domain/writeback-processor.ts` | 串联 dedupe → decideMerge → DB 操作 | `WritebackProcessor.processJob(job)` |
| `domain/governance-engine.ts` | 所有治理动作的事务实现 | `GovernanceEngine.xxx(recordId, input)` |
| `domain/scoring.ts` | 默认 importance / confidence 的推断 | `computeDefaultImportance / computeDefaultConfidence` |
| `jobs/job-worker.ts` | 拉队列、分发给 processor、失败重试与 dead-letter | `JobWorker.processAvailableJobs()` |
| `services.ts` | 组装所有依赖，提供对外 API | `StorageService` |

## 7. 写入链路（候选 → 正式记忆）

### 7.1 时序图

```
宿主/runtime        server.ts          services.ts         jobs repo        worker             processor            records repo       readModel
    │                   │                   │                  │               │                   │                    │                │
    │ POST /v1/storage/  │                   │                  │               │                   │                    │                │
    │ write-back-        │                   │                  │               │                   │                    │                │
    │ candidates         │                   │                  │               │                   │                    │                │
    ├──────────────────►│                   │                  │               │                   │                    │                │
    │                   │ zod parse         │                  │               │                   │                    │                │
    │                   ├──────────────────►│                  │               │                   │                    │                │
    │                   │                   │ normalizeCandidate                                                                       │
    │                   │                   │ + idempotency_key(sha256 of full payload if not supplied)                                │
    │                   │                   ├─ enqueue ──────►│               │                   │                    │                │
    │                   │                   │                  │ INSERT INTO memory_write_jobs (ON CONFLICT idempotency_key DO NOTHING)│
    │                   │                   │◄─ MemoryWriteJob ┤               │                   │                    │                │
    │                   │◄─ {job_id, status: "accepted_async"} │               │                   │                    │                │
    │◄── 202 ───────────┤                   │                  │               │                   │                    │                │
    │                   │                   │                  │               │                   │                    │                │
    │                   │ ...时间流逝...     │                  │               │ poll loop 1s      │                    │                │
    │                   │                   │                  │               ├ processAvailableJobs                    │                │
    │                   │                   │                  │◄─ claimQueuedJobs(batch_size=10) ─┤                    │                │
    │                   │                   │                  │               │ FOR UPDATE SKIP LOCKED                  │                │
    │                   │                   │                  │               │                   │                    │                │
    │                   │                   │                  │               ├─── processJob ───►│                    │                │
    │                   │                   │                  │               │                   │ normalizeCandidate │                │
    │                   │                   │                  │               │                   ├ findByDedupeScope ►│                │
    │                   │                   │                  │               │                   │◄── matches[] ──────┤                │
    │                   │                   │                  │               │                   │ decideMerge        │                │
    │                   │                   │                  │               │                   │                    │                │
    │                   │                   │                  │               │                   │ (事务内)             │                │
    │                   │                   │                  │               │                   ├ insert/update ────►│                │
    │                   │                   │                  │               │                   ├ appendVersion ────►│                │
    │                   │                   │                  │               │                   │ 若 conflict:        │                │
    │                   │                   │                  │               │                   ├ evaluateConflict   │                │
    │                   │                   │                  │               │                   ├ insert pending + openConflict       │
    │                   │                   │                  │               │                   ├ enqueueRefresh(readModel) ─────────►│
    │                   │                   │                  │               │                   │                    │                │
    │                   │                   │                  │◄─ markSucceeded ─────────────────┤                    │                │
    │                   │                   │                  │               │                   │                    │                │
    │                   │                   │                  │               │ processRefreshJobs                      │                │
    │                   │                   │                  │               │◄─ claimRefreshJobs ────────────────────────────────────┤
    │                   │                   │                  │               │ for each: find record → project (embed) → upsert       │
    │                   │                   │                  │               │                                                        │
```

### 7.2 入队（同步，server 进程）

```
submitWriteBackCandidate(candidate):
  normalized = normalizeCandidate(candidate)  # 规范化 + 算 dedupe_key + candidate_hash
  idempotencyKey = candidate.idempotency_key ?? sha256(JSON.stringify(candidate))
  jobs.enqueue({
    idempotency_key,
    candidate_hash: normalized.candidate_hash,
    source_service: candidate.source.service_name,
    candidate,
  })
  → 返回 MemoryWriteJob { id, received_at, ... }
```

响应 `status: "accepted_async"` + `job_id`。

**不在这里做任何记录写入**——只放队列就返回。

### 7.3 规范化（`normalizer.ts`）

```
normalizeCandidate(candidate):
  summary         = trim + collapseWhitespace + lowercase
  details         = 所有 string 值同样处理
  scope           = classifyCandidateScope(candidate, details)   # 启发式再分类
  dedupe_key      = ...（见 7.4）
  candidate_hash  = sha256({candidate_type, scope, summary, details, source_ref, write_reason})
  importance      = candidate.importance ?? computeDefaultImportance(candidate)
  confidence      = candidate.confidence ?? computeDefaultConfidence(candidate)
  memory_type     = candidate.candidate_type
  → NormalizedMemory
```

### 7.4 dedupe_key 生成规则

按 `candidate_type` 分三种：

| candidate_type | dedupe_key 格式 |
| :--- | :--- |
| `task_state` | `task_state:<task_id or "no-task">:<normalized(state_key or summary)>` |
| `episodic` | `episodic:<scope>:<event_kind>:<time_bucket=YYYY-MM-DDTHH>:<sha256(details)[0:12]>` |
| `fact_preference` | `fact_preference:<scope>:<subject>:<normalizedSemanticPredicate(predicate)>` |

`normalizedSemanticPredicate` **会去除极性词**（not / don't / dislike / avoid / hate / prefer / like / love / want），让"喜欢 X"和"不喜欢 X"的 dedupe_key 相同——便于 decideMerge 发现正反向冲突。

### 7.5 scope 再分类（`classifyCandidateScope`）

即使候选传入了 `scope`，规范化阶段还要做一次**独立的启发式分类**：

```
task_state 类型 + 有 explicit task signal（state_key/state_value/next_step/blocked_by） → task（有 task_id）/ workspace
命中 workspace 暗示词（repo/project/workspace/toolchain/rule/constraint/...） → workspace
episodic + 会话暗示词（temporary/session/current turn/expires）→ session
命中长期偏好 + user 暗示词（prefer/style/habit/...） → user
含 repo/project/workspace → 强制改为 workspace（即使候选声明了 user）
其他保留候选声明的 scope
```

**注意**：runtime 的 `WritebackEngine.classifyScope` 已经做过一次分类，storage 又做一次。两套规则不一致，可能让最终 scope 与发送方期望不符（见改进建议）。

### 7.6 decideMerge（`merge-engine.ts`）

`findByDedupeScope` 按 `workspace_id/user_id/task_id/session_id/scope/dedupe_key` 找 `status != deleted` 的候选记录。决策树：

```
没找到 existing                               → insert_new

existing 存在：
  candidate_type == task_state:
    existing.state_value == normalized.state_value → ignore_duplicate
    否则                                          → update_existing

  candidate_type == episodic:
    existing.summary == normalized.summary       → ignore_duplicate
    否则（已因同一 dedupe_key 命中而进入同组；
         当前 dedupe_key 本身包含 time_bucket） → merge_existing（合并 details）

  candidate_type == fact_preference:
    existing.summary == normalized.summary       → ignore_duplicate
    polarity 相反（positive vs negative）         → open_conflict
    否则                                         → update_existing
```

`polarity(summary)`：
- 含 `not / don't / dislike / avoid / hate` → negative
- 含 `prefer / like / love / want` → positive
- 否则 neutral（neutral 不会触发冲突）

**注意**：polarity 只识别英文词，中文"不喜欢/讨厌/避免/反对"不会被识别。

### 7.7 冲突处理（`conflict-engine.ts`）

`evaluateConflict(existing, normalized)` 判断冲突能否自动解决：

```
normalized.confidence > existing.confidence AND normalized.source.confirmed_by_user == true
  → can_auto_supersede: true
  → existing.status = superseded，插入新记录为 active
否则
  → can_auto_supersede: false
  → existing.status = pending_confirmation，插入新记录为 pending_confirmation
  → 同时在 memory_conflicts 开一条 open 记录
  → 等待人工 resolveConflict
```

`conflict_type`：
- `scope_conflict`（existing 与 normalized 的 scope 不同）
- `preference_conflict`（fact_preference 类型）
- `fact_conflict`（其他类型）

### 7.8 版本与刷新

每次 insertRecord / updateRecord 后，事务内必须：

1. `appendVersion(snapshot)` → `memory_record_versions` 追加一行（change_type ∈ create/update/merge/supersede/archive/delete/restore）
2. `enqueueRefresh(source_record_id, refresh_type)` → `memory_read_model_refresh_jobs` 入队

刷新 job 由同一 worker 的 `processRefreshJobs()` 在每个 poll 周期处理。

### 7.9 读模型投影（`read-model-projector.ts`）

```
project(record):
  if record.status == "deleted":
    readModel.delete(record.id)
    return { embedding_updated: false }

  embedding = await embeddingsClient.embedText(record.summary)
       ↓ 若 client 不存在或调用失败
       ↓ embedding = null, degradation_reason = "embedding_unavailable"

  entry = ReadModelEntry {
    id, workspace_id, user_id, task_id, session_id,
    memory_type, scope, status,
    summary, details,
    importance, confidence,
    source: { ..., confirmed_by_user: Boolean(record.last_confirmed_at) },
    last_confirmed_at, last_used_at: null,
    created_at, updated_at,
    summary_embedding: embedding  # 可能 null
  }
  readModel.upsert(entry)
```

embedding 失败时记录仍然写入读模型，只是 `summary_embedding = null`——`retrieval-runtime` 的语义打分对这条给 0 分，其他维度正常加权。

### 7.10 失败处理

write job 级别：
- 抛错 → retry_count++
- `retry_count > WRITE_JOB_MAX_RETRIES`（默认 3）→ `markDeadLetter(error_code, error_message)`
- 否则 → `requeue(error_message)`，下一轮再取

refresh job 级别：同样的重试 + dead-letter 机制，阈值是 `READ_MODEL_REFRESH_MAX_RETRIES`（默认 3）。

**dead-letter 的 job 永久保留**，没有自动清理。

## 8. 治理链路（同步路径）

6 个治理动作：patch / archive / confirm / invalidate / delete / restore-version。全部**同步执行**，不走队列。

```
POST /v1/storage/records/:id/{archive|confirm|...}
      ↓
GovernanceEngine.xxxRecord(recordId, input)
      ↓
事务内执行：
  1. records.findById(recordId)         # 不存在抛 NotFoundError
  2. records.updateRecord(recordId, {...字段变更})
  3. records.appendVersion(snapshot, change_type, reason, actor)
  4. governance.appendAction(record_id, action_type, action_payload, actor)
  5. readModel.enqueueRefresh(record_id, refresh_type=update|delete)
      ↓
返回更新后的 MemoryRecord
```

### 8.1 各动作的语义

| 动作 | updateRecord 实际设置 | change_type | resulting status |
| :--- | :--- | :--- | :--- |
| `patch` | 按 input 传什么改什么（summary/details/scope/status/importance/confidence） | `update` | 保持（除非 input 改了 status） |
| `archive` | `status=archived, archived_at=now` | `archive` | archived |
| `confirm` | `status=active, archived_at=null, last_confirmed_at=now` | `update` | active |
| `invalidate` | `status=archived, archived_at=now`（与 archive 相同） | `archive` | archived |
| `delete` | `status=deleted, deleted_at=now` | `delete` | deleted |
| `restore_version` | 按指定 version 的 snapshot 恢复字段 | `restore` | 看 snapshot |

**注意**：`invalidate` 和 `archive` 的记录级效果完全相同，仅在 governance_actions 审计里 `action_type` 不同。

### 8.2 冲突解决（`resolveConflict`）

```
POST /v1/storage/conflicts/:conflictId/resolve
{ resolution_type, resolution_note, activate_record_id?, resolved_by }

事务内：
  if activate_record_id:
    1. 取 candidate = records.findById(activate_record_id)  # 不存在 → ConflictResolutionError
    2. candidate.status = active, last_confirmed_at = now
    3. appendVersion + readModel.refresh
    4. 找到"失败方" losingRecordId（conflict 的另一侧）
    5. losingRecord.status = archived
    6. appendVersion + readModel.refresh

  conflicts.resolveConflict(conflictId, input)   # 标记 status=resolved
  governance.appendAction(type=confirm, payload={resolution_type, resolution_note})
```

## 9. 读模型（shared schema）

### 9.1 公开字段

`memory_read_model_v1` 是 `retrieval-runtime` 唯一允许读取的表，**不允许写入**（代码 discipline，没有 DB 权限强制）。字段大致对应 `ReadModelEntry`：

```
id, workspace_id, user_id, task_id, session_id,
memory_type, scope, status,
summary, details,
importance, confidence,
source: JSONB,
last_confirmed_at, last_used_at,
created_at, updated_at,
summary_embedding: vector(N)
```

### 9.2 刷新时机

任何改动到 `memory_records` 的路径都会调 `enqueueRefresh(source_record_id, refresh_type)`：

- 写回链路：insert / update / merge / supersede 都触发
- 治理链路：patch / archive / confirm / invalidate / delete / restore / resolveConflict 都触发

刷新 job 由同一 worker 处理，**不保证秒级一致性**（取决于 worker 轮询间隔 + 队列长度）。

### 9.3 降级

- embedding 服务不可用时：写入读模型，`summary_embedding = null`，不阻塞
- 但**后续没有后台补刷机制**：embedding 恢复后，旧 null 记录永远不会重新 embed（需后续改进）

## 10. 依赖与降级

| 依赖 | 必需性 | 不可达时行为 |
| :--- | :--- | :--- |
| PostgreSQL | 必需 | `readiness` 转 `not_ready`；健康接口仍可返回状态，但依赖数据库的业务接口会失败 |
| embedding 服务 | 可选（`EMBEDDING_BASE_URL` 不配即关闭） | 读模型 `summary_embedding = null`；`dependencies` 报 `not_configured` 或 `unavailable` |
| Redis | 配置项存在但**未接入** | `dependencies` 报 `unavailable`，没有实际功能 |

健康端点分三层：

- `GET /v1/storage/health/liveness` → `alive`（进程活着）
- `GET /v1/storage/health/readiness` → `ready` / `not_ready`（DB ping 成功即 ready）
- `GET /v1/storage/health/dependencies` → 三个依赖的详细状态
- `GET /health` → 三者合并

## 11. HTTP API 清单

| 方法 | 路径 | 作用 |
| :--- | :--- | :--- |
| POST | `/v1/storage/write-back-candidates` | 提交写回候选（批量或单条） |
| GET | `/v1/storage/write-back-candidates/:jobId` | 查单个 job 状态 |
| GET | `/v1/storage/records` | 按 filters 分页查询记录 |
| PATCH | `/v1/storage/records/:recordId` | 编辑（governance.patch） |
| POST | `/v1/storage/records/:recordId/archive` | 归档 |
| POST | `/v1/storage/records/:recordId/confirm` | 确认 |
| POST | `/v1/storage/records/:recordId/invalidate` | 标记失效（≈ archive） |
| POST | `/v1/storage/records/:recordId/delete` | 软删除 |
| POST | `/v1/storage/records/:recordId/restore-version` | 从某历史版本恢复 |
| GET | `/v1/storage/conflicts` | 列冲突 |
| POST | `/v1/storage/conflicts/:conflictId/resolve` | 解决冲突（可指定生效方） |
| GET | `/v1/storage/observe/metrics` | 聚合指标 |
| GET | `/v1/storage/observe/write-jobs` | 最近写回 job 列表 |
| GET | `/v1/storage/health/*` | 健康状态 |

## 12. 配置速查（`src/config.ts`）

| 环境变量 | 默认 | 用途 |
| :--- | :---: | :--- |
| `PORT` | 3001 | HTTP 监听端口 |
| `HOST` | 0.0.0.0 | 监听地址 |
| `DATABASE_URL` | — | pg 连接串（必填） |
| `STORAGE_SCHEMA_PRIVATE` | `storage_private` | 私有 schema 名 |
| `STORAGE_SCHEMA_SHARED` | `storage_shared_v1` | 共享读模型 schema 名 |
| `WRITE_JOB_POLL_INTERVAL_MS` | 1000 | worker 轮询间隔 |
| `WRITE_JOB_BATCH_SIZE` | 10 | 每轮 claim 的 job 数 |
| `WRITE_JOB_MAX_RETRIES` | 3 | 超过进 dead_letter |
| `READ_MODEL_REFRESH_MAX_RETRIES` | 3 | 读模型刷新失败重试上限 |
| `EMBEDDING_BASE_URL` | — | 不配则关闭 embedding |
| `EMBEDDING_API_KEY` | — | embedding API key |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | 默认模型名 |
| `REDIS_URL` | — | 占位，首版未启用 |

## 13. 文件索引

| 内容 | 文件 |
| :--- | :--- |
| HTTP server 入口 | `src/server.ts` |
| Worker 入口 | `src/worker.ts` |
| 路由装配 | `src/api/app.ts` |
| 服务总装 | `src/services.ts` |
| 契约类型 | `src/contracts.ts` |
| 配置 | `src/config.ts` |
| DB 客户端 | `src/db/client.ts` |
| Repositories | `src/db/repositories.ts` |
| 读模型投影 | `src/db/read-model-projector.ts` |
| Embedding 客户端 | `src/db/embeddings-client.ts` |
| 候选规范化 | `src/domain/normalizer.ts` |
| 合并决策 | `src/domain/merge-engine.ts` |
| 冲突识别 | `src/domain/conflict-engine.ts` |
| 写回 processor | `src/domain/writeback-processor.ts` |
| 治理引擎 | `src/domain/governance-engine.ts` |
| 默认打分 | `src/domain/scoring.ts` |
| Worker 循环 | `src/jobs/job-worker.ts` |
| 迁移脚本 | `migrations/0001_storage_init.sql` 等 |

## 14. 与外部契约的对齐

本模块的行为在下述文档里有**正式契约约束**：

- `docs/memory-module-contract.md` 第 4 节：记忆记录字段
- `docs/memory-module-contract.md` 第 5.3 节：写回接口
- `docs/memory-module-contract.md` 第 5.4 节：治理接口
- `docs/architecture-independence.md` 第 3.2 / 4 节：数据解耦 / 通信方式
- `docs/storage/database-schema-design.md`：schema 设计决策
- `docs/storage/storage-implementation-spec.md`：实现规范

若代码与上述契约存在偏差，以**契约为准**：要么改代码，要么按回写流程（`current-phase-closure-plan.md` 第 11 节）更新契约。
