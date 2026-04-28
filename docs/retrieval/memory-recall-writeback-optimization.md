# 记忆召回与写入机制优化方案

## 概述

本文档针对 memory-native-agent 召回（Recall）与写入（Writeback）机制中存在的 9 个不合理设计，分析问题根因并给出具体优化方案。

## 当前落地状态

最终状态：9 项优化已全部完成。

| 优化项 | 状态 | 对应提交 | 补充测试与验证 |
|---|---|---|---|
| 优化一：收紧 finalizeTurn 触发条件 | 已完成 | `5017997` | 补充 MNA runner / turn-loop 测试 |
| 优化二：合并 Intent Analyzer 与 Search Planner | 已完成 | `8052f82` | 补充 runtime service 与 orchestrator normalization 测试 |
| 优化三：正则提取覆盖度提升 | 已完成 | `b189ba1` | 补充 writeback quality assessor 测试 |
| 优化四：输入重叠检查对称化 | 已完成 | `b189ba1` | 补充低重叠 LLM 候选过滤测试 |
| 优化五：范围分类优先级调整 | 已完成 | `b189ba1` | 补充项目默认规则进入 workspace scope 的测试 |
| 优化六：写回失败自适应降级 | 已完成 | `56feda8` | 补充 MNA runner / turn-loop 测试 |
| 优化七：Recall Effectiveness 覆盖工具调用 | 已完成 | `05ea4c2` | 补充 runtime service 与 orchestrator modules 测试 |
| 优化八：用 Embedding 交叉引用替代 LLM Refine | 已完成 | `11d85a0` | 补充规则与 LLM 交叉确认合并测试，并确认不再调用 refine |
| 优化九：Resident Memory 刷新死循环修复 | 已完成 | `5017997` | 补充 MNA runner / turn-loop 测试 |

最终验证：

- `services/retrieval-runtime`: `npm test -- tests/writeback-quality-assessor.test.ts tests/runtime-service.test.ts tests/memory-orchestrator-normalization.test.ts tests/remediation.test.ts`
- `services/retrieval-runtime`: `npm run check`

---

## 优化一：收紧 finalizeTurn 触发条件

### 问题

当前 `shouldFinalizeTurn` 判定过于宽泛——只要用户输入和模型输出都非空就触发写入管线：

```typescript
// writeback-decider.ts
export function shouldFinalizeTurn(userInput: string, assistantOutput: string): boolean {
  return userInput.trim().length > 0 && assistantOutput.trim().length > 0;
}
```

"好的"+"收到"这种无信息量的对话也会走完整的规则提取 + LLM 提取 + 精炼 + 质量评估链条。虽然下游过滤会拦截，但 HTTP 往返和正则匹配的开销已经产生了，且浪费 Memory LLM 的 token 预算。

### 方案

在 MNA 侧增加一层轻量级信号检测，只对有信息密度的对话才发起 finalizeTurn：

```typescript
// writeback-decider.ts

const MIN_INPUT_SIGNAL_LENGTH = 8;
const MIN_OUTPUT_SIGNAL_LENGTH = 20;

const WRITE_SIGNAL_PATTERNS = [
  // 偏好与习惯
  /默认|偏好|习惯|风格|prefer|usually|always|convention/i,
  // 任务与进展
  /任务|todo|下一步|完成|修复|实现|添加|删除|修改/i,
  // 承诺与决策
  /我会|i will|承诺|决定|计划|plan to/i,
  // 事实陈述
  /记住|remember|记一下|已确认/i,
  // 工具操作（有副作用的工具结果）
  /created|deleted|modified|installed|deployed/i,
];

export function shouldFinalizeTurn(userInput: string, assistantOutput: string): boolean {
  const normalizedInput = userInput.trim();
  const normalizedOutput = assistantOutput.trim();

  if (normalizedInput.length === 0 || normalizedOutput.length === 0) {
    return false;
  }

  // 双方都太短 → 跳过
  if (normalizedInput.length < MIN_INPUT_SIGNAL_LENGTH
      && normalizedOutput.length < MIN_OUTPUT_SIGNAL_LENGTH) {
    return false;
  }

  // 至少有一方包含可写入的信号
  const combined = `${normalizedInput} ${normalizedOutput}`;
  return WRITE_SIGNAL_PATTERNS.some((pattern) => pattern.test(combined));
}
```

### 效果

- 减少 60%+ 的无意义 HTTP 调用
- 节省 Memory LLM token 预算
- 不影响召回——有信息密度的对话不会被误判

---

## 优化二：合并 Intent Analyzer 与 Search Planner

### 问题

`before_response` 阶段触发两次独立的 Memory LLM 调用：

1. **Intent Analyzer**：分析用户意图是否需要记忆（`needs_memory`、`memory_types`、`scopes`、`confidence`）
2. **Search Planner**：决定是否搜索（`should_search`、`requested_types`、`query_hint`、`candidate_limit`）

两者输出高度重叠，本质回答同一个问题："这个输入需不需要记忆？需要哪类记忆？"

### 方案

合并为一个 `RecallPlanner`，单次 LLM 调用输出统一结构：

