# Memory Orchestrator 真实模型离线评测

- 评测时间：2026-04-22T14:15:55.729Z
- 模型：`gpt-5.3-codex-spark`
- 协议：`openai-compatible`
- 端点：`http://localhost:8090/v1`
- 超时：`45000`（毫秒）

## 指标汇总

| 指标 | 通过数 | 总数 | 实际指标 |
|---|---:|---:|---:|
| intent_accuracy | 2 | 2 | 100.0% |
| recall_accuracy_proxy | 3 | 3 | 100.0% |
| low_quality_intercept_rate | 1 | 1 | 100.0% |
| relation_discovery_accuracy | 1 | 2 | 50.0% |
| recommendation_acceptance_proxy | 1 | 2 | 50.0% |
| knowledge_extraction_accuracy | 2 | 2 | 100.0% |
| governance_correctness_proxy | 2 | 2 | 100.0% |
| effectiveness_adjustment_direction_proxy | 1 | 1 | 100.0% |

## 样本明细

### intent-continue-task

- 模块：`intent-analyzer`
- 指标：`intent_accuracy`
- Prompt：`MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT`
- 预期：应判断需要记忆，并识别 `task_state`（任务状态）或 `fact_preference`（偏好）
- 实际：{"needs_memory":true,"urgency":"immediate","memory_types":["task_state","episodic"],"suggested_scopes":["session","task"]}
- 结果：通过
- 耗时：13264ms

#### 测试提示词

```text
You are the intent analyzer for a memory-native agent.
Return strict JSON only with shape:
{"needs_memory":boolean,"memory_types":[...],"urgency":"immediate|deferred|optional","confidence":number,"reason":"...","suggested_scopes":[...]}

Your task is to judge whether the current input depends on prior context or durable memory.

Rules:
- Focus on whether the user is continuing earlier work, relying on preferences, or asking for continuity.
- memory_types must only use: fact_preference | task_state | episodic.
- suggested_scopes must only use: workspace | user | task | session.
- If uncertain, prefer a conservative answer that keeps memory available.
- Keep reason short and concrete in Chinese.
```

#### 测试输入

```json
{
  "current_input": "继续昨天那个 memory orchestrator 验收，把测试样本文档补完整，格式还是按之前那版。",
  "session_context": {
    "session_id": "eval-session-intent-1",
    "workspace_id": "eval-workspace",
    "recent_turns": [
      {
        "user_input": "先把 memory orchestrator 的验收文档写出来，默认中文，先给一句结论再补几个短点。",
        "assistant_output": "已创建测试样本文档，后面再补真实指标。"
      }
    ]
  }
}
```

#### 模型原始输出

```json
{"needs_memory":true,"memory_types":["task_state","episodic"],"urgency":"immediate","confidence":0.96,"reason":"用户明确“继续昨天”“按之前那版”，需要衔接上一轮已生成的验收文档内容与格式。","suggested_scopes":["session","task"]}
```

#### 结构化结果

```json
{
  "needs_memory": true,
  "memory_types": [
    "task_state",
    "episodic"
  ],
  "urgency": "immediate",
  "confidence": 0.96,
  "reason": "用户明确“继续昨天”“按之前那版”，需要衔接上一轮已生成的验收文档内容与格式。",
  "suggested_scopes": [
    "session",
    "task"
  ]
}
```

### intent-fresh-question

- 模块：`intent-analyzer`
- 指标：`intent_accuracy`
- Prompt：`MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT`
- 预期：应判断为自包含问题，不需要记忆
- 实际：{"needs_memory":false,"reason":"该问题是一般性HTTP知识解释，不依赖上下文、历史偏好或先前任务状态。"}
- 结果：通过
- 耗时：13511ms

#### 测试提示词

```text
You are the intent analyzer for a memory-native agent.
Return strict JSON only with shape:
{"needs_memory":boolean,"memory_types":[...],"urgency":"immediate|deferred|optional","confidence":number,"reason":"...","suggested_scopes":[...]}

Your task is to judge whether the current input depends on prior context or durable memory.

Rules:
- Focus on whether the user is continuing earlier work, relying on preferences, or asking for continuity.
- memory_types must only use: fact_preference | task_state | episodic.
- suggested_scopes must only use: workspace | user | task | session.
- If uncertain, prefer a conservative answer that keeps memory available.
- Keep reason short and concrete in Chinese.
```

#### 测试输入

```json
{
  "current_input": "解释一下 HTTP 204 和 304 的区别。",
  "session_context": {
    "session_id": "eval-session-intent-2",
    "workspace_id": "eval-workspace",
    "recent_turns": []
  }
}
```

#### 模型原始输出

```json
{"needs_memory":false,"memory_types":[],"urgency":"optional","confidence":0.99,"reason":"该问题是一般性HTTP知识解释，不依赖上下文、历史偏好或先前任务状态。","suggested_scopes":[]}
```

#### 结构化结果

```json
{
  "needs_memory": false,
  "memory_types": [],
  "urgency": "optional",
  "confidence": 0.99,
  "reason": "该问题是一般性HTTP知识解释，不依赖上下文、历史偏好或先前任务状态。",
  "suggested_scopes": []
}
```

### search-continue-task

- 模块：`recall-search-planner`
- 指标：`recall_accuracy_proxy`
- Prompt：`MEMORY_RECALL_SEARCH_SYSTEM_PROMPT`
- 预期：应触发检索，并给出可用的查询提示
- 实际：{"should_search":true,"query_hint":"查找本次会话及任务中 memory orchestrator 的测试报告内容，并补齐真实模型的实际验证指标","requested_scopes":["workspace","user","task","session"]}
- 结果：通过
- 耗时：11728ms

#### 测试提示词

