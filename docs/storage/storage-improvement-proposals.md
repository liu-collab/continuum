# storage 改进建议

## 1. 文档目的

这份文档记录对 `services/storage/` **现状实现**的审视结论，按优先级列出建议改动。

- 现状详细描述见 `storage-internals.md`
- 这里只讨论**哪里不合理、怎么改**
- 每条建议独立成一段，可以单独拆成一个修复任务

## 2. 审视依据

- 代码位置：`services/storage/src/`（当前版本）
- 对齐契约：`docs/memory-module-contract.md`、`docs/architecture-independence.md`、`docs/storage/*`
- 使用场景：`retrieval-runtime` 写回候选 + `visualization` 治理动作

## 3. 优先级总览

| 编号 | 标题 | 优先级 | 类别 |
| :--- | :--- | :--- | :--- |
| S01 | `invalidate` 与 `archive` 行为完全一样 | **P0** | 产品契约 |
| S02 | `normalizer.ts` 与 runtime 的 scope 分类**双重分类** | **P0** | 正确性 |
| S03 | `polarity` 检测只支持英文，中文冲突漏判 | **P0** | 正确性 |
| S04 | embedding 不可用时没有后台补刷机制 | P1 | 召回质量 |
| S05 | 批量写回是 N 次独立 INSERT，没有批量化 | P1 | 性能 |
| S06 | Read model 表没有数据库权限保护 | P1 | 数据安全 |
| S07 | Worker 轮询 1s，没有 LISTEN/NOTIFY | P2 | 性能 |
| S08 | `normalizeCandidate` 被调用两次（入队 + 处理） | P2 | 性能 |
| S09 | dead_letter job 永久保留，无清理 | P2 | 运维 |
| S10 | 治理历史无查询 API（仅存表） | P1 | 可观测 |
| S11 | embedding 逐条调用，无 batch | P1 | 性能 / 成本 |
| S12 | 没有 per-workspace 写回限流 | P2 | 防护 |
| S13 | `fact_preference` dedupe 去除极性词的副作用 | 待定 | 产品策略 |
| S14 | `listConflicts` 无显式分页 | P2 | API |

## 4. P0：契约与正确性问题

### S01 — `invalidate` 与 `archive` 行为完全一样

**现状**（`governance-engine.ts:150-190` vs `67-104`）：

```ts
// archiveRecord
updateRecord(recordId, { status: "archived", archived_at: now })
appendVersion(change_type: "archive")
appendGovernanceAction(action_type: "archive")

// invalidateRecord
updateRecord(recordId, { status: "archived", archived_at: now })   // 完全一样
appendVersion(change_type: "archive")                              // 完全一样
appendGovernanceAction(action_type: "invalidate")                  // 只有这里不同
```

对记录本身**两个动作的结果字段完全相同**，只在 governance audit 里 `action_type` 不同。

**为什么不合理**：
- `memory-module-contract.md` 第 5.4 节将两者列为独立治理动作
- `current-phase-closure-plan.md` 和 `memory-module-contract.md` 当前都把 `invalidate` / `archive` 列成独立治理动作，但正式状态语义仍只有 `active / pending_confirmation / superseded / archived / deleted`
- 当前实现让 `invalidate` 退化为"换了名字的 archive"
- visualization 在治理页展示时，用户会困惑"我点了 invalidate 为什么显示 archived"

**建议改动**（二选一）：

方案 A（按契约引入新状态）：在 `memory_records.status` 枚举里加 `invalidated`，让 invalidate 设 `status=invalidated, invalidated_at=now`。`retrieval-runtime` 同 `archived` 一样不默认召回。schema migration + 契约回写。

方案 B（语义明确化，保持字段相同）：
- `archive`：用户主动归档（可以 restore）
- `invalidate`：系统/用户标记为错误信息（不允许直接 restore，必须先 confirm）
- 区别落在 `restoreVersion` 的前置条件：若源记录 `last_governance_action = invalidate`，则 restore 前必须先 confirm

方案 A 更清晰，方案 B 改动小。根据产品倾向选择，之后同步 `memory-module-contract.md`。

**验收**：用户在 visualization 先后点 archive 和 invalidate 两条记录，两条记录在列表页有**不同的显示状态**，且 restore 流程不同。

### S02 — storage 与 runtime 的 scope 分类**双重分类**

**现状**：
- `retrieval-runtime/src/writeback/writeback-engine.ts` 里 `classifyScope` 用关键词重分类（前文已分析）
- `storage/src/domain/normalizer.ts:100-194` 又做一次**独立规则**的 `classifyCandidateScope`