```typescript
// retrieval-runtime/src/memory-orchestrator/types.ts

interface UnifiedRecallPlan {
  // 意图分析
  needs_memory: boolean;
  intent_confidence: number;
  intent_reason: string;

  // 搜索规划
  should_search: boolean;
  search_reason: string;
  requested_scopes: ScopeType[];
  requested_memory_types: MemoryType[];
  importance_threshold: number;
  query_hint?: string;
  candidate_limit?: number;
}
```

对应 prompt 合并为一个 `MEMORY_RECALL_UNIFIED_SYSTEM_PROMPT`，在原 search planner prompt 基础上增加 intent 维度的输出字段。schema 同步更新。

`TriggerEngine.decide()` 简化为：

```
before_response → Unified Recall Planner（1 次 LLM）
  → needs_memory=false + should_search=false → 跳过
  → needs_memory=false + should_search=true → 仅搜索（用户可能无意中用到了记忆中内容的变体）
  → needs_memory=true → 正常搜索 + 注入
```

### 效果

- 每个 turn 减少 1 次 Memory LLM 调用
- 消除两个规划器之间可能的信息不一致
- 降低 Memory LLM 延迟对 Agent 响应时间的影响

---

## 优化三：正则提取覆盖度提升

### 问题

当前规则提取的 3 个核心正则可覆盖度极窄：

- **偏好**：只匹配 `我喜欢|我偏好|我习惯|prefer|i usually...`，遗漏了大量常见表达。"以后都用 Rust 吧"、"从现在开始按 Airbnb 规范来"、"不用 tab，用空格"——全部漏提取。
- **任务状态**：只有一条正则 `/下一步|todo|plan|任务状态/`，无法处理"这个模块已经改完了，还剩 API 层"这类自然表达的进展更新。
- **事件**：只看承诺词 `/我会|i will/`，"明天开始迁移到新的认证方案"同样是一件事，但"明天开始"不在模式内。

### 方案

#### 偏好层扩展

```typescript
const PREFERENCE_PATTERNS_V2 = [
  // 原有
  /(?:我一般|我喜欢|我偏好|我习惯|一直用的是|prefer|i usually|i always|my convention is|my default is)\s*[:：]?\s*(.+)/i,
  // 新增：时间锚定的偏好声明
  /(?:以后|今后|后续|从现在开始|from now on|going forward)\s*(?:都|都给我|统一|全部)?\s*(.+)/i,
  // 新增：否定偏好
  /(?:不要|不用|别|别给我|禁止|no more|stop using|don'?t use)\s+(.+?)(?:[。.!]|$)/i,
  // 新增：工具/规范声明
  /(?:代码风格|编码规范|格式化|lint)(?:\s*(?:按|按照|使用|遵循|跟|走))\s*(.+)/i,
  // 新增：对比选择
  /(?:用|使用|改用)\s*(.+)而不是\s*(.+)/i,
];

const NEGATION_INDICATORS = /^(不要|不用|别|别给我|禁止|no more|stop|don'?t)/i;

function extractStablePreferenceV2(text: string): string | null {
  for (const pattern of PREFERENCE_PATTERNS_V2) {
    const match = text.match(pattern);
    if (!match) continue;

    const extracted = match[1] ?? match[2];
    if (!extracted || extracted.trim().length < 3) continue;

    const cleaned = cleanupPreferenceSummary(extracted);
    if (hasMinimumContent(cleaned)) return cleaned;
  }

  // 兜底：检查是否包含稳定性指示词 + 足够长度
  const hasStabilityHint = STABLE_PREFERENCE_HINTS_V2.some(
    (hint) => text.includes(hint)
  );
  if (hasStabilityHint && text.length >= 15) {
    return cleanupPreferenceSummary(text);
  }

  return null;
}
```

#### 任务状态层扩展

```typescript
const TASK_STATE_PATTERNS_V2 = [
  // 原有
  /(?:下一步|todo|plan|任务状态)\s*[:：]?\s*(.+)$/i,
  // 新增：进展标记
  /(?:已(?:经|完成|改完|实现|修复|处理)|搞定了|做好了|finished|completed|done with)\s*(.+?)(?:[。.!]|$|还剩|还要|接下来)/i,
  // 新增：剩余工作
  /(?:还剩|还要|接下来|仍需|remaining|left to do|pending)\s*[:：]?\s*(.+)/i,
  // 新增：阻塞/依赖
  /(?:卡在|阻塞|等待|依赖|blocked by|waiting on|depends on)\s*[:：]?\s*(.+)/i,
  // 新增：状态变更
  /(?:把|将|状态)?(?:从|由)\s*(\S+)\s*(?:改为|改成|变为|更新为|标记为)\s*(\S+)/i,
];
```

#### 事件层扩展

```typescript
const EVENT_PATTERNS_V2 = [
  // 原有
  /(?:我会|i will)\s+(?:在|after|before|每次|always|每天).{8,}/i,
  // 新增：时间锚定
  /(?:明天|下周|这周|今天晚点|tonight|tomorrow|next week)\s*(?:开始|要|准备|打算)\s*(.+)/i,
  // 新增：触发式
  /(?:当|一旦|whenever|as soon as)\s*(.+?)\s*(?:就|则|我会|会)\s*(.+)/i,
  // 新增：计划输出
  /(?:计划|打算|schedule|roadmap)\s*[:：]?\s*(.+)/i,
];
```

### 效果