```text
You are the memory search planner for a memory-native agent.
Return strict JSON only with shape:
{"should_search":boolean,"reason":"...","requested_scopes":[...],"requested_memory_types":[...],"importance_threshold":number,"query_hint":"...","candidate_limit":number}

Your task is to decide whether the current user input needs a memory search before the main model answers, and if yes, how to search.

Search SHOULD happen when:
- the user implicitly refers to prior preferences, prior decisions, prior task state, or prior conversation context
- the user says things like "照旧", "还是那个", "按之前的", "按我习惯", "继续刚才", "延续上次"
- the user is asking for continuity, personalization, or context carry-over

Search should NOT happen when:
- the input is self-contained and does not depend on memory
- the user is asking a fresh question with enough local context
- memory would add little value

Rules:
- Decide whether memory search is needed at all.
- If search is needed, you may narrow scopes, memory types, threshold, and candidate_limit.
- importance_threshold MUST be an integer 1-5. Never output decimals like 0.7 or 3.5.
- candidate_limit MUST be an integer 1-50 when present.
- query_hint should be a short retrieval-oriented rewrite in Chinese when helpful.
- Prefer the provided requested scopes and memory types unless there is a clear reason to narrow them.
- Never invent unsupported scope or type values.
- Keep reason short and concrete in Chinese.

Examples:
- Strong continuity -> {"should_search":true,"importance_threshold":4,"candidate_limit":8,...}
- Fresh self-contained question -> {"should_search":false,"reason":"..."}
```

#### 测试输入

```json
{
  "current_input": "继续刚才那份 memory orchestrator 测试报告，把真实模型的实际指标补上。",
  "recent_context_summary": "本会话前文已经讨论过测试样本文档、真实模型验证和验收指标。",
  "phase": "before_response",
  "memory_mode": "workspace_plus_global",
  "requested_scopes": [
    "workspace",
    "user",
    "task",
    "session"
  ],
  "requested_memory_types": [
    "fact_preference",
    "task_state",
    "episodic"
  ],
  "semantic_score": 0.61,
  "semantic_threshold": 0.72,
  "task_id_present": true
}
```

#### 模型原始输出

```json
{"should_search":true,"reason":"用户要求“继续刚才”并补齐真实模型指标，需检索上一次报告的上下文与任务状态。","requested_scopes":["workspace","user","task","session"],"requested_memory_types":["task_state","episodic","fact_preference"],"importance_threshold":4,"query_hint":"查找本次会话及任务中 memory orchestrator 的测试报告内容，并补齐真实模型的实际验证指标","candidate_limit":8}
```

#### 结构化结果

```json
{
  "should_search": true,
  "reason": "用户要求“继续刚才”并补齐真实模型指标，需检索上一次报告的上下文与任务状态。",
  "requested_scopes": [
    "workspace",
    "user",
    "task",
    "session"
  ],
  "requested_memory_types": [
    "task_state",
    "episodic",
    "fact_preference"
  ],
  "importance_threshold": 4,
  "query_hint": "查找本次会话及任务中 memory orchestrator 的测试报告内容，并补齐真实模型的实际验证指标",
  "candidate_limit": 8
}
```

### inject-relevant-memory

- 模块：`recall-injection-planner`
- 指标：`recall_accuracy_proxy`
- Prompt：`MEMORY_RECALL_INJECTION_SYSTEM_PROMPT`
- 预期：应选择与当前任务连续性最相关的记忆
- 实际：{"should_inject":true,"selected_record_ids":["mem-style-1","mem-task-1"],"memory_summary":"用户默认中文表达，要求先给一句结论并补充最多3个短点；当前正在续写 memory orchestrator 的测试样本文档。"}
- 结果：通过
- 耗时：9192ms

#### 测试提示词

```text
You are the memory injection planner for a memory-native agent.
Return strict JSON only with shape:
{"should_inject":boolean,"reason":"...","selected_record_ids":[...],"memory_summary":"...","requested_scopes":[...],"requested_memory_types":[...],"importance_threshold":number}

Your task is to decide whether the current user input needs memory injection before the main model answers, using the provided candidate memories.

Injection SHOULD happen when:
- the user implicitly refers to prior preferences, prior decisions, prior task state, or prior conversation context
- the user needs continuity, personalization, or context carry-over

Injection should NOT happen when:
- the input is self-contained and does not depend on memory
- the searched candidate memories are not actually relevant enough

Rules:
- Base your decision on the current input, recent context summary, and the provided candidate memories.
- Only select record ids that exist in the candidate list.
- If should_inject is true, selected_record_ids must be non-empty and memory_summary must explain the injected memory in concise Chinese.
- If should_inject is false, selected_record_ids should be empty.
- If the input is a fresh self-contained question, prefer {"should_inject":false,"selected_record_ids":[]} even when a weakly related candidate exists.
- importance_threshold MUST be an integer 1-5 when present. Never output decimals.
- Keep reason short and concrete in Chinese.

Examples:
- Continue prior task -> {"should_inject":true,"selected_record_ids":["mem-1"],"memory_summary":"..."}
- Unrelated fresh question -> {"should_inject":false,"selected_record_ids":[],"reason":"当前问题自包含，候选记忆弱相关"}
```

#### 测试输入

```json
{
  "current_input": "继续把测试样本文档写完，按之前的短句中文风格来。",
  "recent_context_summary": "用户正在完善 memory orchestrator 测试与验收文档。",
  "phase": "before_response",
  "memory_mode": "workspace_plus_global",
  "requested_scopes": [
    "workspace",
    "user",
    "task"
  ],
  "requested_memory_types": [
    "fact_preference",
    "task_state"
  ],
  "search_reason": "用户显式要求延续之前风格和任务状态",
  "candidates": [
    {
      "id": "mem-style-1",
      "scope": "user",
      "memory_type": "fact_preference",
      "summary": "用户偏好：默认中文，先给一句结论，再补最多 3 个短点。",
      "importance": 5,
      "confidence": 0.96,
      "rerank_score": 0.91,
      "semantic_score": 0.88,
      "updated_at": "2026-04-22T10:00:00.000Z"
    },
    {
      "id": "mem-task-1",
      "scope": "task",
      "memory_type": "task_state",
      "summary": "当前任务：正在补 memory orchestrator 测试样本文档的实际指标。",
      "importance": 4,
      "confidence": 0.93,
      "rerank_score": 0.89,
      "semantic_score": 0.86,
      "updated_at": "2026-04-22T10:05:00.000Z"
    },
    {
      "id": "mem-noise-1",
      "scope": "workspace",
      "memory_type": "episodic",
      "summary": "上周修过一个和代理无关的 CSS 样式问题。",
      "importance": 2,
      "confidence": 0.51,
      "rerank_score": 0.22,
      "semantic_score": 0.19,
      "updated_at": "2026-04-10T09:00:00.000Z"
    }
  ],
  "semantic_score": 0.61,
  "semantic_threshold": 0.72,
  "task_id_present": true
}
```