两套规则**不完全一致**：
- runtime 侧：偏好/习惯 → user；repo/project/workspace → workspace；临时 → session
- storage 侧：有更多字段级暗示（state_key / rule_kind / repo_path 等）+ 不同的 signal 词列表

**为什么不合理**：
- 发送方（runtime）判的 `user`，接收方（storage）可能改成 `workspace`
- 同一条记忆在"writeback 候选日志"里 scope=user，在"最终入库的记录"里 scope=workspace——排查者会以为是另一条记录
- 两侧任意修改规则，对方不会同步

**建议改动**：
- 把 scope 最终判定权**统一归属 storage**（因为 storage 才知道 DB 里有什么、能参考长期规则库）
- runtime 侧 `classifyScope` 改成"建议值"：作为 `candidate.suggested_scope` 字段传来，storage 的 `classifyCandidateScope` 在无明确 signal 时采用它
- 或反过来：runtime 判定后 storage 不再重分类，直接信任 candidate.scope；但需要在 candidate 里带上"分类依据"便于审计

**验收**：
- 契约里明确"scope 分类职责归谁"
- 对同一条候选，两侧规则永远产出相同结果
- 加一组 parity test：构造 20 条样例，分别喂给两侧，断言输出一致

### S03 — `polarity` 检测只支持英文

**现状**（`merge-engine.ts:106-129`）：

```ts
function polarity(value: string): "positive" | "negative" | "neutral" {
  const normalized = value.toLowerCase();
  if (normalized.includes("not ") || normalized.includes("don't ") ||
      normalized.includes("do not ") || normalized.includes("dislike") ||
      normalized.includes("avoid")) {
    return "negative";
  }
  if (normalized.includes("prefer") || normalized.includes("like") ||
      normalized.includes("love") || normalized.includes("want")) {
    return "positive";
  }
  return "neutral";
}
```

**为什么不合理**：
- 产品面向中文用户。"我不喜欢 Python" 与 "我喜欢 Python" 都会被判 `neutral`，不会触发 `open_conflict`
- 两条正反偏好都会以 `update_existing` 互相覆盖，后写入的胜——没有人工介入机会
- 这是产品"冲突闭环"的一个直接漏洞

**建议改动**：
```ts
const NEGATIVE_ZH = ["不喜欢", "讨厌", "反对", "避免", "拒绝", "不要"];
const POSITIVE_ZH = ["喜欢", "偏好", "习惯", "要求", "倾向", "选择"];
const NEGATIVE_EN = ["not ", "don't ", "do not ", "dislike", "avoid", "hate"];
const POSITIVE_EN = ["prefer", "like", "love", "want"];

if (NEGATIVE_ZH.some(w => value.includes(w)) || NEGATIVE_EN.some(w => normalized.includes(w))) return "negative";
if (POSITIVE_ZH.some(w => value.includes(w)) || POSITIVE_EN.some(w => normalized.includes(w))) return "positive";
return "neutral";
```

**验收**：
- 新增测试用例：中文正反偏好对，断言生成 `open_conflict`
- 现有英文用例全部通过

### 补充：S01-S03 都会影响 mna 首版体验

这三条都是"现有系统里默默不合理，但开 mna 后因为中文用户增多、产品治理路径被使用更多而暴露"。建议 mna 开工前同步修。

## 5. P1：性能与召回质量

### S04 — embedding 不可用时没有后台补刷机制

**现状**（`read-model-projector.ts:20-21, 56-75`）：
```ts
const embeddingResult = await this.generateEmbedding(record.summary);
// embedding 失败 → embedding: null, degradation_reason: "embedding_unavailable"
// 仍然写入读模型，只是 summary_embedding 为 null
```

`memory_read_model_refresh_jobs` 标成 `succeeded`（只要 upsert 成功）。embedding 服务后续恢复了，**永远不会**重新 embed 这条记录。

**为什么不合理**：
- embedding 短时不可用是常见情况（网络抖动、rate limit）
- 一批 null embedding 的记录**永久**丢失语义打分能力
- `retrieval-runtime` 的 semantic_score 对这些记录恒为 0，召回偏斜

**建议改动**：
1. `memory_read_model_v1` 加一列 `embedding_status ∈ {ok, pending, failed}` 和 `embedding_attempted_at TIMESTAMP`
2. projector 失败时标 `embedding_status = pending`，不改 refresh_job 状态
3. 新增 worker 循环：定期扫 `embedding_status = pending AND embedding_attempted_at < now - 5min` 的记录，批量补刷
4. metrics 暴露 `pending_embedding_count`，visualization 看板能看到积压

