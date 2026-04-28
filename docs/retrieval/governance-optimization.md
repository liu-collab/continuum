# 治理系统优化方案

## 概述

治理系统（Governance）是 retrieval-runtime 的 MaintenanceWorker 定期用 LLM 审视 storage 中的已有记忆，自动发现重复、过时、碎片、冲突，然后合并/归档/清理。本文档针对其中 7 个不合理设计给出优化方案。

---

## 优化一：修复 buildLifecycleActions 对 related_records 的误归档

**状态：已完成**

### 问题

`buildLifecycleActions` 把 `seed_records` 和 `related_records` 合并后统一检查过期：

```typescript
// maintenance-worker.ts:338
const sourceRecords = [...workspaceContext.seed_records, ...workspaceContext.related_records];
const expired = sourceRecords.filter(isExpiredSessionEpisodic);
```

`related_records` 是通过 Jaccard 相似度匹配到的、与 seeds 主题相近的记录。"和某条 seed 相似"不等于"该被归档"——一条没被使用但主题相似的有效记忆会被错误清理。

### 方案

只对 `seed_records` 做生命周期检查：

```typescript
private buildLifecycleActions(
  workspaceContext: WorkspaceMaintenanceContext,
  checkpointIso: string,
): GovernancePlan["actions"] {
  const nowMs = Date.parse(checkpointIso);
  const expired = workspaceContext.seed_records.filter((record) =>
    isExpiredSessionEpisodic(record, this.config.WRITEBACK_SESSION_EPISODIC_TTL_MS, nowMs),
  );

  return expired.map((record) => ({
    type: "archive" as const,
    record_id: record.id,
    reason: "expired session episodic memory",
  }));
}
```

### 效果

- 不再因"和某条 seed 相似"而误归档有效记忆
- `related_records` 仍然参与 LLM 规划（去重、合并），只是不参与生命周期自动归档

---

## 优化二：Evolution Planner 产出经过 Quality Assess

**状态：已完成**

### 问题

`planEvolution` 直接将 LLM 产出的候选写入存储，跳过了 writeback 管线中的 Quality Assess：

```typescript
// maintenance-worker.ts:511
await this.storageClient.submitCandidates([{
  // evolution 候选
}], signal);
```

进化产生的记忆没有质量评分，可能写入低质量或重复内容。

### 方案

Evolution 产出走 writeback 管线，或者在本地做最小质量检查。

方案 A（推荐）：Evolution 产出封装为 `WriteBackCandidate`，通过 `writebackEngine.submitCandidates` 提交：

```typescript
// maintenance-worker.ts planEvolution 方法中

if (evolutionPlan.extracted_knowledge) {
  const knowledge = evolutionPlan.extracted_knowledge;
  const candidate_type = knowledge.suggested_scope === "user" ? "fact_preference" : "episodic";

  const candidate: WriteBackCandidate = {
    workspace_id: workspaceId,
    user_id: knowledge.suggested_scope === "user" ? sourceRecords[0]?.user_id ?? null : null,
    task_id: null,
    session_id: null,
    candidate_type,
    scope: knowledge.suggested_scope,
    summary: knowledge.pattern,
    details: {
      evolution_type: evolutionPlan.evolution_type,
      evidence_count: knowledge.evidence_count,
      source_record_ids: evolutionPlan.source_records,
    },
    importance: knowledge.suggested_importance,
    confidence: knowledge.confidence,
    write_reason: `memory evolution ${evolutionPlan.evolution_type}`,
    source: {
      source_type: "memory_evolution",
      source_ref: traceId,
      service_name: "retrieval-runtime",
      extraction_method: "llm",
    },
    idempotency_key: `${traceId}:${evolutionPlan.evolution_type}:${knowledge.pattern}`,
  };

  await this.writebackEngine.submitCandidates([candidate]);
}
```

需要在 MaintenanceWorker 构造函数中注入 `WritebackEngine`。

方案 B（轻量）：在本地做最小质量检查，不注入 WritebackEngine：

```typescript
function passMinimumQuality(candidate: { importance: number; confidence: number; summary: string }): boolean {
  return candidate.importance >= 3
    && candidate.confidence >= 0.7
    && candidate.summary.length >= 10
    && candidate.summary.length <= 500;
}

if (passMinimumQuality(knowledge)) {
  await this.storageClient.submitCandidates([candidate], signal);
}
```

### 效果

- 进化记忆不再绕过质量门禁
- 方案 A 最完整，方案 B 实现最快

---

## 优化三：applyMerge 对已归档记录容错

**状态：已完成**

### 问题

`merge` 操作中如果任一条目标记录在 LLM 规划后被手动归档，`guardRecord` 抛异常导致整个事务回滚：