- 偏好提取召回率从当前估计 ~30% 提升到 ~80%
- 任务状态提取从单维度 → 四维度（进展/剩余/阻塞/变更）
- 事件提取从仅承诺 → 覆盖时间锚定、触发式和计划输出

---

## 优化四：输入重叠检查对称化

### 问题

输入重叠检查只对 LLM 候选生效，规则候选完全跳过：

```typescript
// writeback-engine.ts
const extractionMethod = candidate.source.extraction_method;
if (extractionMethod === "llm") {
  // 只有 LLM 候选走这个检查
  const hasInputOverlap = hasSufficientInputOverlap(...);
  if (!hasInputOverlap) { return false; }
}
```

这导致：正则误提取的噪声畅通无阻，LLM 合理概括但措辞不同的候选却被拦截。

### 方案

改为所有候选统一走重叠检查，但阈值按提取方法区分：

```typescript
const OVERLAP_THRESHOLD_BY_METHOD: Record<string, number> = {
  rules: 0.5,   // 规则候选阈值高（更严格），因为正则抓原始文本更字面匹配
  llm: 0.35,    // LLM 候选阈值低（更宽松），因为 LLM 可能做了合理的语义概括
};

function checkInputOverlap(
  candidate: WriteBackCandidate,
  input: FinalizeTurnInput,
  config: AppConfig,
): boolean {
  const threshold = OVERLAP_THRESHOLD_BY_METHOD[
    candidate.source.extraction_method
  ] ?? config.WRITEBACK_INPUT_OVERLAP_THRESHOLD;

  if (threshold <= 0) return true;

  const sourceText = [
    input.current_input,
    input.assistant_output,
    input.tool_results_summary ?? "",
  ].join(" ");

  return hasSufficientInputOverlap(candidate.summary, sourceText, threshold);
}
```

### 效果

- 规则提取的噪声被过滤，减少存储中的垃圾记忆
- LLM 合理概括的候选不再被误杀
- 两种提取方式在同一质量框架下公平对待

---

## 优化五：范围分类优先级调整

### 问题

范围分类中，用户偏好关键词的优先级高于项目约束：

```typescript
// 当前顺序：userHints 检查先于 workspaceHints
if (userHints.some(h => text.includes(h))) return "user";
if (workspaceHints.some(h => text.includes(h))) return "workspace";
```

"这个项目默认用 4 空格缩进"——"默认"命中 userHints → 归为用户记忆，跨项目时被错误注入。

### 方案

改为按信号权重综合评分，而非简单的先来先得：

```typescript
interface ScopeSignal {
  scope: "user" | "workspace" | "task" | "session";
  weight: number; // 0-1
}

function resolveScopeBySignals(
  draft: CandidateDraft,
  input: FinalizeTurnInput,
): { scope: ScopeType; reason: string } {
  const signals: ScopeSignal[] = [];

  // 1. 显式目标指示词（最高权重）
  const explicitMentions = extractExplicitScopeMentions(draft);

  // 2. 内容语义分析
  const userScore = scoreUserSignal(draft);
  const workspaceScore = scoreWorkspaceSignal(draft);
  const taskScore = scoreTaskSignal(draft, input);
  const sessionScore = scoreSessionSignal(draft);

  signals.push(
    { scope: "user", weight: userScore },
    { scope: "workspace", weight: workspaceScore },
    { scope: "task", weight: taskScore },
    { scope: "session", weight: sessionScore },
  );

  // 3. 候选类型的默认倾向
  const typeBias = getTypeScopeBias(draft.candidate_type);
  applyTypeBias(signals, typeBias);

  // 4. 上下文修正：存在项目相关词时降低 user 权重
  if (hasWorkspaceContext(draft)) {
    downgradeScope(signals, "user", 0.3);
  }

  // 5. 特殊规则：task scope 需要 task_id
  const best = pickBestScope(signals, input);

  return {
    scope: best.scope,
    reason: buildScopeReason(signals, best),
  };
}

// 关键修正："这个项目/仓库 + 偏好词" → workspace 优先
function hasWorkspaceContext(draft: CandidateDraft): boolean {
  const text = [draft.summary, draft.write_reason].join(" ");
  return /这个项目|这个仓库|这个 repo|在当前项目|项目里|仓库里/i.test(text);
}

function downgradeScope(
  signals: ScopeSignal[],
  scope: "user",
  amount: number,
) {
  const signal = signals.find((s) => s.scope === scope);
  if (signal) signal.weight = Math.max(0, signal.weight - amount);
}
```

### 效果

- "这个项目默认用 4 空格" → workspace，"我习惯用 4 空格" → user
- scope 归属更准确，跨项目的记忆泄露大幅减少
- 所有信号被综合评估而非单点决策

---

## 优化六：finalizeTurn 连续失败的自适应降级

### 问题

finalizeTurn 是 fire-and-forget，连续失败 Agent 无感知：

```typescript
void this.deps.memoryClient.finalizeTurn({...})
  .catch((error) => {
    // 只记录错误，不改变行为
    this.deps.io.emitError("turn", createMemoryWritebackIncompleteError(...), turnId);
  });
```

如果存储层故障持续 1 小时，记忆完全停止积累，但用户界面没有任何系统性提示。

### 方案

在 AgentRunner 中增加写入健康度追踪，连续失败达阈值后执行自适应策略：