**验收**：
- 断开 embedding 服务，提交记录 → `embedding_status = pending`
- 恢复 embedding 服务 → 后台 worker 自动补刷，状态转 `ok`，`summary_embedding` 非 null

### S05 — 批量写回是 N 次独立 INSERT

**现状**（`services.ts:104-110`）：
```ts
async submitWriteBackCandidates(candidates: WriteBackCandidate[]) {
  const jobs = await Promise.all(
    candidates.map((candidate) => this.submitWriteBackCandidate(candidate)),
  );
  return jobs;
}
```

N 条 candidate = N 次独立 `INSERT INTO memory_write_jobs`，每次独立 round trip。

**为什么不合理**：
- runtime 一次 finalize-turn 可能提交 3 条（WRITEBACK_MAX_CANDIDATES=3），不太痛
- 但未来有 batch import、历史数据补录、多 turn 合并等场景，N 会增大
- PG 的 `INSERT ... VALUES (row1), (row2), ...` 单次 round trip 效率远高

**建议改动**：
- `jobs.enqueueMany(inputs[])` 新方法：构造单条多 VALUES 的 INSERT
- `submitWriteBackCandidates` 调用 `enqueueMany`
- 保留 `enqueue` 单条版本兼容调用点

**验收**：提交 100 条 candidate 所用时间 < 单条 × 20（衡量 batch 效率）。

### S06 — Read model 表没有数据库权限保护

**现状**：`memory_read_model_v1` 在 shared schema，`retrieval-runtime` 和 `storage` 共用同一 `DATABASE_URL` 连接，都是超级用户。runtime 理论上可以 `UPDATE memory_read_model_v1 SET ...`，破坏读模型。

**为什么不合理**：
- `architecture-independence.md` 第 3.2 节规定"只读"——目前靠代码自觉，没有 DB 强制
- 上线前必须加硬约束，否则 bug 或意外调用会污染读模型

**建议改动**：
- 迁移脚本里给 shared schema 创建专用角色：
  ```sql
  CREATE ROLE storage_writer LOGIN;
  CREATE ROLE runtime_reader LOGIN;
  GRANT USAGE ON SCHEMA storage_shared_v1 TO runtime_reader;
  GRANT SELECT ON ALL TABLES IN SCHEMA storage_shared_v1 TO runtime_reader;
  GRANT ALL ON SCHEMA storage_private TO storage_writer;
  GRANT ALL ON ALL TABLES IN SCHEMA storage_private TO storage_writer;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA storage_shared_v1 TO storage_writer;
  ```
- 凭据由部署层注入，不在迁移脚本或仓库文档里硬编码
- `retrieval-runtime` 的 `DATABASE_URL` 用 `runtime_reader` 账号
- storage 的 `DATABASE_URL` 用 `storage_writer` 账号

**验收**：用 runtime 的账号手动 `UPDATE memory_read_model_v1 ...` 被 PG 拒绝。

### S10 — 治理历史无查询 API

**现状**：
- `memory_governance_actions` 表每条治理动作都在追加
- `memory_record_versions` 每次变更都在快照
- **但没有任何 HTTP 路由**把这些暴露出去

visualization 的治理页（`docs/current-phase-closure-plan.md` 第 7.4 节要求）需要展示"某条记录的治理历史"，当前拿不到。

**为什么不合理**：
- 数据都存了，只是没有查询接口——需求已知但没实现
- 对 `invalidate / restore_version` 的链路闭环不可见

**建议改动**：
- 新增 `GET /v1/storage/records/:recordId/history`：返回合并的 `governance_actions + record_versions` 时间线
- 新增 `GET /v1/storage/records/:recordId/versions`：单独返回版本列表（配合 `restore_version` 选版本）

**验收**：在 visualization 记录详情页能看到完整治理历史（包括系统自动的 supersede / merge）。

### S11 — embedding 逐条调用，无 batch

**现状**：`HttpEmbeddingsClient.embedText(text)` 每次单条。N 条记录刷新 = N 次 embedding HTTP 调用。

**为什么不合理**：
- embedding 服务通常支持 batch（OpenAI 允许 2048 条/请求）
- 单条调用时网络 overhead 占比高
- 首次全量 import / 大批量补刷时极慢

**建议改动**：
- `EmbeddingsClient.embedTexts(texts: string[]): Promise<number[][]>`
- `JobWorker.processRefreshJobs()` 批量 claim 后，分组调 batch embed
- 单条路径保留（治理动作触发的 refresh 仍然单条）

**验收**：刷新 50 条记录的耗时 < 单条 × 10。

## 6. P2：运维与清理

### S07 — Worker 轮询 1s，没有 LISTEN/NOTIFY