```typescript
// governance-execution-engine.ts:306
for (const recordId of rest) {
  await this.guardRecord(tx, recordId);  // 状态非 active/pending → 抛异常
  await tx.records.updateRecord(recordId, { status: "archived", ... });
}
```

3 条记录合并，其中 1 条被手动归档 → 其他 2 条也合并不了。

### 方案

`guardRecord` 增加 `skipArchived` 选项，对已归档记录跳过而非抛异常：

```typescript
private async guardRecord(
  tx: StorageRepositories,
  recordId: string,
  options?: { skipArchived?: boolean },
): Promise<MemoryRecord | null> {
  const record = await tx.records.findById(recordId);
  if (!record) {
    throw new NotFoundError("memory record not found", { recordId });
  }
  if (record.status !== "active" && record.status !== "pending_confirmation") {
    if (options?.skipArchived && record.status === "archived") {
      return null;  // 已归档，跳过
    }
    throw new GovernanceExecutionCancelledError(
      `record ${recordId} status changed before execution`,
      { recordId, actual_status: record.status },
    );
  }
  return record;
}

// applyMerge 中的调用改为：
const remaining = [];
for (const recordId of rest) {
  const record = await this.guardRecord(tx, recordId, { skipArchived: true });
  if (record) remaining.push(recordId);
}
// 只剩一条时退化为不需要 merge
if (remaining.length === 0) return;  // 全部已归档，无事可做
```

### 效果

- 并发场景下 merge 不再因单条归档而整体失败
- 已归档的记录被静默跳过，不阻塞有效记录的合并

---

## 优化四：定时器改为链式调度，消除扫描空窗

**状态：已完成**

### 问题

`setInterval` 固定间隔触发。如果 `runOnce` 耗时超过 interval，第二次触发时 `sweepRunning=true` 导致空返回，本次扫描被跳过：

```typescript
// maintenance-worker.ts:99
this.timer = setInterval(() => {
  void this.runOnce().catch(...);
}, this.config.WRITEBACK_MAINTENANCE_INTERVAL_MS);
```

### 方案

改为 `setTimeout` 链式调用，上一次完成后才开始下一次倒计时：

```typescript
private scheduleNext(): void {
  if (!this.config.WRITEBACK_MAINTENANCE_ENABLED) return;

  this.timer = setTimeout(() => {
    void this.runOnce().catch((error) => {
      this.logger.warn({ err: error }, "writeback maintenance tick failed");
    }).finally(() => {
      this.scheduleNext();  // 无论成败，调度下一次
    });
  }, this.config.WRITEBACK_MAINTENANCE_INTERVAL_MS);
}

start(): void {
  if (this.timer) return;
  if (!this.config.WRITEBACK_MAINTENANCE_ENABLED) return;
  this.scheduleNext();
}

stop(): void {
  if (this.timer) {
    clearTimeout(this.timer);
    this.timer = null;
  }
}
```

### 效果

- 不会因上一次扫描耗时长而跳过周期
- 不会出现两次扫描并发执行

---

## 优化五：跨周期的提案去重上下文

### 问题

每次 maintenance sweep 独立调用 LLM planner。上一轮被 verifier 拒绝的提案，下一轮会再次被提出、再次被拒——浪费 LLM 调用且无进展。

### 方案

在 planner 输入中注入最近被拒绝的提案摘要：

```typescript
// maintenance-worker.ts processWorkspace 方法中

const recentlyRejected = await this.repository.listRecentRejectedProposals(
  workspaceId,
  5,  // 最近 5 条
);

const planResult = await this.dependencyGuard.run("memory_llm", ..., () =>
  this.planner!.plan({
    seed_records: workspaceContext.seed_records,
    related_records: workspaceContext.related_records,
    open_conflicts: workspaceContext.open_conflicts,
    recently_rejected: recentlyRejected.map((p) => ({
      proposal_type: p.proposal_type,
      reason_text: p.reason_text,
      verifier_notes: p.verifier_notes,
    })),  // 新增
  }),
);
```

Governance prompt 增加指引：

```
recently_rejected lists proposals that were previously rejected by the verifier.
DO NOT propose the same action again unless the underlying data has meaningfully changed.
If a merge was rejected because the records were judged as unrelated, do not re-propose it.
```

### 效果

- 减少重复提案 → 减少 LLM 调用浪费
- Planner 有"历史记忆"，提案质量更高

---

## 优化六：seeds 拉取支持服务端时间过滤

### 问题

`fetchSeeds` 先拉取全部 active 记录再客户端过滤 `created_at`：

```typescript
// maintenance-worker.ts:586
const response = await this.storageClient.listRecords({
  workspace_id, status: "active", page: 1, page_size: SEED_LIMIT
}, signal);
return response.items.filter((record) => {
  const createdAt = Date.parse(record.created_at);
  return createdAt >= threshold;
});
```

一个有 500 条老记录的 workspace 会浪费大量网络传输。

### 方案