#### 模型原始输出

```json
{"should_inject":true,"reason":"用户明确要求“继续”并保持既定中文短句风格，需延续先前任务与偏好。","selected_record_ids":["mem-style-1","mem-task-1"],"memory_summary":"用户默认中文表达，要求先给一句结论并补充最多3个短点；当前正在续写 memory orchestrator 的测试样本文档。","requested_scopes":["user","task"],"requested_memory_types":["fact_preference","task_state"],"importance_threshold":4}
```

#### 结构化结果

```json
{
  "should_inject": true,
  "reason": "用户明确要求“继续”并保持既定中文短句风格，需延续先前任务与偏好。",
  "selected_record_ids": [
    "mem-style-1",
    "mem-task-1"
  ],
  "memory_summary": "用户默认中文表达，要求先给一句结论并补充最多3个短点；当前正在续写 memory orchestrator 的测试样本文档。",
  "requested_scopes": [
    "user",
    "task"
  ],
  "requested_memory_types": [
    "fact_preference",
    "task_state"
  ],
  "importance_threshold": 4
}
```

### inject-irrelevant-memory-skip

- 模块：`recall-injection-planner`
- 指标：`recall_accuracy_proxy`
- Prompt：`MEMORY_RECALL_INJECTION_SYSTEM_PROMPT`
- 预期：当候选记忆与当前问题无关时，应跳过注入
- 实际：{"should_inject":false,"selected_record_ids":[],"memory_summary":""}
- 结果：通过
- 耗时：8367ms

#### 测试提示词

```text
You are the memory injection planner for a memory-native agent.
Return strict JSON only with shape:
{"should_inject":boolean,"reason":"...","selected_record_ids":[...],"memory_summary":"...","requested_scopes":[...],"requested_memory_types":[...],"importance_threshold":number}

Your task is to decide whether the current user input needs memory injection before the main model answers, using the provided candidate memories.

Injection SHOULD happen when:
- the user implicitly refers to prior preferences, prior decisions, prior task state, or prior conversation context
- the user needs continuity, personalization, or context carry-over

Injection should NOT happen when:
- the input is self-contained and does not depend on memory
- the searched candidate memories are not actually relevant enough

Rules:
- Base your decision on the current input, recent context summary, and the provided candidate memories.
- Only select record ids that exist in the candidate list.
- If should_inject is true, selected_record_ids must be non-empty and memory_summary must explain the injected memory in concise Chinese.
- If should_inject is false, selected_record_ids should be empty.
- If the input is a fresh self-contained question, prefer {"should_inject":false,"selected_record_ids":[]} even when a weakly related candidate exists.
- importance_threshold MUST be an integer 1-5 when present. Never output decimals.
- Keep reason short and concrete in Chinese.

Examples:
- Continue prior task -> {"should_inject":true,"selected_record_ids":["mem-1"],"memory_summary":"..."}
- Unrelated fresh question -> {"should_inject":false,"selected_record_ids":[],"reason":"当前问题自包含，候选记忆弱相关"}
```

#### 测试输入

```json
{
  "current_input": "解释一下 HTTP 204 和 304 的区别，用最短的话说清楚。",
  "recent_context_summary": "当前是一次独立的协议知识问答。",
  "phase": "before_response",
  "memory_mode": "workspace_plus_global",
  "requested_scopes": [
    "workspace",
    "user",
    "task"
  ],
  "requested_memory_types": [
    "fact_preference",
    "task_state",
    "episodic"
  ],
  "search_reason": "语义检索有弱命中，但未确认是否适合注入。",
  "candidates": [
    {
      "id": "mem-style-2",
      "scope": "user",
      "memory_type": "fact_preference",
      "summary": "用户偏好：默认中文，先给一句结论，再补 3 个短点。",
      "importance": 5,
      "confidence": 0.95,
      "rerank_score": 0.31,
      "semantic_score": 0.28,
      "updated_at": "2026-04-22T10:00:00.000Z"
    },
    {
      "id": "mem-task-old-2",
      "scope": "task",
      "memory_type": "task_state",
      "summary": "当前任务：补 memory orchestrator 测试样本文档。",
      "importance": 4,
      "confidence": 0.92,
      "rerank_score": 0.18,
      "semantic_score": 0.16,
      "updated_at": "2026-04-22T10:05:00.000Z"
    }
  ],
  "semantic_score": 0.41,
  "semantic_threshold": 0.72,
  "task_id_present": false
}
```

#### 模型原始输出

```json
{"should_inject":false,"reason":"当前问题是独立的 HTTP 概念解释，语义上不依赖历史任务或偏好记忆，候选记忆与本次内容相关性低","selected_record_ids":[],"memory_summary":"","requested_scopes":["workspace","user","task"],"requested_memory_types":["fact_preference","task_state","episodic"],"importance_threshold":3}
```

#### 结构化结果

```json
{
  "should_inject": false,
  "reason": "当前问题是独立的 HTTP 概念解释，语义上不依赖历史任务或偏好记忆，候选记忆与本次内容相关性低",
  "selected_record_ids": [],
  "memory_summary": "",
  "requested_scopes": [
    "workspace",
    "user",
    "task"
  ],
  "requested_memory_types": [
    "fact_preference",
    "task_state",
    "episodic"
  ],
  "importance_threshold": 3
}
```

### quality-low-signal

- 模块：`writeback-quality-assessor`
- 指标：`low_quality_intercept_rate`
- Prompt：`MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT`
- 预期：应识别低信号候选，并给出低质量或待确认判断
- 实际：{"candidate_id":"cand-low-1","quality_score":0.12,"confidence":0.83,"potential_conflicts":[],"suggested_importance":1,"suggested_status":"pending_confirmation","issues":[{"type":"low_quality","severity":"high","description":"内容仅为一句礼貌确认，缺乏可复用事实"},{"type":"vague","severity":"medium","description":"“好的，我来处理”不体现稳定偏好或可长期记忆的信息"}],"reason":"该记录为当前轮对话的短暂应答，信号很弱，不适合持久化为会话记忆。"}
- 结果：通过
- 耗时：12998ms

#### 测试提示词

