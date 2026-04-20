# Retrieval Runtime 改进提案

> 基于 `services/retrieval-runtime` 模块全量代码审查，提出以下改进方案。
> 按优先级排列：P0（必须修复）、P1（强烈建议）、P2（建议改进）。

## 状态更新（2026-04-20）

| 编号 | 状态 | 说明 |
|------|------|------|
| #1 | 已完成 | `estimateTokens` 已按 CJK / 非 CJK 分段估算，并补充中英文差异测试 |
| #2 | 已完成 | 规则提取已扩展偏好模式、收紧 commitment 匹配，并过滤无意义 tool summary |
| #3 | 已完成 | `recencyScore` 已按 `memory_type` 使用差异化半衰期 |
| #4 | 已完成 | 语义触发已改为“样本分布感知阈值 + 固定阈值下限” |
| #5 | 已完成 | 已新增请求级 finalize 幂等持久化记录，跨实例可复用响应 |
| #6 | 已完成 | Injection 同类型内已优先使用 `rerank_score` 排序 |
| #7 | 已完成 | Writeback LLM prompt 已增加负面示例和边界说明 |

本次对应验证：
1. `npm run check`
2. `npm test`

---

## 目录

1. [P0: Token 估算对中文严重低估](#1-p0-token-估算对中文严重低估)
2. [P0: 规则提取覆盖面不足且噪音高](#2-p0-规则提取覆盖面不足且噪音高)
3. [P1: Recency 衰减未区分记忆类型](#3-p1-recency-衰减未区分记忆类型)
4. [P1: 语义触发阈值仍与 Embedding 模型耦合](#4-p1-语义触发阈值仍与-embedding-模型耦合)
5. [P2: 幂等性缓存不跨实例](#5-p2-幂等性缓存不跨实例)
6. [P2: Injection 排序丢失语义排名信息](#6-p2-injection-排序丢失语义排名信息)
7. [P2: Writeback LLM Prompt 缺少负面示例](#7-p2-writeback-llm-prompt-缺少负面示例)

---

## 1. P0: Token 估算对中文严重低估

### 现状

`src/shared/utils.ts:5-7`:

```typescript
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}
```

固定使用 `length / 4`，这是基于英文的粗略近似（1 token ≈ 4 字符）。

### 问题

当前实现把所有文本都按英文经验值 `1 token ≈ 4 字符` 处理，这对中文通常会明显偏低。对于纯中文或中英混合文本，同样长度下的真实 token 消耗往往会高于当前估算值。

这意味着 `INJECTION_TOKEN_BUDGET` 的预算控制在中文场景下可能失真：系统认为还没超预算，真实上下文消耗却可能已经接近甚至超过预期上限。**低估幅度是否达到“严重超预算”，需要用目标模型的 tokenizer 实测确认。**

### 建议方案

按字符类型分段估算：

```typescript
export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;

  let cjkChars = 0;
  let otherChars = 0;

  for (const char of trimmed) {
    const code = char.codePointAt(0) ?? 0;
    // CJK Unified Ideographs + common CJK ranges
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjkChars++;
    } else {
      otherChars++;
    }
  }

  // CJK: ~1.5 tokens/char; Latin: ~0.25 tokens/char
  return Math.max(1, Math.ceil(cjkChars * 1.5 + otherChars / 4));
}
```

### 影响范围

- `src/injection/injection-engine.ts` — `build()` 方法中的 budget 控制
- 所有使用 `estimateTokens` 的调用点

### 验证方法

用 `tiktoken` 或目标模型的 tokenizer 对一组中英文混合测试集做基准对比，量化当前估算误差，再确认改进后误差是否能稳定收敛到可接受范围（例如 ±20% 以内）。

---

## 2. P0: 规则提取覆盖面不足且噪音高

### 现状

`src/writeback/writeback-engine.ts:135-239` 的规则提取有两个对称问题：

**低召回率** — 只匹配行尾（`$`）的少数固定模式：

```typescript
const preferenceMatch = normalizedUser.match(
  /(?:我一般|我喜欢|我偏好|prefer)\s*[:：]?\s*(.+)$/i
);
```

实际用户表达偏好的方式远不止这几种："I usually...", "My convention is...", "I always...", "一直用的是...", "习惯..." 都不会被捕获。

**高噪音** — commitment 检测 (`writeback-engine.ts:200`) 过于宽松：

```typescript
if (normalizedAssistant.includes("我会") || normalizedAssistant.toLowerCase().includes("i will")) {
```

AI 助手输出中 "I will" / "我会" 是极其常见的礼貌表达（"I will help you with that"），绝大多数不构成值得记忆的 commitment。

### 建议方案

#### 2a. 收紧规则，提高精确率

规则路径定位为**高精确率兜底**（precision > recall），只在 LLM 不可用时启用：

```typescript
// Commitment: 要求更具体的上下文
const commitmentPatterns = [
  /(?:我会|i will)\s+(?:在|after|before|每次|always|每天).{8,}/i,
  /(?:承诺|commit to|保证)\s*[:：]?\s*(.+)/i,
];
```

#### 2b. 偏好检测扩展模式

```typescript
const PREFERENCE_PATTERNS = [
  /(?:我一般|我喜欢|我偏好|我习惯|一直用的是|prefer|i usually|i always|my convention is|my default is)\s*[:：]?\s*(.+)/i,
];
```

注意去掉行尾锚点 `$`，改用 `.+` 贪婪匹配后做长度限制。

#### 2c. Tool summary 增加内容判断

当前仅检查 `length > 24`，应增加实质性内容判断：

```typescript
// 过滤纯状态性 tool 输出（如 "exit code: 0", "success"）
const TRIVIAL_TOOL_PATTERNS = /^(exit code|success|ok|done|completed|finished)\b/i;
if (normalizedTools.length > 24 && !TRIVIAL_TOOL_PATTERNS.test(normalizedTools)) {
  // ...
}
```

### 影响范围

- `src/writeback/writeback-engine.ts` — `extractByRules()` 方法

---

## 3. P1: Recency 衰减未区分记忆类型

### 现状

`src/query/query-engine.ts:17-21`:

```typescript
function recencyScore(updatedAt: string): number {
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  const days = ageMs / (1000 * 60 * 60 * 24);
  return clamp(1 - days / 30, 0, 1);
}
```

30 天线性衰减后归零，对所有记忆类型一视同仁。

### 问题

- **fact_preference**（"用户偏好 dark mode"、"使用 4 空格缩进"）是长期稳定的，30 天后归零不合理
- **task_state**（"当前在做 auth 模块重构"）时效性强，30 天衰减甚至偏慢
- **episodic**（"上次部署遇到了 OOM"）衰减合理但可以更平滑

### 建议方案

按 memory_type 参数化衰减曲线：

```typescript
const RECENCY_HALF_LIFE_DAYS: Record<MemoryType, number> = {
  fact_preference: 180,  // 半年半衰期
  task_state: 14,        // 两周半衰期
  episodic: 30,          // 一个月半衰期
};

function recencyScore(updatedAt: string, memoryType: MemoryType): number {
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  const days = ageMs / (1000 * 60 * 60 * 24);
  const halfLife = RECENCY_HALF_LIFE_DAYS[memoryType];
  // 指数衰减: score = 2^(-days/halfLife)
  return Math.pow(2, -days / halfLife);
}
```

指数衰减比线性衰减更平滑，且不会突然归零。

### 影响范围

- `src/query/query-engine.ts` — `recencyScore()` 和排名计算
- 需要将 `candidate.memory_type` 传入排名函数

---

## 4. P1: 语义触发阈值仍与 Embedding 模型耦合

### 现状

语义触发并非直接拿原始输入比阈值——`semanticFallbackScore()`（`trigger-engine.ts:199-289`）会先从 read_model 取 8 条候选样本，对每条计算输入 embedding 与样本 embedding 的余弦相似度，取最高分作为 `best`。这个 `best` 再和固定阈值 `SEMANTIC_TRIGGER_THRESHOLD`（默认 0.72）做比较：

```typescript
// trigger-engine.ts:170
if (semanticScore.score >= this.config.SEMANTIC_TRIGGER_THRESHOLD) {
```

即：触发判定是**数据驱动的**（依赖实际候选库内容），但最终的门槛仍是一个固定绝对值。

### 问题

虽然取 top-8 样本的 best score 已经提供了一定的自适应能力（候选库为空时 score=0 自然不触发），但 0.72 这个阈值仍然隐式假设了特定 embedding 模型的相似度分布：

- OpenAI `text-embedding-3-small`: 相关对相似度通常在 0.6-0.85
- `all-MiniLM-L6-v2`: 相关对相似度通常在 0.4-0.7
- `bge-large-zh`: 相关对相似度通常在 0.65-0.9

切换 embedding 模型后，0.72 可能偏高（漏召回）或偏低（误触发），需要手动重新调优。

### 建议方案

**短期**：在 config 中增加注释说明 0.72 依赖的 embedding 模型，并在启动日志中输出 `EMBEDDING_MODEL` + `SEMANTIC_TRIGGER_THRESHOLD` 的组合，便于运维排查。

**中期**：将固定阈值改为相对于样本分布的百分位判断。当前已经在 `semanticFallbackScore` 中拿到了 8 条样本的相似度，可以利用这个分布做自适应：

```typescript
// 现有 best score 逻辑之后，增加分布感知
const scores = samples
  .map(s => cosineSimilarity(queryEmbedding, s.summary_embedding))
  .filter(s => s > 0)
  .sort((a, b) => b - a);

// 如果 best score 显著高于样本中位数（如 > median + 0.15），视为有意义的语义匹配
const median = scores[Math.floor(scores.length / 2)] ?? 0;
const dynamicThreshold = Math.max(median + 0.15, this.config.SEMANTIC_TRIGGER_THRESHOLD * 0.8);
```

这样阈值会随实际 embedding 分布自动调整，同时保留固定阈值作为下限兜底。

### 影响范围

- `src/trigger/trigger-engine.ts` — `semanticFallbackScore()` 方法
- `src/config.ts` — 可选：增加 `SEMANTIC_TRIGGER_CALIBRATION_ENABLED` 配置

---

## 5. P2: 幂等性缓存不跨实例

### 现状

`src/writeback/finalize-idempotency-cache.ts` 是纯内存 LRU 缓存，TTL 5 分钟，最多 500 条。

### 问题

- 服务重启后缓存丢失，重复请求会被重新处理
- 多实例部署时，同一请求打到不同实例会重复处理
- writeback outbox 的 `idempotency_key` 提供了候选级持久化去重，但整个 finalize 流程（包括 LLM 调用）仍会重复执行

这里还有一个关键现实约束：当前 `finalize` 缓存键是**请求级**（`session_id + turn_id + current_input` 哈希），而 outbox 的 `idempotency_key` 是**候选级**（按 candidate 内容生成）。两者不是同一个键空间，不能直接靠查询 outbox 重建整次 finalize 的响应。

### 建议方案

**更稳妥的低成本方案**：增加请求级持久化幂等记录，再决定是否进入提取和提交流程：

```typescript
// 在 finalize 开始前，先查请求级 finalize 结果表 / 幂等表
async get(key: string): Promise<FinalizeTurnResponse | null> {
  // 1. 先查内存缓存
  const memCached = this.memoryCache.get(key);
  if (memCached) return memCached;

  // 2. 查请求级持久化结果
  const existing = await this.repository.findFinalizeResultByKey(key);
  if (existing) {
    this.memoryCache.set(key, existing);
    return existing;
  }

  return null;
}
```

请求完成后，再把完整 `FinalizeTurnResponse` 或其最小必要字段持久化。这样即使重启或多实例，只要请求级幂等记录还在，就能在 LLM 提取和即时 writeback 之前直接短路返回。

如果坚持复用现有 outbox 表，也需要先补一层“请求级键 <-> 候选级键集合”的映射，否则无法可靠还原整次 finalize 响应。

### 影响范围

- `src/writeback/finalize-idempotency-cache.ts`
- `src/runtime-service.ts` — `finalizeTurn()` 方法
- `src/observability/runtime-repository.ts` — 需要新增请求级幂等结果读写接口
- 可选：新增一张请求级 finalize 幂等表，而不是直接复用 outbox 表

---

## 6. P2: Injection 排序丢失语义排名信息

### 现状

`src/injection/injection-engine.ts:33-43` 按 `TYPE_PRIORITY → importance → confidence` 排序，**完全忽略了 QueryEngine 的 `rerank_score`**。

```typescript
const sortedRecords = [...packet.records].sort((left, right) => {
  const leftPriority = TYPE_PRIORITY.get(left.memory_type) ?? 99;
  const rightPriority = TYPE_PRIORITY.get(right.memory_type) ?? 99;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  if (left.importance !== right.importance) return right.importance - left.importance;
  return right.confidence - left.confidence;
});
```

### 问题

QueryEngine 花了大量计算（embedding + 多维加权）得出 `rerank_score`，但 InjectionEngine 在预算裁剪时完全重新排序。一条语义高度相关但 importance=3 的记忆可能被 importance=5 但语义无关的记忆挤掉。

### 建议方案

在类型优先级分组内，使用 `rerank_score` 作为二级排序：

```typescript
const sortedRecords = [...packet.records].sort((left, right) => {
  const leftPriority = TYPE_PRIORITY.get(left.memory_type) ?? 99;
  const rightPriority = TYPE_PRIORITY.get(right.memory_type) ?? 99;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  // 同类型内按 rerank_score 排序，保留语义排名
  return (right.rerank_score ?? 0) - (left.rerank_score ?? 0);
});
```

### 影响范围

- `src/injection/injection-engine.ts` — `build()` 方法
- `src/shared/types.ts` — `MemoryPacket.records` 中的 `CandidateMemory` 已有 `rerank_score` 字段，无需改类型

---

## 7. P2: Writeback LLM Prompt 缺少负面示例

### 现状

`src/writeback/llm-extractor.ts:33-52` 的 system prompt 只给了正面指导规则：

```
Rules:
- Extract only durable, high-value items.
- Ignore raw transcript fragments, temporary chatter, and speculative content.
...
```

### 问题

没有负面示例（"不要提取什么"），LLM 容易过度提取：
- "好的，我来帮你看看" → 被提取为 episodic commitment
- "这个文件在 src/auth/ 目录下" → 被提取为 fact_preference
- 纯确认性回复（"已完成"、"没问题"）→ 被提取为 episodic

### 建议方案

在 prompt 中增加负面示例和边界说明：

```typescript
const WRITEBACK_EXTRACTION_SYSTEM_PROMPT = `
You extract durable memory candidates from one agent turn.
Return strict JSON only with shape: {"candidates":[...]}.

... (existing fields and rules) ...

DO NOT extract:
- Polite acknowledgments: "好的", "没问题", "I'll help you with that"
- File paths or code locations mentioned in passing (these are in the codebase, not memory)
- Debugging steps or temporary investigation notes
- Restatements of the user's question

Examples of good extractions:
- User: "我习惯用 4 空格缩进" → fact_preference, scope=user, "偏好 4 空格缩进"
- Assistant completed a migration → task_state, scope=task, "数据库迁移已完成，待验证"

Examples of bad extractions (DO NOT extract these):
- Assistant: "好的，我来帮你修复这个 bug" → NOT a durable memory
- Assistant: "文件在 src/auth/middleware.ts" → NOT worth remembering (derivable from code)
- User: "看看这个报错" → NOT a preference or fact
`.trim();
```

### 影响范围

- `src/writeback/llm-extractor.ts` — `WRITEBACK_EXTRACTION_SYSTEM_PROMPT` 常量

---

## 实施建议

### 阶段一（1-2 天）— 快速修复

| 编号 | 改动 | 预估工作量 |
|------|------|-----------|
| #1 | Token 估算支持中文 | 0.5 天 |
| #2 | 收紧规则提取 + 扩展偏好模式 | 0.5 天 |

### 阶段二（3-5 天）— 质量提升

| 编号 | 改动 | 预估工作量 |
|------|------|-----------|
| #3 | Recency 按类型差异化衰减 | 0.5 天 |
| #6 | Injection 排序保留 rerank_score | 0.5 天 |
| #7 | LLM prompt 增加负面示例 | 0.5 天 |

### 阶段三（1 周+）— 系统性改进

| 编号 | 改动 | 预估工作量 |
|------|------|-----------|
| #4 | 语义阈值分布感知校准 | 2-3 天 |
| #5 | 幂等缓存持久化 | 1-2 天 |

### 验证策略

每个改动应配套：
1. **单元测试** — 覆盖改动的边界条件
2. **A/B 对比** — 用 `observe/metrics` 端点对比改动前后的 trigger_rate、recall_hit_rate、injection_rate
3. **中英文混合测试集** — 特别是 #1 和 #2，需要覆盖纯中文、纯英文、中英混合三种场景
