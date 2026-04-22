# 记忆治理提案 + 全自动执行 设计文档

> 对应目标：记忆治理继续交给 `LLM` 做语义判断，但治理动作改为“机器提案 + 机器复核 + `storage` 自动执行”。  
> 涉及服务：`services/retrieval-runtime`、`services/storage`、`services/visualization`、`services/memory-native-agent`。  
> 文档状态：`draft`。  
> 实施时间：待排期。

---

## 状态更新（2026-04-22）

| 编号 | 状态 | 说明 |
|---|---|---|
| #1 | 已完成 | 已确认产品口径：记忆治理不走人工审核，默认走 `LLM` 全自动治理 |
| #2 | 已完成 | 已确认动作口径：`delete` 统一按软删除处理，不做硬删除 |
| #3 | 已完成 | 已确认职责边界：`retrieval-runtime` 负责治理提案与模型复核，`storage` 负责自动执行、审计、幂等和事务口径 |
| #4 | 已完成 | 已补充当前 `writeback-expansion-design` 的不合理点，作为本方案的改造依据 |
| #5 | 已完成 | `storage` 已新增治理提案模型、批量自动执行接口、执行历史查询接口 |
| #6 | 已完成 | `retrieval-runtime` 已把 maintenance worker 改成“生成提案 + 模型复核 + 提交执行包”，并补齐影子模式与降级语义 |
| #7 | 已完成 | `visualization` 已增加治理历史列表、详情联动、删除原因、来源链路和执行结果展示 |
| #8 | 待开发 | 建立治理提案通过率、复核通过率、执行成功率、软删除率、治理后召回命中率等指标 |

---

## 目录