```text
You assess the quality of writeback candidates for durable agent memory.

Input JSON carries:
- writeback_candidates: [{ id, candidate_type, scope, summary, importance, confidence, write_reason }]
- existing_similar_records: [{ id, scope, memory_type, status, summary, importance, confidence }]
- turn_context: { user_input, assistant_output }

Return strict JSON only with shape:
{"assessments":[{"candidate_id":"...","quality_score":0-1,"confidence":0-1,"potential_conflicts":["..."],"suggested_importance":1-5,"suggested_status":"active|pending_confirmation","issues":[{"type":"duplicate|low_quality|conflict|vague","severity":"high|medium|low","description":"..."}],"reason":"..."}]}

Rules:
- candidate_id must refer to an input candidate id.
- potential_conflicts must only contain ids from existing_similar_records.
- Use pending_confirmation when the candidate is plausible but duplicate/conflict risk remains.
- quality_score should be lower for vague, redundant, low-signal, or temporary content.
- Keep reason and issue descriptions concise in Chinese.
```

#### 测试输入

```json
{
  "writeback_candidates": [
    {
      "id": "cand-low-1",
      "candidate_type": "episodic",
      "scope": "session",
      "summary": "好的，我来处理。",
      "importance": 3,
      "confidence": 0.72,
      "write_reason": "assistant acknowledged the request"
    },
    {
      "id": "cand-good-1",
      "candidate_type": "fact_preference",
      "scope": "user",
      "summary": "用户偏好：写说明时先给一句结论，再补 3 个短点。",
      "importance": 5,
      "confidence": 0.94,
      "write_reason": "stable formatting preference"
    }
  ],
  "existing_similar_records": [
    {
      "id": "rec-good-1",
      "scope": "user",
      "memory_type": "fact_preference",
      "status": "active",
      "summary": "用户偏好：默认中文回答。",
      "importance": 5,
      "confidence": 0.9
    }
  ],
  "turn_context": {
    "user_input": "以后这种说明文档先给结论，再补几个短点。",
    "assistant_output": "好的，我来处理。后续我会按这个格式写。"
  }
}
```

#### 模型原始输出

```json
{"assessments":[{"candidate_id":"cand-low-1","quality_score":0.12,"confidence":0.83,"potential_conflicts":[],"suggested_importance":1,"suggested_status":"pending_confirmation","issues":[{"type":"low_quality","severity":"high","description":"内容仅为一句礼貌确认，缺乏可复用事实"},{"type":"vague","severity":"medium","description":"“好的，我来处理”不体现稳定偏好或可长期记忆的信息"}],"reason":"该记录为当前轮对话的短暂应答，信号很弱，不适合持久化为会话记忆。"},{"candidate_id":"cand-good-1","quality_score":0.95,"confidence":0.96,"potential_conflicts":[],"suggested_importance":4,"suggested_status":"active","issues":[],"reason":"清晰表达用户在说明文档中的格式偏好，属于稳定可复用的用户偏好，与已有“默认中文回答”不冲突，可直接写回。"}]}
```

#### 结构化结果

```json
{
  "assessments": [
    {
      "candidate_id": "cand-low-1",
      "quality_score": 0.12,
      "confidence": 0.83,
      "potential_conflicts": [],
      "suggested_importance": 1,
      "suggested_status": "pending_confirmation",
      "issues": [
        {
          "type": "low_quality",
          "severity": "high",
          "description": "内容仅为一句礼貌确认，缺乏可复用事实"
        },
        {
          "type": "vague",
          "severity": "medium",
          "description": "“好的，我来处理”不体现稳定偏好或可长期记忆的信息"
        }
      ],
      "reason": "该记录为当前轮对话的短暂应答，信号很弱，不适合持久化为会话记忆。"
    },
    {
      "candidate_id": "cand-good-1",
      "quality_score": 0.95,
      "confidence": 0.96,
      "potential_conflicts": [],
      "suggested_importance": 4,
      "suggested_status": "active",
      "issues": [],
      "reason": "清晰表达用户在说明文档中的格式偏好，属于稳定可复用的用户偏好，与已有“默认中文回答”不冲突，可直接写回。"
    }
  ]
}
```

### relation-task-state

- 模块：`relation-discoverer`
- 指标：`relation_discovery_accuracy`
- Prompt：`MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT`
- 预期：应发现同一任务上下文里的扩展或相关关系
- 实际：执行失败
- 结果：未通过
- 耗时：121585ms
- 错误：`memory llm request failed with 502`

#### 测试提示词

```text
You discover semantic relations between durable memory records.

Input JSON carries:
- source_record: { id, memory_type, scope, summary, importance, confidence }
- candidate_records: [{ id, memory_type, scope, summary, importance, confidence }]
- context: { workspace_id, user_id } | null

Return strict JSON only with shape:
{"source_record_id":"...","relations":[{"target_record_id":"...","relation_type":"depends_on|conflicts_with|extends|supersedes|related_to","strength":0-1,"bidirectional":boolean,"reason":"..."}]}

Rules:
- source_record_id must equal source_record.id.
- target_record_id must come from candidate_records.
- Emit only relations with clear semantic support.
- Use conflicts_with only for genuine contradictions; use related_to when weaker but still useful.
- If no candidate has clear semantic support, return {"source_record_id":"...","relations":[]}.
- Keep reason concise in Chinese.
```

#### 测试输入

```json
{
  "source_record": {
    "id": "rec-source-1",
    "memory_type": "task_state",
    "scope": "task",
    "summary": "当前任务：补齐 memory orchestrator 验收文档的真实指标。",
    "importance": 4,
    "confidence": 0.91
  },
  "candidate_records": [
    {
      "id": "rec-related-1",
      "memory_type": "task_state",
      "scope": "task",
      "summary": "当前任务下一步：补充真实模型评测提示词和输出结果。",
      "importance": 4,
      "confidence": 0.9
    },
    {
      "id": "rec-unrelated-1",
      "memory_type": "episodic",
      "scope": "workspace",
      "summary": "昨天修过一个日志滚动配置。",
      "importance": 2,
      "confidence": 0.62
    }
  ],
  "context": {
    "workspace_id": "eval-workspace",
    "user_id": "eval-user"
  }
}
```

### relation-no-clear-link

- 模块：`relation-discoverer`
- 指标：`relation_discovery_accuracy`
- Prompt：`MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT`
- 预期：当候选记录没有明确语义关联时，不应强行输出关系
- 实际：[]
- 结果：通过
- 耗时：13916ms

#### 测试提示词