```typescript
// agent-runner.ts 新增

interface WritebackHealth {
  consecutiveFailures: number;
  lastFailureReason: MemoryWritebackIncompleteReason | null;
  lastSuccessAt: number | null;
  degradedSince: number | null;
}

const MAX_CONSECUTIVE_FAILURES_BEFORE_WARN = 3;
const MAX_CONSECUTIVE_FAILURES_BEFORE_SKIP = 8;
const SKIP_COOLDOWN_MS = 5 * 60 * 1000; // 5 分钟后重试

class AgentRunner {
  private writebackHealth: WritebackHealth = {
    consecutiveFailures: 0,
    lastFailureReason: null,
    lastSuccessAt: null,
    degradedSince: null,
  };

  private shouldAttemptWriteback(): boolean {
    const { consecutiveFailures, degradedSince } = this.writebackHealth;

    // 连续失败超过阈值 → 暂停尝试，避免持续消耗资源
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES_BEFORE_SKIP) {
      if (degradedSince && Date.now() - degradedSince < SKIP_COOLDOWN_MS) {
        return false;
      }
      // cooldown 到期，允许重试
      return true;
    }

    return true;
  }

  // finalizeTurn 调用处修改为：
  if (shouldFinalizeTurn(userInput, assistantOutput)
      && this.shouldAttemptWriteback()) {
    // ... 现有逻辑
    // 在 then 中:
    this.writebackHealth.consecutiveFailures = 0;
    this.writebackHealth.lastSuccessAt = Date.now();
    this.writebackHealth.degradedSince = null;

    // 在 catch 中:
    this.writebackHealth.consecutiveFailures += 1;
    this.writebackHealth.lastFailureReason = classifyMemoryWritebackError(error);
    if (this.writebackHealth.degradedSince === null) {
      this.writebackHealth.degradedSince = Date.now();
    }

    if (this.writebackHealth.consecutiveFailures === MAX_CONSECUTIVE_FAILURES_BEFORE_WARN) {
      this.deps.io.emitError("session",
        Object.assign(new Error("记忆写入连续失败，系统将继续运行但新记忆可能无法保存"), {
          code: "memory_writeback_degraded",
          reason: this.writebackHealth.lastFailureReason,
        }));
    }

    if (this.writebackHealth.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES_BEFORE_SKIP) {
      this.deps.io.emitError("session",
        Object.assign(new Error("记忆写入已暂停，将在 5 分钟后重试"), {
          code: "memory_writeback_paused",
        }));
    }
  }
}
```

### 效果

- 用户能感知到记忆系统异常（3 次失败后告警）
- 8 次连续失败后自动暂停写入，避免持续消耗资源
- 5 分钟 cooldown 后自动恢复重试
- 一次成功即重置计数器

---

## 优化七：召回有效性评估覆盖工具调用

### 问题

召回有效性评估只看文本输出：

```typescript
// runtime-service.ts
evaluator.evaluate({
  injected_memories: context.memories,
  assistant_output: input.assistant_output,  // 只看文本
});
```

模型收到"用户偏好 tab 缩进"后，可能体现为 shell/fwrite 调用中使用 tab，文本回复完全不提缩进的事。当前评估会判定记忆未被使用，错误下调 importance。

### 方案

评估输入增加工具调用摘要：

```typescript
// runtime-service.ts finalizeTurn 调用处

const toolBehaviorSummary = buildToolBehaviorSummary(input.tool_results_summary);

evaluator.evaluate({
  injected_memories: context.memories,
  assistant_output: input.assistant_output,
  // 新增：工具行为摘要，用于判断记忆是否通过工具调用体现
  tool_behavior_summary: toolBehaviorSummary,
});

// 新增工具函数
function buildToolBehaviorSummary(
  toolResultsSummary?: string,
): string | undefined {
  if (!toolResultsSummary) return undefined;

  // 提取工具调用中的关键行为模式
  // 例如：fs-write 中的缩进选择、shell-exec 中的参数偏好等
  const behaviorIndicators = [
    // 代码风格在工具调用中的体现
    /(?:space|tab|indent|format)\s*[:=]\s*\S+/gi,
    // 语言偏好通过工具输出体现
    /(?:language|lang|locale)\s*[:=]\s*\S+/gi,
    // 框架/库选择
    /(?:import|require|from)\s+['"]\S+['"]/gi,
  ];

  const matches: string[] = [];
  for (const pattern of behaviorIndicators) {
    const found = toolResultsSummary.match(pattern);
    if (found) matches.push(...found);
  }

  return matches.length > 0
    ? `工具行为摘要: ${matches.join("; ")}`
    : undefined;
}
```

同步更新评估 prompt，增加工具行为维度的判断指引：

```
## 评估维度
1. 文本体现：assistant_output 是否明确引用了记忆内容
2. 工具体现：tool_behavior_summary 中是否体现了记忆中的偏好或约束
   - 例如：记忆指示"tab 缩进"→ 工具调用中使用了 \t 字符
3. 隐式体现：assistant 的行为模式是否与记忆内容一致
```

### 效果

- 通过工具行为体现的记忆使用不再被遗漏
- importance 调整更准确，不会错误地下调实用记忆
- 特别有利于编程类场景（缩进、命名、框架选择等偏好通过工具体现）

---

## 优化八：用 Embedding 交叉引用替代 LLM Refine