1. [背景与结论](#1-背景与结论)
2. [设计目标](#2-设计目标)
3. [非目标](#3-非目标)
4. [职责边界](#4-职责边界)
5. [总体方案](#5-总体方案)
6. [治理执行模型](#6-治理执行模型)
7. [Storage 自动执行策略](#7-storage-自动执行策略)
8. [接口设计](#8-接口设计)
9. [数据模型](#9-数据模型)
10. [端到端流程](#10-端到端流程)
11. [展示要求](#11-展示要求)
12. [灰度计划](#12-灰度计划)
13. [指标设计](#13-指标设计)
14. [风险与约束](#14-风险与约束)
15. [实施清单](#15-实施清单)
16. [模块级开发拆解](#16-模块级开发拆解)

---

## 1. 背景与结论

### 1.1 背景

记忆治理这件事，本质上包含两类能力：

- **语义判断**：这两条是不是重复、这条是不是过期、这个冲突该激活哪条、这批记录能不能合并成摘要
- **正式执行**：把记录改成 `archived`、`deleted`、`active`，写版本、写治理审计、刷新读模型

前者天然更适合交给 `LLM`，后者天然更适合交给 `storage`。

所以这次的产品口径不是“回退到纯规则”，也不是“继续让 `retrieval-runtime` 直接改正式记录”，而是：

> **规则初筛 + `LLM` 治理提案 + `LLM` 机器复核 + `storage` 自动执行**

这里的“提案”不是为了人工审核，而是为了：

- 给自动执行提供结构化输入
- 给 `storage` 提供统一执行口径
- 给可视化层提供“为什么改了”的解释链路
- 给排障和回放提供审计对象

### 1.2 产品结论

最终产品结论是：

1. 记忆治理继续完全使用 `LLM` 做语义判断。
2. 不引入人工审核作为默认兜底链路。
3. `delete` 允许自动化，但统一按**软删除**处理。
4. 所有自动 `delete` 必须记录明确的删除原因和来源证据。
5. 所有最终状态变化都由 `storage` 负责执行和审计。

### 1.3 当前 `writeback-expansion-design` 的不合理点

这里的“不合理”不是说方向完全错误，而是说当前设计直接进入“运行时规划后马上逐条落盘”，中间少了一层适合自动化治理的执行载体和自动护栏。

#### 不合理点 1：`retrieval-runtime` 同时承担“判断者”和“执行者”

当前 `writeback-expansion-design` 里，maintenance worker 在 `LLM` 规划完成后会直接调用：

- `patchRecord`
- `archiveRecord`
- `submitCandidates`
- `resolveConflict`

这会让 `retrieval-runtime` 既负责判断，又负责推动正式状态变化。这样做虽然快，但会让：

- 正式治理口径分散
- 多步动作缺少统一事务边界
- 后续解释层只能看到结果，缺少提案层语义

#### 不合理点 2：`merge` 和 `summarize` 都不是原子操作

当前设计里：

- `merge` 是先 `patch` 第一条，再 `archive` 其他条
- `summarize` 是先写新摘要，再逐条 `archive` 源记录

只要中间有一步失败，就会出现中间态：

- 合并后的主记录已改，但旧记录只归档了一部分
- 新摘要已写入，但旧记录仍处于 `active`

如果要走全自动治理，这类动作不能再靠运行时顺序调用多个接口完成，而应该收口成 `storage` 侧可原子执行或可补偿执行的一次动作。

#### 不合理点 3：失败语义和调度语义还不够稳定

之前已经确认两处问题：

- 文档写的是“单个动作失败会中断当前 workspace 剩余动作”，实现却是“失败后跳过当前 action，后续继续”
- `WRITEBACK_MAINTENANCE_ENABLED=false` 只关闭定时调度，不关闭手动 `runOnce()`

这类语义如果在全自动模式下不统一，就会直接影响灰度、回放、重试和运维判断。

#### 不合理点 4：用户能看到记忆结果变化，却看不到机器为什么这么做

当前设计更像后台直接改数据：

- 某条记忆被归档了
- 某个冲突被解决了
- 某个摘要被替换了

但没有一层明确对象去表达：

- 这是哪一批记录触发的
- 机器为什么判断它们重复或过期
- 这次是 planner 的判断，还是 verifier 二次确认后的结果
- `delete` 的原因是什么

如果不补这一层，产品体验上还是会显得“系统在偷偷改记忆”。

#### 不合理点 5：高影响动作缺少机器侧二次护栏

既然这次明确不走人工审核，那么原方案里“高风险动作晚一点再自动化”的思路也不够完整。现在更需要的是：

- 高影响动作要有第二次模型复核
- `delete` 必须强制软删除
- 所有动作都必须带结构化理由和证据
- 执行层要有幂等、事务或补偿语义

所以本方案不是引入人工审核，而是引入**机器提案层 + 机器复核层 + `storage` 自动执行层**。

---

## 2. 设计目标

1. **保留语义治理能力**：重复识别、摘要、过期判断、冲突裁决继续由 `LLM` 参与完成。
2. **实现全自动治理**：不依赖人工审核，所有治理动作由机器自动提交、自动执行。
3. **统一最终执行口径**：所有正式状态变化统一由 `storage` 自动执行。
4. **保留可解释性**：每次治理都能回答“为什么删、为什么归档、为什么合并”。
5. **确保删除可追踪**：所有 `delete` 都是软删除，并且必须带删除原因。
6. **保持主链路兼容**：不破坏当前 `prepare-context`、`finalize-turn`、写回入库的对外契约。

---

## 3. 非目标

- 不引入人工审核作为默认产品链路
- 不做硬删除
- 不让 `storage` 负责自己理解原始自然语言
- 不要求一次性替换现有全部治理接口；现有 `archive`、`delete`、`confirm`、`resolveConflict` 继续保留，作为执行层能力

---

## 4. 职责边界

### 4.1 服务职责划分

| 服务 | 角色 | 主要职责 |
|---|---|---|
| `retrieval-runtime` | 治理编排器 | 扫描最近记忆、做规则初筛、调 `LLM` 生成治理提案、调 `LLM` 做二次复核、提交执行包 |
| `storage` | 自动执行器 | 校验执行包、原子执行或补偿执行治理动作、写版本历史、写治理审计、刷新读模型 |
| `visualization` | 解释与观测层 | 展示治理历史、删除原因、来源链路、执行结果、失败原因 |
| `memory-native-agent` | 调用方 | 主链路保持不变，后续只需要接入治理结果查询 |
| `LLM planner` | 第一阶段判断器 | 识别重复、冲突、过期、可合并性，产出治理提案 |
| `LLM verifier` | 第二阶段复核器 | 对高影响动作做二次确认，避免 planner 直接放行动作 |

### 4.2 明确边界

- `retrieval-runtime` 负责回答“建议执行什么动作”
- `LLM verifier` 负责回答“高影响动作是否应继续执行”
- `storage` 负责回答“这个动作现在能不能安全落盘”
- `visualization` 负责回答“这次自动治理为什么发生”

---

## 5. 总体方案

### 5.1 关键变化

当前 maintenance 方向是：

```text
retrieval-runtime
  -> planner.plan(...)
  -> 直接调用 storage patch/archive/resolve
```

调整后的目标方向是：

```text
retrieval-runtime
  -> planner.plan(...)
  -> build governance proposals
  -> verifier.confirm(...)
  -> build execution package
  -> submit to storage

storage
  -> validate package
  -> execute atomically or with compensation
  -> write versions / governance actions / execution history
```

### 5.2 为什么保留提案层

虽然最终不走人工审核，但提案层仍然必须保留，因为它承担四个作用：

1. 给 `LLM verifier` 提供标准化复核输入
2. 给 `storage` 提供统一的自动执行载体
3. 给可视化层提供“机器为什么这么做”的解释对象
4. 给重试、重放、对账提供稳定的审计对象

### 5.3 为什么要有机器复核层

既然这次明确不走人工审核，那高影响动作就不能只靠一次模型输出直接落盘。更合理的机器护栏是：

- 低影响动作：`planner` 直接给提案，满足结构校验就能执行
- 高影响动作：`planner` 提案后，再由 `verifier` 用不同提示词复核

这里的高影响动作包括：

- `merge`
- `summarize`
- `resolve_conflict`
- `delete`

---

## 6. 治理执行模型

### 6.1 执行对象状态

建议把治理对象统一定义为内部执行对象，状态如下：

| 状态 | 含义 |
|---|---|
| `proposed` | planner 已生成提案 |
| `verified` | verifier 已通过 |
| `rejected_by_guard` | 被自动护栏拒绝执行 |
| `executing` | `storage` 正在执行 |
| `executed` | 已执行成功 |
| `failed` | 执行失败 |
| `superseded` | 被新的治理对象覆盖 |
| `cancelled` | 因幂等冲突或状态变化被取消 |

### 6.2 执行对象结构

建议由 `retrieval-runtime` 提交统一格式：

```json
{
  "proposal_id": "uuid",
  "workspace_id": "uuid",
  "proposal_type": "merge|archive|downgrade|confirm|resolve_conflict|summarize|delete",
  "targets": {
    "record_ids": ["id1", "id2"],
    "conflict_id": "optional-conflict-id",
    "winner_record_id": "optional-id"
  },
  "suggested_changes": {
    "summary": "合并后的摘要",
    "importance": 4,
    "status": "archived",
    "delete_mode": "soft"
  },
  "reason_code": "duplicate_preference|obsolete_task_state|conflict_resolved|stale_summary",
  "reason_text": "两条记录表达的是同一稳定偏好，后者信息更完整，旧记录可归档",
  "evidence": {
    "seed_record_ids": ["id1"],
    "related_record_ids": ["id2"],
    "similarity": 0.91,
    "planner_notes": "record id2 覆盖了 id1 的核心内容",
    "delete_reason": "已被更新版本替代，保留无收益且会干扰召回"
  },
  "planner": {
    "model": "writeback_llm",
    "confidence": 0.93
  },
  "verifier": {
    "required": true,
    "model": "writeback_llm",
    "decision": "approve",
    "confidence": 0.91,
    "notes": "删除动作满足软删除条件，且存在明确替代记录"
  },
  "policy_version": "memory-governance-v1",
  "idempotency_key": "sha256(...)"
}
```

### 6.3 字段说明

| 字段 | 说明 |
|---|---|
| `proposal_type` | 治理动作类型 |
| `targets.record_ids` | 被命中的记录集合 |
| `targets.conflict_id` | 若是冲突提案，关联的冲突 id |
| `targets.winner_record_id` | 冲突或合并场景下的保留主记录 |
| `suggested_changes` | 建议执行后的目标状态、新摘要或新重要度 |
| `suggested_changes.delete_mode` | 删除模式，固定为 `soft` |
| `reason_code` | 便于统计的标准原因码 |
| `reason_text` | 面向可视化层的解释文本 |
| `evidence` | 结构化证据，不能存原始长对话 |
| `evidence.delete_reason` | 删除原因，`delete` 动作必填 |
| `planner.confidence` | planner 输出置信度 |
| `verifier` | 二次复核结果；低影响动作可设 `required=false` |
| `policy_version` | 当前治理策略版本 |
| `idempotency_key` | 防止重复治理同一批记录 |

### 6.4 动作口径

| 动作 | 是否自动执行 | 执行口径 |
|---|---|---|
| `archive` | 是 | 归档重复、过期或被替代记录 |
| `confirm` | 是 | 刷新稳定记忆的确认状态 |
| `downgrade` | 是 | 降低重要度，不改状态 |
| `resolve_conflict` | 是 | 自动解决冲突，并按结果激活或归档对应记录 |
| `merge` | 是 | 自动合并多条记录，需通过复核 |
| `summarize` | 是 | 自动生成摘要记录并处理源记录，需通过复核 |
| `delete` | 是 | 固定为软删除，需通过复核并记录删除原因 |

---

## 7. Storage 自动执行策略

### 7.1 核心原则

`storage` 不负责理解自然语言，只负责：

1. 校验执行包是否合法
2. 校验目标记录当前是否允许执行该动作
3. 按动作类型选择原子执行或补偿执行
4. 统一写版本、治理审计和执行历史

### 7.2 执行前校验

`storage` 至少要检查：

- 目标记录是否存在
- 所有目标是否属于同一 `workspace`
- 当前状态是否允许本次动作
- 是否已经处理过相同 `idempotency_key`
- 若动作依赖 `winner_record_id` 或替代记录，该记录是否存在且状态合法
- 若是冲突提案，`conflict_id` 是否仍处于 `open`
- 若是 `delete`，`suggested_changes.delete_mode` 是否为 `soft`
- 若是 `delete`，`evidence.delete_reason` 是否存在且长度合法

### 7.3 机器复核门槛

建议按动作级别做机器复核：

- `archive`
  - `planner.confidence >= 0.85`
  - 不要求 verifier
- `confirm`
  - `planner.confidence >= 0.80`
  - 不要求 verifier
- `downgrade`
  - `planner.confidence >= 0.80`
  - 不要求 verifier
- `resolve_conflict`
  - `planner.confidence >= 0.90`
  - `verifier.decision = approve`
- `merge`
  - `planner.confidence >= 0.90`
  - `verifier.decision = approve`
- `summarize`
  - `planner.confidence >= 0.90`
  - `verifier.decision = approve`
- `delete`
  - `planner.confidence >= 0.92`
  - `verifier.decision = approve`
  - `delete_mode = soft`
  - `delete_reason` 必填

### 7.4 删除动作口径

`delete` 的产品定义统一改成：

- 不是物理删除
- 不是清空历史
- 而是把记录状态改成 `deleted`
- 保留版本历史
- 保留治理审计
- 从共享读模型中移除

这正好和 `storage` 现有软删除语义一致。

### 7.5 多步动作执行语义

为了修正当前 `merge`、`summarize` 的中间态问题，建议新增 `storage` 侧的批量治理执行能力，而不是继续由运行时串行调多个接口。

也就是：

- `merge` 由 `storage` 一次性处理目标记录集合
- `summarize` 由 `storage` 一次性处理“新摘要记录 + 源记录状态变化”
- 如果底层不能完全事务化，就必须把补偿逻辑也收口在 `storage`

这样运行时只提交执行包，不直接拼多次接口调用。

### 7.6 执行结果

自动执行后，只允许有四种最终结果：

| 结果 | 含义 |
|---|---|
| `executed` | 已成功执行 |
| `rejected_by_guard` | 未通过结构或复核门槛 |
| `failed` | 执行期间失败 |
| `cancelled` | 因幂等冲突或状态变化取消 |

---

## 8. 接口设计

### 8.1 新增自动执行接口

建议在 `storage` 新增一组接口：

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/v1/storage/governance-executions` | 提交一批治理执行包并自动执行 |
| `GET` | `/v1/storage/governance-executions` | 查询执行历史 |
| `GET` | `/v1/storage/governance-executions/:executionId` | 查看执行详情 |
| `POST` | `/v1/storage/governance-executions/:executionId/retry` | 对 `failed` 执行重试 |

### 8.2 请求体建议

`POST /v1/storage/governance-executions` 可接收：

```json
{
  "workspace_id": "uuid",
  "source_service": "retrieval-runtime",
  "items": [
    {
      "proposal_id": "uuid",
      "proposal_type": "delete",
      "targets": { "record_ids": ["id1"] },
      "suggested_changes": { "delete_mode": "soft" },
      "reason_code": "obsolete_task_state",
      "reason_text": "该记录已失效，且会干扰当前召回",
      "evidence": {
        "delete_reason": "已被新状态记录替代"
      },
      "planner": { "confidence": 0.94 },
      "verifier": { "decision": "approve", "confidence": 0.92 },
      "policy_version": "memory-governance-v1",
      "idempotency_key": "sha256(...)"
    }
  ]
}
```

### 8.3 现有治理接口的定位

现有接口继续保留：

- `PATCH /v1/storage/records/:recordId`
- `POST /v1/storage/records/:recordId/archive`
- `POST /v1/storage/records/:recordId/confirm`
- `POST /v1/storage/records/:recordId/invalidate`
- `POST /v1/storage/records/:recordId/delete`
- `POST /v1/storage/conflicts/:conflictId/resolve`

但在这套方案里，它们主要变成：

- `storage` 内部执行器调用的能力
- 回放和兼容旧链路的保留能力

### 8.4 对 `retrieval-runtime` 的改动

`retrieval-runtime` 的 maintenance worker 需要从：

```text
plan -> applyActions
```

改为：

```text
plan -> buildGovernanceProposals -> verifyHighImpactActions -> submitExecutionPackage
```

也就是：

- 不再直接串行调用 `patchRecord`、`archiveRecord`、`resolveConflict`
- 改为提交一批治理执行包给 `storage`

---

## 9. 数据模型

### 9.1 建议新增表

#### `memory_governance_proposals`

保存 planner 产出的治理提案：

- `id`
- `workspace_id`
- `proposal_type`
- `status`
- `reason_code`
- `reason_text`
- `suggested_changes_json`
- `evidence_json`
- `planner_confidence`
- `verifier_required`
- `verifier_decision`
- `verifier_confidence`
- `policy_version`
- `idempotency_key`
- `created_at`
- `updated_at`

#### `memory_governance_proposal_targets`

保存提案目标：

- `proposal_id`
- `record_id`
- `conflict_id`
- `role`

这里的 `role` 可用于标记：

- `target`
- `winner`
- `loser`
- `seed`
- `related`

#### `memory_governance_executions`

保存执行记录：

- `id`
- `proposal_id`
- `execution_status`
- `result_summary`
- `error_message`
- `started_at`
- `finished_at`

### 9.2 与现有治理审计的关系

`storage` 现有的：

- `memory_records`
- `memory_record_versions`
- `memory_governance_actions`

继续保留。

新增表用于回答：

- planner 提了什么
- verifier 是否通过
- `storage` 最后怎么执行
- `delete` 的原因是什么

现有治理审计继续回答：

- 正式记录最终发生了什么状态变化

---

## 10. 端到端流程

### 10.1 写回主链路

当前主链路不变：

```text
memory-native-agent
  -> retrieval-runtime / finalize-turn
  -> storage write-back-candidates
```

### 10.2 治理链路

新增治理链路：

```text
maintenance interval / manual trigger
  -> retrieval-runtime maintenance worker
  -> rule prefilter
  -> LLM planner
  -> build governance proposals
  -> LLM verifier (for high-impact actions)
  -> build execution package
  -> POST /v1/storage/governance-executions

storage
  -> validate package
  -> execute atomically or with compensation
  -> write record versions
  -> write governance actions
  -> write execution history
  -> refresh read model
```

### 10.3 失败重试链路

```text
storage execution failed
  -> mark failed
  -> keep proposal and execution history
  -> retry by idempotency key or execution id
```

---

## 11. 展示要求

这次虽然不走人工审核，但展示层仍然必须补齐，否则用户仍会感知为“系统在偷偷改记忆”。

至少要能展示：

1. 治理动作类型
2. 命中的记录列表
3. planner 的理由
4. verifier 的结论
5. 最终执行结果
6. 原记录与变更后记录的对比
7. `delete` 的删除原因
8. 这次动作是否影响了召回可见性

面板里至少要能区分：

- 这是 planner 的提案
- 这是 verifier 的复核结果
- 这是 `storage` 已执行的正式动作

---

## 12. 灰度计划

虽然最终目标是全自动治理，但上线节奏仍建议分阶段，只是这些阶段都不依赖人工审核。

### Phase 1：影子模式

- planner 正常产出提案
- verifier 正常复核
- `storage` 只保存提案和执行包，不真正改记录
- 目标是验证提案质量、复核通过率、删除原因质量

### Phase 2：自动执行低影响动作

- 自动执行 `archive`
- 自动执行 `confirm`
- 自动执行 `downgrade`

### Phase 3：自动执行高影响非删除动作

- 自动执行 `resolve_conflict`
- 自动执行 `merge`
- 自动执行 `summarize`

### Phase 4：自动执行软删除

- 自动执行 `delete`
- 固定映射为 `soft delete`
- 强制要求 `delete_reason`

---

## 13. 指标设计

建议至少补这几组指标：

| 指标 | 含义 |
|---|---|
| `proposal_count` | planner 产出的提案总量 |
| `verification_pass_rate` | verifier 通过率 |
| `guard_reject_rate` | 自动护栏拒绝率 |
| `execution_success_rate` | 自动执行成功率 |
| `soft_delete_rate` | 软删除比例 |
| `execution_retry_rate` | 执行重试比例 |
| `wrong_action_rate` | 错误治理比例 |
| `revert_rate` | 后续被系统或人工修正的比例 |
| `duplicate_reduction_rate` | 重复记忆下降比例 |
| `recall_hit_rate_after_governance` | 治理后召回命中率 |

这些指标要能区分：

- planner 阶段
- verifier 阶段
- 执行阶段
- 最终召回效果阶段

---

## 14. 风险与约束

### 14.1 明确约束

- 不做硬删除
- 所有 `delete` 都必须是软删除
- 所有 `delete` 都必须带 `delete_reason`
- `merge`、`summarize`、`delete` 必须通过机器复核
- 所有自动治理必须有审计
- 提案必须有幂等键
- 证据必须结构化，不能塞原始长对话

### 14.2 主要风险

1. **planner 过于激进**：提案量可能膨胀，影响执行质量。
2. **verifier 过于宽松**：高影响动作可能被放得太快。
3. **状态竞争**：提案生成后到执行前，目标记录状态可能已经变化。
4. **解释不足**：若面板只显示“已删除”，用户仍然不知道为什么删。
5. **删除口径漂移**：若不同模型版本对 `delete_reason` 质量不一致，会影响可解释性。

---

## 15. 实施清单

### 15.1 `storage`

| 事项 | 状态 | 说明 |
|---|---|---|
| 新增 `governance proposals` 数据表 | 已完成 | 已新增 proposal、proposal targets、executions 三类存储结构 |
| 新增 `governance executions` 数据表 | 已完成 | 已支持执行历史、失败原因和重试读取 |
| 新增批量自动执行接口 | 已完成 | 已新增 `/v1/storage/governance-executions` 及查询、详情、重试接口 |
| 新增幂等校验 | 已完成 | 已基于 `idempotency_key` 做 proposal 去重 |
| 收口多步动作执行 | 已完成 | `merge`、`summarize`、`delete` 已由 `storage` 统一执行 |
| 新增观测指标 | 待开发 | 提案量、复核通过率、执行成功率、软删除率 |

### 15.2 `retrieval-runtime`

| 事项 | 状态 | 说明 |
|---|---|---|
| maintenance planner 输出适配 proposal 模型 | 已完成 | planner 已输出可组装为治理提案的动作模型，并支持 `delete` |
| 增加 verifier 调用链 | 已完成 | `merge`、`summarize`、`resolve_conflict`、`delete` 已走二次模型复核 |
| maintenance worker 提交执行包 | 已完成 | 已替换原有直接 `patch/archive/resolve` 行为，统一提交 execution batch |
| 提案构建器 | 已完成 | 已统一补齐 `reason_code`、`reason_text`、`evidence`、`delete_reason` 和幂等键 |
| 兼容旧配置与降级 | 已完成 | 已补 verifier 不可用跳过、高影响动作保护、`shadow mode` 和 `downgrade -> archive` 兼容口径 |

### 15.3 `visualization`

| 事项 | 状态 | 说明 |
|---|---|---|
| 治理历史列表页 | 已完成 | 已支持按 workspace、动作、结果筛选，并新增独立治理页面 |
| 治理详情页 | 已完成 | 已展示原因、证据、来源链路、执行结果和命中目标 |
| 删除原因展示 | 已完成 | `delete` 动作已显式展示 `delete_reason` |
| 执行结果展示 | 已完成 | 已展示 planner、verifier、storage 三段结果 |

### 15.4 验证建议

1. 先做 `Phase 1` 影子模式。
2. 连续观察一周提案质量、复核通过率、软删除原因质量。
3. 再按动作类型逐步打开自动执行。

---

## 16. 模块级开发拆解

这一节把“各个部分要做什么”拆成能直接进入研发排期的任务，不再只停留在概念层。

### 16.1 `retrieval-runtime` 要做什么

#### A. 保留现有写回链路，不动主入口

这部分的结论是“不改主链路，只补治理链路”。

要做的事：

1. 保持 `finalize-turn -> rules-first -> LLM refine -> postProcess -> submitCandidates` 不变。
2. 不把治理逻辑塞进单轮写回里，避免增加主响应时延。
3. 继续把治理入口放在 maintenance worker 里。

完成标准：

- 单轮写回行为和现在一致
- 治理功能开关关闭时，对主链路零影响

#### B. 新增 `planner` 提案构建阶段

这部分负责“发现该治理什么”。

要做的事：

1. 把现有 maintenance planner 的输出从 `action` 改成 `proposal`。
2. 为每个 proposal 补齐统一字段：
   - `proposal_id`
   - `proposal_type`
   - `targets`
   - `reason_code`
   - `reason_text`
   - `evidence`
   - `planner.confidence`
   - `policy_version`
   - `idempotency_key`
3. 给每类动作制定 `reason_code` 枚举，至少包括：
   - `duplicate_preference`
   - `duplicate_task_state`
   - `obsolete_task_state`
   - `conflict_resolved`
   - `stale_summary`
   - `superseded_record`
4. 给 `delete` 动作强制补 `evidence.delete_reason`。

完成标准：

- planner 不再产出直接可落盘的多步动作
- planner 产出的是结构化提案对象
- proposal schema 能单独通过测试

#### C. 新增 `verifier` 机器复核阶段

这部分负责“高影响动作再看一眼”。

要做的事：

1. 新增 `LLM verifier` prompt 和 schema。
2. 定义哪些动作必须走 verifier：
   - `merge`
   - `summarize`
   - `resolve_conflict`
   - `delete`
3. verifier 的输入里要包含：
   - planner 生成的 proposal
   - targets 的压缩记录快照
   - related records
   - conflict snapshot
4. verifier 的输出最少包含：
   - `decision: approve | reject`
   - `confidence`
   - `notes`
5. 未通过 verifier 的 proposal 不进入执行包。

完成标准：

- 高影响动作都能被二次复核
- verifier 失败时，不会误执行高影响动作
- verifier 的拒绝理由可被面板展示

#### D. maintenance worker 改造成“提交执行包”

这部分负责“把提案送到 storage，而不是自己改库”。

要做的事：

1. 删除 worker 里直接调用：
   - `patchRecord`
   - `archiveRecord`
   - `resolveConflict`
   - `submitCandidates`（仅限 summarize 治理链路）
2. 新增 `buildExecutionPackage()`：
   - 把 proposal + verifier 结果组装成统一执行包
3. 新增 `submitExecutionPackage()`：
   - 调 `POST /v1/storage/governance-executions`
4. 保留 `selectWorkspaces / fetchSeeds / fetchRelated / fetchConflicts` 这几段扫描逻辑。
5. 明确降级语义：
   - planner 不可用：本轮治理跳过
   - verifier 不可用：高影响动作不执行，低影响动作可继续
   - storage 执行接口不可用：整批执行包标记失败

完成标准：

- worker 不再有“自己拼多次治理接口调用”的逻辑
- 所有治理动作统一以执行包方式提交

#### E. 新增配置项

要做的事：

1. 新增 verifier 开关和 token 预算：
   - `WRITEBACK_GOVERNANCE_VERIFY_ENABLED`
   - `WRITEBACK_GOVERNANCE_VERIFY_MAX_TOKENS`
2. 新增自动治理阈值配置：
   - `WRITEBACK_GOVERNANCE_ARCHIVE_MIN_CONFIDENCE`
   - `WRITEBACK_GOVERNANCE_DELETE_MIN_CONFIDENCE`
   - `WRITEBACK_GOVERNANCE_VERIFY_REQUIRED_ACTIONS`
3. 新增影子模式开关：
   - `WRITEBACK_GOVERNANCE_SHADOW_MODE`

完成标准：

- 不同环境能独立控制 planner、verifier、shadow mode

---

### 16.2 `storage` 要做什么

#### A. 新增 contracts 和 API

这部分负责“接住执行包”。

要做的事：

1. 在 `contracts.ts` 新增：
   - proposal item schema
   - execution batch request schema
   - execution result schema
2. 在 `api/app.ts` 新增接口：
   - `POST /v1/storage/governance-executions`
   - `GET /v1/storage/governance-executions`
   - `GET /v1/storage/governance-executions/:executionId`
   - `POST /v1/storage/governance-executions/:executionId/retry`
3. 给 `delete` 的 schema 增加强校验：
   - `delete_mode` 必须是 `soft`
   - `delete_reason` 必填

完成标准：

- execution API 能独立接收一批治理动作
- schema 校验失败时不会落任何正式变更

#### B. 新增数据表

这部分负责“留痕”。

要做的事：

1. 新增 `memory_governance_proposals`
2. 新增 `memory_governance_proposal_targets`
3. 新增 `memory_governance_executions`
4. 必要时增加索引：
   - `workspace_id + created_at`
   - `proposal_type + status`
   - `idempotency_key`
5. 为 `delete_reason` 和 `verifier_decision` 预留字段。

完成标准：

- 能完整追踪 proposal、execution、result 三段信息
- 可以按 workspace 和时间窗口查询

#### C. 新增治理执行引擎

这部分负责“真正执行动作”。

要做的事：

1. 新建一个 `GovernanceExecutionEngine`，统一接收 execution items。
2. 按动作类型分发到不同执行器：
   - `executeArchive`
   - `executeConfirm`
   - `executeDowngrade`
   - `executeResolveConflict`
   - `executeMerge`
   - `executeSummarize`
   - `executeSoftDelete`
3. 把 `merge`、`summarize` 这类多步动作收口到同一事务或同一补偿流程里。
4. 对每个 execution item 写：
   - 开始时间
   - 结束时间
   - 成功/失败结果
   - 错误原因

完成标准：

- 运行时不再自己拼多次治理调用
- 多步动作的事务边界收口到 storage

#### D. 新增执行护栏

这部分负责“自动执行也不能乱跑”。

要做的事：

1. 校验目标记录存在且同属一个 `workspace`。
2. 校验当前状态允许本次动作。
3. 校验 `idempotency_key` 未重复执行。
4. 对 `delete` 额外校验：
   - 只能软删除
   - `delete_reason` 必填
   - 若存在替代记录，可校验替代记录 id 合法
5. 对 `merge/summarize` 校验：
   - 最少涉及 2 条记录
   - 目标记录状态都不是 `deleted`

完成标准：

- 即使 planner/verifier 有误，也能挡住明显非法动作

#### E. 保留现有治理审计链

这部分负责“正式变更仍走老的版本和审计口径”。

要做的事：

1. 所有执行动作继续写：
   - `memory_record_versions`
   - `memory_governance_actions`
2. `delete` 的治理动作里把 `delete_reason` 一并写进去。
3. 保持共享读模型刷新逻辑不变。

完成标准：

- 新治理执行链不破坏现有审计模型

---

### 16.3 `visualization` 要做什么

#### A. 新增治理历史页

这部分负责“让自动治理可见”。

要做的事：

1. 新增治理历史列表。
2. 支持筛选：
   - workspace
   - action type
   - execution status
   - 是否软删除
3. 支持时间范围查询。

完成标准：

- 可以快速看到最近自动治理做了什么

#### B. 新增治理详情页

这部分负责“告诉用户为什么改”。

要做的事：

1. 展示 planner 的理由。
2. 展示 verifier 的结论。
3. 展示命中的记录列表。
4. 展示原记录和治理后结果对比。
5. 若是 `delete`，必须显式展示 `delete_reason`。

完成标准：

- 用户能知道这次为什么删、为什么归档、为什么合并

#### C. 新增指标看板

这部分负责“看治理质量”。

要做的事：

1. 展示：
   - 提案总量
   - verifier 通过率
   - 执行成功率
   - 软删除比例
   - 重试比例
   - 治理后召回命中率
2. 支持按时间维度看趋势。

完成标准：

- 能区分是 planner 质量问题、verifier 质量问题，还是 execution 稳定性问题

---

### 16.4 `memory-native-agent` 要做什么

这部分改动最少。

要做的事：

1. 主调用链不改。
2. 如需展示治理历史，从 visualization 或 storage 查询治理结果。
3. 不新增人工审核动作入口。

完成标准：

- mna 不承担治理执行职责
- mna 仍然只负责正常使用记忆和展示记忆结果

---

### 16.5 Prompt 和策略层要做什么

#### A. planner prompt

要做的事：

1. 让 planner 专注判断：
   - 是否重复
   - 是否过期
   - 是否可合并
   - 是否应软删除
2. 明确要求输出 `reason_code` 和 `reason_text`。
3. 对 `delete` 强制要求输出 `delete_reason`。

#### B. verifier prompt

要做的事：

1. verifier 不重复做全量规划。
2. verifier 只回答：
   - planner 的这个动作是否足够可信
   - 是否存在明显风险
   - 是否应该拒绝执行
3. 提示词里要重点打压：
   - 凭空删除
   - 跨 scope 合并
   - 无替代依据的 delete

#### C. policy version

要做的事：

1. 每次 prompt 或策略变动都更新 `policy_version`。
2. 在 proposal 和 execution 里都落库。

完成标准：

- 未来能追溯“当时为什么这样判”

---

### 16.6 测试要做什么

#### A. `retrieval-runtime` 单测

要做的事：

1. planner 输出 proposal schema 测试
2. verifier approve/reject 测试
3. delete 必带 `delete_reason` 测试
4. execution package 构建测试
5. planner/verifier 降级测试

#### B. `storage` 单测和集成测试

要做的事：

1. governance execution API schema 测试
2. idempotency 测试
3. merge 原子执行或补偿测试
4. summarize 原子执行或补偿测试
5. soft delete 测试
6. delete_reason 落库测试
7. retry 测试

#### C. 端到端测试

要做的事：

1. 从写入候选到治理执行的完整链路测试
2. 治理后召回结果变化测试
3. 治理历史页面展示测试

完成标准：

- 至少能覆盖 archive、merge、summarize、soft delete 四条核心路径

---

### 16.7 上线顺序建议

#### 第 1 步

先做 `storage` 数据表和 execution API，但先不开正式执行，只记录 execution request。

#### 第 2 步

改 `retrieval-runtime` worker，先提交 execution package 到 `storage`，走影子模式。

#### 第 3 步

接 verifier，把高影响动作先跑通但不真正改数据。

#### 第 4 步

按动作类型逐步打开正式执行：

1. `archive`
2. `confirm`
3. `downgrade`
4. `resolve_conflict`
5. `merge`
6. `summarize`
7. `delete`（软删除）

#### 第 5 步

最后补 visualization 的治理历史和指标看板。

---

## 附录 A：一句话口径

这套方案的最终口径是：

> **记忆治理继续由 `LLM` 参与判断，但所有动作都走机器复核和 `storage` 自动执行；`delete` 统一按软删除处理，并且必须保留删除原因。**

这句话需要在产品、研发、测试、运营和面板展示层保持一致。