```text
You discover semantic relations between durable memory records.

Input JSON carries:
- source_record: { id, memory_type, scope, summary, importance, confidence }
- candidate_records: [{ id, memory_type, scope, summary, importance, confidence }]
- context: { workspace_id, user_id } | null

Return strict JSON only with shape:
{"source_record_id":"...","relations":[{"target_record_id":"...","relation_type":"depends_on|conflicts_with|extends|supersedes|related_to","strength":0-1,"bidirectional":boolean,"reason":"..."}]}

Rules:
- source_record_id must equal source_record.id.
- target_record_id must come from candidate_records.
- Emit only relations with clear semantic support.
- Use conflicts_with only for genuine contradictions; use related_to when weaker but still useful.
- If no candidate has clear semantic support, return {"source_record_id":"...","relations":[]}.
- Keep reason concise in Chinese.
```

#### 测试输入

```json
{
  "source_record": {
    "id": "rec-source-2",
    "memory_type": "fact_preference",
    "scope": "user",
    "summary": "用户偏好：默认中文回答。",
    "importance": 5,
    "confidence": 0.95
  },
  "candidate_records": [
    {
      "id": "rec-unrelated-2",
      "memory_type": "episodic",
      "scope": "workspace",
      "summary": "上周处理过一个 nginx 日志切割问题。",
      "importance": 2,
      "confidence": 0.58
    },
    {
      "id": "rec-unrelated-3",
      "memory_type": "task_state",
      "scope": "task",
      "summary": "当前任务：补一份前端配色稿。",
      "importance": 3,
      "confidence": 0.72
    }
  ],
  "context": {
    "workspace_id": "eval-workspace",
    "user_id": "eval-user"
  }
}
```

#### 模型原始输出

```json
{"source_record_id":"rec-source-2","relations":[]}
```

#### 结构化结果

```json
{
  "source_record_id": "rec-source-2",
  "relations": []
}
```

### recommend-task-memory

- 模块：`proactive-recommender`
- 指标：`recommendation_acceptance_proxy`
- Prompt：`MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT`
- 预期：应推荐与当前任务连续性相关、宿主大概率会采纳的高价值记忆
- 实际：[{"record_id":"mem-rec-1","relevance_score":0.98,"trigger_reason":"task_similarity","suggestion":"沿用当前任务上下文，继续按既有 memory orchestrator 验收文档的写法补充内容，保持章节结构与术语一致。","auto_inject":true}]
- 结果：通过
- 耗时：11157ms

#### 测试提示词

```text
You proactively recommend useful memories for the current context.

Input JSON carries:
- current_context: { user_input, session_context, detected_task_type }
- available_memories: [{ id, memory_type, scope, summary, importance, confidence, status }]

Return strict JSON only with shape:
{"recommendations":[{"record_id":"...","relevance_score":0-1,"trigger_reason":"task_similarity|forgotten_context|related_decision|conflict_warning","suggestion":"...","auto_inject":boolean}]}

Rules:
- record_id must come from available_memories.
- auto_inject should usually be true only when relevance_score is very high and the context match is strong.
- Prefer concise user-facing suggestions in Chinese.
- Emit only the most relevant recommendations.
- If available memories are stale, weakly related, or the current question is self-contained, return {"recommendations":[]}.
```

#### 测试输入

```json
{
  "current_context": {
    "user_input": "继续完善验收文档，保持之前的写法。",
    "session_context": {
      "session_id": "eval-session-recommend-1",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "recent_context_summary": "本会话一直在完善 memory orchestrator 的测试与验收材料。"
    },
    "detected_task_type": "documentation"
  },
  "available_memories": [
    {
      "id": "mem-rec-1",
      "memory_type": "task_state",
      "scope": "task",
      "status": "active",
      "summary": "当前任务：完善 memory orchestrator 测试样本文档。",
      "importance": 5,
      "confidence": 0.95
    },
    {
      "id": "mem-rec-2",
      "memory_type": "fact_preference",
      "scope": "user",
      "status": "active",
      "summary": "用户偏好：默认中文，短句输出。",
      "importance": 5,
      "confidence": 0.94
    },
    {
      "id": "mem-rec-3",
      "memory_type": "episodic",
      "scope": "workspace",
      "status": "archived",
      "summary": "三个月前讨论过图标颜色。",
      "importance": 1,
      "confidence": 0.4
    }
  ]
}
```

#### 模型原始输出

```json
{"recommendations":[{"record_id":"mem-rec-1","relevance_score":0.98,"trigger_reason":"task_similarity","suggestion":"沿用当前任务上下文，继续按既有 memory orchestrator 验收文档的写法补充内容，保持章节结构与术语一致。","auto_inject":true}]}
```

#### 结构化结果

```json
{
  "recommendations": [
    {
      "record_id": "mem-rec-1",
      "relevance_score": 0.98,
      "trigger_reason": "task_similarity",
      "suggestion": "沿用当前任务上下文，继续按既有 memory orchestrator 验收文档的写法补充内容，保持章节结构与术语一致。",
      "auto_inject": true
    }
  ]
}
```

### recommend-noisy-memory-skip

- 模块：`proactive-recommender`
- 指标：`recommendation_acceptance_proxy`
- Prompt：`MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT`
- 预期：当上下文没有明确连续性时，不应推荐低价值或过期记忆
- 实际：执行失败
- 结果：未通过
- 耗时：85521ms
- 错误：`memory llm request failed with 502`

#### 测试提示词

```text
You proactively recommend useful memories for the current context.

Input JSON carries:
- current_context: { user_input, session_context, detected_task_type }
- available_memories: [{ id, memory_type, scope, summary, importance, confidence, status }]

Return strict JSON only with shape:
{"recommendations":[{"record_id":"...","relevance_score":0-1,"trigger_reason":"task_similarity|forgotten_context|related_decision|conflict_warning","suggestion":"...","auto_inject":boolean}]}

Rules:
- record_id must come from available_memories.
- auto_inject should usually be true only when relevance_score is very high and the context match is strong.
- Prefer concise user-facing suggestions in Chinese.
- Emit only the most relevant recommendations.
- If available memories are stale, weakly related, or the current question is self-contained, return {"recommendations":[]}.
```

#### 测试输入