### 问题

当前 writeback 管线有 3 次 LLM 调用——LLM Extract、LLM Refine、Quality Assess。其中 Refine 步骤的职责有二：

1. 质量判断："这条规则候选是靠谱的还是噪声？"
2. 交叉去重："规则候选 #2 和 #5 说的是同一件事吗？"

问题在于——质量判断和 Quality Assess 重叠，交叉去重是相似度计算，不需要 LLM。LLM Refine 作为中间环节增加了认知模式冲突（生成型 Extract vs 评判型 Refine）、单点故障、以及不必要的 LLM 开销。

### 方案

**删掉 LLM Refine，用 Embedding 交叉引用替代，流程变为：**

```
规则提取 → LLM Extract（带 rule_hints） → Embedding 交叉引用 → Quality Assess（承担更多）
```

#### 第一步：LLM Extract 接收规则结果作为 hints

```typescript
// planner.ts — extract 方法扩展

async extract(input: {
  current_input: string;
  assistant_output: string;
  tool_results_summary?: string;
  task_id?: string;
  rule_hints?: Array<{           // 新增：规则已捕获的内容
    summary: string;
    candidate_type: string;
    scope: string;
    importance: number;
    confidence: number;
  }>;
}): Promise<WritebackExtractionResult> {
  const text = await callMemoryLlm(
    this.config,
    MEMORY_WRITEBACK_EXTRACTION_UPDATED_PROMPT,
    {
      current_input: input.current_input,
      assistant_output: input.assistant_output,
      tool_results_summary: input.tool_results_summary ?? "",
      task_id: input.task_id ?? null,
      rule_hints: input.rule_hints ?? [],
    },
    this.config.MEMORY_LLM_MAX_TOKENS ?? 600,
  );
  const parsed = memoryWritebackExtractionSchema.safeParse(parseMemoryLlmJsonPayload(text));
  if (!parsed.success) {
    throw new Error("memory llm response did not match extraction schema");
  }
  return {
    candidates: parsed.data.candidates.slice(0, this.config.WRITEBACK_MAX_CANDIDATES),
  };
}
```

Extract prompt 新增 hint 相关指引（在原 prompt 末尾追加）：

```
rule_hints lists candidates already captured by rule-based extraction.
These are provided for your awareness only:
- DO NOT re-extract content that is semantically equivalent to any rule_hint entry.
- Only add new candidates when you discover durable information the rules missed.
- If in doubt whether something is already covered, prefer to omit it.
```

与用户讨论过的关键细节：hints **只给 summary、type、scope、importance、confidence**，不给完整结构化字段（如 details、write_reason），避免 LLM 倾向于直接复制。

#### 第二步：Embedding 交叉引用引擎

```typescript
// retrieval-runtime/src/writeback/cross-reference.ts

interface CrossReferenceResult {
  rule_drafts: CandidateDraftWithValidation[];
  llm_drafts: CandidateDraftWithValidation[];
  cross_reference: CrossReferencePair[];
  degraded?: boolean;
  degradation_reason?: string;
}

interface CandidateDraftWithValidation extends CandidateDraft {
  cross_validated: boolean;      // 是否被另一路独立验证
  cross_reference_idx?: number;  // 指向 cross_reference 条目
}

interface CrossReferencePair {
  rule_idx: number;
  llm_idx: number;
  similarity: number;
  verdict: "independent_confirmation" | "partial_match" | "no_match";
}

export class EmbeddingCrossReferenceEngine {
  constructor(
    private readonly embeddingsClient: EmbeddingsClient,
    private readonly config: {
      confirmationThreshold: number;  // 默认 0.85
      partialMatchThreshold: number;  // 默认 0.70
    },
  ) {}

  async crossReference(
    ruleDrafts: CandidateDraft[],
    llmDrafts: CandidateDraft[],
    signal?: AbortSignal,
  ): Promise<CrossReferenceResult> {
    // 如果没有交叉引用的必要
    if (ruleDrafts.length === 0 || llmDrafts.length === 0) {
      return {
        rule_drafts: ruleDrafts.map((d) => ({ ...d, cross_validated: false })),
        llm_drafts: llmDrafts.map((d) => ({ ...d, cross_validated: false })),
        cross_reference: [],
      };
    }

    // 批量计算 embedding
    const ruleSummaries = ruleDrafts.map((d) => d.summary);
    const llmSummaries = llmDrafts.map((d) => d.summary);
    const allTexts = [...ruleSummaries, ...llmSummaries];

    const embeddings = await Promise.all(
      allTexts.map((text) => this.embeddingsClient.embedText(text, signal)),
    );

    const ruleEmbeddings = embeddings.slice(0, ruleDrafts.length);
    const llmEmbeddings = embeddings.slice(ruleDrafts.length);

    // 交叉计算余弦相似度矩阵
    const pairs: CrossReferencePair[] = [];
    const ruleValidated = new Set<number>();
    const llmValidated = new Set<number>();

    for (let ri = 0; ri < ruleDrafts.length; ri++) {
      for (let li = 0; li < llmDrafts.length; li++) {
        const similarity = cosineSimilarity(ruleEmbeddings[ri], llmEmbeddings[li]);

        let verdict: CrossReferencePair["verdict"];
        if (similarity >= this.config.confirmationThreshold) {
          verdict = "independent_confirmation";
          ruleValidated.add(ri);
          llmValidated.add(li);
        } else if (similarity >= this.config.partialMatchThreshold) {
          verdict = "partial_match";
        } else {
          verdict = "no_match";
        }

        pairs.push({ rule_idx: ri, llm_idx: li, similarity, verdict });
      }
    }

    return {
      rule_drafts: ruleDrafts.map((d, i) => ({
        ...d,
        cross_validated: ruleValidated.has(i),
      })),
      llm_drafts: llmDrafts.map((d, i) => ({
        ...d,
        cross_validated: llmValidated.has(i),
      })),
      cross_reference: pairs.sort((a, b) => b.similarity - a.similarity),
    };
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

Embedding 交叉引用仍然依赖 embedding 服务，不应假设一定成功。调用方需要通过 `dependencyGuard.run("embeddings", ...)` 包一层；如果 embedding 超时、配置缺失或服务不可用，就降级为“无交叉验证”，继续把规则候选和 LLM 候选送入 Quality Assess，而不是阻断整条写回链路。

#### 第三步：WritebackEngine 改为两阶段流程

```typescript
// writeback-engine.ts — extractCandidates 方法修改

