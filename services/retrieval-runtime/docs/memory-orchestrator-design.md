# 记忆模型模块化（Memory Orchestrator）设计文档

> 对应目标：把当前分散在 `retrieval-runtime`、`writeback`、`governance` 里的记忆模型能力，收口为统一的 `memory orchestrator`（记忆编排器）模块。  
> 涉及服务：`services/retrieval-runtime`、`services/storage`、`services/visualization`、`services/memory-native-agent`。  
> 文档状态：`draft`。  
> 实施时间：2026-04-22 起。

---

## 状态更新（2026-04-22）

| 编号 | 状态 | 说明 |
|---|---|---|
| #1 | 已完成 | 已确认产品方向：记忆模型不再只是写回提取模型，而是整个记忆系统的控制面 |
| #2 | 已完成 | 已确认职责边界：模型负责决策，程序负责执行与兜底，`storage` 继续保留正式执行权 |
| #3 | 已完成 | 召回链路已经有了雏形：模型先做检索规划，再做注入规划 |
| #4 | 已完成 | 已识别现有冲突点：命名仍是 `writeback_llm`，提示词分散，观测粒度不够，UI 口径偏窄 |
| #5 | 部分完成 | 已新增 `src/memory-orchestrator/` 统一入口、类型、schema、prompt 与 LLM client，召回/写回/治理开始通过 orchestrator 接口接线，具体 planner 文件仍在继续迁移 |
| #6 | 已完成 | `retrieval-runtime` 已切换到 `MEMORY_LLM_*`，不再兼容旧配置；依赖健康检查与状态桶已统一为 `memory_llm` |
| #7 | 已完成 | `visualization` 与 `memory-native-agent` 已统一切到 `memory llm` 配置、状态探针和依赖展示口径 |
| #8 | 部分完成 | `maintenance-worker` 已改为依赖 orchestrator 治理接口类型，治理 planner / verifier 具体实现已迁到新目录，旧入口兼容层仍保留 |

---

## 目录