```json
{
  "current_context": {
    "user_input": "解释一下 TCP 三次握手，给一个最短版本。",
    "session_context": {
      "session_id": "eval-session-recommend-2",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "recent_context_summary": "这是一个新的网络基础知识问题。"
    },
    "detected_task_type": "qa"
  },
  "available_memories": [
    {
      "id": "mem-rec-noise-1",
      "memory_type": "episodic",
      "scope": "workspace",
      "status": "active",
      "summary": "两个月前讨论过 memory orchestrator 的验收文档。",
      "importance": 2,
      "confidence": 0.62
    },
    {
      "id": "mem-rec-noise-2",
      "memory_type": "task_state",
      "scope": "task",
      "status": "archived",
      "summary": "上一个任务：整理前端视觉稿。",
      "importance": 1,
      "confidence": 0.45
    }
  ]
}
```

### evolution-knowledge-extraction

- 模块：`evolution-planner`
- 指标：`knowledge_extraction_accuracy`
- Prompt：`MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT`
- 预期：应从多条相关记录提炼出稳定模式
- 实际：{"evolution_type":"knowledge_extraction","extracted_knowledge":{"pattern":"用户偏好以中文回复为主，回答应自然简短，优先给出结论，再补充几个简短要点。","confidence":0.95,"evidence_count":3,"suggested_scope":"user","suggested_importance":5}}
- 结果：通过
- 耗时：12192ms

#### 测试提示词

```text
You plan long-term memory evolution over a set of related records.

Input JSON carries:
- source_records: [{ id, memory_type, scope, summary, importance, confidence, created_at, updated_at }]
- time_window: { start, end }
- evolution_type: knowledge_extraction | pattern_discovery | summarization

Return strict JSON only with shape:
{"evolution_type":"...","source_records":["..."],"extracted_knowledge":{"pattern":"...","confidence":0-1,"evidence_count":N,"suggested_scope":"user|workspace","suggested_importance":1-5},"consolidation_plan":{"new_summary":"...","records_to_archive":["..."]}}

Rules:
- source_records must only contain ids from the input.
- For knowledge_extraction or pattern_discovery, extracted_knowledge should be present.
- For summarization, consolidation_plan should usually be present.
- For knowledge_extraction, consolidation_plan is optional. If you include it, records_to_archive MUST be a non-empty array of source record ids.
- Do not emit an empty records_to_archive array.
- Keep extracted knowledge concise and evidence-based.
- Do not invent new record ids.
```

#### 测试输入

```json
{
  "source_records": [
    {
      "id": "evo-1",
      "memory_type": "fact_preference",
      "scope": "user",
      "summary": "用户偏好：默认中文回答。",
      "importance": 5,
      "confidence": 0.96,
      "created_at": "2026-04-20T08:00:00.000Z",
      "updated_at": "2026-04-20T08:00:00.000Z"
    },
    {
      "id": "evo-2",
      "memory_type": "fact_preference",
      "scope": "user",
      "summary": "用户偏好：说明文档先给结论，再补几个短点。",
      "importance": 5,
      "confidence": 0.94,
      "created_at": "2026-04-21T08:00:00.000Z",
      "updated_at": "2026-04-21T08:00:00.000Z"
    },
    {
      "id": "evo-3",
      "memory_type": "fact_preference",
      "scope": "user",
      "summary": "用户偏好：不要写太长，尽量自然中文。",
      "importance": 4,
      "confidence": 0.92,
      "created_at": "2026-04-22T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z"
    }
  ],
  "time_window": {
    "start": "2026-04-20T00:00:00.000Z",
    "end": "2026-04-22T23:59:59.000Z"
  },
  "evolution_type": "knowledge_extraction"
}
```

#### 模型原始输出

```json
{
  "evolution_type": "knowledge_extraction",
  "source_records": ["evo-1", "evo-2", "evo-3"],
  "extracted_knowledge": {
    "pattern": "用户偏好以中文回复为主，回答应自然简短，优先给出结论，再补充几个简短要点。",
    "confidence": 0.95,
    "evidence_count": 3,
    "suggested_scope": "user",
    "suggested_importance": 5
  }
}
```

#### 结构化结果

```json
{
  "evolution_type": "knowledge_extraction",
  "source_records": [
    "evo-1",
    "evo-2",
    "evo-3"
  ],
  "extracted_knowledge": {
    "pattern": "用户偏好以中文回复为主，回答应自然简短，优先给出结论，再补充几个简短要点。",
    "confidence": 0.95,
    "evidence_count": 3,
    "suggested_scope": "user",
    "suggested_importance": 5
  }
}
```

### evolution-pattern-knowledge-extraction

- 模块：`evolution-planner`
- 指标：`knowledge_extraction_accuracy`
- Prompt：`MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT`
- 预期：应从多条任务状态中提炼出稳定的长期工作模式
- 实际：{"evolution_type":"knowledge_extraction","source_records":["evo-task-1","evo-task-2","evo-task-3"],"extracted_knowledge":{"pattern":"在该时间窗内，团队验收习惯为先做验证环节（测试样本补充/链路验证），再补充并回写实际指标或统计结果。","confidence":0.93,"evidence_count":3,"suggested_scope":"workspace","suggested_importance":4}}
- 结果：通过
- 耗时：9368ms

#### 测试提示词

```text
You plan long-term memory evolution over a set of related records.

Input JSON carries:
- source_records: [{ id, memory_type, scope, summary, importance, confidence, created_at, updated_at }]
- time_window: { start, end }
- evolution_type: knowledge_extraction | pattern_discovery | summarization

Return strict JSON only with shape:
{"evolution_type":"...","source_records":["..."],"extracted_knowledge":{"pattern":"...","confidence":0-1,"evidence_count":N,"suggested_scope":"user|workspace","suggested_importance":1-5},"consolidation_plan":{"new_summary":"...","records_to_archive":["..."]}}

Rules:
- source_records must only contain ids from the input.
- For knowledge_extraction or pattern_discovery, extracted_knowledge should be present.
- For summarization, consolidation_plan should usually be present.
- For knowledge_extraction, consolidation_plan is optional. If you include it, records_to_archive MUST be a non-empty array of source record ids.
- Do not emit an empty records_to_archive array.
- Keep extracted knowledge concise and evidence-based.
- Do not invent new record ids.
```

#### 测试输入