async extractCandidates(input: FinalizeTurnInput): Promise<WritebackEngineResult> {
  const startedAt = Date.now();
  const ruleResult = this.runRulesOnly(input);

  // 第一阶段：LLM Extract（带 rule_hints）
  let llmDrafts: CandidateDraft[] = [];
  let llmDegraded = false;
  let llmDegradationReason: string | undefined;

  if (this.writebackPlanner) {
    try {
      const extracted = await this.writebackPlanner.extract({
        current_input: input.current_input,
        assistant_output: input.assistant_output,
        tool_results_summary: input.tool_results_summary,
        task_id: input.task_id,
        // 新增：把规则候选作为 hints 传入
        rule_hints: ruleResult.drafts.map((d) => ({
          summary: d.summary,
          candidate_type: d.candidate_type,
          scope: d.scope,
          importance: d.importance,
          confidence: d.confidence,
        })),
      });
      llmDrafts = extracted.candidates.map((c) =>
        this.toDraftFromLlm(input, c),
      );
    } catch (error) {
      llmDegraded = true;
      llmDegradationReason = error instanceof Error ? error.message : "memory_llm_unavailable";
      this.logger?.warn?.({ err: error }, "memory llm extraction failed, using rules only");
    }
  }

  // 第二阶段：Embedding 交叉引用（替代原 LLM Refine）
  let crossRefResult = buildUnvalidatedCrossReference(ruleResult.drafts, llmDrafts);
  let crossRefDegraded = false;
  let crossRefDegradationReason: string | undefined;

  if (this.crossReferenceEngine) {
    const crossRefAttempt = await this.dependencyGuard.run(
      "embeddings",
      this.config.EMBEDDING_TIMEOUT_MS,
      (signal) => this.crossReferenceEngine!.crossReference(
        ruleResult.drafts,
        llmDrafts,
        signal,
      ),
    );

    if (crossRefAttempt.ok && crossRefAttempt.value) {
      crossRefResult = crossRefAttempt.value;
    } else {
      crossRefDegraded = true;
      crossRefDegradationReason = crossRefAttempt.error?.code ?? "embeddings_unavailable";
      crossRefResult = {
        ...crossRefResult,
        degraded: true,
        degradation_reason: crossRefDegradationReason,
      };
    }
  }

  // 合并候选：确认配对先做 pair 级合并，单路候选带标记送入 Quality Assess
  const mergedDrafts = this.mergeWithCrossReference(crossRefResult, input);

  // 后处理与质量评估（保持不变）
  const postProcessed = this.postProcess(
    input,
    mergedDrafts,
    ruleResult.filtered_reasons,
  );

  const result = await this.applyQualityAssessment(input, postProcessed);

  return {
    ...result,
    plan_observation: {
      input_summary: summarizeObservationText(
        `current_input=${input.current_input}; rule_candidates=${ruleResult.drafts.length}; llm_candidates=${llmDrafts.length}; cross_validated=${crossRefResult.cross_reference.filter((p) => p.verdict === "independent_confirmation").length}`,
      ),
      output_summary: summarizeObservationText(
        `candidates=${result.candidates.length}; filtered=${result.filtered_count}`,
      ),
      prompt_version: MEMORY_WRITEBACK_EXTRACTION_PROMPT_VERSION,
      schema_version: MEMORY_WRITEBACK_SCHEMA_VERSION,
      degraded: llmDegraded || crossRefDegraded,
      degradation_reason: llmDegradationReason ?? crossRefDegradationReason,
      result_state: result.candidates.length > 0 ? "planned" : "skipped",
      duration_ms: Date.now() - startedAt,
    },
  };
}
```

#### 第四步：合并逻辑——交叉引用感知

```typescript
// writeback-engine.ts — 新增方法