1. [背景与结论](#1-背景与结论)
2. [设计目标](#2-设计目标)
3. [非目标](#3-非目标)
4. [核心结论](#4-核心结论)
5. [现状问题](#5-现状问题)
6. [总体方案](#6-总体方案)
7. [模块拆分](#7-模块拆分)
8. [四条主链路](#8-四条主链路)
9. [与现有模块的关系与影响](#9-与现有模块的关系与影响)
10. [容易遗漏的问题](#10-容易遗漏的问题)
11. [实施顺序建议](#11-实施顺序建议)
12. [配置与兼容策略](#12-配置与兼容策略)
13. [观测与评估](#13-观测与评估)
14. [开发拆解清单](#14-开发拆解清单)

---

## 1. 背景与结论

### 1.1 背景

当前系统里，记忆相关的 `LLM`（大模型）能力已经不止一处：

- 召回阶段开始让模型参与 `是否检索 / 如何检索 / 最终注入什么`
- 写入阶段已有 `writeback extractor/refiner`
- 治理阶段已有 `maintenance planner` 和 `governance verifier`

问题不在于“有没有模型”，而在于这些模型能力现在分散在多个文件、多个目录、多个名字下面：

- `trigger` 里有一部分
- `writeback` 里有一部分
- `maintenance` 里有一部分
- `governance` 里又有一部分

这样继续演进，会出现三个明显问题：

1. 产品口径不统一。页面上还叫 `writeback llm`，但它实际已经参与召回和治理。
2. 提示词与 schema 分散。后面很难统一治理、统一版本、统一回放。
3. 模块职责模糊。`retrieval-runtime` 里既有“模型判断”，也有“程序执行”，越改越难维护。

### 1.2 结论

更合理的做法是：

> 把“记忆模型”抽成统一的 `memory orchestrator`（记忆编排器）模块，作为整个记忆系统的控制面。

这里的“控制面”指的是：

- 模型决定该怎么查、该注入什么、该写什么、该怎么治理
- 程序负责查库、排序、事务、落库、重试、降级、审计

这意味着：

1. 记忆模型将成为一等模块，不再只是 `writeback` 的附属能力。
2. `storage` 继续保留正式执行权，不让模型直接改数据库。
3. 第一阶段先抽“代码模块”，不急着抽“独立服务”。

---

## 2. 设计目标

### 2.1 目标

1. 统一召回、注入、写入、治理四条链路的模型决策入口。
2. 让记忆模型成为“主要判断者”，程序成为“执行者和兜底者”。
3. 保持 `storage` 的事务、审计、幂等边界不变。
4. 第一阶段尽量不改 `memory-native-agent` 对 `retrieval-runtime` 的 HTTP 契约。
5. 让后续提示词版本化、观测化、评估化。

### 2.2 期望结果

最终产品口径应该变成：

- `retrieval-runtime` 是执行壳
- `storage` 是事实库和执行库
- `memory orchestrator` 是记忆智能层

---

## 3. 非目标

下面这些事情，不是这份方案第一阶段要做的：

1. 不让模型直接访问数据库。
2. 不让模型直接写 `storage` 正式表。
3. 不把 `memory orchestrator` 立刻拆成独立进程。
4. 不要求 `memory-native-agent` 立刻增加新的外部接口。
5. 不在第一阶段做无限多跳检索。

---

## 4. 核心结论

### 4.1 模型与程序的分工

建议固定成下面这条原则：

> 模型负责”判断和编排”，程序负责”执行和兜底”。

具体来说：

- 模型输出结构化计划
- 程序校验计划是否合法
- 程序执行检索、排序、裁剪、落库
- `storage` 负责正式状态变化、版本、审计

### 4.2 为什么不能让模型直接执行

如果让模型直接执行数据库动作，会同时丢掉几样关键能力：

- 幂等
- 事务
- 冲突处理
- 审计回放
- 程序级降级

所以模型再强，也应该停留在”决策层”。

### 4.3 架构边界（重要）

**完整调用链路**：

```
mna 主模型
    ↓ 请求召回/写回
┌─────────────────────────────────────────────────────────┐
│ retrieval-runtime（编排层）                               │
│ - 接收 mna 请求                                           │
│ - 调用 memory orchestrator 获取决策                       │
│ - 调用 storage 执行查询/存储                              │
│ - 返回结果给 mna                                          │
└─────────────────────────────────────────────────────────┘
    ↓ 调用（获取决策）              ↓ 调用（查询/存储）
┌──────────────────────────┐  ┌──────────────────────────┐
│ memory orchestrator      │  │ storage                  │
│ （决策层）                │  │ （存储层）                │
│                          │  │                          │
│ - 什么时候召回            │  │ - 查询记忆                │
│ - 怎么查                 │  │ - 存储记忆                │
│ - 注入什么               │  │ - 事务管理                │
│ - 什么时候写回            │  │ - 冲突处理                │
│ - 写什么                 │  │ - 版本审计                │
│ - 如何治理               │  │                          │
└──────────────────────────┘  └──────────────────────────┘
```

**调用顺序（召回）**：
```
1. mna 主模型 → retrieval-runtime.prepareContext()
2. retrieval-runtime → memory orchestrator.shouldRecall()
   返回：{ needs_recall: true }
3. retrieval-runtime → memory orchestrator.planRecallSearch()
   返回：{ scope, memory_type, query_hint }
4. retrieval-runtime → storage.queryRecords()
   返回：候选记忆列表
5. retrieval-runtime → memory orchestrator.planInjection()
   返回：{ memory_high, memory_summary, memory_records }
6. retrieval-runtime → mna 主模型（注入记忆）
```

**调用顺序（写回）**：
```
1. mna 主模型 → retrieval-runtime.finalizeTurn()
2. retrieval-runtime → memory orchestrator.shouldWriteback()
   返回：{ needs_writeback: true }
3. retrieval-runtime → memory orchestrator.planWriteback()
   返回：{ candidates: [...] }
4. retrieval-runtime 执行去重、入队
5. retrieval-runtime → storage.submitCandidates()
6. storage 执行持久化、冲突处理
```

**关键原则**：
1. **mna 只和 retrieval-runtime 交互**，不直接调用 memory orchestrator 或 storage
2. **retrieval-runtime 是唯一的编排者**，协调 memory orchestrator 和 storage
3. **memory orchestrator 只返回决策**，不执行任何数据操作
4. **storage 只负责数据**，不做业务决策
5. **memory orchestrator 和 storage 之间没有直接调用**

**职责矩阵**：

| 职责 | mna | retrieval-runtime | memory orchestrator | storage |
|-----|-----|-------------------|---------------------|---------|
| 发起召回/写回请求 | ✅ | ❌ | ❌ | ❌ |
| 编排流程 | ❌ | ✅ | ❌ | ❌ |
| 决策：是否召回 | ❌ | ❌ | ✅ | ❌ |
| 决策：怎么查 | ❌ | ❌ | ✅ | ❌ |
| 决策：注入什么 | ❌ | ❌ | ✅ | ❌ |
| 决策：写什么 | ❌ | ❌ | ✅ | ❌ |
| 执行查询 | ❌ | ✅ | ❌ | ✅ |
| 执行存储 | ❌ | ✅ | ❌ | ✅ |
| 去重/入队 | ❌ | ✅ | ❌ | ❌ |
| 事务/冲突处理 | ❌ | ❌ | ❌ | ✅ |

### 4.4 第一阶段为什么不先拆服务

现在更适合先在 `retrieval-runtime` 内部抽模块，而不是直接新开一个服务，原因有三个：

1. 现在链路还在快速变化，先抽服务会把迭代成本拉高。
2. 召回是在线链路，多一跳网络会放大延迟。
3. 现有配置、观测、宿主接入都还围绕 `retrieval-runtime`。

所以第一阶段更稳的方案是：

> 先做 `src/memory-orchestrator/` 领域模块，稳定后再评估是否独立服务化。

---

## 5. 现状问题

### 5.1 命名已经不准确

当前配置和页面里还是 `WRITEBACK_LLM_*`、`writeback llm`，但这套模型已经开始参与：

- 召回规划
- 注入规划
- 写回提取
- 治理决策

继续沿用这个命名，会让产品理解和实现边界越来越乱。

### 5.2 模型能力分散

当前相关实现分散在：

- `src/trigger/llm-recall-judge.ts`
- `src/writeback/llm-extractor.ts`
- `src/writeback/llm-maintenance-planner.ts`
- `src/writeback/llm-governance-verifier.ts`

这会带来：

- 提示词难统一
- schema 难统一
- fallback 难统一
- 指标难统一

### 5.3 召回与写入的口径不一致

现在召回链路和写入链路虽然都用了模型，但模型的职责还没在同一个框架里表达清楚：

- 召回是 `planSearch -> planInjection`
- 写入还是 `extract/refine`
- 治理是 `plan + verify`

从代码上看像三个系统，从产品上看其实是同一个“记忆模型”。

### 5.4 观测粒度不够

目前观测只有：

- trigger
- recall
- injection
- writeback

但如果要真正调试“记忆模型”，至少还应该有：

- search plan
- injection plan
- writeback plan
- governance plan

否则只能看到结果，看不到模型中间是怎么想的。

---

## 6. 总体方案

### 6.1 目标结构

建议在 `services/retrieval-runtime/src/` 下新增统一目录：

```text
src/
  memory-orchestrator/
    index.ts
    types.ts
    schemas.ts
    llm-client.ts
    prompts.ts
    fallback-policy.ts
    intent/
      intent-analyzer.ts
    recall/
      search-planner.ts
      injection-planner.ts
      effectiveness-evaluator.ts
    writeback/
      planner.ts
      quality-assessor.ts
    governance/
      planner.ts
      verifier.ts
      evolution-planner.ts
    relation/
      relation-discoverer.ts
    recommendation/
      proactive-recommender.ts
    observability/
      events.ts
```

### 6.2 设计思路

这个模块**只做决策，不做执行**。

关键原则：
- `memory orchestrator` 不直接调用 `storage`
- `memory orchestrator` 不执行召回流程
- `memory orchestrator` 不执行写入流程
- `memory orchestrator` 只输出结构化计划

调用关系：

```text
host / runtime
  -> retrieval-runtime.prepareContext()
       -> memory orchestrator.planRecallSearch()  # 返回检索计划
       -> retrieval-runtime 执行查询（query read model）
       -> memory orchestrator.planInjection()     # 返回注入计划
       -> retrieval-runtime 构建注入内容
  -> retrieval-runtime.finalizeTurn()
       -> memory orchestrator.planWriteback()     # 返回写入计划
       -> retrieval-runtime 执行去重、入队
       -> storage 执行持久化
```

### 6.3 职责边界（重要）

| 模块 | 职责 | 不负责 |
|-----|------|--------|
| `memory orchestrator` | 决策：是否召回、怎么查、注入什么、写什么、如何治理 | ❌ 不执行数据库操作<br>❌ 不调用 storage<br>❌ 不执行召回流程<br>❌ 不执行写入流程 |
| `retrieval-runtime` | 执行：召回流程、写入流程、编排、调用 orchestrator 获取决策、调用 storage 持久化 | ❌ 不做复杂决策<br>❌ 不直接持久化 |
| `storage` | 存储：持久化、事务、冲突处理、版本管理、审计 | ❌ 不做业务决策<br>❌ 不调用 LLM |

---

## 7. 模块拆分

### 7.1 统一 LLM Client

现在 `callWritebackLlm` 已经是一个通用雏形，但名字还太窄。

建议升级成：

- `memory-orchestrator/llm-client.ts`

职责：

- 统一 OpenAI-compatible / Anthropic 两种协议
- 统一超时和重试
- 统一 JSON schema 校验入口
- 统一健康检查

### 7.2 Intent Analyzer（意图理解）

职责：

- 分析用户输入的任务类型（编码、调试、规划、闲聊）
- 判断是否需要记忆支持
- 预判需要哪类记忆（偏好、任务状态、历史决策）
- 决定召回的紧急程度（立即 vs 延迟）

输入：
- `current_input`：用户当前输入
- `session_context`：会话上下文
- `recent_turns`：最近几轮对话

输出：
```json
{
  “needs_memory”: true,
  “memory_types”: [“fact_preference”, “task_state”],
  “urgency”: “immediate”,
  “confidence”: 0.9,
  “reason”: “用户在继续之前的重构任务，需要加载任务状态”
}
```

### 7.3 Recall Search Planner

职责：

- 判断要不要查记忆
- 决定查哪些 `scope`
- 决定查哪些 `memory_type`
- 决定 `importance_threshold`
- 产出 `query_hint`
- 决定 `candidate_limit`

它的输出不是最终注入内容，而是”检索计划”。

### 7.4 Injection Planner

职责：

- 看检索回来的候选记忆
- 决定要不要注入
- 选哪些记录
- 生成分层注入内容

建议最终统一输出：

- `memory_high`：高优先级硬约束或强连续性信息
- `memory_summary`：供主模型快速读取的浓缩摘要
- `memory_records`：支撑记录

### 7.5 Recall Effectiveness Evaluator（召回效果评估）

职责：

- 分析主模型的输出，判断哪些记忆被实际使用
- 评估记忆的有效性
- 调整记忆的重要度和召回优先级

输入：
- `injected_memories`：已注入的记忆
- `assistant_output`：主模型输出
- `user_feedback`：用户反馈（可选）

输出：
```json
{
  “evaluations”: [
    {
      “record_id”: “...”,
      “was_used”: true,
      “usage_confidence”: 0.85,
      “effectiveness_score”: 0.9,
      “suggested_importance_adjustment”: +1,
      “reason”: “该偏好在代码生成中被明确应用”
    }
  ]
}
```

### 7.6 Writeback Planner

职责：

- 从当前 turn 中提取值得写入的记忆
- 判断是新增、更新、合并建议还是忽略
- 给出作用域和摘要

它的输出是”写入计划”，不是正式写库动作。

### 7.7 Quality Assessor（质量评估）

职责：

- 评估新写入记忆的质量分数
- 预判可能的冲突
- 建议初始优先级和确认状态
- 识别可能的重复

输入：
- `writeback_candidates`：写回候选
- `existing_similar_records`：已有相似记录

输出：
```json
{
  “assessments”: [
    {
      “candidate_id”: “...”,
      “quality_score”: 0.85,
      “confidence”: 0.9,
      “potential_conflicts”: [“record_id_123”],
      “suggested_importance”: 4,
      “suggested_status”: “pending_confirmation”,
      “reason”: “高质量偏好，但与现有记录可能冲突”
    }
  ]
}
```

### 7.8 Governance Planner

职责：

- 读种子记录、关联记录、冲突记录
- 判断该不该 `merge / archive / downgrade / summarize / soft_delete / resolve_conflict`
- 输出结构化治理提案

### 7.9 Governance Verifier

职责：

- 对高影响动作做二次确认
- 避免 planner 直接放行危险动作
- 输出 approve / reject 决策

### 7.10 Memory Evolution Planner（记忆演化）

职责：

- 将多条相关记忆提炼为知识
- 构建结构化知识图谱
- 识别模式和规律
- 生成元记忆（关于记忆的记忆）

触发时机：
- 定期（每周/每月）
- 记忆数量达到阈值
- 用户主动请求

输出：
```json
{
  “evolution_type”: “knowledge_extraction”,
  “source_records”: [“id1”, “id2”, “id3”],
  “extracted_knowledge”: {
    “pattern”: “用户在重构时总是优先考虑可测试性”,
    “confidence”: 0.85,
    “evidence_count”: 5,
    “suggested_scope”: “workspace”
  }
}
```

### 7.11 Relation Discoverer（关联发现）

职责：

- 发现记忆之间的语义关联
- 构建记忆关系图谱
- 识别因果关系、依赖关系、冲突关系
- 建议记忆分组和标签

触发时机：
- 新记忆写入后
- 治理阶段
- 用户主动请求

输出：
```json
{
  “source_record_id”: “...”,
  “relations”: [
    {
      “target_record_id”: “...”,
      “relation_type”: “depends_on”,
      “strength”: 0.8,
      “reason”: “该偏好依赖于项目架构决策”
    }
  ]
}
```

### 7.12 Proactive Recommender（主动推荐）

职责：

- 基于当前上下文，主动推荐可能有用的记忆
- 识别用户可能忘记的重要信息
- 提醒相关的历史决策

触发时机：
- 用户开始新任务时
- 检测到与历史任务相似时
- 用户遇到问题时

输出：
```json
{
  “recommendations”: [
    {
      “record_id”: “...”,
      “relevance_score”: 0.9,
      “reason”: “你上次在类似场景中选择了方案 A”,
      “suggestion”: “是否需要参考之前的决策？”
    }
  ]
}
```

### 7.13 Fallback Policy

职责：

- 统一管理各阶段模型不可用时的程序兜底
- 规定哪些场景可以退回规则，哪些场景应该直接跳过

这层很重要，因为：

- 召回是在线链路
- 写入是后置链路
- 治理是后台链路

三者的降级策略天然不同，不能各自写一套。

---

## 8. 完整链路设计

### 8.1 意图理解与召回触发链路

建议标准流程如下：

```text
mna 主模型
  ↓ POST /v1/runtime/prepare-context
retrieval-runtime.prepareContext
  ↓ 调用
memory orchestrator.analyzeIntent(...)              # 决策：是否需要记忆
  返回：{ needs_memory: true, memory_types: [...] }
  ↓ 如果 needs_memory = true
retrieval-runtime
  ↓ 调用
memory orchestrator.planRecallSearch(...)           # 决策：怎么查
  返回：{ scope, memory_type, query_hint, candidate_limit }
  ↓
retrieval-runtime
  ↓ 调用
storage.queryRecords(...)                           # 查询记忆
  返回：候选记忆列表
  ↓
retrieval-runtime
  ↓ 调用
memory orchestrator.planInjection(...)              # 决策：注入什么
  返回：{ memory_high, memory_summary, memory_records }
  ↓
retrieval-runtime 构建注入内容
  ↓ 返回
mna 主模型（注入记忆到 prompt）
```

关键点：
- **mna 只调用 retrieval-runtime**
- **retrieval-runtime 协调 memory orchestrator 和 storage**
- **memory orchestrator 只返回决策，不访问数据**
- **storage 负责查询，不做决策**

### 8.2 召回链路

建议标准流程如下：

```text
mna → retrieval-runtime.prepareContext()
  → memory orchestrator.shouldRecall()              # 是否召回？
  → memory orchestrator.planRecallSearch()          # 怎么查？
  → storage.queryRecords()                          # 查询数据
  → memory orchestrator.planInjection()             # 注入什么？
  → retrieval-runtime 构建注入内容
  → 返回给 mna
```

### 8.3 注入链路

注入链路不应该只输出一坨平铺文本。

建议统一成三层：

1. `memory_high`
- 硬约束
- 明确偏好
- 当前强相关任务状态

2. `memory_summary`
- 当前最值得主模型先读的一段摘要

3. `memory_records`
- 支撑记录
- 只保留少量可追溯条目

这会比现在只给 `memory_summary + memory_records` 更利于主模型使用。

### 8.3 注入链路

注入链路不应该只输出一坨平铺文本。

建议统一成三层：

1. `memory_high`
- 硬约束
- 明确偏好
- 当前强相关任务状态

2. `memory_summary`
- 当前最值得主模型先读的一段摘要

3. `memory_records`
- 支撑记录
- 只保留少量可追溯条目

这会比现在只给 `memory_summary + memory_records` 更利于主模型使用。

### 8.4 召回效果反馈链路

建议标准流程如下：

```text
mna 主模型完成响应
  ↓
retrieval-runtime.finalizeTurn()
  ↓ 调用
memory orchestrator.evaluateEffectiveness(...)      # 决策：哪些记忆被使用
  返回：{ evaluations: [{ record_id, was_used, effectiveness_score }] }
  ↓
retrieval-runtime 更新记忆重要度
  ↓ 调用
storage.updateRecordImportance(...)                 # 更新数据
```

关键点：
- **评估在 finalizeTurn 后异步执行**
- **memory orchestrator 分析主模型输出，判断记忆使用情况**
- **retrieval-runtime 协调更新流程**
- **storage 执行实际的重要度更新**

### 8.5 写入链路

建议标准流程如下：

```text
mna 主模型
  ↓ POST /v1/runtime/finalize-turn
retrieval-runtime.finalizeTurn()
  ↓ 调用
memory orchestrator.shouldWriteback(...)            # 决策：是否需要写回
  返回：{ needs_writeback: true }
  ↓ 如果 needs_writeback = true
retrieval-runtime
  ↓ 调用
memory orchestrator.planWriteback(...)              # 决策：写什么
  返回：{ candidates: [...] }
  ↓
retrieval-runtime
  ↓ 调用
memory orchestrator.assessQuality(...)              # 决策：质量如何
  返回：{ quality_score, potential_conflicts, suggested_importance }
  ↓
retrieval-runtime 执行去重、入队（outbox）
  ↓ 调用
storage.submitCandidates(...)                       # 存储记忆
  ↓
storage 执行冲突处理、事务、审计
  ↓ 返回
mna 主模型（写回完成）
```

关键点：
- **mna 只调用 retrieval-runtime**
- **memory orchestrator 决策：是否写回、写什么、质量如何**
- **retrieval-runtime 执行去重和入队**
- **storage 执行持久化和冲突处理**

### 8.6 治理链路

建议标准流程如下：

```text
定时任务触发 / 手动触发
  ↓
retrieval-runtime.maintenanceTick()
  ↓ 调用
storage.fetchSeeds()                                # 查询种子记录
storage.fetchRelated()                              # 查询关联记录
storage.fetchConflicts()                            # 查询冲突记录
  ↓
retrieval-runtime
  ↓ 调用
memory orchestrator.planGovernance(...)             # 决策：如何治理
  返回：{ actions: [merge, archive, delete, ...] }
  ↓
retrieval-runtime
  ↓ 调用（高影响动作）
memory orchestrator.verifyGovernance(...)           # 决策：是否批准
  返回：{ decision: 'approve' | 'reject' }
  ↓
retrieval-runtime 构建执行包
  ↓ 调用
storage.executeGovernancePackage(...)               # 执行治理
  ↓
storage 执行状态变化、版本、审计
```

关键点：
- **retrieval-runtime 协调整个治理流程**
- **storage 提供数据查询**
- **memory orchestrator 决策治理动作和复核**
- **storage 执行最终的状态变化**
- **memory orchestrator 不直接改数据库**

### 8.7 记忆关联发现链路

建议标准流程如下：

```text
新记忆写入后 / 治理阶段 / 用户请求
  ↓
retrieval-runtime
  ↓ 调用
storage.fetchRelatedRecords(...)                    # 查询候选记录
  ↓
retrieval-runtime
  ↓ 调用
memory orchestrator.discoverRelations(...)          # 决策：发现关联
  返回：{ relations: [{ target_id, relation_type, strength }] }
  ↓
retrieval-runtime 校验关联
  ↓ 调用
storage.persistRelations(...)                       # 存储关系
```

关键点：
- **异步执行，不阻塞主流程**
- **storage 提供候选记录**
- **memory orchestrator 发现语义关联**
- **storage 持久化关系到 memory_relations 表**

### 8.8 主动推荐链路

建议标准流程如下：

```text
session 开始 / 任务变化检测
  ↓
retrieval-runtime
  ↓ 调用
storage.fetchAvailableMemories(...)                 # 查询可用记忆
  ↓
retrieval-runtime
  ↓ 调用
memory orchestrator.recommend(...)                  # 决策：推荐什么
  返回：{ recommendations: [{ record_id, relevance_score, suggestion }] }
  ↓
retrieval-runtime 过滤和排序
  ↓ 可选
mna 主模型（注入推荐或提示用户）
```

关键点：
- **主动触发，不需要用户请求**
- **storage 提供可用记忆**
- **memory orchestrator 决策推荐内容**
- **retrieval-runtime 决定是否自动注入**

### 8.9 记忆演化链路

建议标准流程如下：

```text
定期触发 / 阈值达到 / 用户请求
  ↓
retrieval-runtime
  ↓ 调用
storage.fetchRelatedRecords(...)                    # 查询源记录
  ↓
retrieval-runtime
  ↓ 调用
memory orchestrator.planEvolution(...)              # 决策：如何演化
  返回：{ evolution_type, extracted_knowledge, consolidation_plan }
  ↓
retrieval-runtime 校验演化计划
  ↓ 调用
storage.persistEvolvedKnowledge(...)                # 存储知识
storage.archiveSourceRecords(...)                   # 归档源记录
```

关键点：
- **后台任务，长期运行**
- **storage 提供源记录**
- **memory orchestrator 提炼知识和模式**
- **storage 执行知识持久化和源记录归档**

---

## 9. 与现有模块的关系与影响

### 9.1 对 retrieval-runtime 的影响

这是影响最大的模块。

需要调整的点：

- `trigger` 不再自己持有零散的模型逻辑，而是调用 `memory orchestrator`
- `writeback` 目录里的模型能力要上提
- `maintenance` / `verifier` 要并到统一模块
- 观测里要新增 plan 级别事件

但它的外部 HTTP 契约，第一阶段可以保持不变。

### 9.2 对 storage 的影响

没有原则性冲突，但边界要明确：

- `storage` 继续保留正式执行权
- `storage` 继续保留版本与审计
- `storage` 不应该变成“模型调用器”

需要注意的一点是：

如果后面治理计划输出更复杂的批量动作，`storage` 可能需要更多“批量执行”接口，而不是让 `retrieval-runtime` 串多个单步接口。

### 9.3 对 visualization 的影响

这是容易被忽略、但一定要改的部分。

当前页面的口径是：

- `writeback llm`
- 写回模型配置
- 写回模型状态

这已经不准确了。

后面应该升级成：

- `memory llm` 或 `memory orchestrator model`
- 统一配置页
- 统一状态探针
- 统一观测面板

至少要展示：

- recall search planner 状态
- injection planner 状态
- writeback planner 状态
- governance planner 状态

### 9.4 对 memory-native-agent 的影响

第一阶段可以不改主契约。

也就是说：

- `mna` 仍然只调 `prepare-context / finalize-turn`
- 记忆模型模块仍然隐藏在 `retrieval-runtime` 内部

后面如果要开放更细的调试视图，再考虑扩 `mna` 的事件流。

### 9.5 对现有文档和术语的影响

现有文档里，凡是把模型写成“写回模型”的地方，后面都要逐步统一。

最典型的冲突有两个：

1. 命名冲突
- 代码里叫 `WRITEBACK_LLM`
- 实际已经不是只做写回

2. 口径冲突
- 文档里把召回、写回、治理写成三套
- 产品上其实希望它们共享同一个记忆模型

---

## 10. 容易遗漏的问题

这部分是这次方案里最容易漏掉，但后面一定会遇到的问题。

### 10.1 配置迁移

直接使用新的配置名称：

- `MEMORY_LLM_BASE_URL`
- `MEMORY_LLM_MODEL`
- `MEMORY_LLM_API_KEY`
- `MEMORY_LLM_PROTOCOL`
- `MEMORY_LLM_TIMEOUT_MS`

不兼容旧的 `WRITEBACK_LLM_*` 配置，需要用户手动迁移。

### 10.2 提示词与 schema 版本

如果提示词、schema、fallback 逻辑不做版本号，后面很难排查：

- 这次为什么多查了
- 为什么没注入
- 为什么治理提案变了

建议每个计划都带：

- `planner_version`
- `prompt_version`
- `schema_version`

### 10.3 延迟与超时控制

召回链路是在线链路，需要合理的超时设置。

建议配置：

- **单次 LLM 调用超时**: 15 秒（可配置 `MEMORY_LLM_TIMEOUT_MS`）
- **整个召回链路超时**: 30 秒（可配置）
- **超时后降级**: 降级到规则模式或跳过，不影响主流程
- **降级触发条件**: 基于失败率（连续失败 ≥ 3 次，或最近 10 次失败率 > 50%），而非单次延迟

性能参考值（非硬性限制）：

- search planner (LLM): 1-3 秒
- query read model: 100-500ms
- injection planner (LLM): 1-3 秒
- 召回链路总延迟 P95: < 8 秒

调用频率：

- **不限制调用次数**，由业务需求决定
- 仅防止异常情况（同一 turn_id 重复调用 > 3 次时告警）
- 监控调用模式，异常时告警而非拒绝

多跳检索：

- 默认单次检索规划
- 默认单次注入规划
- 如需支持二次检索，必须明确最大步数（建议 ≤ 2 跳）

### 10.4 候选裁剪

模型不是看得越多越准。

如果把太多候选记忆喂进去，会出现：

- 延迟变高
- 成本变高
- 干扰项变多

所以程序侧仍然需要做第一轮候选控制。

### 10.5 敏感信息边界

记忆记录里可能包含：

- token
- 路径
- 报错原文
- 用户隐私

后面要明确：

- 哪些字段可以送模型
- 哪些字段必须脱敏
- 哪些字段只能保留在程序侧

### 10.6 回放能力

如果没有计划级别的回放数据，后面你只能看到“为什么结果错了”，却看不到“模型当时到底收到了什么”。

建议至少回放：

- 输入上下文摘要
- 候选记忆摘要
- 结构化计划输出
- 执行结果

### 10.7 影子模式

后面做迁移时，最好支持：

- 新模块只产出计划，不实际执行
- 新旧链路并跑，对比差异

没有影子模式，切换风险会偏高。

### 10.8 统一依赖状态

依赖桶名称直接改为 `memory_llm`，不保留 `writeback_llm` 兼容。

需要同步修改：

- `retrieval-runtime` 的依赖健康检查
- `visualization` 的状态展示
- `memory-native-agent` 的依赖查询
- 监控和告警配置

### 10.9 评估体系

后面不能只看“触发率”。

至少要分开看：

- 搜索计划触发率
- 搜索后命中率
- 注入采纳率
- 误注入率
- 写入有效率
- 治理正确率

### 10.10 配置是否需要单模型还是多模型

从产品角度，用户可能会想：

- 一个模型同时做召回、写入、治理
- 或者召回用快模型，治理用慢模型

建议第一阶段先统一一套 `memory llm` 配置，后面再支持能力级覆盖。

---

## 11. 实施顺序建议

建议按下面顺序推进，而不是一步拆成独立服务。

### 阶段 1：模块收口

目标：

- 在 `retrieval-runtime` 内新建 `memory-orchestrator`
- 先把召回双阶段逻辑收进去
- 统一 LLM client 和 prompt 管理

### 阶段 2：写入迁移

目标：

- 把 `llm-extractor` / `refine` 迁到 `memory-orchestrator/writeback`
- `writeback-engine` 只保留规则候选与执行逻辑

### 阶段 3：治理迁移

目标：

- 把 `maintenance planner` / `governance verifier` 收到 `memory-orchestrator/governance`
- `maintenance-worker` 只保留调度与执行

### 阶段 4：配置和 UI 升级

目标：

- 使用 `MEMORY_LLM_*` 替换 `WRITEBACK_LLM_*`（不兼容旧配置）
- 页面把 `writeback llm` 改成 `memory llm`
- 面板补上 plan 级别状态
- 更新文档和迁移指南

### 阶段 5：是否独立服务化

只有在下面条件都满足时，再评估独立服务：

- 模块边界已经稳定
- 计划 schema 已稳定
- 在线召回链路延迟可接受
- 需要多语言或多运行时共享

### 阶段 2：写入迁移

目标：

- 把 `llm-extractor` / `refine` 迁到 `memory-orchestrator/writeback`
- `writeback-engine` 只保留规则候选与执行逻辑

### 阶段 3：治理迁移

目标：

- 把 `maintenance planner` / `governance verifier` 收到 `memory-orchestrator/governance`
- `maintenance-worker` 只保留调度与执行

### 阶段 4：配置和 UI 升级

目标：

- 使用 `MEMORY_LLM_*` 替换 `WRITEBACK_LLM_*`（不兼容旧配置）
- 页面把 `writeback llm` 改成 `memory llm`
- 面板补上 plan 级别状态
- 更新文档和迁移指南

### 阶段 5：是否独立服务化

只有在下面条件都满足时，再评估独立服务：

- 模块边界已经稳定
- 计划 schema 已稳定
- 在线召回链路延迟可接受
- 需要多语言或多运行时共享

---

## 12. 配置策略

### 12.1 新配置名

直接使用新的配置名称：

- `MEMORY_LLM_BASE_URL`
- `MEMORY_LLM_MODEL`
- `MEMORY_LLM_API_KEY`
- `MEMORY_LLM_PROTOCOL`
- `MEMORY_LLM_TIMEOUT_MS`（默认 15000，即 15 秒）
- `MEMORY_LLM_EFFORT`
- `MEMORY_LLM_MAX_TOKENS`

### 12.2 迁移策略

**不兼容旧配置**，需要用户手动迁移：

1. 将 `WRITEBACK_LLM_*` 改为 `MEMORY_LLM_*`
2. 更新 `visualization` 和 `memory-native-agent` 的配置引用
3. 更新依赖状态桶名称：`writeback_llm` → `memory_llm`

迁移检查清单：

- [x] 环境变量配置文件（.env）
- [ ] 部署配置（docker-compose.yml / k8s manifests）
- [ ] 监控和告警配置
- [x] 文档和 README

### 12.3 降级配置

- `MEMORY_LLM_FALLBACK_ENABLED`（默认 true）：LLM 不可用时是否降级到规则模式
- `MEMORY_LLM_DEGRADED_THRESHOLD`（默认 0.5）：失败率超过此值时触发降级
- `MEMORY_LLM_RECOVERY_INTERVAL_MS`（默认 300000，即 5 分钟）：降级后尝试恢复的间隔

---

## 13. 观测与评估

### 13.1 建议新增的运行时事件

除了现在已有的 `trigger / recall / injection / writeback`，建议新增：

- `memory_search_plan`
- `memory_injection_plan`
- `memory_writeback_plan`
- `memory_governance_plan`

### 13.2 每条 plan 至少记录

- 输入摘要
- 输出计划
- 使用的 prompt/schema 版本
- 模型耗时
- 是否降级
- 最终执行结果

### 13.3 评估指标

建议至少增加：

- `search_plan_trigger_rate`
- `search_plan_override_rate`
- `injection_accept_rate`
- `injection_empty_after_search_rate`
- `writeback_plan_keep_rate`
- `governance_plan_execute_success_rate`
- `fallback_rate_by_stage`

---

## 14. 开发拆解清单

### 14.1 模块级清单

| 编号 | 状态 | 工作项 | 优先级 |
|---|---|---|---|
| M1 | 已完成 | 新建 `src/memory-orchestrator/` 目录 | P0 |
| M2 | 已完成 | 已抽统一 `llm-client.ts`、`prompts.ts`，运行时装配改为优先使用新目录下 planner 实现 | P0 |
| M3 | 部分完成 | 召回搜索规划已通过 orchestrator 入口接线，具体实现仍在旧目录 | P0 |
| M4 | 部分完成 | 注入规划已通过 orchestrator 入口接线，具体实现仍在旧目录 | P0 |
| M5 | 已完成 | `writeback-engine` 已改走统一 planner 接口，具体 writeback planner 实现已迁到新目录，旧入口保留兼容包装 | P0 |
| M6 | 已完成 | 治理 worker 已改走统一 planner / verifier 接口，具体治理实现已迁到新目录，旧入口保留兼容包装 | P0 |
| M7 | 已完成 | 抽统一 `fallback-policy.ts` | P0 |
| M8 | 部分完成 | 已抽统一类型定义与核心 planner schema，旧目录已改为兼容包装，召回旧入口与剩余 schema 迁移仍待继续 | P0 |
| M9 | 待开发 | 抽 `writeback/quality-assessor.ts` | P1 |
| M10 | 待开发 | 抽 `recall/effectiveness-evaluator.ts` | P1 |
| M11 | 待开发 | 抽 `intent/intent-analyzer.ts` | P2 |
| M12 | 待开发 | 抽 `relation/relation-discoverer.ts` | P2 |
| M13 | 待开发 | 抽 `recommendation/proactive-recommender.ts` | P3 |
| M14 | 待开发 | 抽 `governance/evolution-planner.ts` | P3 |

### 14.2 运行时接线清单

| 编号 | 状态 | 工作项 |
|---|---|---|
| R1 | 部分完成 | 召回链路已具备模型先规划检索、再规划注入的雏形 |
| R2 | 部分完成 | `trigger-engine` 已通过 orchestrator recall search 接口调用模型规划，基线判定仍保留在本地 |
| R3 | 部分完成 | `runtime-service` 已改为依赖 orchestrator 入口获取 recall / writeback 能力，细节仍待继续下沉 |
| R4 | 已完成 | `writeback-engine` 已迁移到统一 planner 接口 |
| R5 | 已完成 | `maintenance-worker` 已迁移到统一 governance planner 接口 |

### 14.3 配置与 UI 清单

| 编号 | 状态 | 工作项 |
|---|---|---|
| C1 | 已完成 | `retrieval-runtime` 已引入 `MEMORY_LLM_*` 配置并替换 `WRITEBACK_LLM_*`（不兼容） |
| C2 | 已完成 | `retrieval-runtime` 依赖状态桶已从 `writeback_llm` 更新为 `memory_llm` |
| C3 | 已完成 | 页面配置项已统一改口径为 `memory llm` |
| C4 | 已完成 | 页面状态探针已从 `writeback llm` 升级为统一记忆模型状态 |
| C5 | 已完成 | 运行时已新增 `memory_search_plan / memory_injection_plan / memory_writeback_plan / memory_governance_plan` 观测记录，`visualization` 运行轨迹页已补 plan 级调试视图 |
| C6 | 已完成 | 已补配置迁移文档与批量替换脚本，支持将 `WRITEBACK_LLM_*` 迁移到 `MEMORY_LLM_*` |

### 14.4 测试清单

| 编号 | 状态 | 工作项 |
|---|---|---|
| T1 | 待开发 | 召回链路影子模式对比测试 |
| T2 | 部分完成 | 已补 orchestrator 工厂、共享 LLM client 与核心 plan schema 单测，旧目录兼容包装联测仍待继续 |
| T3 | 部分完成 | maintenance worker 与 runtime service 联测已覆盖统一 governance 接口接线，旧入口兼容层独立联测仍待继续 |
| T4 | 待开发 | 降级和恢复机制测试 |
| T5 | 已完成 | 已补可视化配置、健康检查与状态展示联动测试 |
| T6 | 待开发 | 并发和竞态条件测试 |

---

## 15. 模型介入的完整视图

### 15.1 记忆生命周期与模型介入点

```
用户交互
    ↓
┌─────────────────────────────────────────────────────────┐
│ 1. 意图理解阶段                                           │
│    模型：Intent Analyzer                                  │
│    职责：理解任务类型，判断是否需要记忆                    │
│    优先级：P2                                             │
└─────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────┐
│ 2. 召回阶段                                               │
│    模型：Search Planner + Injection Planner              │
│    职责：决定查询策略和注入内容                            │
│    优先级：P0（核心链路）                                  │
└─────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────┐
│ 3. 使用阶段                                               │
│    模型：Recall Effectiveness Evaluator                  │
│    职责：评估记忆有效性，动态调整优先级                    │
│    优先级：P1（闭环优化）                                  │
└─────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────┐
│ 4. 写回阶段                                               │
│    模型：Writeback Planner + Quality Assessor            │
│    职责：决定写什么，评估质量                              │
│    优先级：P0 + P1                                        │
└─────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────┐
│ 5. 治理阶段                                               │
│    模型：Governance Planner + Verifier                   │
│    职责：决定如何整理，复核高影响动作                      │
│    优先级：P0（核心链路）                                  │
└─────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────┐
│ 6. 关联与演化阶段                                         │
│    模型：Relation Discoverer + Evolution Planner         │
│    职责：构建关系图谱，提炼知识                            │
│    优先级：P2 + P3（增强能力）                            │
└─────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────┐
│ 7. 主动推荐阶段                                           │
│    模型：Proactive Recommender                           │
│    职责：主动推荐相关记忆                                  │
│    优先级：P3（高级功能）                                  │
└─────────────────────────────────────────────────────────┘
```

### 15.2 核心链路（P0 - 必须有）

这些是记忆系统的核心能力，必须在第一阶段实现：

| 模块 | 职责 | 输入 | 输出 |
|-----|------|------|------|
| Search Planner | 决定查询策略 | 用户输入、会话上下文 | 检索计划（scope、memory_type、query_hint） |
| Injection Planner | 决定注入内容 | 候选记忆、用户输入 | 分层注入内容（memory_high、memory_summary、memory_records） |
| Writeback Planner | 决定写入内容 | 当前对话、历史记忆 | 写入计划（新增、更新、合并） |
| Governance Planner | 决定治理动作 | 种子记录、关联记录、冲突 | 治理提案（merge、archive、delete 等） |
| Governance Verifier | 复核高影响动作 | 治理提案 | approve / reject |

**实施时间**：第一阶段（1-2 个月）

### 15.3 闭环优化链路（P1 - 显著提升体验）

这些模块形成闭环反馈，显著提升记忆质量：

| 模块 | 职责 | 价值 | 触发时机 |
|-----|------|------|---------|
| Quality Assessor | 评估写入质量 | 防止低质量记忆污染 | 写回前 |
| Recall Effectiveness Evaluator | 评估召回效果 | 动态优化记忆优先级 | 主模型响应后 |

**实施时间**：第二阶段（1 个月）

**关键指标**：
- 低质量记忆拦截率 > 80%
- 记忆有效性评估准确率 > 85%
- 记忆优先级调整后召回命中率提升 > 20%

### 15.4 增强能力链路（P2 - 增强能力）

这些模块提供更智能的记忆管理：

| 模块 | 职责 | 价值 | 触发时机 |
|-----|------|------|---------|
| Intent Analyzer | 理解用户意图 | 更精准的召回触发 | 每次对话前 |
| Relation Discoverer | 发现记忆关联 | 构建知识图谱 | 写入后、治理时 |

**实施时间**：第三阶段（1-2 个月）

**关键指标**：
- 意图识别准确率 > 90%
- 关联发现准确率 > 80%
- 基于关联的召回命中率提升 > 15%

### 15.5 高级功能链路（P3 - 高级功能）

这些模块提供差异化的用户体验：

| 模块 | 职责 | 价值 | 触发时机 |
|-----|------|------|---------|
| Proactive Recommender | 主动推荐记忆 | 提醒用户可能忘记的信息 | 任务开始、问题检测 |
| Memory Evolution Planner | 提炼知识 | 长期记忆压缩和知识提取 | 定期、阈值触发 |

**实施时间**：第四阶段（2-3 个月）

**关键指标**：
- 推荐采纳率 > 30%
- 知识提取准确率 > 85%
- 用户满意度提升 > 25%

### 15.6 实施路线图

```
阶段 1（1-2 个月）：核心链路 P0
├─ 模块收口
├─ Search Planner + Injection Planner
├─ Writeback Planner
└─ Governance Planner + Verifier

阶段 2（1 个月）：闭环优化 P1
├─ Quality Assessor
└─ Recall Effectiveness Evaluator

阶段 3（1-2 个月）：增强能力 P2
├─ Intent Analyzer
└─ Relation Discoverer

阶段 4（2-3 个月）：高级功能 P3
├─ Proactive Recommender
└─ Memory Evolution Planner

阶段 5（评估后决定）：独立服务化
└─ 根据模块稳定性和性能需求决定
```

### 15.7 各阶段交付标准

**阶段 1 交付标准**：
- [ ] 召回、写入、治理链路全部使用模型决策
- [ ] 降级策略完善，LLM 不可用时有兜底
- [ ] 观测面板展示 plan 级别数据
- [x] 配置迁移完成（MEMORY_LLM_*）
- [ ] 核心指标：召回准确率 > 80%，治理正确率 > 85%

**阶段 2 交付标准**：
- [ ] 写入质量评估上线
- [ ] 召回效果反馈闭环建立
- [ ] 记忆优先级动态调整生效
- [ ] 核心指标：低质量拦截率 > 80%，优先级调整后命中率提升 > 20%

**阶段 3 交付标准**：
- [ ] 意图理解准确率 > 90%
- [ ] 记忆关系图谱构建完成
- [ ] 基于关联的召回上线
- [ ] 核心指标：关联发现准确率 > 80%

**阶段 4 交付标准**：
- [ ] 主动推荐功能上线
- [ ] 知识提取功能上线
- [ ] 用户满意度调研
- [ ] 核心指标：推荐采纳率 > 30%，知识提取准确率 > 85%

### 15.8 风险与依赖

**技术风险**：
- 模型调用延迟累积（缓解：并发调用、缓存）
- 模型输出质量不稳定（缓解：多次采样、置信度阈值）
- 成本快速增长（缓解：成本监控、用户配额）

**依赖关系**：
- P1 依赖 P0 的基础设施
- P2 依赖 P1 的质量评估能力
- P3 依赖 P2 的关联图谱

**资源需求**：
- 阶段 1：2-3 人，1-2 个月
- 阶段 2：1-2 人，1 个月
- 阶段 3：2 人，1-2 个月
- 阶段 4：2-3 人，2-3 个月

---

## 最终建议

这次方案最重要的不是”再多加几个 planner”，而是把下面这条产品口径正式固定下来：

> 记忆系统里，模型是统一的决策层；程序是统一的执行层；`storage` 是统一的正式状态层。

只要这条边界稳定，后面无论是加 `memory_high`、加多轮检索、加软删除治理，还是把模块再拆成独立服务，都会顺很多。

---

## 附录 E：新增模块技术规格

### E.1 Intent Analyzer 规格

**输入 Schema**：
```typescript
interface IntentAnalyzerInput {
  current_input: string;
  session_context: {
    session_id: string;
    recent_turns: Array<{
      user_input: string;
      assistant_output: string;
    }>;
    workspace_id: string;
  };
}
```

**输出 Schema**：
```typescript
interface IntentAnalyzerOutput {
  needs_memory: boolean;
  memory_types: Array<'fact_preference' | 'task_state' | 'episodic'>;
  urgency: 'immediate' | 'deferred' | 'optional';
  confidence: number; // 0-1
  reason: string;
  suggested_scopes?: Array<'user' | 'workspace' | 'task' | 'session'>;
}
```

**Prompt 要点**：
- 识别任务类型（编码、调试、规划、闲聊、问答）
- 判断是否需要历史上下文
- 区分新任务 vs 延续任务

**降级策略**：
- 失败时默认 `needs_memory: true, urgency: 'immediate'`（保守策略）

### E.2 Quality Assessor 规格

**输入 Schema**：
```typescript
interface QualityAssessorInput {
  writeback_candidates: Array<WritebackCandidate>;
  existing_similar_records: Array<MemoryRecord>;
  turn_context: {
    user_input: string;
    assistant_output: string;
  };
}
```

**输出 Schema**：
```typescript
interface QualityAssessment {
  candidate_id: string;
  quality_score: number; // 0-1
  confidence: number; // 0-1
  potential_conflicts: string[]; // record_ids
  suggested_importance: number; // 1-5
  suggested_status: 'active' | 'pending_confirmation';
  issues: Array<{
    type: 'duplicate' | 'low_quality' | 'conflict' | 'vague';
    severity: 'high' | 'medium' | 'low';
    description: string;
  }>;
  reason: string;
}
```

**评估维度**：
- 信息完整性（是否包含足够上下文）
- 表达清晰度（是否易于理解）
- 重复性（与现有记忆的重复程度）
- 冲突性（是否与现有记忆冲突）
- 时效性（是否是临时信息）

**质量阈值**：
- quality_score < 0.6：拒绝写入
- quality_score 0.6-0.8：标记为 pending_confirmation
- quality_score > 0.8：直接写入

### E.3 Recall Effectiveness Evaluator 规格

**输入 Schema**：
```typescript
interface EffectivenessEvaluatorInput {
  injected_memories: Array<{
    record_id: string;
    summary: string;
    importance: number;
  }>;
  assistant_output: string;
  user_feedback?: {
    rating?: number; // 1-5
    comment?: string;
  };
}
```

**输出 Schema**：
```typescript
interface EffectivenessEvaluation {
  record_id: string;
  was_used: boolean;
  usage_confidence: number; // 0-1
  effectiveness_score: number; // 0-1
  suggested_importance_adjustment: number; // -2 to +2
  usage_evidence?: string;
  reason: string;
}
```

**评估方法**：
- 文本匹配：检查记忆内容是否出现在输出中
- 语义相似度：检查输出是否体现了记忆的语义
- 用户反馈：结合用户评分

**调整策略**：
- 连续 3 次未使用：importance -1
- 连续 3 次有效使用：importance +1
- importance 调整范围：[1, 5]

### E.4 Relation Discoverer 规格

**输入 Schema**：
```typescript
interface RelationDiscovererInput {
  source_record: MemoryRecord;
  candidate_records: Array<MemoryRecord>;
  context?: {
    workspace_id: string;
    user_id: string;
  };
}
```

**输出 Schema**：
```typescript
interface RelationDiscovery {
  source_record_id: string;
  relations: Array<{
    target_record_id: string;
    relation_type: 'depends_on' | 'conflicts_with' | 'extends' | 'supersedes' | 'related_to';
    strength: number; // 0-1
    bidirectional: boolean;
    reason: string;
  }>;
}
```

**关系类型定义**：
- `depends_on`：源记忆依赖目标记忆（如偏好依赖架构决策）
- `conflicts_with`：源记忆与目标记忆冲突
- `extends`：源记忆扩展目标记忆
- `supersedes`：源记忆替代目标记忆
- `related_to`：一般性关联

**存储方式**：
- 在 storage 新增 `memory_relations` 表
- 支持双向查询

### E.5 Proactive Recommender 规格

**输入 Schema**：
```typescript
interface ProactiveRecommenderInput {
  current_context: {
    user_input: string;
    session_context: SessionContext;
    detected_task_type?: string;
  };
  available_memories: Array<MemoryRecord>;
}
```

**输出 Schema**：
```typescript
interface ProactiveRecommendation {
  recommendations: Array<{
    record_id: string;
    relevance_score: number; // 0-1
    trigger_reason: 'task_similarity' | 'forgotten_context' | 'related_decision' | 'conflict_warning';
    suggestion: string; // 面向用户的建议文本
    auto_inject: boolean; // 是否自动注入
  }>;
}
```

**触发场景**：
- 任务相似度 > 0.8：推荐历史相似任务的记忆
- 检测到问题关键词：推荐相关解决方案
- 检测到决策点：推荐历史决策

**推荐策略**：
- relevance_score > 0.9：自动注入
- relevance_score 0.7-0.9：提示用户
- relevance_score < 0.7：不推荐

### E.6 Memory Evolution Planner 规格

**输入 Schema**：
```typescript
interface EvolutionPlannerInput {
  source_records: Array<MemoryRecord>;
  time_window: {
    start: Date;
    end: Date;
  };
  evolution_type: 'knowledge_extraction' | 'pattern_discovery' | 'summarization';
}
```

**输出 Schema**：
```typescript
interface EvolutionPlan {
  evolution_type: string;
  source_records: string[]; // record_ids
  extracted_knowledge?: {
    pattern: string;
    confidence: number;
    evidence_count: number;
    suggested_scope: 'user' | 'workspace';
    suggested_importance: number;
  };
  consolidation_plan?: {
    new_summary: string;
    records_to_archive: string[];
  };
}
```

**演化类型**：
- `knowledge_extraction`：从多条记忆中提取模式和规律
- `pattern_discovery`：发现用户行为模式
- `summarization`：将多条相关记忆合并为摘要

**触发条件**：
- 同类记忆 > 10 条
- 时间跨度 > 1 个月
- 用户主动请求

---

## 附录 F：观测指标完整清单

### F.1 核心链路指标（P0）

**召回链路**：
- `search_plan_trigger_rate`：触发检索规划的比例
- `search_plan_latency_p95`：检索规划延迟 P95
- `injection_plan_latency_p95`：注入规划延迟 P95
- `injection_accept_rate`：注入采纳率（实际注入 / 规划注入）
- `injection_empty_after_search_rate`：检索后空注入率
- `recall_hit_rate`：召回命中率（注入记忆被使用的比例）

**写入链路**：
- `writeback_plan_trigger_rate`：触发写回规划的比例
- `writeback_plan_latency_p95`：写回规划延迟 P95
- `writeback_plan_keep_rate`：写回保留率（实际写入 / 规划写入）
- `writeback_quality_score_avg`：写入质量平均分

**治理链路**：
- `governance_plan_trigger_rate`：触发治理规划的比例
- `governance_plan_latency_p95`：治理规划延迟 P95
- `governance_plan_execute_success_rate`：治理执行成功率
- `governance_verifier_reject_rate`：复核拒绝率

### F.2 质量指标（P1）

- `quality_assessment_block_rate`：质量评估拦截率
- `quality_score_distribution`：质量分数分布
- `effectiveness_evaluation_accuracy`：效果评估准确率
- `importance_adjustment_rate`：重要度调整率
- `memory_usage_rate`：记忆使用率（被使用的记忆 / 总记忆）

### F.3 增强能力指标（P2）

- `intent_recognition_accuracy`：意图识别准确率
- `relation_discovery_rate`：关联发现率
- `relation_accuracy`：关联准确率
- `graph_coverage`：图谱覆盖率（有关联的记忆 / 总记忆）

### F.4 高级功能指标（P3）

- `recommendation_trigger_rate`：推荐触发率
- `recommendation_accept_rate`：推荐采纳率
- `evolution_trigger_rate`：演化触发率
- `knowledge_extraction_accuracy`：知识提取准确率

### F.5 系统指标

- `memory_orchestrator_total_latency_p95`：总延迟 P95
- `memory_orchestrator_error_rate`：错误率
- `fallback_rate_by_stage`：各阶段降级率
- `llm_call_count_by_module`：各模块 LLM 调用量
- `token_consumption_by_module`：各模块 token 消耗

---

## 附录 A：并发与竞态控制

### A.1 召回链路并发

**问题**：同一 session 多个 turn 并发调用 prepareContext

**方案**：
- 使用 session_id + turn_id 作为幂等键
- 相同 session 的 planner 调用串行化（内存队列）
- 不同 session 可并发

### A.2 治理链路并发

**问题**：maintenance worker 和手动触发同时操作同一 workspace

**方案**：
- workspace 级别的内存锁（Map<workspace_id, Promise>）
- 执行包提交时检查 idempotency_key
- 冲突时后者返回 409 Conflict

### A.3 状态竞态

**问题**：planner 生成提案后，目标记录状态已变化

**方案**：
- storage 执行前校验记录状态（乐观锁）
- 状态不匹配时标记为 cancelled
- 记录 expected_status 和 actual_status 用于调试

---

## 附录 B：错误处理与重试

### B.1 错误分类

| 错误类型 | 重试策略 | 降级行为 |
|---------|---------|---------|
| LLM 超时 (> 15s) | 立即重试 1 次 | 跳过本次 planner 调用 |
| LLM 限流 (429) | 指数退避，最多 3 次 | 标记 degraded，延迟下次调用 |
| Schema 校验失败 | 不重试 | 记录错误，使用兜底逻辑 |
| Storage 网络错误 | 指数退避，最多 5 次 | 写入失败队列，异步重试 |
| Storage 业务错误 (4xx) | 不重试 | 记录错误，标记 failed |

### B.2 降级触发条件

- 连续失败 ≥ 3 次
- 最近 10 次调用失败率 > 50%
- 单次调用超时 > 15 秒

### B.3 降级恢复

- 每 5 分钟尝试恢复一次（可配置 `MEMORY_LLM_RECOVERY_INTERVAL_MS`）
- 成功 3 次后恢复正常
- 避免因一次成功就立即恢复（防止抖动）

---

## 附录 C：安全与权限

### C.1 敏感信息过滤

**输入过滤**：
- 记录中的 API key、token、密码等敏感字段不送入 planner
- 文件路径脱敏（只保留相对路径）
- 环境变量值不送入 planner

**输出过滤**：
- planner 输出的 reason_text 不能包含敏感信息
- 自动检测并替换常见敏感模式（正则匹配）

### C.2 权限控制

**workspace 隔离**：
- planner 只能访问当前 workspace 的记录
- 跨 workspace 的 merge/summarize 自动拒绝

**用户隔离**：
- user scope 记录只能被该用户的 session 访问
- governance 不能跨用户合并记录

---

## 附录 D：监控与告警

### D.1 告警规则

| 指标 | 告警阈值 | 严重级别 | 响应动作 |
|-----|---------|---------|---------|
| search_plan_trigger_rate | < 20% | P2 | 检查 baseline phase 逻辑 |
| injection_empty_after_search_rate | > 30% | P2 | 检查 injection planner prompt |
| fallback_rate_by_stage | > 50% | P1 | 检查 LLM 服务健康度 |
| governance_plan_execute_success_rate | < 80% | P2 | 检查 storage 服务 |
| memory_orchestrator_p95_latency | > 10s | P1 | 检查 LLM 响应时间 |
| memory_orchestrator_error_rate | > 10% | P1 | 触发降级开关 |

### D.2 仪表盘

**实时监控**：
- 各 planner 的调用量、成功率、延迟（P50/P95/P99）
- 降级状态和恢复次数
- 并发队列长度

**趋势分析**：
- 按天/周/月的指标趋势
- 成本趋势（token 消耗）
- 质量趋势（注入采纳率、治理正确率）

**异常检测**：
- 自动标记异常时间段
- 关联分析（延迟突增 + 错误率上升）