```json
{
  "source_records": [
    {
      "id": "evo-task-1",
      "memory_type": "task_state",
      "scope": "workspace",
      "summary": "最近 3 次验收任务都先补测试样本，再补实际指标。",
      "importance": 4,
      "confidence": 0.9,
      "created_at": "2026-04-01T08:00:00.000Z",
      "updated_at": "2026-04-18T08:00:00.000Z"
    },
    {
      "id": "evo-task-2",
      "memory_type": "task_state",
      "scope": "workspace",
      "summary": "最近 2 次真实模型评测都先做链路验证，再回写指标文档。",
      "importance": 4,
      "confidence": 0.89,
      "created_at": "2026-04-10T08:00:00.000Z",
      "updated_at": "2026-04-20T08:00:00.000Z"
    },
    {
      "id": "evo-task-3",
      "memory_type": "task_state",
      "scope": "workspace",
      "summary": "当前团队验收习惯：先通链路，再补统计数。",
      "importance": 4,
      "confidence": 0.87,
      "created_at": "2026-04-15T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z"
    }
  ],
  "time_window": {
    "start": "2026-04-01T00:00:00.000Z",
    "end": "2026-04-22T23:59:59.000Z"
  },
  "evolution_type": "knowledge_extraction"
}
```

#### 模型原始输出

```json
{
  "evolution_type": "knowledge_extraction",
  "source_records": ["evo-task-1", "evo-task-2", "evo-task-3"],
  "extracted_knowledge": {
    "pattern": "在该时间窗内，团队验收习惯为先做验证环节（测试样本补充/链路验证），再补充并回写实际指标或统计结果。",
    "confidence": 0.93,
    "evidence_count": 3,
    "suggested_scope": "workspace",
    "suggested_importance": 4
  }
}
```

#### 结构化结果

```json
{
  "evolution_type": "knowledge_extraction",
  "source_records": [
    "evo-task-1",
    "evo-task-2",
    "evo-task-3"
  ],
  "extracted_knowledge": {
    "pattern": "在该时间窗内，团队验收习惯为先做验证环节（测试样本补充/链路验证），再补充并回写实际指标或统计结果。",
    "confidence": 0.93,
    "evidence_count": 3,
    "suggested_scope": "workspace",
    "suggested_importance": 4
  }
}
```

### governance-verify-reject-delete

- 模块：`governance-verifier`
- 指标：`governance_correctness_proxy`
- Prompt：`MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT`
- 预期：对于缺少删除依据的删除提案，应拒绝执行
- 实际：{"decision":"reject","confidence":0.97,"notes":"拒绝：删除提议仅说明“看起来没用了，删掉”，未提供明确的删除原因、关联替代记录或保留依据。该记录有明确事实内容（真实模型评测记录），且无冲突或可替代上下文支持，不满足“明确可删除”与“低歧义”条件。"}
- 结果：通过
- 耗时：8524ms

#### 测试提示词

```text
You verify a proposed automated memory governance action before execution.

Input JSON carries:
- proposal: the proposed action with targets, suggested_changes, reason_code, reason_text, evidence
- seed_records: compact record snapshots
- related_records: compact related record snapshots
- open_conflicts: compact conflict snapshots

Return strict JSON only with shape:
{"decision":"approve|reject","confidence":0-1,"notes":"..."}

Rules:
- Reject if the proposal deletes without a clear delete_reason or replacement context.
- Reject if the proposal merges records that are not clearly about the same durable fact.
- Reject if the proposal resolves a conflict without enough evidence in related records.
- Reject if the proposal appears to cross scopes incorrectly.
- Approve only when the proposal is specific, well-supported, and low-ambiguity.
- If a proposal archives an older record because a newer record clearly supersedes it, approval is usually appropriate.
- When evidence is insufficient, prefer reject over a hesitant approve.
```

#### 测试输入

```json
{
  "proposal": {
    "proposal_id": "proposal-1",
    "proposal_type": "delete",
    "targets": {
      "record_ids": [
        "gov-1"
      ]
    },
    "suggested_changes": {
      "status": "deleted",
      "delete_mode": "soft"
    },
    "reason_code": "cleanup",
    "reason_text": "看起来没用了，删掉。",
    "evidence": {
      "matched_records": 1
    },
    "planner": {
      "model": "gpt-5.3-codex-spark",
      "confidence": 0.66
    }
  },
  "seed_records": [
    {
      "id": "gov-1",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "task_id": null,
      "session_id": null,
      "memory_type": "episodic",
      "scope": "session",
      "status": "active",
      "summary": "今天跑过一次真实模型评测。",
      "details": null,
      "importance": 2,
      "confidence": 0.82,
      "created_at": "2026-04-22T09:00:00.000Z",
      "updated_at": "2026-04-22T09:00:00.000Z",
      "last_used_at": null
    }
  ],
  "related_records": [],
  "open_conflicts": []
}
```

#### 模型原始输出

```json
{"decision":"reject","confidence":0.97,"notes":"拒绝：删除提议仅说明“看起来没用了，删掉”，未提供明确的删除原因、关联替代记录或保留依据。该记录有明确事实内容（真实模型评测记录），且无冲突或可替代上下文支持，不满足“明确可删除”与“低歧义”条件。"}
```

#### 结构化结果

```json
{
  "decision": "reject",
  "confidence": 0.97,
  "notes": "拒绝：删除提议仅说明“看起来没用了，删掉”，未提供明确的删除原因、关联替代记录或保留依据。该记录有明确事实内容（真实模型评测记录），且无冲突或可替代上下文支持，不满足“明确可删除”与“低歧义”条件。"
}
```

### governance-verify-approve-archive

- 模块：`governance-verifier`
- 指标：`governance_correctness_proxy`
- Prompt：`MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT`
- 预期：对于证据充分、目标明确的归档提案，应允许通过
- 实际：{"decision":"approve","confidence":0.95,"notes":"The proposal is a specific archive action for gov-2 with explicit supersession rationale and a replacement record (gov-3). gov-2 and gov-3 are both active user-scope fact_pref records; gov-3 appears to be a superseding/expanded version of the same preference (adds explicit natural/default Chinese while retaining brevity), so archiving the older record is appropriate and non-ambiguous."}
- 结果：通过
- 耗时：13108ms

#### 测试提示词