private mergeWithCrossReference(
  crossRef: CrossReferenceResult,
  input: FinalizeTurnInput,
): CandidateDraft[] {
  const merged: CandidateDraft[] = [];
  const consumedRules = new Set<number>();
  const consumedLlms = new Set<number>();

  // 先处理两路独立确认的 pair。不要简单丢弃 LLM 候选：
  // LLM 可能给出更清晰的 summary、更准确的 scope 或更完整的 reason。
  const confirmedPairs = crossRef.cross_reference
    .filter((pair) => pair.verdict === "independent_confirmation")
    .sort((a, b) => b.similarity - a.similarity);

  for (const pair of confirmedPairs) {
    if (consumedRules.has(pair.rule_idx) || consumedLlms.has(pair.llm_idx)) {
      continue;
    }

    const ruleDraft = crossRef.rule_drafts[pair.rule_idx];
    const llmDraft = crossRef.llm_drafts[pair.llm_idx];
    if (!ruleDraft || !llmDraft) continue;

    consumedRules.add(pair.rule_idx);
    consumedLlms.add(pair.llm_idx);
    merged.push(this.mergeConfirmedPair(ruleDraft, llmDraft, pair));
  }

  // 未配对的规则候选 → 降低置信度，交给 Quality Assess 判断是否误匹配
  for (let index = 0; index < crossRef.rule_drafts.length; index += 1) {
    if (consumedRules.has(index)) continue;
    const draft = crossRef.rule_drafts[index];
    merged.push({
      ...draft,
      confidence: Math.max(0.5, draft.confidence - 0.1),
      write_reason: `${draft.write_reason} (仅规则提取，待质量评估验证)`,
      details: {
        ...draft.details,
        cross_reference: "rule_only",
      },
    });
  }

  // 未配对的 LLM 候选 → 作为规则遗漏的候选保留
  for (let index = 0; index < crossRef.llm_drafts.length; index += 1) {
    if (consumedLlms.has(index)) continue;
    const draft = crossRef.llm_drafts[index];
    merged.push({
      ...draft,
      write_reason: `${draft.write_reason} (LLM 独立发现)`,
      details: {
        ...draft.details,
        cross_reference: "llm_only",
      },
    });
  }

  return merged;
}

private mergeConfirmedPair(
  ruleDraft: CandidateDraft,
  llmDraft: CandidateDraft,
  pair: CrossReferencePair,
): CandidateDraft {
  const llmSummaryIsClearer =
    llmDraft.summary.length >= ruleDraft.summary.length
    && llmDraft.confidence >= ruleDraft.confidence - 0.1;

  const primary = llmSummaryIsClearer ? llmDraft : ruleDraft;
  const secondary = primary === llmDraft ? ruleDraft : llmDraft;

  return {
    ...primary,
    // scope 只在 LLM 置信度明显更高时覆盖规则侧；避免 LLM 把项目约束误升成全局偏好。
    scope:
      llmDraft.confidence >= ruleDraft.confidence + 0.15
        ? llmDraft.scope
        : ruleDraft.scope,
    importance: Math.max(ruleDraft.importance, llmDraft.importance),
    confidence: Math.min(1, Math.max(ruleDraft.confidence, llmDraft.confidence) + 0.1),
    write_reason: `${primary.write_reason} (规则与 LLM 独立确认，similarity=${pair.similarity.toFixed(2)})`,
    details: {
      ...secondary.details,
      ...primary.details,
      cross_reference: "independent_confirmation",
      cross_reference_similarity: pair.similarity,
      rule_summary: ruleDraft.summary,
      llm_summary: llmDraft.summary,
    },
  };
}

function buildUnvalidatedCrossReference(
  ruleDrafts: CandidateDraft[],
  llmDrafts: CandidateDraft[],
): CrossReferenceResult {
  return {
    rule_drafts: ruleDrafts.map((draft) => ({ ...draft, cross_validated: false })),
    llm_drafts: llmDrafts.map((draft) => ({ ...draft, cross_validated: false })),
    cross_reference: [],
  };
}
```

#### 第五步：Quality Assess 获得更完整的上下文

Quality Assess prompt 更新，新增交叉引用维度的判断指引（在原 prompt 末尾追加）：

```
cross_reference results are provided alongside candidates:
- "independent_confirmation": 两个独立的提取通道（规则 + LLM）都发现了这条记忆。置信度应显著提高。
- "rule_only": 仅有规则提取发现，LLM 未独立确认。需审视是否为误匹配或低价值内容。
- "llm_only": 仅有 LLM 发现，规则未捕获。这是规则覆盖的盲区，应给予更高关注。
- "partial_match": 两路发现了部分重叠的内容。需要判断是否为同一事实的不同表述。

For independent_confirmation candidates with high importance (>=4), consider quality_score >= 0.85.
For rule_only or llm_only candidates with low importance (<=2), scrutinize more carefully.
```

### 依赖注入

```typescript
// retrieval-runtime 启动时

const crossReferenceEngine = new EmbeddingCrossReferenceEngine(
  embeddingsClient,
  {
    confirmationThreshold: config.CROSS_REFERENCE_CONFIRMATION_THRESHOLD ?? 0.85,
    partialMatchThreshold: config.CROSS_REFERENCE_PARTIAL_MATCH_THRESHOLD ?? 0.70,
  },
);