在 `listRecords` API 和 `StorageWritebackClient` 中增加 `created_after` 参数：

```typescript
// storage-client.ts listRecords 方法
listRecords(filters: {
  workspace_id: string;
  status?: string;
  scope?: ScopeType;
  memory_type?: MemoryType;
  created_after?: string;  // 新增
  page?: number;
  page_size?: number;
}, signal?: AbortSignal): Promise<PaginatedResponse<MemoryRecordSnapshot>>;
```

storage API 在 SQL 查询中增加 `WHERE created_at >= $created_after`，直接服务端过滤。

`fetchSeeds` 改为：

```typescript
const response = await this.storageClient.listRecords({
  workspace_id: workspaceId,
  status: "active",
  created_after: new Date(Date.now() - lookbackMs).toISOString(),
  page: 1,
  page_size: this.config.WRITEBACK_MAINTENANCE_SEED_LIMIT,
}, signal);
// 不再需要客户端过滤
```

注：session episodic 生命周期候选仍需不过滤时间，因为它们可能很旧但仍需归档。可以分两次查询或增加 `include_session_episodic` 参数。

### 效果

- 大量旧记录的 workspace 不再浪费带宽
- 需要同步改动 storage API、HTTP client、SQL 查询三层

---

## 优化七：GovernanceEngine 手动操作去重

### 问题

`patchRecord`、`archiveRecord`、`confirmRecord`、`invalidateRecord`、`deleteRecord`、`restoreVersion` 六个方法结构完全一致，每个 ~30 行：

```
findById → updateRecord → appendVersion → appendAction → enqueueRefresh
```

唯一差异：`updateRecord` 的参数和 `governance action` 的 type/payload。当前 6 × 30 = 180 行代码，可压缩到 ~50 行。

### 方案

提取模板方法：

```typescript
// governance-engine.ts

private async applyManualAction(
  recordId: string,
  actionType: string,
  updateFields: Partial<MemoryRecord>,
  actionPayload: Record<string, unknown>,
  changeType: string,
  actor: { actor_type: string; actor_id: string },
  reason: string,
): Promise<MemoryRecord> {
  return this.repositories.transaction(async (tx) => {
    const existing = await tx.records.findById(recordId);
    if (!existing) {
      throw new NotFoundError("memory record not found", { recordId });
    }

    const updated = await tx.records.updateRecord(recordId, {
      ...updateFields,
      ...(updateFields.status === "archived" ? { archived_at: new Date().toISOString() } : {}),
    });

    await tx.records.appendVersion({
      record_id: updated.id,
      version_no: updated.version,
      snapshot_json: snapshotRecord(updated),
      change_type: changeType,
      change_reason: reason,
      changed_by_type: actor.actor_type,
      changed_by_id: actor.actor_id,
    });

    await tx.governance.appendAction({
      record_id: updated.id,
      action_type: actionType,
      action_payload: actionPayload,
      actor_type: actor.actor_type,
      actor_id: actor.actor_id,
    });

    const refreshType = actionType === "delete" ? "delete" : "update";
    await tx.readModel.enqueueRefresh({
      source_record_id: updated.id,
      refresh_type: refreshType,
    });

    return updated;
  });
}

// 六个方法退化为调用模板：
async archiveRecord(recordId: string, input: ArchiveRecordInput) {
  return this.applyManualAction(recordId, "archive", { status: "archived" }, { reason: input.reason }, "archive", input.actor, input.reason);
}

async confirmRecord(recordId: string, input: ConfirmRecordInput) {
  return this.applyManualAction(recordId, "confirm", { status: "active", archived_at: null, last_confirmed_at: new Date().toISOString() }, { reason: input.reason, last_confirmed_at: new Date().toISOString() }, "update", input.actor, input.reason);
}
// ... 其余类似
```

`patchRecord` 和 `restoreVersion` 稍有差异（需要从 patch/snapshot 构建 `updateFields`），但也可以走同一模板——差异部分提取为 `buildUpdateFields(input)` 即可。

### 效果

- 180 行 → ~50 行
- 审计日志、版本快照、读模型刷新的调用一致性由模板保证，不会出现某个方法漏写

---

## 实施优先级

| 优先级 | 优化项 | 理由 |
|---|---|---|
| **P1** | 优化一（误归档修复） | 当前 bug，可能删除有效记忆 |
| **P1** | 优化二（Evolution 质量门禁） | 进化记忆无 QA，可能写入垃圾 |
| **P2** | 优化三（merge 容错） | 并发场景健壮性 |
| **P2** | 优化四（定时器调度） | 避免扫描空窗 |
| **P2** | 优化五（跨周期去重） | 减少 LLM 浪费 |
| **P3** | 优化六（服务端过滤） | 性能优化 |
| **P3** | 优化七（代码去重） | 维护性 |

每项优化独立可实施、独立可验证。