```text
You verify a proposed automated memory governance action before execution.

Input JSON carries:
- proposal: the proposed action with targets, suggested_changes, reason_code, reason_text, evidence
- seed_records: compact record snapshots
- related_records: compact related record snapshots
- open_conflicts: compact conflict snapshots

Return strict JSON only with shape:
{"decision":"approve|reject","confidence":0-1,"notes":"..."}

Rules:
- Reject if the proposal deletes without a clear delete_reason or replacement context.
- Reject if the proposal merges records that are not clearly about the same durable fact.
- Reject if the proposal resolves a conflict without enough evidence in related records.
- Reject if the proposal appears to cross scopes incorrectly.
- Approve only when the proposal is specific, well-supported, and low-ambiguity.
- If a proposal archives an older record because a newer record clearly supersedes it, approval is usually appropriate.
- When evidence is insufficient, prefer reject over a hesitant approve.
```

#### 测试输入

```json
{
  "proposal": {
    "proposal_id": "proposal-2",
    "proposal_type": "archive",
    "targets": {
      "record_ids": [
        "gov-2"
      ]
    },
    "suggested_changes": {
      "status": "archived"
    },
    "reason_code": "superseded",
    "reason_text": "该记录已被更新的同类偏好替代，保留会造成重复召回。",
    "evidence": {
      "matched_records": 2,
      "replacement_record_ids": [
        "gov-3"
      ]
    },
    "planner": {
      "model": "gpt-5.3-codex-spark",
      "confidence": 0.91
    }
  },
  "seed_records": [
    {
      "id": "gov-2",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "task_id": null,
      "session_id": null,
      "memory_type": "fact_preference",
      "scope": "user",
      "status": "active",
      "summary": "用户偏好：回答尽量简短。",
      "details": null,
      "importance": 3,
      "confidence": 0.84,
      "created_at": "2026-04-01T09:00:00.000Z",
      "updated_at": "2026-04-01T09:00:00.000Z",
      "last_used_at": "2026-04-05T09:00:00.000Z"
    }
  ],
  "related_records": [
    {
      "id": "gov-3",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "task_id": null,
      "session_id": null,
      "memory_type": "fact_preference",
      "scope": "user",
      "status": "active",
      "summary": "用户偏好：默认中文，回答自然且尽量简短。",
      "details": null,
      "importance": 5,
      "confidence": 0.95,
      "created_at": "2026-04-20T09:00:00.000Z",
      "updated_at": "2026-04-20T09:00:00.000Z",
      "last_used_at": "2026-04-22T09:00:00.000Z"
    }
  ],
  "open_conflicts": []
}
```

#### 模型原始输出

```json
{"decision":"approve","confidence":0.95,"notes":"The proposal is a specific archive action for gov-2 with explicit supersession rationale and a replacement record (gov-3). gov-2 and gov-3 are both active user-scope fact_pref records; gov-3 appears to be a superseding/expanded version of the same preference (adds explicit natural/default Chinese while retaining brevity), so archiving the older record is appropriate and non-ambiguous."}
```

#### 结构化结果

```json
{
  "decision": "approve",
  "confidence": 0.95,
  "notes": "The proposal is a specific archive action for gov-2 with explicit supersession rationale and a replacement record (gov-3). gov-2 and gov-3 are both active user-scope fact_pref records; gov-3 appears to be a superseding/expanded version of the same preference (adds explicit natural/default Chinese while retaining brevity), so archiving the older record is appropriate and non-ambiguous."
}
```

### effectiveness-memory-used

- 模块：`effectiveness-evaluator`
- 指标：`effectiveness_adjustment_direction_proxy`
- Prompt：`MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT`
- 预期：当回复明显使用了注入记忆时，应给出正向使用判断
- 实际：{"record_id":"eff-1","was_used":true,"usage_confidence":0.84,"effectiveness_score":0.78,"suggested_importance_adjustment":1,"usage_evidence":"回复以“结论：”开头，并且全程中文，体现了先给结论再展开的格式意图。","reason":"模型遵循了中文与结论优先的偏好，风格契合但未完整体现“再补3个短点”。"}
- 结果：通过
- 耗时：8142ms

#### 测试提示词

```text
You evaluate whether injected memories were actually used by the main model response.

Input JSON carries:
- injected_memories: [{ record_id, summary, importance }]
- assistant_output: string
- user_feedback: { rating, comment } | null

Return strict JSON only with shape:
{"evaluations":[{"record_id":"...","was_used":boolean,"usage_confidence":0-1,"effectiveness_score":0-1,"suggested_importance_adjustment":-2..2,"usage_evidence":"...","reason":"..."}]}

Rules:
- record_id must refer to an injected memory.
- Use usage_evidence only when you can point to a clear phrase or behavior in assistant_output.
- Raise suggested_importance_adjustment only when the memory was clearly used and materially helpful.
- Lower suggested_importance_adjustment when the memory was ignored or unnecessary.
- Keep reason short and concrete in Chinese.
```

#### 测试输入

```json
{
  "injected_memories": [
    {
      "record_id": "eff-1",
      "summary": "用户偏好：默认中文，先给一句结论，再补 3 个短点。",
      "importance": 5
    }
  ],
  "assistant_output": "结论：这些指标可以用真实模型测。后面我会按中文短句格式，把测试提示词、预期指标和实际指标一起补到文档里。",
  "user_feedback": {
    "rating": 5,
    "comment": "格式符合预期。"
  }
}
```

#### 模型原始输出

```json
{"evaluations":[{"record_id":"eff-1","was_used":true,"usage_confidence":0.84,"effectiveness_score":0.78,"suggested_importance_adjustment":1,"usage_evidence":"回复以“结论：”开头，并且全程中文，体现了先给结论再展开的格式意图。","reason":"模型遵循了中文与结论优先的偏好，风格契合但未完整体现“再补3个短点”。"}]}
```

#### 结构化结果

```json
{
  "evaluations": [
    {
      "record_id": "eff-1",
      "was_used": true,
      "usage_confidence": 0.84,
      "effectiveness_score": 0.78,
      "suggested_importance_adjustment": 1,
      "usage_evidence": "回复以“结论：”开头，并且全程中文，体现了先给结论再展开的格式意图。",
      "reason": "模型遵循了中文与结论优先的偏好，风格契合但未完整体现“再补3个短点”。"
    }
  ]
}
```

## 说明

- 这份报告是离线代理评测，只验证真实模型在当前 prompt 和 schema 下的结构化决策质量。
- 推荐采纳率、用户满意度、优先级调整后的长期命中率，仍然需要真实线上埋点或人工采样。