const writebackEngine = new WritebackEngine(
  config,
  storageClient,
  dependencyGuard,
  writebackPlanner,
  qualityAssessor,
  crossReferenceEngine,  // 新增依赖
  logger,
);
```

### 最终调用次数

| 阶段 | 原调用 | 优化后 | 说明 |
|---|---|---|---|
| before_response | intent + search（2 次） | **Recall Planner（1 次）** | 优化二 |
| before_response | injection plan（1 次） | injection plan（1 次） | - |
| after_response | llm extract（1 次） | llm extract + rule_hints（1 次） | - |
| after_response | llm refine（1 次） | ~~删除~~ **Embedding 交叉引用** | 非 LLM；走 embedding 依赖，失败时降级为无交叉验证 |
| after_response | quality assess（1 次） | quality assess（1 次） | 输入更完整 |
| after_response | effectiveness（1 次） | effectiveness（1 次） | - |
| **合计** | **7 次** | **5 次** | |

### 效果

- LLM 调用从 7 次稳定降到 5 次，消除 LLM Refine 的延迟和 token 消耗
- 两路独立验证的候选先做 pair 级合并，保留更清晰的 summary、更可信的 scope 和更完整的 reason
- 单路候选被标记后经 Quality Assess 严格审视
- 认知模式不再冲突——Extract 只生成，Quality Assess 只评判，中间用 embedding 做纯计算
- Embedding 交叉引用作为可降级增强能力：成功时提供独立验证，失败时记录 degraded 并继续走 Quality Assess
- 余弦相似度阈值可配置（0.85/0.70），结果可复现、可调参

---

## 优化九：Resident Memory 刷新死循环修复

### 问题

三重问题叠加导致静默失败：

1. storage projection 未就绪时 `isResidentMemoryProjectionReady()` 返回 false
2. `refreshResidentMemory()` 静默返回，`residentMemoryDirty` 保持 true
3. 下一个 turn 继续触发 refresh，继续失败，无限循环
4. Agent 一直使用旧 resident memory，用户完全无感知

### 方案

```typescript
// agent-runner.ts

const MAX_RESIDENT_REFRESH_ATTEMPTS = 5;
const RESIDENT_REFRESH_COOLDOWN_MS = 2 * 60 * 1000; // 2 分钟

class AgentRunner {
  private residentRefreshAttempts = 0;
  private residentRefreshCooldownUntil: number | null = null;
  private residentMemoryStaleWarningEmitted = false;

  private async refreshResidentMemory(): Promise<void> {
    // Cooldown 期内跳过
    if (this.residentRefreshCooldownUntil
        && Date.now() < this.residentRefreshCooldownUntil) {
      return;
    }

    // 超过最大重试次数 → 进入 cooldown
    if (this.residentRefreshAttempts >= MAX_RESIDENT_REFRESH_ATTEMPTS) {
      this.residentRefreshCooldownUntil = Date.now() + RESIDENT_REFRESH_COOLDOWN_MS;
      this.residentRefreshAttempts = 0;

      if (!this.residentMemoryStaleWarningEmitted) {
        this.residentMemoryStaleWarningEmitted = true;
        this.deps.io.emitError("session",
          Object.assign(new Error("持久记忆刷新失败，当前使用缓存中的旧记忆"), {
            code: "resident_memory_stale",
          }));
      }
      return;
    }

    const projectionReady = await this.isResidentMemoryProjectionReady();
    if (!projectionReady) {
      this.residentRefreshAttempts += 1;
      this.residentMemoryDirty = true;
      return;
    }

    const result = await this.safeSessionStart();
    if (!result) {
      this.residentRefreshAttempts += 1;
      this.residentMemoryDirty = true;
      return;
    }

    // 成功 → 重置一切
    const injection = result?.injection_block
      ? toInjectionBlock("session_start", result.injection_block)
      : null;
    this.residentMemory = injection ? toResidentInjectionBlock(injection) : null;
    this.residentMemoryDirty = false;
    this.pendingResidentRefresh = null;
    this.residentRefreshAttempts = 0;
    this.residentRefreshCooldownUntil = null;
    this.residentMemoryStaleWarningEmitted = false;
  }
}
```

### 效果

- 5 次重试后进入 2 分钟 cooldown，打破死循环
- 用户收到一次告警，知道记忆可能不最新
- projection 恢复后 cooldown 结束，自动恢复正常刷新
- 一次成功刷新 → 所有状态清零

---

## 实施优先级

| 优先级 | 优化项 | 理由 |
|---|---|---|
| **P0** | 优化九（死循环修复） | 当前 bug，必须修复 |
| **P0** | 优化一（收紧触发条件） | 改动小、收益大、无风险 |
| **P1** | 优化四（重叠检查对称化） | 直接提升写入质量 |
| **P1** | 优化五（范围分类优先级） | 跨项目记忆泄露是严重问题 |
| **P2** | 优化二（合并 Intent + Search） | 减少 LLM 调用，降低延迟和成本 |
| **P2** | 优化六（写入自适应降级） | 用户体验改进 |
| **P2** | 优化三（正则覆盖度） | 提升规则提取质量 |
| **P2** | 优化八（Embedding 交叉引用替代 Refine） | 删除 LLM Refine，用 embedding 做去重和验证 |
| **P3** | 优化七（工具调用覆盖） | 需要评估 prompt 改动 |

每项优化独立可实施、独立可验证，不需要等全部完成再上线。优化八的核心思路：LLM Refine 的"质量判断"并入 Quality Assess，"交叉去重"用 Embedding 余弦相似度替代，7 次 LLM → 5 次。