**现状**：`worker.ts` 每 1s 拉一次队列。入队的候选延迟至少 1s 才开始处理。

**建议改动**：PG 的 `LISTEN memory_write_jobs_channel` + enqueue 时 `NOTIFY` 触发。退化路径保留 poll 作为 fallback。

### S08 — `normalizeCandidate` 被调用两次

**现状**：
- `services.ts:79` 调 `normalizeCandidate(candidate)` 为了拿 `candidate_hash`
- `writeback-processor.ts:16` 又调一次为了拿 `normalized` 给 merge-engine

**建议改动**：
- `enqueue` 时把 `normalized` 序列化存到 `memory_write_jobs.normalized_json` 列
- processor 直接读反序列化，不再重复计算
- 注意：若跨版本部署，旧 job 可能没这列，需要兼容处理

### S09 — dead_letter job 永久保留

**现状**：`markDeadLetter` 只改 status，记录永留。

**建议改动**：
- 加 `memory_write_jobs_dead_letter_ttl_days` 配置（默认 30）
- 每日扫一次 `job_status = 'dead_letter' AND received_at < now - N days`，DELETE 或归档到 `memory_write_jobs_archive`
- `memory_read_model_refresh_jobs` 同样处理

### S12 — 没有 per-workspace 写回限流

**现状**：任何调用者可以无限提交候选。runtime bug 或 agent 失控可能把 `memory_write_jobs` 打满。

**建议改动**：
- `POST /v1/storage/write-back-candidates` 前加 token bucket per `workspace_id`（默认 60 条/分钟）
- 超限返回 429 + Retry-After
- runtime 侧 memory-client 捕获 429 走降级

### S14 — `listConflicts` 无显式分页

**现状**：`repositories.conflicts.listConflicts(status?)` 实现未确认，但路由签名没有 `page / page_size` 参数。

**建议改动**：加 `page` / `page_size` + 默认 50 上限。

## 7. 待产品决策

### S13 — `fact_preference` dedupe 去除极性词的副作用

**现状**（`normalizer.ts:92-98`）：
```ts
function normalizeSemanticPredicate(input: string): string {
  return normalizeText(input)
    .replace(/\b(do not|don't|not|dislike|avoid|hate)\b/g, "")
    .replace(/\b(prefers|prefer|likes|like|love|loves|wants|want)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
```

这样 dedupe_key 里"喜欢 Python"和"不喜欢 Python"相同 → `findByDedupeScope` 能找到 existing → `decideMerge` 走到 `open_conflict` 分支（如果 polarity 也检测出相反）。

**但副作用**：
- "我喜欢 Python" 和 "我喜欢 Rust"，predicate 都被剥离极性词，如果 subject 也是同一个（比如都是 "programming language preference"），dedupe_key 一样
- 本该是两条独立偏好被误判为冲突
- 或者两条偏好的 subject 恰好不同，才不会撞 key——这个判断取决于 runtime 写回时填的 `details.subject` 是否细到"语言名"

这是一个**哲学选择**：
- A. 继续剥离极性词，支持正反冲突检测，但存在误撞
- B. 保留极性词，不剥离，正反不同 key → 不会误撞，但冲突检测得靠其他机制

**建议**：
- 短期：保留 A，补测试用例覆盖已知边界
- 长期：把正反冲突检测迁移到**独立的 conflict engine 阶段**（不依赖 dedupe_key 撞击），让 dedupe_key 专注"同一主题同一断言"

产品侧决定后更新 `memory-module-contract.md` 第 10 节。

## 8. 改进顺序建议

1. **先做 P0 三条**（S01 / S02 / S03）——契约与正确性优先，与 mna 首版一起发。
2. 做 P1 五条（S04 / S05 / S06 / S10 / S11）——性能与召回质量，mna 稳定运行后合一批。
3. P2 五条（S07 / S08 / S09 / S12 / S14）——纯运维，可以在更晚阶段统一清理。
4. S13 需产品决策后再动。

## 9. 契约回写清单

按本文档建议实施后，需要同步更新的契约文档：

- `docs/memory-module-contract.md` 第 5.4 节：若 S01 选方案 A，新增 `invalidated` 状态
- `docs/memory-module-contract.md` 第 10 节：若 S13 切换策略，更新冲突检测描述
- `docs/storage/database-schema-design.md`：S01 新增字段、S04 新增 `embedding_status` 列、S06 新增 role 设计
- `docs/storage/storage-service-design.md`：S02 明确 scope 分类职责归属
- `docs/api-contract.md`：S10 新增 history / versions 端点
- `docs/storage/storage-internals.md`（本系列文档）：每条改动合并后同步更新"现状"描述
