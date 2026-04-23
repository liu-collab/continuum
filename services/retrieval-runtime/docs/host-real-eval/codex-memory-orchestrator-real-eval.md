# Memory Orchestrator 真实模型离线评测

- 评测时间：2026-04-23T15:04:01.089Z
- 模型：`gpt-5.4`
- 协议：`openai-compatible`
- 端点：`http://localhost:8090/v1`
- 超时：`45000`（毫秒）
- 通过阈值：`score >= 0.6`
- 总用例数：`100`

- 错误分布：网络 `8`，结构 `3`，逻辑 `5`

## 指标汇总

| 指标 | 通过数 | 总数 | 通过率 | 平均分 | 基线对比 | 网络错误 | 结构错误 | 逻辑错误 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| intent_accuracy | 10 | 10 | 100.0% | 0.980 | NEW | 0 | 0 | 0 |
| recall_accuracy_proxy | 13 | 15 | 86.7% | 0.867 | NEW | 0 | 2 | 0 |
| writeback_extraction_accuracy | 8 | 8 | 100.0% | 1.000 | NEW | 0 | 0 | 0 |
| writeback_refine_accuracy | 7 | 8 | 87.5% | 0.825 | NEW | 0 | 1 | 0 |
| governance_plan_accuracy | 7 | 8 | 87.5% | 0.887 | NEW | 0 | 0 | 1 |
| low_quality_intercept_rate | 8 | 8 | 100.0% | 1.000 | NEW | 0 | 0 | 0 |
| relation_discovery_accuracy | 10 | 10 | 100.0% | 1.000 | NEW | 0 | 0 | 0 |
| recommendation_acceptance_proxy | 9 | 10 | 90.0% | 0.930 | NEW | 0 | 0 | 1 |
| knowledge_extraction_accuracy | 6 | 8 | 75.0% | 0.813 | NEW | 0 | 0 | 2 |
| governance_correctness_proxy | 6 | 8 | 75.0% | 0.750 | NEW | 1 | 0 | 1 |
| effectiveness_adjustment_direction_proxy | 0 | 7 | 0.0% | 0.000 | NEW | 7 | 0 | 0 |

## 样本明细

### intent-continue-task

- 模块：`intent-analyzer`
- 指标：`intent_accuracy`
- Prompt：`MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT`
- 预期：应判断需要记忆，并识别 task_state 或 fact_preference
- 实际：{"needs_memory":true,"urgency":"immediate","memory_types":["task_state","episodic"],"suggested_scopes":["task","session","workspace"]}
- 评分：`1.000`
- 结果：通过
- 耗时：15829ms

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
    "session_id": "intent-1",
    "workspace_id": "eval-workspace",
    "recent_turns": [
      {
        "user_input": "先把 memory orchestrator 的验收文档写出来，默认中文。",
        "assistant_output": "已创建测试样本文档。"
      }
    ]
  }
}
```

#### 模型原始输出

```json
{"needs_memory":true,"memory_types":["task_state","episodic"],"urgency":"immediate","confidence":0.97,"reason":"用户明确要求继续昨天的验收工作，并沿用之前版本格式，依赖历史任务状态。","suggested_scopes":["task","session","workspace"]}
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
  "confidence": 0.97,
  "reason": "用户明确要求继续昨天的验收工作，并沿用之前版本格式，依赖历史任务状态。",
  "suggested_scopes": [
    "task",
    "session",
    "workspace"
  ]
}
```

### intent-fresh-question

- 模块：`intent-analyzer`
- 指标：`intent_accuracy`
- Prompt：`MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT`
- 预期：应判断为自包含问题，不需要记忆
- 实际：{"needs_memory":false,"reason":"独立的通用知识问答，不依赖之前上下文或用户偏好。"}
- 评分：`1.000`
- 结果：通过
- 耗时：12688ms

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
    "session_id": "intent-2",
    "workspace_id": "eval-workspace",
    "recent_turns": []
  }
}
```

#### 模型原始输出

```json
{"needs_memory":false,"memory_types":[],"urgency":"optional","confidence":0.98,"reason":"独立的通用知识问答，不依赖之前上下文或用户偏好。","suggested_scopes":["session"]}
```

#### 结构化结果

```json
{
  "needs_memory": false,
  "memory_types": [],
  "urgency": "optional",
  "confidence": 0.98,
  "reason": "独立的通用知识问答，不依赖之前上下文或用户偏好。",
  "suggested_scopes": [
    "session"
  ]
}
```

### intent-ambiguous-reference

- 模块：`intent-analyzer`
- 指标：`intent_accuracy`
- Prompt：`MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT`
- 预期：半相关引用，应倾向需要记忆（保守策略）
- 实际：{"needs_memory":true,"urgency":"optional","confidence":0.91}
- 评分：`0.800`
- 结果：通过
- 耗时：15179ms

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
  "current_input": "顺便提一下上次那个方案，你还记得吗？不过先帮我看看这个新需求。",
  "session_context": {
    "session_id": "intent-3",
    "workspace_id": "eval-workspace",
    "recent_turns": []
  }
}
```

#### 模型原始输出

```json
{"needs_memory":true,"memory_types":["episodic","task_state"],"urgency":"optional","confidence":0.91,"reason":"提到“上次那个方案”，明显在引用先前交流，但当前优先事项是新需求。","suggested_scopes":["session","task","workspace"]}
```

#### 结构化结果

```json
{
  "needs_memory": true,
  "memory_types": [
    "episodic",
    "task_state"
  ],
  "urgency": "optional",
  "confidence": 0.91,
  "reason": "提到“上次那个方案”，明显在引用先前交流，但当前优先事项是新需求。",
  "suggested_scopes": [
    "session",
    "task",
    "workspace"
  ]
}
```

### intent-multi-type-trigger

- 模块：`intent-analyzer`
- 指标：`intent_accuracy`
- Prompt：`MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT`
- 预期：应同时识别 task_state 和 episodic
- 实际：{"needs_memory":true,"memory_types":["task_state","episodic"]}
- 评分：`1.000`
- 结果：通过
- 耗时：15706ms

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
  "current_input": "昨天那个数据库迁移做到哪一步了？我记得当时还遇到了一个权限问题。",
  "session_context": {
    "session_id": "intent-4",
    "workspace_id": "eval-workspace",
    "recent_turns": [
      {
        "user_input": "开始做数据库迁移",
        "assistant_output": "迁移脚本已执行到第 3 步，遇到权限问题暂停。"
      }
    ]
  }
}
```

#### 模型原始输出

```json
{"needs_memory":true,"memory_types":["task_state","episodic"],"urgency":"immediate","confidence":0.97,"reason":"用户在追问之前的数据库迁移进度和遇到的权限问题，明显依赖先前任务上下文。","suggested_scopes":["task","session","workspace"]}
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
  "confidence": 0.97,
  "reason": "用户在追问之前的数据库迁移进度和遇到的权限问题，明显依赖先前任务上下文。",
  "suggested_scopes": [
    "task",
    "session",
    "workspace"
  ]
}
```

### intent-english-input

- 模块：`intent-analyzer`
- 指标：`intent_accuracy`
- Prompt：`MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT`
- 预期：英文自包含问题，不需要记忆
- 实际：{"needs_memory":false}
- 评分：`1.000`
- 结果：通过
- 耗时：17921ms

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
  "current_input": "What is the difference between a mutex and a semaphore?",
  "session_context": {
    "session_id": "intent-5",
    "workspace_id": "eval-workspace",
    "recent_turns": []
  }
}
```

#### 模型原始输出

```json
{"needs_memory":false,"memory_types":[],"urgency":"optional","confidence":0.98,"reason":"这是独立的通用知识问答，不依赖先前对话或用户偏好。","suggested_scopes":[]}
```

#### 结构化结果

```json
{
  "needs_memory": false,
  "memory_types": [],
  "urgency": "optional",
  "confidence": 0.98,
  "reason": "这是独立的通用知识问答，不依赖先前对话或用户偏好。",
  "suggested_scopes": []
}
```

### intent-preference-recall

- 模块：`intent-analyzer`
- 指标：`intent_accuracy`
- Prompt：`MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT`
- 预期：用户引用偏好设置，应识别 fact_preference
- 实际：{"needs_memory":true,"memory_types":["fact_preference"],"suggested_scopes":["user","session"]}
- 评分：`1.000`
- 结果：通过
- 耗时：13285ms

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
  "current_input": "按我习惯的格式写，不要太长。",
  "session_context": {
    "session_id": "intent-6",
    "workspace_id": "eval-workspace",
    "recent_turns": []
  }
}
```

#### 模型原始输出

```json
{"needs_memory":true,"memory_types":["fact_preference"],"urgency":"immediate","confidence":0.94,"reason":"用户要求按其一贯格式与长度偏好输出，需调用偏好记忆。","suggested_scopes":["user","session"]}
```

#### 结构化结果

```json
{
  "needs_memory": true,
  "memory_types": [
    "fact_preference"
  ],
  "urgency": "immediate",
  "confidence": 0.94,
  "reason": "用户要求按其一贯格式与长度偏好输出，需调用偏好记忆。",
  "suggested_scopes": [
    "user",
    "session"
  ]
}
```

### intent-code-snippet-only

- 模块：`intent-analyzer`
- 指标：`intent_accuracy`
- Prompt：`MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT`
- 预期：纯代码问题不需要记忆
- 实际：{"needs_memory":false}
- 评分：`1.000`
- 结果：通过
- 耗时：11119ms

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
  "current_input": "function add(a, b) { return a + b; } 这段代码有什么问题？",
  "session_context": {
    "session_id": "intent-7",
    "workspace_id": "eval-workspace",
    "recent_turns": []
  }
}
```

#### 模型原始输出

```json
{"needs_memory":false,"memory_types":[],"urgency":"optional","confidence":0.97,"reason":"当前问题可独立回答，不依赖先前对话或用户偏好。","suggested_scopes":["session"]}
```

#### 结构化结果

```json
{
  "needs_memory": false,
  "memory_types": [],
  "urgency": "optional",
  "confidence": 0.97,
  "reason": "当前问题可独立回答，不依赖先前对话或用户偏好。",
  "suggested_scopes": [
    "session"
  ]
}
```

### intent-workspace-convention

- 模块：`intent-analyzer`
- 指标：`intent_accuracy`
- Prompt：`MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT`
- 预期：引用工作区约定，应识别 workspace scope
- 实际：{"needs_memory":true,"suggested_scopes":["task","workspace","session"]}
- 评分：`1.000`
- 结果：通过
- 耗时：16289ms

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
  "current_input": "按照咱们项目的目录结构来放，别弄错路径。",
  "session_context": {
    "session_id": "intent-8",
    "workspace_id": "eval-workspace",
    "recent_turns": [
      {
        "user_input": "新建一个组件",
        "assistant_output": "准备创建组件文件。"
      }
    ]
  }
}
```

#### 模型原始输出

```json
{"needs_memory":true,"memory_types":["task_state","episodic"],"urgency":"immediate","confidence":0.91,"reason":"提到项目目录结构和放置路径，依赖当前任务上下文与先前约定。","suggested_scopes":["task","workspace","session"]}
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
  "confidence": 0.91,
  "reason": "提到项目目录结构和放置路径，依赖当前任务上下文与先前约定。",
  "suggested_scopes": [
    "task",
    "workspace",
    "session"
  ]
}
```

### intent-session-continuation

- 模块：`intent-analyzer`
- 指标：`intent_accuracy`
- Prompt：`MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT`
- 预期：明确延续会话上下文，urgency 应为 immediate
- 实际：{"needs_memory":true,"urgency":"immediate","memory_types":["task_state","episodic"]}
- 评分：`1.000`
- 结果：通过
- 耗时：11503ms

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
  "current_input": "接着刚才说的，把第二步也做了。",
  "session_context": {
    "session_id": "intent-9",
    "workspace_id": "eval-workspace",
    "recent_turns": [
      {
        "user_input": "帮我做三件事",
        "assistant_output": "第一步已完成。"
      }
    ]
  }
}
```

#### 模型原始输出

```json
{"needs_memory":true,"memory_types":["task_state","episodic"],"urgency":"immediate","confidence":0.97,"reason":"用户明确引用“刚才”并要求继续完成第二步，依赖先前任务进度。","suggested_scopes":["session","task"]}
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
  "confidence": 0.97,
  "reason": "用户明确引用“刚才”并要求继续完成第二步，依赖先前任务进度。",
  "suggested_scopes": [
    "session",
    "task"
  ]
}
```

### intent-math-question

- 模块：`intent-analyzer`
- 指标：`intent_accuracy`
- Prompt：`MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT`
- 预期：纯数学问题不需要记忆
- 实际：{"needs_memory":false}
- 评分：`1.000`
- 结果：通过
- 耗时：10004ms

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
  "current_input": "计算 17 的阶乘是多少？",
  "session_context": {
    "session_id": "intent-10",
    "workspace_id": "eval-workspace",
    "recent_turns": []
  }
}
```

#### 模型原始输出

```json
{"needs_memory":false,"memory_types":[],"urgency":"optional","confidence":0.98,"reason":"这是独立的数学问题，不依赖先前上下文或长期偏好。","suggested_scopes":["session"]}
```

#### 结构化结果

```json
{
  "needs_memory": false,
  "memory_types": [],
  "urgency": "optional",
  "confidence": 0.98,
  "reason": "这是独立的数学问题，不依赖先前上下文或长期偏好。",
  "suggested_scopes": [
    "session"
  ]
}
```

### search-continue-task

- 模块：`recall-search-planner`
- 指标：`recall_accuracy_proxy`
- Prompt：`MEMORY_RECALL_SEARCH_SYSTEM_PROMPT`
- 预期：应触发检索并给出查询提示
- 实际：{"should_search":true,"query_hint":"刚才的 memory orchestrator 测试报告草稿、测试样本、待补充的真实模型实际指标"}
- 评分：`1.000`
- 结果：通过
- 耗时：12373ms

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
  "recent_context_summary": "本会话前文讨论过测试样本文档。",
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
{"should_search":true,"reason":"用户要求延续刚才内容并补全先前报告，依赖任务状态。","requested_scopes":["workspace","task","session"],"requested_memory_types":["task_state","episodic"],"importance_threshold":4,"query_hint":"刚才的 memory orchestrator 测试报告草稿、测试样本、待补充的真实模型实际指标","candidate_limit":8}
```

#### 结构化结果

```json
{
  "should_search": true,
  "reason": "用户要求延续刚才内容并补全先前报告，依赖任务状态。",
  "requested_scopes": [
    "workspace",
    "task",
    "session"
  ],
  "requested_memory_types": [
    "task_state",
    "episodic"
  ],
  "importance_threshold": 4,
  "query_hint": "刚才的 memory orchestrator 测试报告草稿、测试样本、待补充的真实模型实际指标",
  "candidate_limit": 8
}
```

### search-fresh-http-question

- 模块：`recall-search-planner`
- 指标：`recall_accuracy_proxy`
- Prompt：`MEMORY_RECALL_SEARCH_SYSTEM_PROMPT`
- 预期：自包含问题不应触发检索
- 实际：执行失败
- 评分：`0.000`
- 结果：未通过
- 耗时：9923ms
- 错误类型：`schema`
- 错误：`[
  {
    "code": "too_small",
    "minimum": 1,
    "type": "string",
    "inclusive": true,
    "exact": false,
    "message": "String must contain at least 1 character(s)",
    "path": [
      "query_hint"
    ]
  }
]`

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
  "current_input": "解释一下 gRPC 和 REST 的区别。",
  "recent_context_summary": "",
  "phase": "before_response",
  "memory_mode": "workspace_plus_global",
  "requested_scopes": [
    "workspace",
    "user"
  ],
  "requested_memory_types": [
    "fact_preference"
  ],
  "semantic_score": 0.15,
  "semantic_threshold": 0.72,
  "task_id_present": false
}
```

### search-prior-preference

- 模块：`recall-search-planner`
- 指标：`recall_accuracy_proxy`
- Prompt：`MEMORY_RECALL_SEARCH_SYSTEM_PROMPT`
- 预期：引用偏好时应触发检索
- 实际：{"should_search":true,"query_hint":"用户代码缩进风格偏好 缩进 空格 tab 代码风格"}
- 评分：`1.000`
- 结果：通过
- 耗时：12291ms

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
  "current_input": "按我习惯的缩进风格来写。",
  "recent_context_summary": "用户之前表达过代码风格偏好。",
  "phase": "before_response",
  "memory_mode": "workspace_plus_global",
  "requested_scopes": [
    "user"
  ],
  "requested_memory_types": [
    "fact_preference"
  ],
  "semantic_score": 0.55,
  "semantic_threshold": 0.72,
  "task_id_present": false
}
```

#### 模型原始输出

```json
{"should_search":true,"reason":"用户要求按其习惯风格，依赖过往偏好。","requested_scopes":["user"],"requested_memory_types":["fact_preference"],"importance_threshold":3,"query_hint":"用户代码缩进风格偏好 缩进 空格 tab 代码风格","candidate_limit":5}
```

#### 结构化结果

```json
{
  "should_search": true,
  "reason": "用户要求按其习惯风格，依赖过往偏好。",
  "requested_scopes": [
    "user"
  ],
  "requested_memory_types": [
    "fact_preference"
  ],
  "importance_threshold": 3,
  "query_hint": "用户代码缩进风格偏好 缩进 空格 tab 代码风格",
  "candidate_limit": 5
}
```

### search-implicit-context-carry

- 模块：`recall-search-planner`
- 指标：`recall_accuracy_proxy`
- Prompt：`MEMORY_RECALL_SEARCH_SYSTEM_PROMPT`
- 预期：隐式上下文延续应触发检索
- 实际：{"should_search":true,"query_hint":"之前讨论的架构方案及其优化点"}
- 评分：`1.000`
- 结果：通过
- 耗时：11794ms

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
  "current_input": "还是那个方案，帮我再优化一下。",
  "recent_context_summary": "前几轮讨论了一个架构方案。",
  "phase": "before_response",
  "memory_mode": "workspace_plus_global",
  "requested_scopes": [
    "workspace",
    "task",
    "session"
  ],
  "requested_memory_types": [
    "task_state",
    "episodic"
  ],
  "semantic_score": 0.68,
  "semantic_threshold": 0.72,
  "task_id_present": true
}
```

#### 模型原始输出

```json
{"should_search":true,"reason":"用户明确引用之前的方案，需要延续上下文。","requested_scopes":["workspace","task","session"],"requested_memory_types":["task_state","episodic"],"importance_threshold":4,"query_hint":"之前讨论的架构方案及其优化点","candidate_limit":8}
```

#### 结构化结果

```json
{
  "should_search": true,
  "reason": "用户明确引用之前的方案，需要延续上下文。",
  "requested_scopes": [
    "workspace",
    "task",
    "session"
  ],
  "requested_memory_types": [
    "task_state",
    "episodic"
  ],
  "importance_threshold": 4,
  "query_hint": "之前讨论的架构方案及其优化点",
  "candidate_limit": 8
}
```

### search-english-no-context

- 模块：`recall-search-planner`
- 指标：`recall_accuracy_proxy`
- Prompt：`MEMORY_RECALL_SEARCH_SYSTEM_PROMPT`
- 预期：英文独立问题不应触发检索
- 实际：执行失败
- 评分：`0.000`
- 结果：未通过
- 耗时：11506ms
- 错误类型：`schema`
- 错误：`[
  {
    "code": "too_small",
    "minimum": 1,
    "type": "string",
    "inclusive": true,
    "exact": false,
    "message": "String must contain at least 1 character(s)",
    "path": [
      "query_hint"
    ]
  }
]`

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
  "current_input": "Explain the CAP theorem in distributed systems.",
  "recent_context_summary": "",
  "phase": "before_response",
  "memory_mode": "workspace_plus_global",
  "requested_scopes": [
    "workspace"
  ],
  "requested_memory_types": [
    "fact_preference"
  ],
  "semantic_score": 0.1,
  "semantic_threshold": 0.72,
  "task_id_present": false
}
```

### search-borderline-semantic

- 模块：`recall-search-planner`
- 指标：`recall_accuracy_proxy`
- Prompt：`MEMORY_RECALL_SEARCH_SYSTEM_PROMPT`
- 预期：语义分接近阈值且有隐式引用，应触发检索
- 实际：{"should_search":true,"query_hint":"上次使用的模板格式 模板讨论 输出格式 偏好"}
- 评分：`1.000`
- 结果：通过
- 耗时：11259ms

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
  "current_input": "用上次那个模板的格式。",
  "recent_context_summary": "之前有过模板讨论。",
  "phase": "before_response",
  "memory_mode": "workspace_plus_global",
  "requested_scopes": [
    "user",
    "workspace"
  ],
  "requested_memory_types": [
    "fact_preference",
    "episodic"
  ],
  "semantic_score": 0.7,
  "semantic_threshold": 0.72,
  "task_id_present": false
}
```

#### 模型原始输出

```json
{"should_search":true,"reason":"用户明确引用上次模板格式，需要延续先前上下文。","requested_scopes":["user","workspace"],"requested_memory_types":["fact_preference","episodic"],"importance_threshold":4,"query_hint":"上次使用的模板格式 模板讨论 输出格式 偏好","candidate_limit":8}
```

#### 结构化结果

```json
{
  "should_search": true,
  "reason": "用户明确引用上次模板格式，需要延续先前上下文。",
  "requested_scopes": [
    "user",
    "workspace"
  ],
  "requested_memory_types": [
    "fact_preference",
    "episodic"
  ],
  "importance_threshold": 4,
  "query_hint": "上次使用的模板格式 模板讨论 输出格式 偏好",
  "candidate_limit": 8
}
```

### search-multi-task-reference

- 模块：`recall-search-planner`
- 指标：`recall_accuracy_proxy`
- Prompt：`MEMORY_RECALL_SEARCH_SYSTEM_PROMPT`
- 预期：跨任务引用应触发检索并限定范围
- 实际：{"should_search":true,"query_hint":"上个任务使用的重试策略、相关API开发中的重试配置与决策","requested_scopes":["workspace","task"]}
- 评分：`1.000`
- 结果：通过
- 耗时：11331ms

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
  "current_input": "上个任务里我们用的那个重试策略，这次也用同一个。",
  "recent_context_summary": "当前任务是新的 API 开发，之前做过类似系统。",
  "phase": "before_response",
  "memory_mode": "workspace_plus_global",
  "requested_scopes": [
    "workspace",
    "user",
    "task"
  ],
  "requested_memory_types": [
    "task_state",
    "fact_preference"
  ],
  "semantic_score": 0.58,
  "semantic_threshold": 0.72,
  "task_id_present": true
}
```

#### 模型原始输出

```json
{"should_search":true,"reason":"用户引用上个任务的具体方案，需要延续先前决策。","requested_scopes":["workspace","task"],"requested_memory_types":["task_state","fact_preference"],"importance_threshold":4,"query_hint":"上个任务使用的重试策略、相关API开发中的重试配置与决策","candidate_limit":8}
```

#### 结构化结果

```json
{
  "should_search": true,
  "reason": "用户引用上个任务的具体方案，需要延续先前决策。",
  "requested_scopes": [
    "workspace",
    "task"
  ],
  "requested_memory_types": [
    "task_state",
    "fact_preference"
  ],
  "importance_threshold": 4,
  "query_hint": "上个任务使用的重试策略、相关API开发中的重试配置与决策",
  "candidate_limit": 8
}
```

### inject-relevant-memory

- 模块：`recall-injection-planner`
- 指标：`recall_accuracy_proxy`
- Prompt：`MEMORY_RECALL_INJECTION_SYSTEM_PROMPT`
- 预期：应选择与当前任务连续性最相关的记忆，不选噪声
- 实际：{"should_inject":true,"selected_record_ids":["mem-style-1","mem-task-1"]}
- 评分：`1.000`
- 结果：通过
- 耗时：15793ms

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
{"should_inject":true,"reason":"用户明确要求延续之前风格与任务进度","selected_record_ids":["mem-style-1","mem-task-1"],"memory_summary":"用户偏好用中文短句表达，先给一句结论再补最多3个短点；当前正在补写 memory orchestrator 的测试样本文档与相关实际指标。","requested_scopes":["workspace","user","task"],"requested_memory_types":["fact_preference","task_state"],"importance_threshold":4}
```

#### 结构化结果

```json
{
  "should_inject": true,
  "reason": "用户明确要求延续之前风格与任务进度",
  "selected_record_ids": [
    "mem-style-1",
    "mem-task-1"
  ],
  "memory_summary": "用户偏好用中文短句表达，先给一句结论再补最多3个短点；当前正在补写 memory orchestrator 的测试样本文档与相关实际指标。",
  "requested_scopes": [
    "workspace",
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

### inject-irrelevant-skip

- 模块：`recall-injection-planner`
- 指标：`recall_accuracy_proxy`
- Prompt：`MEMORY_RECALL_INJECTION_SYSTEM_PROMPT`
- 预期：候选记忆与当前问题无关时应跳过注入
- 实际：{"should_inject":false,"selected_record_ids":[]}
- 评分：`1.000`
- 结果：通过
- 耗时：20133ms

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
  "search_reason": "语义检索有弱命中。",
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
{"should_inject":false,"reason":"当前问题自包含，候选记忆仅弱相关风格偏好","selected_record_ids":[],"memory_summary":"","requested_scopes":["workspace","user","task"],"requested_memory_types":["fact_preference","task_state","episodic"],"importance_threshold":4}
```

#### 结构化结果

```json
{
  "should_inject": false,
  "reason": "当前问题自包含，候选记忆仅弱相关风格偏好",
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
  "importance_threshold": 4
}
```

### inject-borderline-score

- 模块：`recall-injection-planner`
- 指标：`recall_accuracy_proxy`
- Prompt：`MEMORY_RECALL_INJECTION_SYSTEM_PROMPT`
- 预期：候选分数在阈值附近但内容相关时应注入
- 实际：{"should_inject":true,"selected_record_ids":["mem-indent"]}
- 评分：`1.000`
- 结果：通过
- 耗时：11550ms

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
  "current_input": "把缩进改成 4 空格，按我之前说的来。",
  "recent_context_summary": "用户在修改代码格式。",
  "phase": "before_response",
  "memory_mode": "workspace_plus_global",
  "requested_scopes": [
    "user"
  ],
  "requested_memory_types": [
    "fact_preference"
  ],
  "search_reason": "用户引用偏好设置",
  "candidates": [
    {
      "id": "mem-indent",
      "scope": "user",
      "memory_type": "fact_preference",
      "summary": "用户偏好：使用 4 空格缩进。",
      "importance": 5,
      "confidence": 0.88,
      "rerank_score": 0.73,
      "semantic_score": 0.71,
      "updated_at": "2026-04-20T08:00:00.000Z"
    },
    {
      "id": "mem-old-style",
      "scope": "user",
      "memory_type": "fact_preference",
      "summary": "用户偏好：变量名用 camelCase。",
      "importance": 3,
      "confidence": 0.72,
      "rerank_score": 0.42,
      "semantic_score": 0.38,
      "updated_at": "2026-04-15T08:00:00.000Z"
    }
  ],
  "semantic_score": 0.71,
  "semantic_threshold": 0.72,
  "task_id_present": false
}
```

#### 模型原始输出

```json
{"should_inject":true,"reason":"用户明确引用之前的格式偏好，需延续上下文","selected_record_ids":["mem-indent"],"memory_summary":"用户之前明确偏好代码使用 4 空格缩进。","requested_scopes":["user"],"requested_memory_types":["fact_preference"],"importance_threshold":4}
```

#### 结构化结果

```json
{
  "should_inject": true,
  "reason": "用户明确引用之前的格式偏好，需延续上下文",
  "selected_record_ids": [
    "mem-indent"
  ],
  "memory_summary": "用户之前明确偏好代码使用 4 空格缩进。",
  "requested_scopes": [
    "user"
  ],
  "requested_memory_types": [
    "fact_preference"
  ],
  "importance_threshold": 4
}
```

### inject-conflicting-candidates

- 模块：`recall-injection-planner`
- 指标：`recall_accuracy_proxy`
- Prompt：`MEMORY_RECALL_INJECTION_SYSTEM_PROMPT`
- 预期：两条候选矛盾时应选择更新、更高置信度的那条
- 实际：{"should_inject":true,"selected_record_ids":["mem-new-space"]}
- 评分：`1.000`
- 结果：通过
- 耗时：15592ms

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
  "current_input": "按我的偏好来设置 tab 还是空格。",
  "recent_context_summary": "用户在配置编辑器。",
  "phase": "before_response",
  "memory_mode": "workspace_plus_global",
  "requested_scopes": [
    "user"
  ],
  "requested_memory_types": [
    "fact_preference"
  ],
  "search_reason": "用户引用编辑器偏好",
  "candidates": [
    {
      "id": "mem-old-tab",
      "scope": "user",
      "memory_type": "fact_preference",
      "summary": "用户偏好：使用 tab 缩进。",
      "importance": 4,
      "confidence": 0.78,
      "rerank_score": 0.8,
      "semantic_score": 0.77,
      "updated_at": "2026-03-01T08:00:00.000Z"
    },
    {
      "id": "mem-new-space",
      "scope": "user",
      "memory_type": "fact_preference",
      "summary": "用户偏好：使用 4 空格缩进，不用 tab。",
      "importance": 5,
      "confidence": 0.95,
      "rerank_score": 0.85,
      "semantic_score": 0.82,
      "updated_at": "2026-04-20T08:00:00.000Z"
    }
  ],
  "semantic_score": 0.8,
  "semantic_threshold": 0.72,
  "task_id_present": false
}
```

#### 模型原始输出

```json
{"should_inject":true,"reason":"用户明确引用既有编辑器偏好，需要延续上下文","selected_record_ids":["mem-new-space"],"memory_summary":"用户当前偏好是使用 4 个空格缩进，不用 tab；较旧的“使用 tab”偏好已被更新记录覆盖。","requested_scopes":["user"],"requested_memory_types":["fact_preference"],"importance_threshold":4}
```

#### 结构化结果

```json
{
  "should_inject": true,
  "reason": "用户明确引用既有编辑器偏好，需要延续上下文",
  "selected_record_ids": [
    "mem-new-space"
  ],
  "memory_summary": "用户当前偏好是使用 4 个空格缩进，不用 tab；较旧的“使用 tab”偏好已被更新记录覆盖。",
  "requested_scopes": [
    "user"
  ],
  "requested_memory_types": [
    "fact_preference"
  ],
  "importance_threshold": 4
}
```

### inject-all-noise

- 模块：`recall-injection-planner`
- 指标：`recall_accuracy_proxy`
- Prompt：`MEMORY_RECALL_INJECTION_SYSTEM_PROMPT`
- 预期：所有候选都是噪声时不应注入
- 实际：{"should_inject":false}
- 评分：`1.000`
- 结果：通过
- 耗时：10133ms

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
  "current_input": "帮我写一个 Python 快排。",
  "recent_context_summary": "用户需要算法实现。",
  "phase": "before_response",
  "memory_mode": "workspace_plus_global",
  "requested_scopes": [
    "workspace"
  ],
  "requested_memory_types": [
    "fact_preference",
    "episodic"
  ],
  "search_reason": "弱语义命中",
  "candidates": [
    {
      "id": "mem-css-fix",
      "scope": "workspace",
      "memory_type": "episodic",
      "summary": "上周修过一个 CSS 对齐问题。",
      "importance": 2,
      "confidence": 0.45,
      "rerank_score": 0.12,
      "semantic_score": 0.1,
      "updated_at": "2026-04-05T08:00:00.000Z"
    },
    {
      "id": "mem-deploy",
      "scope": "workspace",
      "memory_type": "episodic",
      "summary": "三天前部署过一次 staging 环境。",
      "importance": 2,
      "confidence": 0.5,
      "rerank_score": 0.15,
      "semantic_score": 0.13,
      "updated_at": "2026-04-19T08:00:00.000Z"
    }
  ],
  "semantic_score": 0.22,
  "semantic_threshold": 0.72,
  "task_id_present": false
}
```

#### 模型原始输出

```json
{"should_inject":false,"reason":"当前问题自包含，候选记忆不相关","selected_record_ids":[],"memory_summary":"","requested_scopes":["workspace"],"requested_memory_types":["fact_preference","episodic"],"importance_threshold":3}
```

#### 结构化结果

```json
{
  "should_inject": false,
  "reason": "当前问题自包含，候选记忆不相关",
  "selected_record_ids": [],
  "memory_summary": "",
  "requested_scopes": [
    "workspace"
  ],
  "requested_memory_types": [
    "fact_preference",
    "episodic"
  ],
  "importance_threshold": 3
}
```

### inject-single-perfect-match

- 模块：`recall-injection-planner`
- 指标：`recall_accuracy_proxy`
- Prompt：`MEMORY_RECALL_INJECTION_SYSTEM_PROMPT`
- 预期：单条高匹配候选应注入
- 实际：{"should_inject":true,"selected_record_ids":["mem-arch"]}
- 评分：`1.000`
- 结果：通过
- 耗时：12532ms

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
  "current_input": "延续上次的架构方案，继续设计 API 层。",
  "recent_context_summary": "正在做系统设计。",
  "phase": "before_response",
  "memory_mode": "workspace_plus_global",
  "requested_scopes": [
    "task",
    "workspace"
  ],
  "requested_memory_types": [
    "task_state"
  ],
  "search_reason": "用户延续上次方案",
  "candidates": [
    {
      "id": "mem-arch",
      "scope": "task",
      "memory_type": "task_state",
      "summary": "当前架构方案：微服务 + API Gateway + Redis 缓存层。",
      "importance": 5,
      "confidence": 0.97,
      "rerank_score": 0.95,
      "semantic_score": 0.93,
      "updated_at": "2026-04-21T08:00:00.000Z"
    }
  ],
  "semantic_score": 0.92,
  "semantic_threshold": 0.72,
  "task_id_present": true
}
```

#### 模型原始输出

```json
{"should_inject":true,"reason":"用户明确要求延续上次方案，需注入任务状态","selected_record_ids":["mem-arch"],"memory_summary":"延续之前的架构方案：采用微服务架构，包含 API Gateway 和 Redis 缓存层；当前需在此基础上继续设计 API 层。","requested_scopes":["task","workspace"],"requested_memory_types":["task_state"],"importance_threshold":5}
```

#### 结构化结果

```json
{
  "should_inject": true,
  "reason": "用户明确要求延续上次方案，需注入任务状态",
  "selected_record_ids": [
    "mem-arch"
  ],
  "memory_summary": "延续之前的架构方案：采用微服务架构，包含 API Gateway 和 Redis 缓存层；当前需在此基础上继续设计 API 层。",
  "requested_scopes": [
    "task",
    "workspace"
  ],
  "requested_memory_types": [
    "task_state"
  ],
  "importance_threshold": 5
}
```

### inject-mixed-relevance

- 模块：`recall-injection-planner`
- 指标：`recall_accuracy_proxy`
- Prompt：`MEMORY_RECALL_INJECTION_SYSTEM_PROMPT`
- 预期：混合相关度时只选高相关候选
- 实际：{"should_inject":true,"selected_record_ids":["mem-form"]}
- 评分：`1.000`
- 结果：通过
- 耗时：23335ms

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
  "current_input": "继续改那个登录页的表单验证。",
  "recent_context_summary": "用户在做前端表单工作。",
  "phase": "before_response",
  "memory_mode": "workspace_plus_global",
  "requested_scopes": [
    "task",
    "workspace",
    "user"
  ],
  "requested_memory_types": [
    "task_state",
    "fact_preference"
  ],
  "search_reason": "延续前端任务",
  "candidates": [
    {
      "id": "mem-form",
      "scope": "task",
      "memory_type": "task_state",
      "summary": "当前任务：实现登录页表单验证，已完成邮箱字段。",
      "importance": 4,
      "confidence": 0.92,
      "rerank_score": 0.88,
      "semantic_score": 0.86,
      "updated_at": "2026-04-22T08:00:00.000Z"
    },
    {
      "id": "mem-color",
      "scope": "user",
      "memory_type": "fact_preference",
      "summary": "用户偏好：主色调用蓝色。",
      "importance": 3,
      "confidence": 0.8,
      "rerank_score": 0.45,
      "semantic_score": 0.4,
      "updated_at": "2026-04-18T08:00:00.000Z"
    },
    {
      "id": "mem-db",
      "scope": "workspace",
      "memory_type": "episodic",
      "summary": "上周优化过数据库索引。",
      "importance": 2,
      "confidence": 0.55,
      "rerank_score": 0.15,
      "semantic_score": 0.12,
      "updated_at": "2026-04-14T08:00:00.000Z"
    }
  ],
  "semantic_score": 0.75,
  "semantic_threshold": 0.72,
  "task_id_present": true
}
```

#### 模型原始输出

```json
{"should_inject":true,"reason":"用户明确要求继续之前的登录页任务，需注入任务状态","selected_record_ids":["mem-form"],"memory_summary":"当前任务是实现登录页表单验证，已完成邮箱字段，需要在此基础上继续推进。","requested_scopes":["task","workspace","user"],"requested_memory_types":["task_state","fact_preference"],"importance_threshold":4}
```

#### 结构化结果

```json
{
  "should_inject": true,
  "reason": "用户明确要求继续之前的登录页任务，需注入任务状态",
  "selected_record_ids": [
    "mem-form"
  ],
  "memory_summary": "当前任务是实现登录页表单验证，已完成邮箱字段，需要在此基础上继续推进。",
  "requested_scopes": [
    "task",
    "workspace",
    "user"
  ],
  "requested_memory_types": [
    "task_state",
    "fact_preference"
  ],
  "importance_threshold": 4
}
```

### inject-empty-candidates

- 模块：`recall-injection-planner`
- 指标：`recall_accuracy_proxy`
- Prompt：`MEMORY_RECALL_INJECTION_SYSTEM_PROMPT`
- 预期：无候选时不应注入
- 实际：{"should_inject":false}
- 评分：`1.000`
- 结果：通过
- 耗时：10172ms

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
  "current_input": "帮我重构这个函数。",
  "recent_context_summary": "用户在做代码重构。",
  "phase": "before_response",
  "memory_mode": "workspace_plus_global",
  "requested_scopes": [
    "workspace"
  ],
  "requested_memory_types": [
    "fact_preference"
  ],
  "search_reason": "检索无结果",
  "candidates": [],
  "semantic_score": 0.3,
  "semantic_threshold": 0.72,
  "task_id_present": false
}
```

#### 模型原始输出

```json
{"should_inject":false,"reason":"当前请求过于笼统且无可用候选记忆","selected_record_ids":[],"memory_summary":"","requested_scopes":["workspace"],"requested_memory_types":["fact_preference"],"importance_threshold":3}
```

#### 结构化结果

```json
{
  "should_inject": false,
  "reason": "当前请求过于笼统且无可用候选记忆",
  "selected_record_ids": [],
  "memory_summary": "",
  "requested_scopes": [
    "workspace"
  ],
  "requested_memory_types": [
    "fact_preference"
  ],
  "importance_threshold": 3
}
```

### extract-durable-preference

- 模块：`writeback-extractor`
- 指标：`writeback_extraction_accuracy`
- Prompt：`MEMORY_WRITEBACK_EXTRACTION_SYSTEM_PROMPT`
- 预期：应提取用户偏好为 fact_preference
- 实际：[{"type":"fact_preference","scope":"user","summary":"偏好代码使用 4 空格缩进，不使用 tab"}]
- 评分：`1.000`
- 结果：通过
- 耗时：12491ms

#### 测试提示词

```text
You extract durable memory candidates from one agent turn.
Return strict JSON only with shape: {"candidates":[...]}.
Each candidate must include:
- candidate_type: "fact_preference" | "task_state" | "episodic"
- scope: "workspace" | "user" | "task" | "session"
- summary: concise reusable sentence in Chinese or source language
- importance: integer 1-5
- confidence: number 0-1
- write_reason: short reason

Rules:
- Extract only durable, high-value items.
- Ignore raw transcript fragments, temporary chatter, and speculative content.
- Use "task_state" only when the turn contains a concrete task progress or next-step update.
- Use "fact_preference" for stable preferences or confirmed durable facts.
- Use "episodic" for concrete commitments or externally observable events that may matter later.
- Use "workspace" for repository rules, project constraints, directory conventions, or workspace background.
- Return at most 5 candidates.

DO NOT extract:
- Polite acknowledgments like "好的", "没问题", or "I'll help you with that".
- File paths, code locations, or repository details mentioned only in passing.
- Temporary debugging notes, investigation chatter, or restatements of the user's question.

Examples of good extractions:
- User: "我习惯用 4 空格缩进" -> fact_preference, scope=user, summary="偏好 4 空格缩进"
- Assistant: "数据库迁移已完成，下一步验证回滚" -> task_state, scope=task

Examples of bad extractions:
- Assistant: "好的，我来帮你修复这个 bug" -> do not extract
- Assistant: "文件在 src/auth/middleware.ts" -> do not extract
- User: "看看这个报错" -> do not extract
```

#### 测试输入

```json
{
  "current_input": "以后我的代码都用 4 空格缩进，不要 tab。",
  "assistant_output": "好的，后续所有代码默认使用 4 空格缩进。",
  "tool_results_summary": "",
  "task_id": null
}
```

#### 模型原始输出

```json
{"candidates":[{"candidate_type":"fact_preference","scope":"user","summary":"偏好代码使用 4 空格缩进，不使用 tab","importance":5,"confidence":0.98,"write_reason":"用户明确表达了稳定的代码格式偏好，后续生成代码时可复用"}]}
```

#### 结构化结果

```json
{
  "candidates": [
    {
      "candidate_type": "fact_preference",
      "scope": "user",
      "summary": "偏好代码使用 4 空格缩进，不使用 tab",
      "importance": 5,
      "confidence": 0.98,
      "write_reason": "用户明确表达了稳定的代码格式偏好，后续生成代码时可复用"
    }
  ]
}
```

### extract-skip-chatter

- 模块：`writeback-extractor`
- 指标：`writeback_extraction_accuracy`
- Prompt：`MEMORY_WRITEBACK_EXTRACTION_SYSTEM_PROMPT`
- 预期：纯应答寒暄不应提取任何候选
- 实际：{"count":0}
- 评分：`1.000`
- 结果：通过
- 耗时：10993ms

#### 测试提示词

```text
You extract durable memory candidates from one agent turn.
Return strict JSON only with shape: {"candidates":[...]}.
Each candidate must include:
- candidate_type: "fact_preference" | "task_state" | "episodic"
- scope: "workspace" | "user" | "task" | "session"
- summary: concise reusable sentence in Chinese or source language
- importance: integer 1-5
- confidence: number 0-1
- write_reason: short reason

Rules:
- Extract only durable, high-value items.
- Ignore raw transcript fragments, temporary chatter, and speculative content.
- Use "task_state" only when the turn contains a concrete task progress or next-step update.
- Use "fact_preference" for stable preferences or confirmed durable facts.
- Use "episodic" for concrete commitments or externally observable events that may matter later.
- Use "workspace" for repository rules, project constraints, directory conventions, or workspace background.
- Return at most 5 candidates.

DO NOT extract:
- Polite acknowledgments like "好的", "没问题", or "I'll help you with that".
- File paths, code locations, or repository details mentioned only in passing.
- Temporary debugging notes, investigation chatter, or restatements of the user's question.

Examples of good extractions:
- User: "我习惯用 4 空格缩进" -> fact_preference, scope=user, summary="偏好 4 空格缩进"
- Assistant: "数据库迁移已完成，下一步验证回滚" -> task_state, scope=task

Examples of bad extractions:
- Assistant: "好的，我来帮你修复这个 bug" -> do not extract
- Assistant: "文件在 src/auth/middleware.ts" -> do not extract
- User: "看看这个报错" -> do not extract
```

#### 测试输入

```json
{
  "current_input": "帮我看看这个报错。",
  "assistant_output": "好的，我来帮你看看这个问题。",
  "tool_results_summary": "",
  "task_id": null
}
```

#### 模型原始输出

```json
{"candidates":[]}
```

#### 结构化结果

```json
{
  "candidates": []
}
```

### extract-task-progress

- 模块：`writeback-extractor`
- 指标：`writeback_extraction_accuracy`
- Prompt：`MEMORY_WRITEBACK_EXTRACTION_SYSTEM_PROMPT`
- 预期：应提取任务进度为 task_state
- 实际：[{"type":"task_state","scope":"task","summary":"数据库迁移已完成第 3 步（共 5 步），下一步是第 4 步创建索引"}]
- 评分：`1.000`
- 结果：通过
- 耗时：11599ms

#### 测试提示词

```text
You extract durable memory candidates from one agent turn.
Return strict JSON only with shape: {"candidates":[...]}.
Each candidate must include:
- candidate_type: "fact_preference" | "task_state" | "episodic"
- scope: "workspace" | "user" | "task" | "session"
- summary: concise reusable sentence in Chinese or source language
- importance: integer 1-5
- confidence: number 0-1
- write_reason: short reason

Rules:
- Extract only durable, high-value items.
- Ignore raw transcript fragments, temporary chatter, and speculative content.
- Use "task_state" only when the turn contains a concrete task progress or next-step update.
- Use "fact_preference" for stable preferences or confirmed durable facts.
- Use "episodic" for concrete commitments or externally observable events that may matter later.
- Use "workspace" for repository rules, project constraints, directory conventions, or workspace background.
- Return at most 5 candidates.

DO NOT extract:
- Polite acknowledgments like "好的", "没问题", or "I'll help you with that".
- File paths, code locations, or repository details mentioned only in passing.
- Temporary debugging notes, investigation chatter, or restatements of the user's question.

Examples of good extractions:
- User: "我习惯用 4 空格缩进" -> fact_preference, scope=user, summary="偏好 4 空格缩进"
- Assistant: "数据库迁移已完成，下一步验证回滚" -> task_state, scope=task

Examples of bad extractions:
- Assistant: "好的，我来帮你修复这个 bug" -> do not extract
- Assistant: "文件在 src/auth/middleware.ts" -> do not extract
- User: "看看这个报错" -> do not extract
```

#### 测试输入

```json
{
  "current_input": "数据库迁移做到哪了？",
  "assistant_output": "迁移脚本已执行到第 3 步（共 5 步），第 4 步是创建索引，预计 10 分钟完成。",
  "tool_results_summary": "migration run: step 3/5 completed",
  "task_id": "task-migrate-1"
}
```

#### 模型原始输出

```json
{"candidates":[{"candidate_type":"task_state","scope":"task","summary":"数据库迁移已完成第 3 步（共 5 步），下一步是第 4 步创建索引","importance":4,"confidence":0.95,"write_reason":"包含明确的任务进度和下一步，可用于后续衔接"}]}
```

#### 结构化结果

```json
{
  "candidates": [
    {
      "candidate_type": "task_state",
      "scope": "task",
      "summary": "数据库迁移已完成第 3 步（共 5 步），下一步是第 4 步创建索引",
      "importance": 4,
      "confidence": 0.95,
      "write_reason": "包含明确的任务进度和下一步，可用于后续衔接"
    }
  ]
}
```

### extract-skip-file-path

- 模块：`writeback-extractor`
- 指标：`writeback_extraction_accuracy`
- Prompt：`MEMORY_WRITEBACK_EXTRACTION_SYSTEM_PROMPT`
- 预期：路径/代码位置提及不应被提取
- 实际：{"count":0}
- 评分：`1.000`
- 结果：通过
- 耗时：14707ms

#### 测试提示词

```text
You extract durable memory candidates from one agent turn.
Return strict JSON only with shape: {"candidates":[...]}.
Each candidate must include:
- candidate_type: "fact_preference" | "task_state" | "episodic"
- scope: "workspace" | "user" | "task" | "session"
- summary: concise reusable sentence in Chinese or source language
- importance: integer 1-5
- confidence: number 0-1
- write_reason: short reason

Rules:
- Extract only durable, high-value items.
- Ignore raw transcript fragments, temporary chatter, and speculative content.
- Use "task_state" only when the turn contains a concrete task progress or next-step update.
- Use "fact_preference" for stable preferences or confirmed durable facts.
- Use "episodic" for concrete commitments or externally observable events that may matter later.
- Use "workspace" for repository rules, project constraints, directory conventions, or workspace background.
- Return at most 5 candidates.

DO NOT extract:
- Polite acknowledgments like "好的", "没问题", or "I'll help you with that".
- File paths, code locations, or repository details mentioned only in passing.
- Temporary debugging notes, investigation chatter, or restatements of the user's question.

Examples of good extractions:
- User: "我习惯用 4 空格缩进" -> fact_preference, scope=user, summary="偏好 4 空格缩进"
- Assistant: "数据库迁移已完成，下一步验证回滚" -> task_state, scope=task

Examples of bad extractions:
- Assistant: "好的，我来帮你修复这个 bug" -> do not extract
- Assistant: "文件在 src/auth/middleware.ts" -> do not extract
- User: "看看这个报错" -> do not extract
```

#### 测试输入

```json
{
  "current_input": "auth 中间件在哪？",
  "assistant_output": "认证中间件在 src/middleware/auth.ts 文件中，第 42 行开始。",
  "tool_results_summary": "",
  "task_id": null
}
```

#### 模型原始输出

```json
{"candidates":[]}
```

#### 结构化结果

```json
{
  "candidates": []
}
```

### extract-workspace-convention

- 模块：`writeback-extractor`
- 指标：`writeback_extraction_accuracy`
- Prompt：`MEMORY_WRITEBACK_EXTRACTION_SYSTEM_PROMPT`
- 预期：项目约定应提取为 workspace scope 的 fact_preference
- 实际：[{"type":"fact_preference","scope":"workspace","summary":"项目中的所有 API 都需要使用 /api/v2 作为统一前缀"}]
- 评分：`1.000`
- 结果：通过
- 耗时：12130ms

#### 测试提示词

```text
You extract durable memory candidates from one agent turn.
Return strict JSON only with shape: {"candidates":[...]}.
Each candidate must include:
- candidate_type: "fact_preference" | "task_state" | "episodic"
- scope: "workspace" | "user" | "task" | "session"
- summary: concise reusable sentence in Chinese or source language
- importance: integer 1-5
- confidence: number 0-1
- write_reason: short reason

Rules:
- Extract only durable, high-value items.
- Ignore raw transcript fragments, temporary chatter, and speculative content.
- Use "task_state" only when the turn contains a concrete task progress or next-step update.
- Use "fact_preference" for stable preferences or confirmed durable facts.
- Use "episodic" for concrete commitments or externally observable events that may matter later.
- Use "workspace" for repository rules, project constraints, directory conventions, or workspace background.
- Return at most 5 candidates.

DO NOT extract:
- Polite acknowledgments like "好的", "没问题", or "I'll help you with that".
- File paths, code locations, or repository details mentioned only in passing.
- Temporary debugging notes, investigation chatter, or restatements of the user's question.

Examples of good extractions:
- User: "我习惯用 4 空格缩进" -> fact_preference, scope=user, summary="偏好 4 空格缩进"
- Assistant: "数据库迁移已完成，下一步验证回滚" -> task_state, scope=task

Examples of bad extractions:
- Assistant: "好的，我来帮你修复这个 bug" -> do not extract
- Assistant: "文件在 src/auth/middleware.ts" -> do not extract
- User: "看看这个报错" -> do not extract
```

#### 测试输入

```json
{
  "current_input": "这个项目所有 API 都要加 /api/v2 前缀。",
  "assistant_output": "了解，后续所有新建的 API 路由都会加上 /api/v2 前缀。",
  "tool_results_summary": "",
  "task_id": null
}
```

#### 模型原始输出

```json
{"candidates":[{"candidate_type":"fact_preference","scope":"workspace","summary":"项目中的所有 API 都需要使用 /api/v2 作为统一前缀","importance":5,"confidence":0.98,"write_reason":"这是项目级接口约束，属于后续开发应持续遵守的规则"}]}
```

#### 结构化结果

```json
{
  "candidates": [
    {
      "candidate_type": "fact_preference",
      "scope": "workspace",
      "summary": "项目中的所有 API 都需要使用 /api/v2 作为统一前缀",
      "importance": 5,
      "confidence": 0.98,
      "write_reason": "这是项目级接口约束，属于后续开发应持续遵守的规则"
    }
  ]
}
```

### extract-episodic-event

- 模块：`writeback-extractor`
- 指标：`writeback_extraction_accuracy`
- Prompt：`MEMORY_WRITEBACK_EXTRACTION_SYSTEM_PROMPT`
- 预期：具体的外部事件应提取为 episodic
- 实际：[{"type":"episodic","scope":"workspace","summary":"生产数据库已升级到 PostgreSQL 16，后续可考虑使用 PG16 新特性。"}]
- 评分：`1.000`
- 结果：通过
- 耗时：16584ms

#### 测试提示词

```text
You extract durable memory candidates from one agent turn.
Return strict JSON only with shape: {"candidates":[...]}.
Each candidate must include:
- candidate_type: "fact_preference" | "task_state" | "episodic"
- scope: "workspace" | "user" | "task" | "session"
- summary: concise reusable sentence in Chinese or source language
- importance: integer 1-5
- confidence: number 0-1
- write_reason: short reason

Rules:
- Extract only durable, high-value items.
- Ignore raw transcript fragments, temporary chatter, and speculative content.
- Use "task_state" only when the turn contains a concrete task progress or next-step update.
- Use "fact_preference" for stable preferences or confirmed durable facts.
- Use "episodic" for concrete commitments or externally observable events that may matter later.
- Use "workspace" for repository rules, project constraints, directory conventions, or workspace background.
- Return at most 5 candidates.

DO NOT extract:
- Polite acknowledgments like "好的", "没问题", or "I'll help you with that".
- File paths, code locations, or repository details mentioned only in passing.
- Temporary debugging notes, investigation chatter, or restatements of the user's question.

Examples of good extractions:
- User: "我习惯用 4 空格缩进" -> fact_preference, scope=user, summary="偏好 4 空格缩进"
- Assistant: "数据库迁移已完成，下一步验证回滚" -> task_state, scope=task

Examples of bad extractions:
- Assistant: "好的，我来帮你修复这个 bug" -> do not extract
- Assistant: "文件在 src/auth/middleware.ts" -> do not extract
- User: "看看这个报错" -> do not extract
```

#### 测试输入

```json
{
  "current_input": "刚刚和运维确认过了，生产数据库已经升级到 PostgreSQL 16。",
  "assistant_output": "记录到了，后续 SQL 可以用 PG16 新特性。",
  "tool_results_summary": "",
  "task_id": null
}
```

#### 模型原始输出

```json
{"candidates":[{"candidate_type":"episodic","scope":"workspace","summary":"生产数据库已升级到 PostgreSQL 16，后续可考虑使用 PG16 新特性。","importance":4,"confidence":0.95,"write_reason":"这是项目环境的重要变更，会影响后续 SQL 方案与兼容性判断。"}]}
```

#### 结构化结果

```json
{
  "candidates": [
    {
      "candidate_type": "episodic",
      "scope": "workspace",
      "summary": "生产数据库已升级到 PostgreSQL 16，后续可考虑使用 PG16 新特性。",
      "importance": 4,
      "confidence": 0.95,
      "write_reason": "这是项目环境的重要变更，会影响后续 SQL 方案与兼容性判断。"
    }
  ]
}
```

### extract-skip-question-echo

- 模块：`writeback-extractor`
- 指标：`writeback_extraction_accuracy`
- Prompt：`MEMORY_WRITEBACK_EXTRACTION_SYSTEM_PROMPT`
- 预期：助手重述用户问题不应被提取
- 实际：{"count":0}
- 评分：`1.000`
- 结果：通过
- 耗时：12944ms

#### 测试提示词

```text
You extract durable memory candidates from one agent turn.
Return strict JSON only with shape: {"candidates":[...]}.
Each candidate must include:
- candidate_type: "fact_preference" | "task_state" | "episodic"
- scope: "workspace" | "user" | "task" | "session"
- summary: concise reusable sentence in Chinese or source language
- importance: integer 1-5
- confidence: number 0-1
- write_reason: short reason

Rules:
- Extract only durable, high-value items.
- Ignore raw transcript fragments, temporary chatter, and speculative content.
- Use "task_state" only when the turn contains a concrete task progress or next-step update.
- Use "fact_preference" for stable preferences or confirmed durable facts.
- Use "episodic" for concrete commitments or externally observable events that may matter later.
- Use "workspace" for repository rules, project constraints, directory conventions, or workspace background.
- Return at most 5 candidates.

DO NOT extract:
- Polite acknowledgments like "好的", "没问题", or "I'll help you with that".
- File paths, code locations, or repository details mentioned only in passing.
- Temporary debugging notes, investigation chatter, or restatements of the user's question.

Examples of good extractions:
- User: "我习惯用 4 空格缩进" -> fact_preference, scope=user, summary="偏好 4 空格缩进"
- Assistant: "数据库迁移已完成，下一步验证回滚" -> task_state, scope=task

Examples of bad extractions:
- Assistant: "好的，我来帮你修复这个 bug" -> do not extract
- Assistant: "文件在 src/auth/middleware.ts" -> do not extract
- User: "看看这个报错" -> do not extract
```

#### 测试输入

```json
{
  "current_input": "为什么构建会失败？",
  "assistant_output": "你问的是构建失败的原因，让我检查一下日志。目前还没有定论。",
  "tool_results_summary": "",
  "task_id": null
}
```

#### 模型原始输出

```json
{"candidates":[]}
```

#### 结构化结果

```json
{
  "candidates": []
}
```

### extract-multi-fact

- 模块：`writeback-extractor`
- 指标：`writeback_extraction_accuracy`
- Prompt：`MEMORY_WRITEBACK_EXTRACTION_SYSTEM_PROMPT`
- 预期：一轮包含多个持久事实时应提取多个候选
- 实际：{"count":3,"types":["fact_preference","fact_preference","fact_preference"]}
- 评分：`1.000`
- 结果：通过
- 耗时：15565ms

#### 测试提示词

```text
You extract durable memory candidates from one agent turn.
Return strict JSON only with shape: {"candidates":[...]}.
Each candidate must include:
- candidate_type: "fact_preference" | "task_state" | "episodic"
- scope: "workspace" | "user" | "task" | "session"
- summary: concise reusable sentence in Chinese or source language
- importance: integer 1-5
- confidence: number 0-1
- write_reason: short reason

Rules:
- Extract only durable, high-value items.
- Ignore raw transcript fragments, temporary chatter, and speculative content.
- Use "task_state" only when the turn contains a concrete task progress or next-step update.
- Use "fact_preference" for stable preferences or confirmed durable facts.
- Use "episodic" for concrete commitments or externally observable events that may matter later.
- Use "workspace" for repository rules, project constraints, directory conventions, or workspace background.
- Return at most 5 candidates.

DO NOT extract:
- Polite acknowledgments like "好的", "没问题", or "I'll help you with that".
- File paths, code locations, or repository details mentioned only in passing.
- Temporary debugging notes, investigation chatter, or restatements of the user's question.

Examples of good extractions:
- User: "我习惯用 4 空格缩进" -> fact_preference, scope=user, summary="偏好 4 空格缩进"
- Assistant: "数据库迁移已完成，下一步验证回滚" -> task_state, scope=task

Examples of bad extractions:
- Assistant: "好的，我来帮你修复这个 bug" -> do not extract
- Assistant: "文件在 src/auth/middleware.ts" -> do not extract
- User: "看看这个报错" -> do not extract
```

#### 测试输入

```json
{
  "current_input": "记一下：我用 Vim 键位，终端用 zsh，测试框架用 vitest。",
  "assistant_output": "已记录你的开发环境偏好。",
  "tool_results_summary": "",
  "task_id": null
}
```

#### 模型原始输出

```json
{"candidates":[{"candidate_type":"fact_preference","scope":"user","summary":"偏好使用 Vim 键位","importance":4,"confidence":0.97,"write_reason":"这是稳定的编辑习惯偏好，后续生成操作建议时有用"},{"candidate_type":"fact_preference","scope":"user","summary":"终端环境使用 zsh","importance":4,"confidence":0.96,"write_reason":"这是稳定的开发环境事实，后续命令示例可据此适配"},{"candidate_type":"fact_preference","scope":"user","summary":"测试框架使用 vitest","importance":5,"confidence":0.98,"write_reason":"这是稳定的项目/开发偏好，后续测试相关建议需要据此适配"}]}
```

#### 结构化结果

```json
{
  "candidates": [
    {
      "candidate_type": "fact_preference",
      "scope": "user",
      "summary": "偏好使用 Vim 键位",
      "importance": 4,
      "confidence": 0.97,
      "write_reason": "这是稳定的编辑习惯偏好，后续生成操作建议时有用"
    },
    {
      "candidate_type": "fact_preference",
      "scope": "user",
      "summary": "终端环境使用 zsh",
      "importance": 4,
      "confidence": 0.96,
      "write_reason": "这是稳定的开发环境事实，后续命令示例可据此适配"
    },
    {
      "candidate_type": "fact_preference",
      "scope": "user",
      "summary": "测试框架使用 vitest",
      "importance": 5,
      "confidence": 0.98,
      "write_reason": "这是稳定的项目/开发偏好，后续测试相关建议需要据此适配"
    }
  ]
}
```

### refine-drop-low-signal

- 模块：`writeback-refiner`
- 指标：`writeback_refine_accuracy`
- Prompt：`MEMORY_WRITEBACK_REFINE_SYSTEM_PROMPT`
- 预期：应 drop 低信号的应答候选
- 实际：[{"source":"rule_index:0","action":"drop"}]
- 评分：`1.000`
- 结果：通过
- 耗时：9135ms

#### 测试提示词

```text
You refine a list of rule-generated writeback candidates for durable agent memory.

Input JSON carries:
- current_input, assistant_output, tool_results_summary, task_id
- rule_candidates: [{ index, candidate_type, scope, summary, importance, confidence, write_reason }]

Return strict JSON only with shape: {"refined_candidates":[ ... ]}
Each item MUST include:
- source: "rule_index:<N>" for an existing rule candidate, OR "llm_new" for a brand-new one
- action: "keep" | "drop" | "merge" | "new"
- reason: concise justification

Action-specific fields:
- keep: may override summary/importance/confidence/scope/candidate_type when the rule value is suboptimal
- drop: no extra fields; use to remove a false positive
- merge: MUST include merge_with: ["rule_index:<N>", ...] listing the other rule candidates being consolidated; the emitted summary/importance is the consolidated version
- new: MUST set summary, importance, confidence, scope, candidate_type

Behavioural rules:
- Prefer drop over keep when the rule candidate is a polite acknowledgment, a file path restatement, a question echo, or content that is not durable.
- Merge only when two or more rule candidates describe the same durable fact or state.
- Add a new candidate only when the turn clearly surfaces information the rules missed; avoid speculation.
- Scope must be one of: workspace | user | task | session.
- Importance is an integer 1-5; confidence is 0-1.
- Emit at most 9 items.
```

#### 测试输入

```json
{
  "current_input": "帮我看看日志",
  "assistant_output": "好的，我来处理。",
  "tool_results_summary": "",
  "task_id": null,
  "rule_candidates": [
    {
      "index": 0,
      "candidate_type": "episodic",
      "scope": "session",
      "summary": "助手确认会处理日志查看请求。",
      "importance": 2,
      "confidence": 0.5,
      "write_reason": "assistant acknowledged"
    }
  ]
}
```

#### 模型原始输出

```json
{"refined_candidates":[{"source":"rule_index:0","action":"drop","reason":"Polite acknowledgment of the request; not durable memory."}]}
```

#### 结构化结果

```json
{
  "refined_candidates": [
    {
      "source": "rule_index:0",
      "action": "drop",
      "reason": "Polite acknowledgment of the request; not durable memory."
    }
  ]
}
```

### refine-keep-good-candidate

- 模块：`writeback-refiner`
- 指标：`writeback_refine_accuracy`
- Prompt：`MEMORY_WRITEBACK_REFINE_SYSTEM_PROMPT`
- 预期：应 keep 稳定偏好候选
- 实际：[{"source":"rule_index:0","action":"keep"}]
- 评分：`1.000`
- 结果：通过
- 耗时：10708ms

#### 测试提示词

```text
You refine a list of rule-generated writeback candidates for durable agent memory.

Input JSON carries:
- current_input, assistant_output, tool_results_summary, task_id
- rule_candidates: [{ index, candidate_type, scope, summary, importance, confidence, write_reason }]

Return strict JSON only with shape: {"refined_candidates":[ ... ]}
Each item MUST include:
- source: "rule_index:<N>" for an existing rule candidate, OR "llm_new" for a brand-new one
- action: "keep" | "drop" | "merge" | "new"
- reason: concise justification

Action-specific fields:
- keep: may override summary/importance/confidence/scope/candidate_type when the rule value is suboptimal
- drop: no extra fields; use to remove a false positive
- merge: MUST include merge_with: ["rule_index:<N>", ...] listing the other rule candidates being consolidated; the emitted summary/importance is the consolidated version
- new: MUST set summary, importance, confidence, scope, candidate_type

Behavioural rules:
- Prefer drop over keep when the rule candidate is a polite acknowledgment, a file path restatement, a question echo, or content that is not durable.
- Merge only when two or more rule candidates describe the same durable fact or state.
- Add a new candidate only when the turn clearly surfaces information the rules missed; avoid speculation.
- Scope must be one of: workspace | user | task | session.
- Importance is an integer 1-5; confidence is 0-1.
- Emit at most 9 items.
```

#### 测试输入

```json
{
  "current_input": "以后默认中文回答，不要英文。",
  "assistant_output": "已确认，后续默认使用中文。",
  "tool_results_summary": "",
  "task_id": null,
  "rule_candidates": [
    {
      "index": 0,
      "candidate_type": "fact_preference",
      "scope": "user",
      "summary": "用户偏好：默认中文回答。",
      "importance": 5,
      "confidence": 0.95,
      "write_reason": "stable language preference"
    }
  ]
}
```

#### 模型原始输出

```json
{"refined_candidates":[{"source":"rule_index:0","action":"keep","reason":"明确且持久的语言偏好，适合写入用户记忆。"}]}
```

#### 结构化结果

```json
{
  "refined_candidates": [
    {
      "source": "rule_index:0",
      "action": "keep",
      "reason": "明确且持久的语言偏好，适合写入用户记忆。"
    }
  ]
}
```

### refine-merge-duplicates

- 模块：`writeback-refiner`
- 指标：`writeback_refine_accuracy`
- Prompt：`MEMORY_WRITEBACK_REFINE_SYSTEM_PROMPT`
- 预期：两条描述同一事实的候选应 merge
- 实际：[{"source":"rule_index:0","action":"keep"},{"source":"rule_index:1","action":"keep"}]
- 评分：`0.600`
- 结果：通过
- 耗时：22303ms

#### 测试提示词

```text
You refine a list of rule-generated writeback candidates for durable agent memory.

Input JSON carries:
- current_input, assistant_output, tool_results_summary, task_id
- rule_candidates: [{ index, candidate_type, scope, summary, importance, confidence, write_reason }]

Return strict JSON only with shape: {"refined_candidates":[ ... ]}
Each item MUST include:
- source: "rule_index:<N>" for an existing rule candidate, OR "llm_new" for a brand-new one
- action: "keep" | "drop" | "merge" | "new"
- reason: concise justification

Action-specific fields:
- keep: may override summary/importance/confidence/scope/candidate_type when the rule value is suboptimal
- drop: no extra fields; use to remove a false positive
- merge: MUST include merge_with: ["rule_index:<N>", ...] listing the other rule candidates being consolidated; the emitted summary/importance is the consolidated version
- new: MUST set summary, importance, confidence, scope, candidate_type

Behavioural rules:
- Prefer drop over keep when the rule candidate is a polite acknowledgment, a file path restatement, a question echo, or content that is not durable.
- Merge only when two or more rule candidates describe the same durable fact or state.
- Add a new candidate only when the turn clearly surfaces information the rules missed; avoid speculation.
- Scope must be one of: workspace | user | task | session.
- Importance is an integer 1-5; confidence is 0-1.
- Emit at most 9 items.
```

#### 测试输入

```json
{
  "current_input": "用中文回答，简短一点。",
  "assistant_output": "好的，后续默认中文、简短输出。",
  "tool_results_summary": "",
  "task_id": null,
  "rule_candidates": [
    {
      "index": 0,
      "candidate_type": "fact_preference",
      "scope": "user",
      "summary": "用户偏好：使用中文。",
      "importance": 5,
      "confidence": 0.92,
      "write_reason": "language preference"
    },
    {
      "index": 1,
      "candidate_type": "fact_preference",
      "scope": "user",
      "summary": "用户偏好：简短回答。",
      "importance": 4,
      "confidence": 0.88,
      "write_reason": "brevity preference"
    }
  ]
}
```

#### 模型原始输出

```json
{"refined_candidates":[{"source":"rule_index:0","action":"keep","reason":"明确的长期语言偏好，适合持久化。","summary":"用户偏好：默认用中文回答。","importance":5,"confidence":0.96,"scope":"user","candidate_type":"fact_preference"},{"source":"rule_index:1","action":"keep","reason":"明确的输出风格偏好，具有跨任务稳定性。","summary":"用户偏好：回答尽量简短。","importance":4,"confidence":0.93,"scope":"user","candidate_type":"fact_preference"}]}
```

#### 结构化结果

```json
{
  "refined_candidates": [
    {
      "source": "rule_index:0",
      "action": "keep",
      "summary": "用户偏好：默认用中文回答。",
      "importance": 5,
      "confidence": 0.96,
      "scope": "user",
      "candidate_type": "fact_preference",
      "reason": "明确的长期语言偏好，适合持久化。"
    },
    {
      "source": "rule_index:1",
      "action": "keep",
      "summary": "用户偏好：回答尽量简短。",
      "importance": 4,
      "confidence": 0.93,
      "scope": "user",
      "candidate_type": "fact_preference",
      "reason": "明确的输出风格偏好，具有跨任务稳定性。"
    }
  ]
}
```

### refine-add-new-missed

- 模块：`writeback-refiner`
- 指标：`writeback_refine_accuracy`
- Prompt：`MEMORY_WRITEBACK_REFINE_SYSTEM_PROMPT`
- 预期：规则遗漏的重要事实应作为 new 补充
- 实际：执行失败
- 评分：`0.000`
- 结果：未通过
- 耗时：24280ms
- 错误类型：`schema`
- 错误：`[
  {
    "received": "preference",
    "code": "invalid_enum_value",
    "options": [
      "fact_preference",
      "task_state",
      "episodic"
    ],
    "path": [
      "refined_candidates",
      1,
      "candidate_type"
    ],
    "message": "Invalid enum value. Expected 'fact_preference' | 'task_state' | 'episodic', received 'preference'"
  },
  {
    "received": "fact",
    "code": "invalid_enum_value",
    "options": [
      "fact_preference",
      "task_state",
      "episodic"
    ],
    "path": [
      "refined_candidates",
      2,
      "candidate_type"
    ],
    "message": "Invalid enum value. Expected 'fact_preference' | 'task_state' | 'episodic', received 'fact'"
  }
]`

#### 测试提示词

```text
You refine a list of rule-generated writeback candidates for durable agent memory.

Input JSON carries:
- current_input, assistant_output, tool_results_summary, task_id
- rule_candidates: [{ index, candidate_type, scope, summary, importance, confidence, write_reason }]

Return strict JSON only with shape: {"refined_candidates":[ ... ]}
Each item MUST include:
- source: "rule_index:<N>" for an existing rule candidate, OR "llm_new" for a brand-new one
- action: "keep" | "drop" | "merge" | "new"
- reason: concise justification

Action-specific fields:
- keep: may override summary/importance/confidence/scope/candidate_type when the rule value is suboptimal
- drop: no extra fields; use to remove a false positive
- merge: MUST include merge_with: ["rule_index:<N>", ...] listing the other rule candidates being consolidated; the emitted summary/importance is the consolidated version
- new: MUST set summary, importance, confidence, scope, candidate_type

Behavioural rules:
- Prefer drop over keep when the rule candidate is a polite acknowledgment, a file path restatement, a question echo, or content that is not durable.
- Merge only when two or more rule candidates describe the same durable fact or state.
- Add a new candidate only when the turn clearly surfaces information the rules missed; avoid speculation.
- Scope must be one of: workspace | user | task | session.
- Importance is an integer 1-5; confidence is 0-1.
- Emit at most 9 items.
```

#### 测试输入

```json
{
  "current_input": "项目从今天起不允许使用 any 类型。另外这个 bug 我看了。",
  "assistant_output": "了解，已在 tsconfig 中启用 strict 模式。这个 bug 是空指针引起的。",
  "tool_results_summary": "",
  "task_id": "task-strict-1",
  "rule_candidates": [
    {
      "index": 0,
      "candidate_type": "episodic",
      "scope": "session",
      "summary": "助手查看了一个 bug。",
      "importance": 2,
      "confidence": 0.55,
      "write_reason": "assistant investigated bug"
    }
  ]
}
```

### refine-keep-all-valid

- 模块：`writeback-refiner`
- 指标：`writeback_refine_accuracy`
- Prompt：`MEMORY_WRITEBACK_REFINE_SYSTEM_PROMPT`
- 预期：多条有效且不重复的候选应全部 keep
- 实际：[{"source":"rule_index:0","action":"keep"},{"source":"rule_index:1","action":"keep"}]
- 评分：`1.000`
- 结果：通过
- 耗时：12558ms

#### 测试提示词

```text
You refine a list of rule-generated writeback candidates for durable agent memory.

Input JSON carries:
- current_input, assistant_output, tool_results_summary, task_id
- rule_candidates: [{ index, candidate_type, scope, summary, importance, confidence, write_reason }]

Return strict JSON only with shape: {"refined_candidates":[ ... ]}
Each item MUST include:
- source: "rule_index:<N>" for an existing rule candidate, OR "llm_new" for a brand-new one
- action: "keep" | "drop" | "merge" | "new"
- reason: concise justification

Action-specific fields:
- keep: may override summary/importance/confidence/scope/candidate_type when the rule value is suboptimal
- drop: no extra fields; use to remove a false positive
- merge: MUST include merge_with: ["rule_index:<N>", ...] listing the other rule candidates being consolidated; the emitted summary/importance is the consolidated version
- new: MUST set summary, importance, confidence, scope, candidate_type

Behavioural rules:
- Prefer drop over keep when the rule candidate is a polite acknowledgment, a file path restatement, a question echo, or content that is not durable.
- Merge only when two or more rule candidates describe the same durable fact or state.
- Add a new candidate only when the turn clearly surfaces information the rules missed; avoid speculation.
- Scope must be one of: workspace | user | task | session.
- Importance is an integer 1-5; confidence is 0-1.
- Emit at most 9 items.
```

#### 测试输入

```json
{
  "current_input": "记一下：Vim 键位、4 空格缩进。",
  "assistant_output": "已记录。",
  "tool_results_summary": "",
  "task_id": null,
  "rule_candidates": [
    {
      "index": 0,
      "candidate_type": "fact_preference",
      "scope": "user",
      "summary": "用户偏好：使用 Vim 键位。",
      "importance": 4,
      "confidence": 0.9,
      "write_reason": "editor preference"
    },
    {
      "index": 1,
      "candidate_type": "fact_preference",
      "scope": "user",
      "summary": "用户偏好：4 空格缩进。",
      "importance": 4,
      "confidence": 0.9,
      "write_reason": "formatting preference"
    }
  ]
}
```

#### 模型原始输出

```json
{"refined_candidates":[{"source":"rule_index:0","action":"keep","reason":"明确的长期编辑偏好，适合写入用户记忆。"},{"source":"rule_index:1","action":"keep","reason":"明确的长期格式化偏好，适合写入用户记忆。"}]}
```

#### 结构化结果

```json
{
  "refined_candidates": [
    {
      "source": "rule_index:0",
      "action": "keep",
      "reason": "明确的长期编辑偏好，适合写入用户记忆。"
    },
    {
      "source": "rule_index:1",
      "action": "keep",
      "reason": "明确的长期格式化偏好，适合写入用户记忆。"
    }
  ]
}
```

### refine-drop-path-restate

- 模块：`writeback-refiner`
- 指标：`writeback_refine_accuracy`
- Prompt：`MEMORY_WRITEBACK_REFINE_SYSTEM_PROMPT`
- 预期：文件路径重述应被 drop
- 实际：[{"source":"rule_index:0","action":"drop"}]
- 评分：`1.000`
- 结果：通过
- 耗时：17110ms

#### 测试提示词

```text
You refine a list of rule-generated writeback candidates for durable agent memory.

Input JSON carries:
- current_input, assistant_output, tool_results_summary, task_id
- rule_candidates: [{ index, candidate_type, scope, summary, importance, confidence, write_reason }]

Return strict JSON only with shape: {"refined_candidates":[ ... ]}
Each item MUST include:
- source: "rule_index:<N>" for an existing rule candidate, OR "llm_new" for a brand-new one
- action: "keep" | "drop" | "merge" | "new"
- reason: concise justification

Action-specific fields:
- keep: may override summary/importance/confidence/scope/candidate_type when the rule value is suboptimal
- drop: no extra fields; use to remove a false positive
- merge: MUST include merge_with: ["rule_index:<N>", ...] listing the other rule candidates being consolidated; the emitted summary/importance is the consolidated version
- new: MUST set summary, importance, confidence, scope, candidate_type

Behavioural rules:
- Prefer drop over keep when the rule candidate is a polite acknowledgment, a file path restatement, a question echo, or content that is not durable.
- Merge only when two or more rule candidates describe the same durable fact or state.
- Add a new candidate only when the turn clearly surfaces information the rules missed; avoid speculation.
- Scope must be one of: workspace | user | task | session.
- Importance is an integer 1-5; confidence is 0-1.
- Emit at most 9 items.
```

#### 测试输入

```json
{
  "current_input": "配置文件在哪？",
  "assistant_output": "配置文件在 src/config/index.ts。",
  "tool_results_summary": "",
  "task_id": null,
  "rule_candidates": [
    {
      "index": 0,
      "candidate_type": "episodic",
      "scope": "workspace",
      "summary": "配置文件位于 src/config/index.ts。",
      "importance": 2,
      "confidence": 0.55,
      "write_reason": "file location mentioned"
    }
  ]
}
```

#### 模型原始输出

```json
{"refined_candidates":[{"source":"rule_index:0","action":"drop","reason":"File path restatement from the current turn is not durable memory."}]}
```

#### 结构化结果

```json
{
  "refined_candidates": [
    {
      "source": "rule_index:0",
      "action": "drop",
      "reason": "File path restatement from the current turn is not durable memory."
    }
  ]
}
```

### refine-upgrade-importance

- 模块：`writeback-refiner`
- 指标：`writeback_refine_accuracy`
- Prompt：`MEMORY_WRITEBACK_REFINE_SYSTEM_PROMPT`
- 预期：关键约束的重要度被低估时应 keep 并提升 importance
- 实际：{"source":"rule_index:0","action":"keep","summary":"项目安全规则：绝对禁止使用 eval。","importance":4,"confidence":0.96,"scope":"workspace","candidate_type":"fact_preference","reason":"明确的项目级安全约束，属于应持久化的编码规则。"}
- 评分：`1.000`
- 结果：通过
- 耗时：12804ms

#### 测试提示词

```text
You refine a list of rule-generated writeback candidates for durable agent memory.

Input JSON carries:
- current_input, assistant_output, tool_results_summary, task_id
- rule_candidates: [{ index, candidate_type, scope, summary, importance, confidence, write_reason }]

Return strict JSON only with shape: {"refined_candidates":[ ... ]}
Each item MUST include:
- source: "rule_index:<N>" for an existing rule candidate, OR "llm_new" for a brand-new one
- action: "keep" | "drop" | "merge" | "new"
- reason: concise justification

Action-specific fields:
- keep: may override summary/importance/confidence/scope/candidate_type when the rule value is suboptimal
- drop: no extra fields; use to remove a false positive
- merge: MUST include merge_with: ["rule_index:<N>", ...] listing the other rule candidates being consolidated; the emitted summary/importance is the consolidated version
- new: MUST set summary, importance, confidence, scope, candidate_type

Behavioural rules:
- Prefer drop over keep when the rule candidate is a polite acknowledgment, a file path restatement, a question echo, or content that is not durable.
- Merge only when two or more rule candidates describe the same durable fact or state.
- Add a new candidate only when the turn clearly surfaces information the rules missed; avoid speculation.
- Scope must be one of: workspace | user | task | session.
- Importance is an integer 1-5; confidence is 0-1.
- Emit at most 9 items.
```

#### 测试输入

```json
{
  "current_input": "绝对不能用 eval，这是安全红线。",
  "assistant_output": "理解，已在 ESLint 中禁用 eval。",
  "tool_results_summary": "",
  "task_id": null,
  "rule_candidates": [
    {
      "index": 0,
      "candidate_type": "fact_preference",
      "scope": "workspace",
      "summary": "项目规则：禁止使用 eval。",
      "importance": 2,
      "confidence": 0.75,
      "write_reason": "security rule"
    }
  ]
}
```

#### 模型原始输出

```json
{"refined_candidates":[{"source":"rule_index:0","action":"keep","reason":"明确的项目级安全约束，属于应持久化的编码规则。","summary":"项目安全规则：绝对禁止使用 eval。","importance":4,"confidence":0.96,"scope":"workspace","candidate_type":"fact_preference"}]}
```

#### 结构化结果

```json
{
  "refined_candidates": [
    {
      "source": "rule_index:0",
      "action": "keep",
      "summary": "项目安全规则：绝对禁止使用 eval。",
      "importance": 4,
      "confidence": 0.96,
      "scope": "workspace",
      "candidate_type": "fact_preference",
      "reason": "明确的项目级安全约束，属于应持久化的编码规则。"
    }
  ]
}
```

### refine-empty-input

- 模块：`writeback-refiner`
- 指标：`writeback_refine_accuracy`
- Prompt：`MEMORY_WRITEBACK_REFINE_SYSTEM_PROMPT`
- 预期：无候选输入时应返回空列表
- 实际：{"count":0}
- 评分：`1.000`
- 结果：通过
- 耗时：7820ms

#### 测试提示词

```text
You refine a list of rule-generated writeback candidates for durable agent memory.

Input JSON carries:
- current_input, assistant_output, tool_results_summary, task_id
- rule_candidates: [{ index, candidate_type, scope, summary, importance, confidence, write_reason }]

Return strict JSON only with shape: {"refined_candidates":[ ... ]}
Each item MUST include:
- source: "rule_index:<N>" for an existing rule candidate, OR "llm_new" for a brand-new one
- action: "keep" | "drop" | "merge" | "new"
- reason: concise justification

Action-specific fields:
- keep: may override summary/importance/confidence/scope/candidate_type when the rule value is suboptimal
- drop: no extra fields; use to remove a false positive
- merge: MUST include merge_with: ["rule_index:<N>", ...] listing the other rule candidates being consolidated; the emitted summary/importance is the consolidated version
- new: MUST set summary, importance, confidence, scope, candidate_type

Behavioural rules:
- Prefer drop over keep when the rule candidate is a polite acknowledgment, a file path restatement, a question echo, or content that is not durable.
- Merge only when two or more rule candidates describe the same durable fact or state.
- Add a new candidate only when the turn clearly surfaces information the rules missed; avoid speculation.
- Scope must be one of: workspace | user | task | session.
- Importance is an integer 1-5; confidence is 0-1.
- Emit at most 9 items.
```

#### 测试输入

```json
{
  "current_input": "你好",
  "assistant_output": "你好！有什么可以帮助你的？",
  "tool_results_summary": "",
  "task_id": null,
  "rule_candidates": []
}
```

#### 模型原始输出

```json
{"refined_candidates":[]}
```

#### 结构化结果

```json
{
  "refined_candidates": []
}
```

### govplan-merge-duplicates

- 模块：`governance-planner`
- 指标：`governance_plan_accuracy`
- Prompt：`MEMORY_GOVERNANCE_PLAN_SYSTEM_PROMPT`
- 预期：两条重复偏好应输出 merge action
- 实际：[{"type":"merge"}]
- 评分：`1.000`
- 结果：通过
- 耗时：13084ms

#### 测试提示词

```text
You plan maintenance actions over a small set of durable memory records.

Input JSON carries:
- seed_records: recently added records (id, memory_type, scope, summary, importance, confidence, created_at)
- related_records: historical records, same workspace, similar in scope or summary
- open_conflicts: [{id, record_id, conflict_with_record_id, conflict_type, conflict_summary}]

Return strict JSON only with shape: {"actions":[ ... ], "notes": "..." }

Each action MUST match one of:
- {"type":"merge","target_record_ids":[ids...],"merged_summary":"...","merged_importance":N,"reason":"..."}
- {"type":"archive","record_id":"...","reason":"..."}
- {"type":"downgrade","record_id":"...","new_importance":N,"reason":"..."}
- {"type":"summarize","source_record_ids":[ids...],"new_summary":"...","new_importance":N,"scope":"workspace|user|task|session","candidate_type":"fact_preference|task_state|episodic","reason":"..."}
- {"type":"delete","record_id":"...","reason":"...","delete_reason":"..."}
- {"type":"resolve_conflict","conflict_id":"...","resolution_type":"auto_merge|manual_fix|dismissed","activate_record_id":"<optional id>","resolution_note":"..."}

Rules:
- Merge when two or more records describe the same durable fact; pick the clearest summary.
- Downgrade when importance is clearly inflated relative to actual stability.
- Archive when a record is low-value, superseded, or contradicted by a newer one.
- Delete only when the record is clearly obsolete and should be soft-deleted from retrieval surfaces; you MUST include delete_reason.
- Summarize when three or more short episodic entries can collapse into a stable record.
- Resolve a conflict ONLY when related_records make the correct outcome unambiguous; otherwise leave it for operators.
- NEVER invent record_ids or conflict_ids; they must appear in the input.
- Emit at most 10 actions total.
- Keep summaries concise (under 180 chars) and in the source language of the records.
```

#### 测试输入

```json
{
  "seed_records": [
    {
      "id": "gp-1",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "task_id": null,
      "session_id": null,
      "memory_type": "fact_preference",
      "scope": "user",
      "status": "active",
      "summary": "用户偏好：默认中文回答。",
      "details": null,
      "importance": 5,
      "confidence": 0.95,
      "created_at": "2026-04-20T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z",
      "last_used_at": null
    },
    {
      "id": "gp-2",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "task_id": null,
      "session_id": null,
      "memory_type": "fact_preference",
      "scope": "user",
      "status": "active",
      "summary": "用户偏好：回答请用中文。",
      "details": null,
      "importance": 4,
      "confidence": 0.88,
      "created_at": "2026-04-20T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z",
      "last_used_at": null
    }
  ],
  "related_records": [],
  "open_conflicts": []
}
```

#### 模型原始输出

```json
{"actions":[{"type":"merge","target_record_ids":["gp-1","gp-2"],"merged_summary":"用户偏好：默认用中文回答。","merged_importance":5,"reason":"两条记录表达同一稳定偏好，内容重复，合并可减少冗余并保留更清晰表述。"}],"notes":"检测到重复的用户语言偏好记录，建议合并为单条稳定事实。"}
```

#### 结构化结果

```json
{
  "actions": [
    {
      "type": "merge",
      "target_record_ids": [
        "gp-1",
        "gp-2"
      ],
      "merged_summary": "用户偏好：默认用中文回答。",
      "merged_importance": 5,
      "reason": "两条记录表达同一稳定偏好，内容重复，合并可减少冗余并保留更清晰表述。"
    }
  ],
  "notes": "检测到重复的用户语言偏好记录，建议合并为单条稳定事实。"
}
```

### govplan-no-action-needed

- 模块：`governance-planner`
- 指标：`governance_plan_accuracy`
- Prompt：`MEMORY_GOVERNANCE_PLAN_SYSTEM_PROMPT`
- 预期：记录互不重复且健康时不应输出 action
- 实际：{"action_count":0}
- 评分：`1.000`
- 结果：通过
- 耗时：13222ms

#### 测试提示词

```text
You plan maintenance actions over a small set of durable memory records.

Input JSON carries:
- seed_records: recently added records (id, memory_type, scope, summary, importance, confidence, created_at)
- related_records: historical records, same workspace, similar in scope or summary
- open_conflicts: [{id, record_id, conflict_with_record_id, conflict_type, conflict_summary}]

Return strict JSON only with shape: {"actions":[ ... ], "notes": "..." }

Each action MUST match one of:
- {"type":"merge","target_record_ids":[ids...],"merged_summary":"...","merged_importance":N,"reason":"..."}
- {"type":"archive","record_id":"...","reason":"..."}
- {"type":"downgrade","record_id":"...","new_importance":N,"reason":"..."}
- {"type":"summarize","source_record_ids":[ids...],"new_summary":"...","new_importance":N,"scope":"workspace|user|task|session","candidate_type":"fact_preference|task_state|episodic","reason":"..."}
- {"type":"delete","record_id":"...","reason":"...","delete_reason":"..."}
- {"type":"resolve_conflict","conflict_id":"...","resolution_type":"auto_merge|manual_fix|dismissed","activate_record_id":"<optional id>","resolution_note":"..."}

Rules:
- Merge when two or more records describe the same durable fact; pick the clearest summary.
- Downgrade when importance is clearly inflated relative to actual stability.
- Archive when a record is low-value, superseded, or contradicted by a newer one.
- Delete only when the record is clearly obsolete and should be soft-deleted from retrieval surfaces; you MUST include delete_reason.
- Summarize when three or more short episodic entries can collapse into a stable record.
- Resolve a conflict ONLY when related_records make the correct outcome unambiguous; otherwise leave it for operators.
- NEVER invent record_ids or conflict_ids; they must appear in the input.
- Emit at most 10 actions total.
- Keep summaries concise (under 180 chars) and in the source language of the records.
```

#### 测试输入

```json
{
  "seed_records": [
    {
      "id": "gp-3",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "task_id": null,
      "session_id": null,
      "memory_type": "fact_preference",
      "scope": "user",
      "status": "active",
      "summary": "用户偏好：使用 Vim 键位。",
      "details": null,
      "importance": 4,
      "confidence": 0.9,
      "created_at": "2026-04-20T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z",
      "last_used_at": null
    },
    {
      "id": "gp-4",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "task_id": null,
      "session_id": null,
      "memory_type": "fact_preference",
      "scope": "workspace",
      "status": "active",
      "summary": "项目规则：API 前缀 /api/v2。",
      "details": null,
      "importance": 5,
      "confidence": 0.95,
      "created_at": "2026-04-20T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z",
      "last_used_at": null
    }
  ],
  "related_records": [],
  "open_conflicts": []
}
```

#### 模型原始输出

```json
{"actions":[],"notes":"未发现重复、冲突或明显需要降级/归档的记录；当前两条记录均清晰且具备持续价值。"}
```

#### 结构化结果

```json
{
  "actions": [],
  "notes": "未发现重复、冲突或明显需要降级/归档的记录；当前两条记录均清晰且具备持续价值。"
}
```

### govplan-archive-superseded

- 模块：`governance-planner`
- 指标：`governance_plan_accuracy`
- Prompt：`MEMORY_GOVERNANCE_PLAN_SYSTEM_PROMPT`
- 预期：旧记录被新记录替代时应归档旧记录
- 实际：[{"type":"merge"}]
- 评分：`0.600`
- 结果：通过
- 耗时：19635ms

#### 测试提示词

```text
You plan maintenance actions over a small set of durable memory records.

Input JSON carries:
- seed_records: recently added records (id, memory_type, scope, summary, importance, confidence, created_at)
- related_records: historical records, same workspace, similar in scope or summary
- open_conflicts: [{id, record_id, conflict_with_record_id, conflict_type, conflict_summary}]

Return strict JSON only with shape: {"actions":[ ... ], "notes": "..." }

Each action MUST match one of:
- {"type":"merge","target_record_ids":[ids...],"merged_summary":"...","merged_importance":N,"reason":"..."}
- {"type":"archive","record_id":"...","reason":"..."}
- {"type":"downgrade","record_id":"...","new_importance":N,"reason":"..."}
- {"type":"summarize","source_record_ids":[ids...],"new_summary":"...","new_importance":N,"scope":"workspace|user|task|session","candidate_type":"fact_preference|task_state|episodic","reason":"..."}
- {"type":"delete","record_id":"...","reason":"...","delete_reason":"..."}
- {"type":"resolve_conflict","conflict_id":"...","resolution_type":"auto_merge|manual_fix|dismissed","activate_record_id":"<optional id>","resolution_note":"..."}

Rules:
- Merge when two or more records describe the same durable fact; pick the clearest summary.
- Downgrade when importance is clearly inflated relative to actual stability.
- Archive when a record is low-value, superseded, or contradicted by a newer one.
- Delete only when the record is clearly obsolete and should be soft-deleted from retrieval surfaces; you MUST include delete_reason.
- Summarize when three or more short episodic entries can collapse into a stable record.
- Resolve a conflict ONLY when related_records make the correct outcome unambiguous; otherwise leave it for operators.
- NEVER invent record_ids or conflict_ids; they must appear in the input.
- Emit at most 10 actions total.
- Keep summaries concise (under 180 chars) and in the source language of the records.
```

#### 测试输入

```json
{
  "seed_records": [
    {
      "id": "gp-new",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "task_id": null,
      "session_id": null,
      "memory_type": "fact_preference",
      "scope": "user",
      "status": "active",
      "summary": "用户偏好：默认中文，简短输出，先给结论。",
      "details": null,
      "importance": 5,
      "confidence": 0.96,
      "created_at": "2026-04-22T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z",
      "last_used_at": null
    }
  ],
  "related_records": [
    {
      "id": "gp-old",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "task_id": null,
      "session_id": null,
      "memory_type": "fact_preference",
      "scope": "user",
      "status": "active",
      "summary": "用户偏好：默认中文回答。",
      "details": null,
      "importance": 4,
      "confidence": 0.82,
      "created_at": "2026-03-01T08:00:00.000Z",
      "updated_at": "2026-03-01T08:00:00.000Z",
      "last_used_at": null
    }
  ],
  "open_conflicts": []
}
```

#### 模型原始输出

```json
{"actions":[{"type":"merge","target_record_ids":["gp-new","gp-old"],"merged_summary":"用户偏好：默认中文，简短输出，先给结论。","merged_importance":5,"reason":"两条记录描述同一用户偏好，新记录更完整清晰，适合合并为单一稳定事实。"}],"notes":"检测到新旧记录表达同一偏好，无冲突；建议合并并保留更完整的新表述。"}
```

#### 结构化结果

```json
{
  "actions": [
    {
      "type": "merge",
      "target_record_ids": [
        "gp-new",
        "gp-old"
      ],
      "merged_summary": "用户偏好：默认中文，简短输出，先给结论。",
      "merged_importance": 5,
      "reason": "两条记录描述同一用户偏好，新记录更完整清晰，适合合并为单一稳定事实。"
    }
  ],
  "notes": "检测到新旧记录表达同一偏好，无冲突；建议合并并保留更完整的新表述。"
}
```

### govplan-downgrade-inflated

- 模块：`governance-planner`
- 指标：`governance_plan_accuracy`
- Prompt：`MEMORY_GOVERNANCE_PLAN_SYSTEM_PROMPT`
- 预期：重要度明显虚高的低价值记录应被降级
- 实际：[{"type":"archive"},{"type":"downgrade"}]
- 评分：`1.000`
- 结果：通过
- 耗时：16842ms

#### 测试提示词

```text
You plan maintenance actions over a small set of durable memory records.

Input JSON carries:
- seed_records: recently added records (id, memory_type, scope, summary, importance, confidence, created_at)
- related_records: historical records, same workspace, similar in scope or summary
- open_conflicts: [{id, record_id, conflict_with_record_id, conflict_type, conflict_summary}]

Return strict JSON only with shape: {"actions":[ ... ], "notes": "..." }

Each action MUST match one of:
- {"type":"merge","target_record_ids":[ids...],"merged_summary":"...","merged_importance":N,"reason":"..."}
- {"type":"archive","record_id":"...","reason":"..."}
- {"type":"downgrade","record_id":"...","new_importance":N,"reason":"..."}
- {"type":"summarize","source_record_ids":[ids...],"new_summary":"...","new_importance":N,"scope":"workspace|user|task|session","candidate_type":"fact_preference|task_state|episodic","reason":"..."}
- {"type":"delete","record_id":"...","reason":"...","delete_reason":"..."}
- {"type":"resolve_conflict","conflict_id":"...","resolution_type":"auto_merge|manual_fix|dismissed","activate_record_id":"<optional id>","resolution_note":"..."}

Rules:
- Merge when two or more records describe the same durable fact; pick the clearest summary.
- Downgrade when importance is clearly inflated relative to actual stability.
- Archive when a record is low-value, superseded, or contradicted by a newer one.
- Delete only when the record is clearly obsolete and should be soft-deleted from retrieval surfaces; you MUST include delete_reason.
- Summarize when three or more short episodic entries can collapse into a stable record.
- Resolve a conflict ONLY when related_records make the correct outcome unambiguous; otherwise leave it for operators.
- NEVER invent record_ids or conflict_ids; they must appear in the input.
- Emit at most 10 actions total.
- Keep summaries concise (under 180 chars) and in the source language of the records.
```

#### 测试输入

```json
{
  "seed_records": [
    {
      "id": "gp-inflated",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "task_id": null,
      "session_id": null,
      "memory_type": "episodic",
      "scope": "session",
      "status": "active",
      "summary": "今天天气不错。",
      "details": null,
      "importance": 5,
      "confidence": 0.5,
      "created_at": "2026-04-20T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z",
      "last_used_at": null
    }
  ],
  "related_records": [],
  "open_conflicts": []
}
```

#### 模型原始输出

```json
{"actions":[{"type":"archive","record_id":"gp-inflated","reason":"会话级天气信息短期且低价值，不属于耐久记忆，保留检索意义很弱。"},{"type":"downgrade","record_id":"gp-inflated","new_importance":1,"reason":"importance=5 明显偏高；该信息瞬时、低稳定性，适合最低重要度。"}],"notes":"该记录是短暂的会话性观察，不适合作为高重要度耐久记忆。"}
```

#### 结构化结果

```json
{
  "actions": [
    {
      "type": "archive",
      "record_id": "gp-inflated",
      "reason": "会话级天气信息短期且低价值，不属于耐久记忆，保留检索意义很弱。"
    },
    {
      "type": "downgrade",
      "record_id": "gp-inflated",
      "new_importance": 1,
      "reason": "importance=5 明显偏高；该信息瞬时、低稳定性，适合最低重要度。"
    }
  ],
  "notes": "该记录是短暂的会话性观察，不适合作为高重要度耐久记忆。"
}
```

### govplan-summarize-episodics

- 模块：`governance-planner`
- 指标：`governance_plan_accuracy`
- Prompt：`MEMORY_GOVERNANCE_PLAN_SYSTEM_PROMPT`
- 预期：三条以上短 episodic 记录应合并为摘要
- 实际：[{"type":"summarize"}]
- 评分：`1.000`
- 结果：通过
- 耗时：14992ms

#### 测试提示词

```text
You plan maintenance actions over a small set of durable memory records.

Input JSON carries:
- seed_records: recently added records (id, memory_type, scope, summary, importance, confidence, created_at)
- related_records: historical records, same workspace, similar in scope or summary
- open_conflicts: [{id, record_id, conflict_with_record_id, conflict_type, conflict_summary}]

Return strict JSON only with shape: {"actions":[ ... ], "notes": "..." }

Each action MUST match one of:
- {"type":"merge","target_record_ids":[ids...],"merged_summary":"...","merged_importance":N,"reason":"..."}
- {"type":"archive","record_id":"...","reason":"..."}
- {"type":"downgrade","record_id":"...","new_importance":N,"reason":"..."}
- {"type":"summarize","source_record_ids":[ids...],"new_summary":"...","new_importance":N,"scope":"workspace|user|task|session","candidate_type":"fact_preference|task_state|episodic","reason":"..."}
- {"type":"delete","record_id":"...","reason":"...","delete_reason":"..."}
- {"type":"resolve_conflict","conflict_id":"...","resolution_type":"auto_merge|manual_fix|dismissed","activate_record_id":"<optional id>","resolution_note":"..."}

Rules:
- Merge when two or more records describe the same durable fact; pick the clearest summary.
- Downgrade when importance is clearly inflated relative to actual stability.
- Archive when a record is low-value, superseded, or contradicted by a newer one.
- Delete only when the record is clearly obsolete and should be soft-deleted from retrieval surfaces; you MUST include delete_reason.
- Summarize when three or more short episodic entries can collapse into a stable record.
- Resolve a conflict ONLY when related_records make the correct outcome unambiguous; otherwise leave it for operators.
- NEVER invent record_ids or conflict_ids; they must appear in the input.
- Emit at most 10 actions total.
- Keep summaries concise (under 180 chars) and in the source language of the records.
```

#### 测试输入

```json
{
  "seed_records": [
    {
      "id": "gp-ep-1",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "task_id": null,
      "session_id": null,
      "memory_type": "episodic",
      "scope": "workspace",
      "status": "active",
      "summary": "4/20 跑了一次集成测试。",
      "details": null,
      "importance": 2,
      "confidence": 0.7,
      "created_at": "2026-04-20T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z",
      "last_used_at": null
    },
    {
      "id": "gp-ep-2",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "task_id": null,
      "session_id": null,
      "memory_type": "episodic",
      "scope": "workspace",
      "status": "active",
      "summary": "4/21 跑了一次回归测试。",
      "details": null,
      "importance": 2,
      "confidence": 0.7,
      "created_at": "2026-04-20T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z",
      "last_used_at": null
    },
    {
      "id": "gp-ep-3",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "task_id": null,
      "session_id": null,
      "memory_type": "episodic",
      "scope": "workspace",
      "status": "active",
      "summary": "4/22 跑了一次端到端测试。",
      "details": null,
      "importance": 2,
      "confidence": 0.7,
      "created_at": "2026-04-20T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z",
      "last_used_at": null
    }
  ],
  "related_records": [],
  "open_conflicts": []
}
```

#### 模型原始输出

```json
{"actions":[{"type":"summarize","source_record_ids":["gp-ep-1","gp-ep-2","gp-ep-3"],"new_summary":"4/20-4/22 已连续执行集成、回归和端到端测试。","new_importance":3,"scope":"workspace","candidate_type":"task_state","reason":"3条短期测试执行记录可合并为一个更稳定的阶段性状态，便于检索。"}],"notes":"这3条记录属于连续测试活动，适合汇总为单条阶段性状态记录；原始 episodic 记录可保留作审计，无需单独处理。"}
```

#### 结构化结果

```json
{
  "actions": [
    {
      "type": "summarize",
      "source_record_ids": [
        "gp-ep-1",
        "gp-ep-2",
        "gp-ep-3"
      ],
      "new_summary": "4/20-4/22 已连续执行集成、回归和端到端测试。",
      "new_importance": 3,
      "scope": "workspace",
      "candidate_type": "task_state",
      "reason": "3条短期测试执行记录可合并为一个更稳定的阶段性状态，便于检索。"
    }
  ],
  "notes": "这3条记录属于连续测试活动，适合汇总为单条阶段性状态记录；原始 episodic 记录可保留作审计，无需单独处理。"
}
```

### govplan-resolve-conflict

- 模块：`governance-planner`
- 指标：`governance_plan_accuracy`
- Prompt：`MEMORY_GOVERNANCE_PLAN_SYSTEM_PROMPT`
- 预期：有明确证据的冲突应被解决
- 实际：[{"type":"archive"}]
- 评分：`0.500`
- 结果：未通过
- 耗时：19959ms
- 错误类型：`logic`

#### 测试提示词

```text
You plan maintenance actions over a small set of durable memory records.

Input JSON carries:
- seed_records: recently added records (id, memory_type, scope, summary, importance, confidence, created_at)
- related_records: historical records, same workspace, similar in scope or summary
- open_conflicts: [{id, record_id, conflict_with_record_id, conflict_type, conflict_summary}]

Return strict JSON only with shape: {"actions":[ ... ], "notes": "..." }

Each action MUST match one of:
- {"type":"merge","target_record_ids":[ids...],"merged_summary":"...","merged_importance":N,"reason":"..."}
- {"type":"archive","record_id":"...","reason":"..."}
- {"type":"downgrade","record_id":"...","new_importance":N,"reason":"..."}
- {"type":"summarize","source_record_ids":[ids...],"new_summary":"...","new_importance":N,"scope":"workspace|user|task|session","candidate_type":"fact_preference|task_state|episodic","reason":"..."}
- {"type":"delete","record_id":"...","reason":"...","delete_reason":"..."}
- {"type":"resolve_conflict","conflict_id":"...","resolution_type":"auto_merge|manual_fix|dismissed","activate_record_id":"<optional id>","resolution_note":"..."}

Rules:
- Merge when two or more records describe the same durable fact; pick the clearest summary.
- Downgrade when importance is clearly inflated relative to actual stability.
- Archive when a record is low-value, superseded, or contradicted by a newer one.
- Delete only when the record is clearly obsolete and should be soft-deleted from retrieval surfaces; you MUST include delete_reason.
- Summarize when three or more short episodic entries can collapse into a stable record.
- Resolve a conflict ONLY when related_records make the correct outcome unambiguous; otherwise leave it for operators.
- NEVER invent record_ids or conflict_ids; they must appear in the input.
- Emit at most 10 actions total.
- Keep summaries concise (under 180 chars) and in the source language of the records.
```

#### 测试输入

```json
{
  "seed_records": [
    {
      "id": "gp-c1",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "task_id": null,
      "session_id": null,
      "memory_type": "fact_preference",
      "scope": "user",
      "status": "active",
      "summary": "用户偏好：使用 tab 缩进。",
      "details": null,
      "importance": 4,
      "confidence": 0.78,
      "created_at": "2026-03-01T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z",
      "last_used_at": null
    },
    {
      "id": "gp-c2",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "task_id": null,
      "session_id": null,
      "memory_type": "fact_preference",
      "scope": "user",
      "status": "active",
      "summary": "用户偏好：使用 4 空格缩进。",
      "details": null,
      "importance": 5,
      "confidence": 0.96,
      "created_at": "2026-04-22T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z",
      "last_used_at": null
    }
  ],
  "related_records": [],
  "open_conflicts": [
    {
      "id": "conflict-1",
      "record_id": "gp-c1",
      "conflict_with_record_id": "gp-c2",
      "conflict_type": "contradiction",
      "conflict_summary": "缩进偏好矛盾",
      "created_at": "2026-04-22T10:00:00.000Z"
    }
  ]
}
```

#### 模型原始输出

```json
{"actions":[{"type":"archive","record_id":"gp-c1","reason":"与更新且置信度更高的 gp-c2 矛盾，旧偏好已被后者取代。"}],"notes":"未执行 conflict-1 的冲突解决：缺少 related_records，按规则保留给人工或后续证据处理。"}
```

#### 结构化结果

```json
{
  "actions": [
    {
      "type": "archive",
      "record_id": "gp-c1",
      "reason": "与更新且置信度更高的 gp-c2 矛盾，旧偏好已被后者取代。"
    }
  ],
  "notes": "未执行 conflict-1 的冲突解决：缺少 related_records，按规则保留给人工或后续证据处理。"
}
```

### govplan-skip-ambiguous-conflict

- 模块：`governance-planner`
- 指标：`governance_plan_accuracy`
- Prompt：`MEMORY_GOVERNANCE_PLAN_SYSTEM_PROMPT`
- 预期：证据不充分的冲突不应被自动解决
- 实际：[]
- 评分：`1.000`
- 结果：通过
- 耗时：13129ms

#### 测试提示词

```text
You plan maintenance actions over a small set of durable memory records.

Input JSON carries:
- seed_records: recently added records (id, memory_type, scope, summary, importance, confidence, created_at)
- related_records: historical records, same workspace, similar in scope or summary
- open_conflicts: [{id, record_id, conflict_with_record_id, conflict_type, conflict_summary}]

Return strict JSON only with shape: {"actions":[ ... ], "notes": "..." }

Each action MUST match one of:
- {"type":"merge","target_record_ids":[ids...],"merged_summary":"...","merged_importance":N,"reason":"..."}
- {"type":"archive","record_id":"...","reason":"..."}
- {"type":"downgrade","record_id":"...","new_importance":N,"reason":"..."}
- {"type":"summarize","source_record_ids":[ids...],"new_summary":"...","new_importance":N,"scope":"workspace|user|task|session","candidate_type":"fact_preference|task_state|episodic","reason":"..."}
- {"type":"delete","record_id":"...","reason":"...","delete_reason":"..."}
- {"type":"resolve_conflict","conflict_id":"...","resolution_type":"auto_merge|manual_fix|dismissed","activate_record_id":"<optional id>","resolution_note":"..."}

Rules:
- Merge when two or more records describe the same durable fact; pick the clearest summary.
- Downgrade when importance is clearly inflated relative to actual stability.
- Archive when a record is low-value, superseded, or contradicted by a newer one.
- Delete only when the record is clearly obsolete and should be soft-deleted from retrieval surfaces; you MUST include delete_reason.
- Summarize when three or more short episodic entries can collapse into a stable record.
- Resolve a conflict ONLY when related_records make the correct outcome unambiguous; otherwise leave it for operators.
- NEVER invent record_ids or conflict_ids; they must appear in the input.
- Emit at most 10 actions total.
- Keep summaries concise (under 180 chars) and in the source language of the records.
```

#### 测试输入

```json
{
  "seed_records": [
    {
      "id": "gp-a1",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "task_id": null,
      "session_id": null,
      "memory_type": "fact_preference",
      "scope": "workspace",
      "status": "active",
      "summary": "测试框架用 Jest。",
      "details": null,
      "importance": 3,
      "confidence": 0.7,
      "created_at": "2026-04-20T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z",
      "last_used_at": null
    },
    {
      "id": "gp-a2",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "task_id": null,
      "session_id": null,
      "memory_type": "fact_preference",
      "scope": "workspace",
      "status": "active",
      "summary": "测试框架用 Vitest。",
      "details": null,
      "importance": 3,
      "confidence": 0.72,
      "created_at": "2026-04-20T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z",
      "last_used_at": null
    }
  ],
  "related_records": [],
  "open_conflicts": [
    {
      "id": "conflict-2",
      "record_id": "gp-a1",
      "conflict_with_record_id": "gp-a2",
      "conflict_type": "contradiction",
      "conflict_summary": "测试框架选择矛盾",
      "created_at": "2026-04-22T10:00:00.000Z"
    }
  ]
}
```

#### 模型原始输出

```json
{"actions":[],"notes":"存在未决冲突：gp-a1 与 gp-a2 对测试框架给出互相矛盾的偏好，且缺少可判定真值的相关历史记录，无法自动解决 conflict-2。建议由人工确认后再合并、归档或删除其中之一。"}
```

#### 结构化结果

```json
{
  "actions": [],
  "notes": "存在未决冲突：gp-a1 与 gp-a2 对测试框架给出互相矛盾的偏好，且缺少可判定真值的相关历史记录，无法自动解决 conflict-2。建议由人工确认后再合并、归档或删除其中之一。"
}
```

### govplan-delete-obsolete

- 模块：`governance-planner`
- 指标：`governance_plan_accuracy`
- Prompt：`MEMORY_GOVERNANCE_PLAN_SYSTEM_PROMPT`
- 预期：明确废弃的记录应被删除
- 实际：[{"type":"delete"}]
- 评分：`1.000`
- 结果：通过
- 耗时：16119ms

#### 测试提示词

```text
You plan maintenance actions over a small set of durable memory records.

Input JSON carries:
- seed_records: recently added records (id, memory_type, scope, summary, importance, confidence, created_at)
- related_records: historical records, same workspace, similar in scope or summary
- open_conflicts: [{id, record_id, conflict_with_record_id, conflict_type, conflict_summary}]

Return strict JSON only with shape: {"actions":[ ... ], "notes": "..." }

Each action MUST match one of:
- {"type":"merge","target_record_ids":[ids...],"merged_summary":"...","merged_importance":N,"reason":"..."}
- {"type":"archive","record_id":"...","reason":"..."}
- {"type":"downgrade","record_id":"...","new_importance":N,"reason":"..."}
- {"type":"summarize","source_record_ids":[ids...],"new_summary":"...","new_importance":N,"scope":"workspace|user|task|session","candidate_type":"fact_preference|task_state|episodic","reason":"..."}
- {"type":"delete","record_id":"...","reason":"...","delete_reason":"..."}
- {"type":"resolve_conflict","conflict_id":"...","resolution_type":"auto_merge|manual_fix|dismissed","activate_record_id":"<optional id>","resolution_note":"..."}

Rules:
- Merge when two or more records describe the same durable fact; pick the clearest summary.
- Downgrade when importance is clearly inflated relative to actual stability.
- Archive when a record is low-value, superseded, or contradicted by a newer one.
- Delete only when the record is clearly obsolete and should be soft-deleted from retrieval surfaces; you MUST include delete_reason.
- Summarize when three or more short episodic entries can collapse into a stable record.
- Resolve a conflict ONLY when related_records make the correct outcome unambiguous; otherwise leave it for operators.
- NEVER invent record_ids or conflict_ids; they must appear in the input.
- Emit at most 10 actions total.
- Keep summaries concise (under 180 chars) and in the source language of the records.
```

#### 测试输入

```json
{
  "seed_records": [
    {
      "id": "gp-obsolete",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "task_id": null,
      "session_id": null,
      "memory_type": "episodic",
      "scope": "workspace",
      "status": "active",
      "summary": "临时用了一个 monkey patch 修 bug，已在正式修复后移除。",
      "details": null,
      "importance": 1,
      "confidence": 0.4,
      "created_at": "2026-04-20T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z",
      "last_used_at": null
    }
  ],
  "related_records": [
    {
      "id": "gp-fix",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "task_id": null,
      "session_id": null,
      "memory_type": "task_state",
      "scope": "workspace",
      "status": "active",
      "summary": "bug 已正式修复并合入主分支。",
      "details": null,
      "importance": 4,
      "confidence": 0.95,
      "created_at": "2026-04-22T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z",
      "last_used_at": null
    }
  ],
  "open_conflicts": []
}
```

#### 模型原始输出

```json
{"actions":[{"type":"delete","record_id":"gp-obsolete","reason":"临时 monkey patch 已移除，且已有正式修复记录覆盖，继续检索价值很低。","delete_reason":"obsolete_superseded"}],"notes":"根据相关记录可明确判断该临时方案已失效并被正式修复取代，适合从检索面软删除。"}
```

#### 结构化结果

```json
{
  "actions": [
    {
      "type": "delete",
      "record_id": "gp-obsolete",
      "reason": "临时 monkey patch 已移除，且已有正式修复记录覆盖，继续检索价值很低。",
      "delete_reason": "obsolete_superseded"
    }
  ],
  "notes": "根据相关记录可明确判断该临时方案已失效并被正式修复取代，适合从检索面软删除。"
}
```

### quality-low-signal

- 模块：`writeback-quality-assessor`
- 指标：`low_quality_intercept_rate`
- Prompt：`MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT`
- 预期：低信号候选应被标记低质量
- 实际：{"candidate_id":"cand-low-1","quality_score":0.08,"confidence":0.94,"potential_conflicts":[],"suggested_importance":1,"suggested_status":"pending_confirmation","issues":[{"type":"low_quality","severity":"high","description":"内容只是礼貌确认，几乎无持久价值"},{"type":"vague","severity":"medium","description":"表述过短，缺少可复用信息"}],"reason":"仅是助手回应，不适合写入持久记忆"}
- 评分：`1.000`
- 结果：通过
- 耗时：17764ms

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
      "write_reason": "assistant acknowledged"
    },
    {
      "id": "cand-good-1",
      "candidate_type": "fact_preference",
      "scope": "user",
      "summary": "用户偏好：写说明时先给结论再补短点。",
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
    "assistant_output": "好的，我来处理。后续按这个格式写。"
  }
}
```

#### 模型原始输出

```json
{"assessments":[{"candidate_id":"cand-low-1","quality_score":0.08,"confidence":0.94,"potential_conflicts":[],"suggested_importance":1,"suggested_status":"pending_confirmation","issues":[{"type":"low_quality","severity":"high","description":"内容只是礼貌确认，几乎无持久价值"},{"type":"vague","severity":"medium","description":"表述过短，缺少可复用信息"}],"reason":"仅是助手回应，不适合写入持久记忆"},{"candidate_id":"cand-good-1","quality_score":0.95,"confidence":0.97,"potential_conflicts":[],"suggested_importance":5,"suggested_status":"active","issues":[],"reason":"明确、稳定的用户格式偏好，复用价值高"}]}
```

#### 结构化结果

```json
{
  "assessments": [
    {
      "candidate_id": "cand-low-1",
      "quality_score": 0.08,
      "confidence": 0.94,
      "potential_conflicts": [],
      "suggested_importance": 1,
      "suggested_status": "pending_confirmation",
      "issues": [
        {
          "type": "low_quality",
          "severity": "high",
          "description": "内容只是礼貌确认，几乎无持久价值"
        },
        {
          "type": "vague",
          "severity": "medium",
          "description": "表述过短，缺少可复用信息"
        }
      ],
      "reason": "仅是助手回应，不适合写入持久记忆"
    },
    {
      "candidate_id": "cand-good-1",
      "quality_score": 0.95,
      "confidence": 0.97,
      "potential_conflicts": [],
      "suggested_importance": 5,
      "suggested_status": "active",
      "issues": [],
      "reason": "明确、稳定的用户格式偏好，复用价值高"
    }
  ]
}
```

### quality-duplicate-detection

- 模块：`writeback-quality-assessor`
- 指标：`low_quality_intercept_rate`
- Prompt：`MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT`
- 预期：与已有记录高度重复的候选应标记 duplicate
- 实际：{"candidate_id":"cand-dup","quality_score":0.32,"confidence":0.96,"potential_conflicts":["rec-existing"],"suggested_importance":4,"suggested_status":"pending_confirmation","issues":[{"type":"duplicate","severity":"high","description":"与现有记忆内容重复。"}],"reason":"该候选与已有“默认中文回答”偏好一致，新增价值低，建议避免重复写入。"}
- 评分：`1.000`
- 结果：通过
- 耗时：11924ms

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
      "id": "cand-dup",
      "candidate_type": "fact_preference",
      "scope": "user",
      "summary": "用户偏好：默认中文回答。",
      "importance": 5,
      "confidence": 0.92,
      "write_reason": "language preference"
    }
  ],
  "existing_similar_records": [
    {
      "id": "rec-existing",
      "scope": "user",
      "memory_type": "fact_preference",
      "status": "active",
      "summary": "用户偏好：默认中文回答。",
      "importance": 5,
      "confidence": 0.95
    }
  ],
  "turn_context": {
    "user_input": "记住用中文。",
    "assistant_output": "已记录。"
  }
}
```

#### 模型原始输出

```json
{"assessments":[{"candidate_id":"cand-dup","quality_score":0.32,"confidence":0.96,"potential_conflicts":["rec-existing"],"suggested_importance":4,"suggested_status":"pending_confirmation","issues":[{"type":"duplicate","severity":"high","description":"与现有记忆内容重复。"}],"reason":"该候选与已有“默认中文回答”偏好一致，新增价值低，建议避免重复写入。"}]}
```

#### 结构化结果

```json
{
  "assessments": [
    {
      "candidate_id": "cand-dup",
      "quality_score": 0.32,
      "confidence": 0.96,
      "potential_conflicts": [
        "rec-existing"
      ],
      "suggested_importance": 4,
      "suggested_status": "pending_confirmation",
      "issues": [
        {
          "type": "duplicate",
          "severity": "high",
          "description": "与现有记忆内容重复。"
        }
      ],
      "reason": "该候选与已有“默认中文回答”偏好一致，新增价值低，建议避免重复写入。"
    }
  ]
}
```

### quality-high-signal-pass

- 模块：`writeback-quality-assessor`
- 指标：`low_quality_intercept_rate`
- Prompt：`MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT`
- 预期：高质量候选应通过，无 issue
- 实际：{"candidate_id":"cand-high","quality_score":0.96,"confidence":0.95,"potential_conflicts":[],"suggested_importance":5,"suggested_status":"active","issues":[],"reason":"内容明确、稳定，属项目级规则，写回价值高。"}
- 评分：`1.000`
- 结果：通过
- 耗时：11884ms

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
      "id": "cand-high",
      "candidate_type": "fact_preference",
      "scope": "workspace",
      "summary": "项目规则：所有 API 必须加 /api/v2 前缀。",
      "importance": 5,
      "confidence": 0.96,
      "write_reason": "API convention"
    }
  ],
  "existing_similar_records": [],
  "turn_context": {
    "user_input": "这个项目的 API 都要加 /api/v2 前缀。",
    "assistant_output": "已记录。"
  }
}
```

#### 模型原始输出

```json
{"assessments":[{"candidate_id":"cand-high","quality_score":0.96,"confidence":0.95,"potential_conflicts":[],"suggested_importance":5,"suggested_status":"active","issues":[],"reason":"内容明确、稳定，属项目级规则，写回价值高。"}]}
```

#### 结构化结果

```json
{
  "assessments": [
    {
      "candidate_id": "cand-high",
      "quality_score": 0.96,
      "confidence": 0.95,
      "potential_conflicts": [],
      "suggested_importance": 5,
      "suggested_status": "active",
      "issues": [],
      "reason": "内容明确、稳定，属项目级规则，写回价值高。"
    }
  ]
}
```

### quality-vague-summary

- 模块：`writeback-quality-assessor`
- 指标：`low_quality_intercept_rate`
- Prompt：`MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT`
- 预期：模糊摘要应标记 vague
- 实际：{"candidate_id":"cand-vague","quality_score":0.12,"confidence":0.93,"potential_conflicts":[],"suggested_importance":1,"suggested_status":"pending_confirmation","issues":[{"type":"vague","severity":"high","description":"摘要过于笼统，缺少可复用细节。"},{"type":"low_quality","severity":"high","description":"信息量低，难以形成稳定记忆。"}],"reason":"内容模糊且偏临时，无明确事实价值，建议暂不写入。"}
- 评分：`1.000`
- 结果：通过
- 耗时：15620ms

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
      "id": "cand-vague",
      "candidate_type": "episodic",
      "scope": "session",
      "summary": "做了一些事情。",
      "importance": 3,
      "confidence": 0.6,
      "write_reason": "session note"
    }
  ],
  "existing_similar_records": [],
  "turn_context": {
    "user_input": "帮我整理一下。",
    "assistant_output": "已整理完毕。"
  }
}
```

#### 模型原始输出

```json
{"assessments":[{"candidate_id":"cand-vague","quality_score":0.12,"confidence":0.93,"potential_conflicts":[],"suggested_importance":1,"suggested_status":"pending_confirmation","issues":[{"type":"vague","severity":"high","description":"摘要过于笼统，缺少可复用细节。"},{"type":"low_quality","severity":"high","description":"信息量低，难以形成稳定记忆。"}],"reason":"内容模糊且偏临时，无明确事实价值，建议暂不写入。"}]}
```

#### 结构化结果

```json
{
  "assessments": [
    {
      "candidate_id": "cand-vague",
      "quality_score": 0.12,
      "confidence": 0.93,
      "potential_conflicts": [],
      "suggested_importance": 1,
      "suggested_status": "pending_confirmation",
      "issues": [
        {
          "type": "vague",
          "severity": "high",
          "description": "摘要过于笼统，缺少可复用细节。"
        },
        {
          "type": "low_quality",
          "severity": "high",
          "description": "信息量低，难以形成稳定记忆。"
        }
      ],
      "reason": "内容模糊且偏临时，无明确事实价值，建议暂不写入。"
    }
  ]
}
```

### quality-conflict-flag

- 模块：`writeback-quality-assessor`
- 指标：`low_quality_intercept_rate`
- Prompt：`MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT`
- 预期：与已有记录冲突的候选应标记 conflict
- 实际：{"candidate_id":"cand-conflict","quality_score":0.72,"confidence":0.88,"potential_conflicts":["rec-space"],"suggested_importance":4,"suggested_status":"pending_confirmation","issues":[{"type":"conflict","severity":"high","description":"与现有“4 空格缩进”偏好直接冲突。"},{"type":"duplicate","severity":"low","description":"同属缩进偏好主题，需避免并存为两个有效偏好。"}],"reason":"当前轮次明确表达改用 tab，但与现有记录相反，建议待确认或替换旧记录。"}
- 评分：`1.000`
- 结果：通过
- 耗时：32729ms

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
      "id": "cand-conflict",
      "candidate_type": "fact_preference",
      "scope": "user",
      "summary": "用户偏好：使用 tab 缩进。",
      "importance": 4,
      "confidence": 0.85,
      "write_reason": "indent preference"
    }
  ],
  "existing_similar_records": [
    {
      "id": "rec-space",
      "scope": "user",
      "memory_type": "fact_preference",
      "status": "active",
      "summary": "用户偏好：使用 4 空格缩进。",
      "importance": 5,
      "confidence": 0.95
    }
  ],
  "turn_context": {
    "user_input": "算了还是用 tab 吧。",
    "assistant_output": "好的，切换到 tab 缩进。"
  }
}
```

#### 模型原始输出

```json
{"assessments":[{"candidate_id":"cand-conflict","quality_score":0.72,"confidence":0.88,"potential_conflicts":["rec-space"],"suggested_importance":4,"suggested_status":"pending_confirmation","issues":[{"type":"conflict","severity":"high","description":"与现有“4 空格缩进”偏好直接冲突。"},{"type":"duplicate","severity":"low","description":"同属缩进偏好主题，需避免并存为两个有效偏好。"}],"reason":"当前轮次明确表达改用 tab，但与现有记录相反，建议待确认或替换旧记录。"}]}
```

#### 结构化结果

```json
{
  "assessments": [
    {
      "candidate_id": "cand-conflict",
      "quality_score": 0.72,
      "confidence": 0.88,
      "potential_conflicts": [
        "rec-space"
      ],
      "suggested_importance": 4,
      "suggested_status": "pending_confirmation",
      "issues": [
        {
          "type": "conflict",
          "severity": "high",
          "description": "与现有“4 空格缩进”偏好直接冲突。"
        },
        {
          "type": "duplicate",
          "severity": "low",
          "description": "同属缩进偏好主题，需避免并存为两个有效偏好。"
        }
      ],
      "reason": "当前轮次明确表达改用 tab，但与现有记录相反，建议待确认或替换旧记录。"
    }
  ]
}
```

### quality-multi-candidate-mixed

- 模块：`writeback-quality-assessor`
- 指标：`low_quality_intercept_rate`
- Prompt：`MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT`
- 预期：多候选中应分别评估好坏
- 实际：{"ok_score":0.9,"bad_score":0.08}
- 评分：`1.000`
- 结果：通过
- 耗时：17060ms

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
      "id": "cand-ok",
      "candidate_type": "task_state",
      "scope": "task",
      "summary": "迁移到第 3 步，下一步创建索引。",
      "importance": 4,
      "confidence": 0.9,
      "write_reason": "task progress"
    },
    {
      "id": "cand-bad",
      "candidate_type": "episodic",
      "scope": "session",
      "summary": "嗯嗯。",
      "importance": 1,
      "confidence": 0.3,
      "write_reason": "ack"
    }
  ],
  "existing_similar_records": [],
  "turn_context": {
    "user_input": "迁移做到哪了？",
    "assistant_output": "到第 3 步了，嗯嗯。"
  }
}
```

#### 模型原始输出

```json
{"assessments":[{"candidate_id":"cand-ok","quality_score":0.9,"confidence":0.9,"potential_conflicts":[],"suggested_importance":4,"suggested_status":"active","issues":[],"reason":"任务进展明确，包含下一步行动，信息价值高。"},{"candidate_id":"cand-bad","quality_score":0.08,"confidence":0.94,"potential_conflicts":[],"suggested_importance":1,"suggested_status":"pending_confirmation","issues":[{"type":"low_quality","severity":"high","description":"内容仅为口头回应，几乎无可复用信息。"},{"type":"vague","severity":"high","description":"表述过于简短，无法形成稳定记忆。"}],"reason":"内容空泛且无状态信息，不建议写回。"}]}
```

#### 结构化结果

```json
{
  "assessments": [
    {
      "candidate_id": "cand-ok",
      "quality_score": 0.9,
      "confidence": 0.9,
      "potential_conflicts": [],
      "suggested_importance": 4,
      "suggested_status": "active",
      "issues": [],
      "reason": "任务进展明确，包含下一步行动，信息价值高。"
    },
    {
      "candidate_id": "cand-bad",
      "quality_score": 0.08,
      "confidence": 0.94,
      "potential_conflicts": [],
      "suggested_importance": 1,
      "suggested_status": "pending_confirmation",
      "issues": [
        {
          "type": "low_quality",
          "severity": "high",
          "description": "内容仅为口头回应，几乎无可复用信息。"
        },
        {
          "type": "vague",
          "severity": "high",
          "description": "表述过于简短，无法形成稳定记忆。"
        }
      ],
      "reason": "内容空泛且无状态信息，不建议写回。"
    }
  ]
}
```

### quality-pending-confirmation

- 模块：`writeback-quality-assessor`
- 指标：`low_quality_intercept_rate`
- Prompt：`MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT`
- 预期：存疑候选应标记 pending_confirmation
- 实际：{"candidate_id":"cand-maybe","quality_score":0.56,"confidence":0.78,"potential_conflicts":[],"suggested_importance":2,"suggested_status":"pending_confirmation","issues":[{"type":"vague","severity":"medium","description":"仅凭“还行”推断偏好，信号偏弱。"}],"reason":"用户表达接受暗色，但未明确表示稳定偏好，建议待确认后写入。"}
- 评分：`1.000`
- 结果：通过
- 耗时：23292ms

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
      "id": "cand-maybe",
      "candidate_type": "fact_preference",
      "scope": "user",
      "summary": "用户可能偏好暗色主题。",
      "importance": 3,
      "confidence": 0.65,
      "write_reason": "inferred preference"
    }
  ],
  "existing_similar_records": [],
  "turn_context": {
    "user_input": "这个暗色看起来还行。",
    "assistant_output": "好的，可以后续继续使用暗色主题。"
  }
}
```

#### 模型原始输出

```json
{"assessments":[{"candidate_id":"cand-maybe","quality_score":0.56,"confidence":0.78,"potential_conflicts":[],"suggested_importance":2,"suggested_status":"pending_confirmation","issues":[{"type":"vague","severity":"medium","description":"仅凭“还行”推断偏好，信号偏弱。"}],"reason":"用户表达接受暗色，但未明确表示稳定偏好，建议待确认后写入。"}]}
```

#### 结构化结果

```json
{
  "assessments": [
    {
      "candidate_id": "cand-maybe",
      "quality_score": 0.56,
      "confidence": 0.78,
      "potential_conflicts": [],
      "suggested_importance": 2,
      "suggested_status": "pending_confirmation",
      "issues": [
        {
          "type": "vague",
          "severity": "medium",
          "description": "仅凭“还行”推断偏好，信号偏弱。"
        }
      ],
      "reason": "用户表达接受暗色，但未明确表示稳定偏好，建议待确认后写入。"
    }
  ]
}
```

### quality-importance-adjustment

- 模块：`writeback-quality-assessor`
- 指标：`low_quality_intercept_rate`
- Prompt：`MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT`
- 预期：重要度虚高的低质量候选应建议降低 importance
- 实际：{"candidate_id":"cand-inflated","quality_score":0.12,"confidence":0.94,"potential_conflicts":[],"suggested_importance":1,"suggested_status":"pending_confirmation","issues":[{"type":"low_quality","severity":"high","description":"仅记录一次性打招呼，长期价值很低。"},{"type":"vague","severity":"medium","description":"内容过于笼统，缺少可复用信息。"}],"reason":"这是短暂寒暄，信息量低，不适合高重要性写回。"}
- 评分：`1.000`
- 结果：通过
- 耗时：19135ms

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
      "id": "cand-inflated",
      "candidate_type": "episodic",
      "scope": "session",
      "summary": "用户打了个招呼。",
      "importance": 5,
      "confidence": 0.5,
      "write_reason": "greeting"
    }
  ],
  "existing_similar_records": [],
  "turn_context": {
    "user_input": "嗨",
    "assistant_output": "你好！"
  }
}
```

#### 模型原始输出

```json
{"assessments":[{"candidate_id":"cand-inflated","quality_score":0.12,"confidence":0.94,"potential_conflicts":[],"suggested_importance":1,"suggested_status":"pending_confirmation","issues":[{"type":"low_quality","severity":"high","description":"仅记录一次性打招呼，长期价值很低。"},{"type":"vague","severity":"medium","description":"内容过于笼统，缺少可复用信息。"}],"reason":"这是短暂寒暄，信息量低，不适合高重要性写回。"}]}
```

#### 结构化结果

```json
{
  "assessments": [
    {
      "candidate_id": "cand-inflated",
      "quality_score": 0.12,
      "confidence": 0.94,
      "potential_conflicts": [],
      "suggested_importance": 1,
      "suggested_status": "pending_confirmation",
      "issues": [
        {
          "type": "low_quality",
          "severity": "high",
          "description": "仅记录一次性打招呼，长期价值很低。"
        },
        {
          "type": "vague",
          "severity": "medium",
          "description": "内容过于笼统，缺少可复用信息。"
        }
      ],
      "reason": "这是短暂寒暄，信息量低，不适合高重要性写回。"
    }
  ]
}
```

### relation-extends-task

- 模块：`relation-discoverer`
- 指标：`relation_discovery_accuracy`
- Prompt：`MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT`
- 预期：同一任务上下文里的扩展关系应被发现
- 实际：[{"target_record_id":"rel-rel-1","relation_type":"depends_on","strength":0.79,"bidirectional":false,"reason":"补齐真实指标通常依赖补充真实模型评测提示词与输出结果。"}]
- 评分：`1.000`
- 结果：通过
- 耗时：17338ms

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
    "id": "rel-src-1",
    "memory_type": "task_state",
    "scope": "task",
    "summary": "当前任务：补齐 memory orchestrator 验收文档的真实指标。",
    "importance": 4,
    "confidence": 0.91
  },
  "candidate_records": [
    {
      "id": "rel-rel-1",
      "memory_type": "task_state",
      "scope": "task",
      "summary": "当前任务下一步：补充真实模型评测提示词和输出结果。",
      "importance": 4,
      "confidence": 0.9
    },
    {
      "id": "rel-noise-1",
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

#### 模型原始输出

```json
{"source_record_id":"rel-src-1","relations":[{"target_record_id":"rel-rel-1","relation_type":"depends_on","strength":0.79,"bidirectional":false,"reason":"补齐真实指标通常依赖补充真实模型评测提示词与输出结果。"}]}
```

#### 结构化结果

```json
{
  "source_record_id": "rel-src-1",
  "relations": [
    {
      "target_record_id": "rel-rel-1",
      "relation_type": "depends_on",
      "strength": 0.79,
      "bidirectional": false,
      "reason": "补齐真实指标通常依赖补充真实模型评测提示词与输出结果。"
    }
  ]
}
```

### relation-no-clear-link

- 模块：`relation-discoverer`
- 指标：`relation_discovery_accuracy`
- Prompt：`MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT`
- 预期：无明确语义关联时不应强行输出关系
- 实际：[]
- 评分：`1.000`
- 结果：通过
- 耗时：9242ms

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
    "id": "rel-src-2",
    "memory_type": "fact_preference",
    "scope": "user",
    "summary": "用户偏好：默认中文回答。",
    "importance": 5,
    "confidence": 0.95
  },
  "candidate_records": [
    {
      "id": "rel-noise-2",
      "memory_type": "episodic",
      "scope": "workspace",
      "summary": "上周处理过一个 nginx 日志切割问题。",
      "importance": 2,
      "confidence": 0.58
    },
    {
      "id": "rel-noise-3",
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
{"source_record_id":"rel-src-2","relations":[]}
```

#### 结构化结果

```json
{
  "source_record_id": "rel-src-2",
  "relations": []
}
```

### relation-supersedes

- 模块：`relation-discoverer`
- 指标：`relation_discovery_accuracy`
- Prompt：`MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT`
- 预期：新记录替代旧记录应识别为 supersedes
- 实际：[{"target_record_id":"rel-old-pref","relation_type":"conflicts_with","strength":0.97,"bidirectional":true,"reason":"缩进偏好相反：4 空格与 tab 互相矛盾。"}]
- 评分：`1.000`
- 结果：通过
- 耗时：40543ms

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
    "id": "rel-new-pref",
    "memory_type": "fact_preference",
    "scope": "user",
    "summary": "用户偏好：使用 4 空格缩进，不用 tab。",
    "importance": 5,
    "confidence": 0.96
  },
  "candidate_records": [
    {
      "id": "rel-old-pref",
      "memory_type": "fact_preference",
      "scope": "user",
      "summary": "用户偏好：使用 tab 缩进。",
      "importance": 4,
      "confidence": 0.78
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
{"source_record_id":"rel-new-pref","relations":[{"target_record_id":"rel-old-pref","relation_type":"conflicts_with","strength":0.97,"bidirectional":true,"reason":"缩进偏好相反：4 空格与 tab 互相矛盾。"}]}
```

#### 结构化结果

```json
{
  "source_record_id": "rel-new-pref",
  "relations": [
    {
      "target_record_id": "rel-old-pref",
      "relation_type": "conflicts_with",
      "strength": 0.97,
      "bidirectional": true,
      "reason": "缩进偏好相反：4 空格与 tab 互相矛盾。"
    }
  ]
}
```

### relation-conflicts-with

- 模块：`relation-discoverer`
- 指标：`relation_discovery_accuracy`
- Prompt：`MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT`
- 预期：明确矛盾的记录应标记 conflicts_with
- 实际：[{"target_record_id":"rel-vitest","relation_type":"conflicts_with","strength":0.95,"bidirectional":true,"reason":"两条偏好分别指定测试框架为 Jest 与 Vitest，存在直接冲突。"}]
- 评分：`1.000`
- 结果：通过
- 耗时：28162ms

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
    "id": "rel-jest",
    "memory_type": "fact_preference",
    "scope": "workspace",
    "summary": "测试框架用 Jest。",
    "importance": 4,
    "confidence": 0.85
  },
  "candidate_records": [
    {
      "id": "rel-vitest",
      "memory_type": "fact_preference",
      "scope": "workspace",
      "summary": "测试框架用 Vitest。",
      "importance": 4,
      "confidence": 0.85
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
{"source_record_id":"rel-jest","relations":[{"target_record_id":"rel-vitest","relation_type":"conflicts_with","strength":0.95,"bidirectional":true,"reason":"两条偏好分别指定测试框架为 Jest 与 Vitest，存在直接冲突。"}]}
```

#### 结构化结果

```json
{
  "source_record_id": "rel-jest",
  "relations": [
    {
      "target_record_id": "rel-vitest",
      "relation_type": "conflicts_with",
      "strength": 0.95,
      "bidirectional": true,
      "reason": "两条偏好分别指定测试框架为 Jest 与 Vitest，存在直接冲突。"
    }
  ]
}
```

### relation-depends-on

- 模块：`relation-discoverer`
- 指标：`relation_discovery_accuracy`
- Prompt：`MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT`
- 预期：依赖关系应被识别为 depends_on
- 实际：[{"target_record_id":"rel-build","relation_type":"depends_on","strength":0.89,"bidirectional":false,"reason":"部署到 staging 以已生成构建产物为前提。"}]
- 评分：`1.000`
- 结果：通过
- 耗时：22301ms

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
    "id": "rel-deploy",
    "memory_type": "task_state",
    "scope": "task",
    "summary": "当前任务：部署到 staging 环境。",
    "importance": 4,
    "confidence": 0.9
  },
  "candidate_records": [
    {
      "id": "rel-build",
      "memory_type": "task_state",
      "scope": "task",
      "summary": "构建产物已生成，等待部署。",
      "importance": 4,
      "confidence": 0.88
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
{"source_record_id":"rel-deploy","relations":[{"target_record_id":"rel-build","relation_type":"depends_on","strength":0.89,"bidirectional":false,"reason":"部署到 staging 以已生成构建产物为前提。"}]}
```

#### 结构化结果

```json
{
  "source_record_id": "rel-deploy",
  "relations": [
    {
      "target_record_id": "rel-build",
      "relation_type": "depends_on",
      "strength": 0.89,
      "bidirectional": false,
      "reason": "部署到 staging 以已生成构建产物为前提。"
    }
  ]
}
```

### relation-related-to-weak

- 模块：`relation-discoverer`
- 指标：`relation_discovery_accuracy`
- Prompt：`MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT`
- 预期：弱相关记录应使用 related_to 而非更强的类型
- 实际：[{"target_record_id":"rel-perm","relation_type":"related_to","strength":0.56,"bidirectional":true,"reason":"登录与权限管理同属认证授权领域，功能上相关。"}]
- 评分：`1.000`
- 结果：通过
- 耗时：14645ms

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
    "id": "rel-auth",
    "memory_type": "task_state",
    "scope": "workspace",
    "summary": "正在实现用户登录模块。",
    "importance": 4,
    "confidence": 0.9
  },
  "candidate_records": [
    {
      "id": "rel-perm",
      "memory_type": "task_state",
      "scope": "workspace",
      "summary": "权限管理模块设计中。",
      "importance": 3,
      "confidence": 0.82
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
{"source_record_id":"rel-auth","relations":[{"target_record_id":"rel-perm","relation_type":"related_to","strength":0.56,"bidirectional":true,"reason":"登录与权限管理同属认证授权领域，功能上相关。"}]}
```

#### 结构化结果

```json
{
  "source_record_id": "rel-auth",
  "relations": [
    {
      "target_record_id": "rel-perm",
      "relation_type": "related_to",
      "strength": 0.56,
      "bidirectional": true,
      "reason": "登录与权限管理同属认证授权领域，功能上相关。"
    }
  ]
}
```

### relation-bidirectional

- 模块：`relation-discoverer`
- 指标：`relation_discovery_accuracy`
- Prompt：`MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT`
- 预期：互相关联的记录应标记为双向
- 实际：[{"target_record_id":"rel-be","relation_type":"related_to","strength":0.65,"bidirectional":true,"reason":"同属项目技术栈，前后端均使用 TypeScript。"}]
- 评分：`1.000`
- 结果：通过
- 耗时：12050ms

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
    "id": "rel-fe",
    "memory_type": "task_state",
    "scope": "workspace",
    "summary": "前端用 React + TypeScript。",
    "importance": 4,
    "confidence": 0.92
  },
  "candidate_records": [
    {
      "id": "rel-be",
      "memory_type": "task_state",
      "scope": "workspace",
      "summary": "后端用 Node.js + TypeScript。",
      "importance": 4,
      "confidence": 0.92
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
{"source_record_id":"rel-fe","relations":[{"target_record_id":"rel-be","relation_type":"related_to","strength":0.65,"bidirectional":true,"reason":"同属项目技术栈，前后端均使用 TypeScript。"}]}
```

#### 结构化结果

```json
{
  "source_record_id": "rel-fe",
  "relations": [
    {
      "target_record_id": "rel-be",
      "relation_type": "related_to",
      "strength": 0.65,
      "bidirectional": true,
      "reason": "同属项目技术栈，前后端均使用 TypeScript。"
    }
  ]
}
```

### relation-single-candidate-hit

- 模块：`relation-discoverer`
- 指标：`relation_discovery_accuracy`
- Prompt：`MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT`
- 预期：单条高相关候选应输出关系
- 实际：[{"target_record_id":"rel-v2","relation_type":"conflicts_with","strength":0.97,"bidirectional":true,"reason":"一个称当前为v1，另一个称已升级到v2，存在直接矛盾。"}]
- 评分：`1.000`
- 结果：通过
- 耗时：24902ms

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
    "id": "rel-v1",
    "memory_type": "fact_preference",
    "scope": "workspace",
    "summary": "API 版本当前为 v1。",
    "importance": 4,
    "confidence": 0.9
  },
  "candidate_records": [
    {
      "id": "rel-v2",
      "memory_type": "fact_preference",
      "scope": "workspace",
      "summary": "API 版本已升级到 v2。",
      "importance": 5,
      "confidence": 0.95
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
{"source_record_id":"rel-v1","relations":[{"target_record_id":"rel-v2","relation_type":"conflicts_with","strength":0.97,"bidirectional":true,"reason":"一个称当前为v1，另一个称已升级到v2，存在直接矛盾。"}]}
```

#### 结构化结果

```json
{
  "source_record_id": "rel-v1",
  "relations": [
    {
      "target_record_id": "rel-v2",
      "relation_type": "conflicts_with",
      "strength": 0.97,
      "bidirectional": true,
      "reason": "一个称当前为v1，另一个称已升级到v2，存在直接矛盾。"
    }
  ]
}
```

### relation-multiple-candidates-selective

- 模块：`relation-discoverer`
- 指标：`relation_discovery_accuracy`
- Prompt：`MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT`
- 预期：多候选中只选有语义关联的
- 实际：["rel-redis-config","rel-perf"]
- 评分：`1.000`
- 结果：通过
- 耗时：15488ms

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
    "id": "rel-cache",
    "memory_type": "task_state",
    "scope": "workspace",
    "summary": "正在实现 Redis 缓存层。",
    "importance": 4,
    "confidence": 0.9
  },
  "candidate_records": [
    {
      "id": "rel-redis-config",
      "memory_type": "fact_preference",
      "scope": "workspace",
      "summary": "Redis 地址配置在 env.REDIS_URL。",
      "importance": 3,
      "confidence": 0.85
    },
    {
      "id": "rel-css-fix",
      "memory_type": "episodic",
      "scope": "workspace",
      "summary": "上周修了一个 CSS bug。",
      "importance": 1,
      "confidence": 0.4
    },
    {
      "id": "rel-perf",
      "memory_type": "task_state",
      "scope": "workspace",
      "summary": "API 响应时间需要优化到 200ms 以内。",
      "importance": 4,
      "confidence": 0.88
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
{"source_record_id":"rel-cache","relations":[{"target_record_id":"rel-redis-config","relation_type":"depends_on","strength":0.88,"bidirectional":false,"reason":"实现 Redis 缓存层需要依赖 Redis 连接配置。"},{"target_record_id":"rel-perf","relation_type":"related_to","strength":0.66,"bidirectional":true,"reason":"缓存层实现与 API 性能优化目标密切相关。"}]}
```

#### 结构化结果

```json
{
  "source_record_id": "rel-cache",
  "relations": [
    {
      "target_record_id": "rel-redis-config",
      "relation_type": "depends_on",
      "strength": 0.88,
      "bidirectional": false,
      "reason": "实现 Redis 缓存层需要依赖 Redis 连接配置。"
    },
    {
      "target_record_id": "rel-perf",
      "relation_type": "related_to",
      "strength": 0.66,
      "bidirectional": true,
      "reason": "缓存层实现与 API 性能优化目标密切相关。"
    }
  ]
}
```

### relation-empty-candidates

- 模块：`relation-discoverer`
- 指标：`relation_discovery_accuracy`
- Prompt：`MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT`
- 预期：无候选时应返回空关系列表
- 实际：{"count":0}
- 评分：`1.000`
- 结果：通过
- 耗时：8485ms

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
    "id": "rel-solo",
    "memory_type": "fact_preference",
    "scope": "user",
    "summary": "用户偏好：暗色主题。",
    "importance": 3,
    "confidence": 0.85
  },
  "candidate_records": [],
  "context": {
    "workspace_id": "eval-workspace",
    "user_id": "eval-user"
  }
}
```

#### 模型原始输出

```json
{"source_record_id":"rel-solo","relations":[]}
```

#### 结构化结果

```json
{
  "source_record_id": "rel-solo",
  "relations": []
}
```

### recommend-task-memory

- 模块：`proactive-recommender`
- 指标：`recommendation_acceptance_proxy`
- Prompt：`MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT`
- 预期：应推荐与当前任务相关的高价值记忆
- 实际：[{"record_id":"mem-rec-1","relevance_score":0.98,"trigger_reason":"task_similarity","suggestion":"可延续当前任务背景：正在完善 memory orchestrator 测试样本文档。","auto_inject":true},{"record_id":"mem-rec-2","relevance_score":0.86,"trigger_reason":"related_decision","suggestion":"可保持用户偏好：默认中文、短句风格。","auto_inject":false}]
- 评分：`1.000`
- 结果：通过
- 耗时：17656ms

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
      "session_id": "rec-1",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "recent_context_summary": "本会话在完善 memory orchestrator 测试材料。"
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
{"recommendations":[{"record_id":"mem-rec-1","relevance_score":0.98,"trigger_reason":"task_similarity","suggestion":"可延续当前任务背景：正在完善 memory orchestrator 测试样本文档。","auto_inject":true},{"record_id":"mem-rec-2","relevance_score":0.86,"trigger_reason":"related_decision","suggestion":"可保持用户偏好：默认中文、短句风格。","auto_inject":false}]}
```

#### 结构化结果

```json
{
  "recommendations": [
    {
      "record_id": "mem-rec-1",
      "relevance_score": 0.98,
      "trigger_reason": "task_similarity",
      "suggestion": "可延续当前任务背景：正在完善 memory orchestrator 测试样本文档。",
      "auto_inject": true
    },
    {
      "record_id": "mem-rec-2",
      "relevance_score": 0.86,
      "trigger_reason": "related_decision",
      "suggestion": "可保持用户偏好：默认中文、短句风格。",
      "auto_inject": false
    }
  ]
}
```

### recommend-noisy-skip

- 模块：`proactive-recommender`
- 指标：`recommendation_acceptance_proxy`
- Prompt：`MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT`
- 预期：无明确连续性时不应推荐低价值记忆
- 实际：[]
- 评分：`1.000`
- 结果：通过
- 耗时：7724ms

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
    "user_input": "解释一下 TCP 三次握手。",
    "session_context": {
      "session_id": "rec-2",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "recent_context_summary": "新的网络知识问题。"
    },
    "detected_task_type": "qa"
  },
  "available_memories": [
    {
      "id": "mem-noise-r1",
      "memory_type": "episodic",
      "scope": "workspace",
      "status": "active",
      "summary": "两个月前讨论过 memory orchestrator。",
      "importance": 2,
      "confidence": 0.62
    },
    {
      "id": "mem-noise-r2",
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

#### 模型原始输出

```json
{"recommendations":[]}
```

#### 结构化结果

```json
{
  "recommendations": []
}
```

### recommend-borderline-relevance

- 模块：`proactive-recommender`
- 指标：`recommendation_acceptance_proxy`
- Prompt：`MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT`
- 预期：边界相关度的记忆应谨慎推荐或不推荐
- 实际：["mem-ts-strict"]
- 评分：`1.000`
- 结果：通过
- 耗时：16558ms

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
    "user_input": "帮我重写这个函数，用 TypeScript。",
    "session_context": {
      "session_id": "rec-3",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "recent_context_summary": "用户在做代码重构。"
    },
    "detected_task_type": "coding"
  },
  "available_memories": [
    {
      "id": "mem-ts-strict",
      "memory_type": "fact_preference",
      "scope": "workspace",
      "status": "active",
      "summary": "项目使用 TypeScript strict 模式。",
      "importance": 4,
      "confidence": 0.88
    },
    {
      "id": "mem-old-meeting",
      "memory_type": "episodic",
      "scope": "workspace",
      "status": "archived",
      "summary": "上个月开过一次 sprint 回顾会。",
      "importance": 1,
      "confidence": 0.35
    }
  ]
}
```

#### 模型原始输出

```json
{"recommendations":[{"record_id":"mem-ts-strict","relevance_score":0.9,"trigger_reason":"task_similarity","suggestion":"可参考：项目启用了 TypeScript strict 模式，重写时注意补全类型并避免 any。","auto_inject":true}]}
```

#### 结构化结果

```json
{
  "recommendations": [
    {
      "record_id": "mem-ts-strict",
      "relevance_score": 0.9,
      "trigger_reason": "task_similarity",
      "suggestion": "可参考：项目启用了 TypeScript strict 模式，重写时注意补全类型并避免 any。",
      "auto_inject": true
    }
  ]
}
```

### recommend-conflict-warning

- 模块：`proactive-recommender`
- 指标：`recommendation_acceptance_proxy`
- Prompt：`MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT`
- 预期：应推荐带冲突预警的记忆
- 实际：[{"record_id":"mem-space-pref","relevance_score":0.95,"trigger_reason":"conflict_warning","suggestion":"检测到你之前偏好使用 4 空格缩进、不要 tab；如果这次要改为 tab，我将以当前指令为准。","auto_inject":true}]
- 评分：`1.000`
- 结果：通过
- 耗时：13347ms

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
    "user_input": "用 tab 缩进写这个文件。",
    "session_context": {
      "session_id": "rec-4",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "recent_context_summary": "用户在写代码。"
    },
    "detected_task_type": "coding"
  },
  "available_memories": [
    {
      "id": "mem-space-pref",
      "memory_type": "fact_preference",
      "scope": "user",
      "status": "active",
      "summary": "用户偏好：使用 4 空格缩进，不用 tab。",
      "importance": 5,
      "confidence": 0.96
    }
  ]
}
```

#### 模型原始输出

```json
{"recommendations":[{"record_id":"mem-space-pref","relevance_score":0.95,"trigger_reason":"conflict_warning","suggestion":"检测到你之前偏好使用 4 空格缩进、不要 tab；如果这次要改为 tab，我将以当前指令为准。","auto_inject":true}]}
```

#### 结构化结果

```json
{
  "recommendations": [
    {
      "record_id": "mem-space-pref",
      "relevance_score": 0.95,
      "trigger_reason": "conflict_warning",
      "suggestion": "检测到你之前偏好使用 4 空格缩进、不要 tab；如果这次要改为 tab，我将以当前指令为准。",
      "auto_inject": true
    }
  ]
}
```

### recommend-auto-inject-high

- 模块：`proactive-recommender`
- 指标：`recommendation_acceptance_proxy`
- Prompt：`MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT`
- 预期：高度相关时 auto_inject 应为 true
- 实际：[{"record_id":"mem-migrate","relevance_score":0.98,"trigger_reason":"task_similarity","suggestion":"可继续沿用上次迁移进度：第 3 步已完成，下一步是创建索引。","auto_inject":true}]
- 评分：`1.000`
- 结果：通过
- 耗时：9689ms

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
    "user_input": "继续做迁移的下一步。",
    "session_context": {
      "session_id": "rec-5",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "recent_context_summary": "正在做数据库迁移。"
    },
    "detected_task_type": "implementation"
  },
  "available_memories": [
    {
      "id": "mem-migrate",
      "memory_type": "task_state",
      "scope": "task",
      "status": "active",
      "summary": "迁移进度：第 3 步完成，下一步创建索引。",
      "importance": 5,
      "confidence": 0.97
    }
  ]
}
```

#### 模型原始输出

```json
{"recommendations":[{"record_id":"mem-migrate","relevance_score":0.98,"trigger_reason":"task_similarity","suggestion":"可继续沿用上次迁移进度：第 3 步已完成，下一步是创建索引。","auto_inject":true}]}
```

#### 结构化结果

```json
{
  "recommendations": [
    {
      "record_id": "mem-migrate",
      "relevance_score": 0.98,
      "trigger_reason": "task_similarity",
      "suggestion": "可继续沿用上次迁移进度：第 3 步已完成，下一步是创建索引。",
      "auto_inject": true
    }
  ]
}
```

### recommend-no-auto-inject-low

- 模块：`proactive-recommender`
- 指标：`recommendation_acceptance_proxy`
- Prompt：`MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT`
- 预期：弱相关时 auto_inject 应为 false
- 实际：[{"record_id":"mem-lang-pref","relevance_score":0.93,"trigger_reason":"forgotten_context","suggestion":"可结合用户的中文回答偏好，用中文提供排序算法实现与说明。","auto_inject":true}]
- 评分：`0.300`
- 结果：未通过
- 耗时：13525ms
- 错误类型：`logic`

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
    "user_input": "写一个排序算法。",
    "session_context": {
      "session_id": "rec-6",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "recent_context_summary": "用户需要算法实现。"
    },
    "detected_task_type": "coding"
  },
  "available_memories": [
    {
      "id": "mem-lang-pref",
      "memory_type": "fact_preference",
      "scope": "user",
      "status": "active",
      "summary": "用户偏好：默认中文回答。",
      "importance": 5,
      "confidence": 0.94
    }
  ]
}
```

#### 模型原始输出

```json
{"recommendations":[{"record_id":"mem-lang-pref","relevance_score":0.93,"trigger_reason":"forgotten_context","suggestion":"可结合用户的中文回答偏好，用中文提供排序算法实现与说明。","auto_inject":true}]}
```

#### 结构化结果

```json
{
  "recommendations": [
    {
      "record_id": "mem-lang-pref",
      "relevance_score": 0.93,
      "trigger_reason": "forgotten_context",
      "suggestion": "可结合用户的中文回答偏好，用中文提供排序算法实现与说明。",
      "auto_inject": true
    }
  ]
}
```

### recommend-multiple-relevant

- 模块：`proactive-recommender`
- 指标：`recommendation_acceptance_proxy`
- Prompt：`MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT`
- 预期：多条高相关记忆应全部推荐
- 实际：["mem-api-prefix","mem-api-task"]
- 评分：`1.000`
- 结果：通过
- 耗时：16773ms

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
    "user_input": "继续写那个 API，按项目规范来。",
    "session_context": {
      "session_id": "rec-7",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "recent_context_summary": "正在开发 API。"
    },
    "detected_task_type": "implementation"
  },
  "available_memories": [
    {
      "id": "mem-api-prefix",
      "memory_type": "fact_preference",
      "scope": "workspace",
      "status": "active",
      "summary": "项目规则：API 前缀 /api/v2。",
      "importance": 5,
      "confidence": 0.95
    },
    {
      "id": "mem-api-task",
      "memory_type": "task_state",
      "scope": "task",
      "status": "active",
      "summary": "当前任务：实现用户列表 API。",
      "importance": 4,
      "confidence": 0.92
    },
    {
      "id": "mem-unrelated",
      "memory_type": "episodic",
      "scope": "workspace",
      "status": "active",
      "summary": "上周部署过一次 CDN。",
      "importance": 1,
      "confidence": 0.4
    }
  ]
}
```

#### 模型原始输出

```json
{"recommendations":[{"record_id":"mem-api-prefix","relevance_score":0.96,"trigger_reason":"task_similarity","suggestion":"可沿用项目规范：API 路径前缀使用 /api/v2。","auto_inject":true},{"record_id":"mem-api-task","relevance_score":0.93,"trigger_reason":"forgotten_context","suggestion":"当前正在实现的是“用户列表 API”，可按这个目标继续编写。","auto_inject":true}]}
```

#### 结构化结果

```json
{
  "recommendations": [
    {
      "record_id": "mem-api-prefix",
      "relevance_score": 0.96,
      "trigger_reason": "task_similarity",
      "suggestion": "可沿用项目规范：API 路径前缀使用 /api/v2。",
      "auto_inject": true
    },
    {
      "record_id": "mem-api-task",
      "relevance_score": 0.93,
      "trigger_reason": "forgotten_context",
      "suggestion": "当前正在实现的是“用户列表 API”，可按这个目标继续编写。",
      "auto_inject": true
    }
  ]
}
```

### recommend-empty-memories

- 模块：`proactive-recommender`
- 指标：`recommendation_acceptance_proxy`
- Prompt：`MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT`
- 预期：无可用记忆时应返回空推荐
- 实际：{"count":0}
- 评分：`1.000`
- 结果：通过
- 耗时：9165ms

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
    "user_input": "写个 hello world。",
    "session_context": {
      "session_id": "rec-8",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "recent_context_summary": ""
    },
    "detected_task_type": "coding"
  },
  "available_memories": []
}
```

#### 模型原始输出

```json
{"recommendations":[]}
```

#### 结构化结果

```json
{
  "recommendations": []
}
```

### recommend-archived-skip

- 模块：`proactive-recommender`
- 指标：`recommendation_acceptance_proxy`
- Prompt：`MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT`
- 预期：归档记忆不应被推荐
- 实际：[]
- 评分：`1.000`
- 结果：通过
- 耗时：9410ms

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
    "user_input": "帮我写文档。",
    "session_context": {
      "session_id": "rec-9",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "recent_context_summary": "写文档。"
    },
    "detected_task_type": "documentation"
  },
  "available_memories": [
    {
      "id": "mem-archived-doc",
      "memory_type": "task_state",
      "scope": "task",
      "status": "archived",
      "summary": "上次的文档任务已完成。",
      "importance": 2,
      "confidence": 0.5
    }
  ]
}
```

#### 模型原始输出

```json
{"recommendations":[]}
```

#### 结构化结果

```json
{
  "recommendations": []
}
```

### recommend-forgotten-context

- 模块：`proactive-recommender`
- 指标：`recommendation_acceptance_proxy`
- Prompt：`MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT`
- 预期：用户可能遗忘的关键上下文应被推荐
- 实际：[{"record_id":"mem-freeze","relevance_score":0.95,"trigger_reason":"conflict_warning","suggestion":"注意当前主分支在 4/25 后已冻结，新功能开发请先确认是否需要走分支方案或延期合并。","auto_inject":true}]
- 评分：`1.000`
- 结果：通过
- 耗时：11020ms

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
    "user_input": "开始做新功能。",
    "session_context": {
      "session_id": "rec-10",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "recent_context_summary": "用户开始新任务。"
    },
    "detected_task_type": "implementation"
  },
  "available_memories": [
    {
      "id": "mem-freeze",
      "memory_type": "fact_preference",
      "scope": "workspace",
      "status": "active",
      "summary": "注意：4/25 后主分支冻结合并，仅允许关键修复。",
      "importance": 5,
      "confidence": 0.98
    }
  ]
}
```

#### 模型原始输出

```json
{"recommendations":[{"record_id":"mem-freeze","relevance_score":0.95,"trigger_reason":"conflict_warning","suggestion":"注意当前主分支在 4/25 后已冻结，新功能开发请先确认是否需要走分支方案或延期合并。","auto_inject":true}]}
```

#### 结构化结果

```json
{
  "recommendations": [
    {
      "record_id": "mem-freeze",
      "relevance_score": 0.95,
      "trigger_reason": "conflict_warning",
      "suggestion": "注意当前主分支在 4/25 后已冻结，新功能开发请先确认是否需要走分支方案或延期合并。",
      "auto_inject": true
    }
  ]
}
```

### evolution-preference-extraction

- 模块：`evolution-planner`
- 指标：`knowledge_extraction_accuracy`
- Prompt：`MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT`
- 预期：应从多条偏好中提炼稳定模式
- 实际：{"evolution_type":"knowledge_extraction","extracted_knowledge":{"pattern":"用户长期偏好中文、先给结论，并保持表达简短自然。","confidence":0.95,"evidence_count":3,"suggested_scope":"user","suggested_importance":5}}
- 评分：`1.000`
- 结果：通过
- 耗时：14627ms

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
      "summary": "用户偏好：说明文档先给结论，再补短点。",
      "importance": 5,
      "confidence": 0.94,
      "created_at": "2026-04-21T08:00:00.000Z",
      "updated_at": "2026-04-21T08:00:00.000Z"
    },
    {
      "id": "evo-3",
      "memory_type": "fact_preference",
      "scope": "user",
      "summary": "用户偏好：不要写太长，自然中文。",
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
{"evolution_type":"knowledge_extraction","source_records":["evo-1","evo-2","evo-3"],"extracted_knowledge":{"pattern":"用户长期偏好中文、先给结论，并保持表达简短自然。","confidence":0.95,"evidence_count":3,"suggested_scope":"user","suggested_importance":5},"consolidation_plan":{"new_summary":"整合偏好：默认使用自然中文回答；说明性内容先给结论，再补充简短说明；整体保持篇幅精炼。","records_to_archive":["evo-1","evo-2","evo-3"]}}
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
    "pattern": "用户长期偏好中文、先给结论，并保持表达简短自然。",
    "confidence": 0.95,
    "evidence_count": 3,
    "suggested_scope": "user",
    "suggested_importance": 5
  },
  "consolidation_plan": {
    "new_summary": "整合偏好：默认使用自然中文回答；说明性内容先给结论，再补充简短说明；整体保持篇幅精炼。",
    "records_to_archive": [
      "evo-1",
      "evo-2",
      "evo-3"
    ]
  }
}
```

### evolution-pattern-workflow

- 模块：`evolution-planner`
- 指标：`knowledge_extraction_accuracy`
- Prompt：`MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT`
- 预期：应从任务状态记录中提炼工作模式
- 实际：{"evolution_type":"knowledge_extraction","pattern":"团队在验收/评测中呈现稳定顺序：优先完成链路或测试样本验证，再补充实际指标、统计数或指标文档。"}
- 评分：`1.000`
- 结果：通过
- 耗时：20049ms

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
      "id": "evo-t1",
      "memory_type": "task_state",
      "scope": "workspace",
      "summary": "最近 3 次验收都先补测试样本再补实际指标。",
      "importance": 4,
      "confidence": 0.9,
      "created_at": "2026-04-01T08:00:00.000Z",
      "updated_at": "2026-04-18T08:00:00.000Z"
    },
    {
      "id": "evo-t2",
      "memory_type": "task_state",
      "scope": "workspace",
      "summary": "最近 2 次评测都先做链路验证再回写指标文档。",
      "importance": 4,
      "confidence": 0.89,
      "created_at": "2026-04-10T08:00:00.000Z",
      "updated_at": "2026-04-20T08:00:00.000Z"
    },
    {
      "id": "evo-t3",
      "memory_type": "task_state",
      "scope": "workspace",
      "summary": "团队验收习惯：先通链路再补统计数。",
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
{"evolution_type":"knowledge_extraction","source_records":["evo-t1","evo-t2","evo-t3"],"extracted_knowledge":{"pattern":"团队在验收/评测中呈现稳定顺序：优先完成链路或测试样本验证，再补充实际指标、统计数或指标文档。","confidence":0.9,"evidence_count":3,"suggested_scope":"workspace","suggested_importance":4},"consolidation_plan":{"new_summary":"可固化为团队流程偏好：验收与评测通常先验证链路/测试样本可用，再补写指标与统计材料。","records_to_archive":["evo-t1","evo-t2","evo-t3"]}}
```

#### 结构化结果

```json
{
  "evolution_type": "knowledge_extraction",
  "source_records": [
    "evo-t1",
    "evo-t2",
    "evo-t3"
  ],
  "extracted_knowledge": {
    "pattern": "团队在验收/评测中呈现稳定顺序：优先完成链路或测试样本验证，再补充实际指标、统计数或指标文档。",
    "confidence": 0.9,
    "evidence_count": 3,
    "suggested_scope": "workspace",
    "suggested_importance": 4
  },
  "consolidation_plan": {
    "new_summary": "可固化为团队流程偏好：验收与评测通常先验证链路/测试样本可用，再补写指标与统计材料。",
    "records_to_archive": [
      "evo-t1",
      "evo-t2",
      "evo-t3"
    ]
  }
}
```

### evolution-summarization

- 模块：`evolution-planner`
- 指标：`knowledge_extraction_accuracy`
- Prompt：`MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT`
- 预期：summarization 类型应输出 consolidation_plan
- 实际：{"evolution_type":"summarization","consolidation_plan":{"new_summary":"2026-04-20 至 2026-04-22，工作区连续三天完成了不同类型的测试执行：4/20 集成测试，4/21 回归测试，4/22 端到端测试。","records_to_archive":["evo-s1","evo-s2","evo-s3"]}}
- 评分：`1.000`
- 结果：通过
- 耗时：39342ms

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
      "id": "evo-s1",
      "memory_type": "episodic",
      "scope": "workspace",
      "summary": "4/20 跑了集成测试。",
      "importance": 2,
      "confidence": 0.7,
      "created_at": "2026-04-20T08:00:00.000Z",
      "updated_at": "2026-04-20T08:00:00.000Z"
    },
    {
      "id": "evo-s2",
      "memory_type": "episodic",
      "scope": "workspace",
      "summary": "4/21 跑了回归测试。",
      "importance": 2,
      "confidence": 0.7,
      "created_at": "2026-04-21T08:00:00.000Z",
      "updated_at": "2026-04-21T08:00:00.000Z"
    },
    {
      "id": "evo-s3",
      "memory_type": "episodic",
      "scope": "workspace",
      "summary": "4/22 跑了端到端测试。",
      "importance": 2,
      "confidence": 0.7,
      "created_at": "2026-04-22T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z"
    }
  ],
  "time_window": {
    "start": "2026-04-20T00:00:00.000Z",
    "end": "2026-04-22T23:59:59.000Z"
  },
  "evolution_type": "summarization"
}
```

#### 模型原始输出

```json
{"evolution_type":"summarization","source_records":["evo-s1","evo-s2","evo-s3"],"extracted_knowledge":{"pattern":"4/20-4/22 连续三天分别执行了集成、回归和端到端测试。","confidence":0.87,"evidence_count":3,"suggested_scope":"workspace","suggested_importance":3},"consolidation_plan":{"new_summary":"2026-04-20 至 2026-04-22，工作区连续三天完成了不同类型的测试执行：4/20 集成测试，4/21 回归测试，4/22 端到端测试。","records_to_archive":["evo-s1","evo-s2","evo-s3"]}}
```

#### 结构化结果

```json
{
  "evolution_type": "summarization",
  "source_records": [
    "evo-s1",
    "evo-s2",
    "evo-s3"
  ],
  "extracted_knowledge": {
    "pattern": "4/20-4/22 连续三天分别执行了集成、回归和端到端测试。",
    "confidence": 0.87,
    "evidence_count": 3,
    "suggested_scope": "workspace",
    "suggested_importance": 3
  },
  "consolidation_plan": {
    "new_summary": "2026-04-20 至 2026-04-22，工作区连续三天完成了不同类型的测试执行：4/20 集成测试，4/21 回归测试，4/22 端到端测试。",
    "records_to_archive": [
      "evo-s1",
      "evo-s2",
      "evo-s3"
    ]
  }
}
```

### evolution-too-few-records

- 模块：`evolution-planner`
- 指标：`knowledge_extraction_accuracy`
- Prompt：`MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT`
- 预期：单条记录不足以提炼模式时应标记低置信度
- 实际：{"extracted_knowledge":{"pattern":"用户偏好使用中文进行交流。","confidence":0.85,"evidence_count":1,"suggested_scope":"user","suggested_importance":4}}
- 评分：`0.500`
- 结果：未通过
- 耗时：21694ms
- 错误类型：`logic`

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
      "id": "evo-single",
      "memory_type": "fact_preference",
      "scope": "user",
      "summary": "用户偏好：用中文。",
      "importance": 4,
      "confidence": 0.85,
      "created_at": "2026-04-22T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z"
    }
  ],
  "time_window": {
    "start": "2026-04-22T00:00:00.000Z",
    "end": "2026-04-22T23:59:59.000Z"
  },
  "evolution_type": "knowledge_extraction"
}
```

#### 模型原始输出

```json
{"evolution_type":"knowledge_extraction","source_records":["evo-single"],"extracted_knowledge":{"pattern":"用户偏好使用中文进行交流。","confidence":0.85,"evidence_count":1,"suggested_scope":"user","suggested_importance":4}}
```

#### 结构化结果

```json
{
  "evolution_type": "knowledge_extraction",
  "source_records": [
    "evo-single"
  ],
  "extracted_knowledge": {
    "pattern": "用户偏好使用中文进行交流。",
    "confidence": 0.85,
    "evidence_count": 1,
    "suggested_scope": "user",
    "suggested_importance": 4
  }
}
```

### evolution-cross-scope-pattern

- 模块：`evolution-planner`
- 指标：`knowledge_extraction_accuracy`
- Prompt：`MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT`
- 预期：跨 scope 的记录应正确建议提炼后的 scope
- 实际：{"extracted_knowledge":{"pattern":"用户在开发协作中偏好中英分工：代码注释与 commit message 用英文，文档和常规回复用中文。","confidence":0.95,"evidence_count":3,"suggested_scope":"user","suggested_importance":5}}
- 评分：`1.000`
- 结果：通过
- 耗时：14867ms

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
      "id": "evo-u1",
      "memory_type": "fact_preference",
      "scope": "user",
      "summary": "用户偏好：代码写英文注释。",
      "importance": 4,
      "confidence": 0.88,
      "created_at": "2026-04-15T08:00:00.000Z",
      "updated_at": "2026-04-15T08:00:00.000Z"
    },
    {
      "id": "evo-u2",
      "memory_type": "fact_preference",
      "scope": "user",
      "summary": "用户偏好：commit message 用英文。",
      "importance": 4,
      "confidence": 0.9,
      "created_at": "2026-04-18T08:00:00.000Z",
      "updated_at": "2026-04-18T08:00:00.000Z"
    },
    {
      "id": "evo-u3",
      "memory_type": "fact_preference",
      "scope": "user",
      "summary": "用户偏好：文档和回复用中文。",
      "importance": 4,
      "confidence": 0.88,
      "created_at": "2026-04-20T08:00:00.000Z",
      "updated_at": "2026-04-20T08:00:00.000Z"
    }
  ],
  "time_window": {
    "start": "2026-04-15T00:00:00.000Z",
    "end": "2026-04-22T23:59:59.000Z"
  },
  "evolution_type": "knowledge_extraction"
}
```

#### 模型原始输出

```json
{"evolution_type":"knowledge_extraction","source_records":["evo-u1","evo-u2","evo-u3"],"extracted_knowledge":{"pattern":"用户在开发协作中偏好中英分工：代码注释与 commit message 用英文，文档和常规回复用中文。","confidence":0.95,"evidence_count":3,"suggested_scope":"user","suggested_importance":5},"consolidation_plan":{"new_summary":"用户语言偏好已稳定：代码注释和 commit message 使用英文；文档与对话回复使用中文。","records_to_archive":["evo-u1","evo-u2","evo-u3"]}}
```

#### 结构化结果

```json
{
  "evolution_type": "knowledge_extraction",
  "source_records": [
    "evo-u1",
    "evo-u2",
    "evo-u3"
  ],
  "extracted_knowledge": {
    "pattern": "用户在开发协作中偏好中英分工：代码注释与 commit message 用英文，文档和常规回复用中文。",
    "confidence": 0.95,
    "evidence_count": 3,
    "suggested_scope": "user",
    "suggested_importance": 5
  },
  "consolidation_plan": {
    "new_summary": "用户语言偏好已稳定：代码注释和 commit message 使用英文；文档与对话回复使用中文。",
    "records_to_archive": [
      "evo-u1",
      "evo-u2",
      "evo-u3"
    ]
  }
}
```

### evolution-pattern-discovery

- 模块：`evolution-planner`
- 指标：`knowledge_extraction_accuracy`
- Prompt：`MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT`
- 预期：pattern_discovery 类型应识别行为模式
- 实际：{"evolution_type":"pattern_discovery","pattern":"在该工作区中，提交 PR 前通常会先运行 lint 和单元测试。"}
- 评分：`1.000`
- 结果：通过
- 耗时：12657ms

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
      "id": "evo-p1",
      "memory_type": "task_state",
      "scope": "workspace",
      "summary": "每次 PR 前都会先跑 lint 和单元测试。",
      "importance": 4,
      "confidence": 0.88,
      "created_at": "2026-04-10T08:00:00.000Z",
      "updated_at": "2026-04-20T08:00:00.000Z"
    },
    {
      "id": "evo-p2",
      "memory_type": "task_state",
      "scope": "workspace",
      "summary": "上次也是先 lint 再测试再提 PR。",
      "importance": 3,
      "confidence": 0.82,
      "created_at": "2026-04-18T08:00:00.000Z",
      "updated_at": "2026-04-21T08:00:00.000Z"
    }
  ],
  "time_window": {
    "start": "2026-04-10T00:00:00.000Z",
    "end": "2026-04-22T23:59:59.000Z"
  },
  "evolution_type": "pattern_discovery"
}
```

#### 模型原始输出

```json
{"evolution_type":"pattern_discovery","source_records":["evo-p1","evo-p2"],"extracted_knowledge":{"pattern":"在该工作区中，提交 PR 前通常会先运行 lint 和单元测试。","confidence":0.9,"evidence_count":2,"suggested_scope":"workspace","suggested_importance":4},"consolidation_plan":{"new_summary":"已观察到稳定流程：提 PR 前通常先执行 lint，再运行单元测试。","records_to_archive":["evo-p1","evo-p2"]}}
```

#### 结构化结果

```json
{
  "evolution_type": "pattern_discovery",
  "source_records": [
    "evo-p1",
    "evo-p2"
  ],
  "extracted_knowledge": {
    "pattern": "在该工作区中，提交 PR 前通常会先运行 lint 和单元测试。",
    "confidence": 0.9,
    "evidence_count": 2,
    "suggested_scope": "workspace",
    "suggested_importance": 4
  },
  "consolidation_plan": {
    "new_summary": "已观察到稳定流程：提 PR 前通常先执行 lint，再运行单元测试。",
    "records_to_archive": [
      "evo-p1",
      "evo-p2"
    ]
  }
}
```

### evolution-unrelated-records

- 模块：`evolution-planner`
- 指标：`knowledge_extraction_accuracy`
- Prompt：`MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT`
- 预期：不相关的记录不应被强行提炼
- 实际：{"extracted_knowledge":{"pattern":"用户偏好使用 Vim。","confidence":0.9,"evidence_count":1,"suggested_scope":"user","suggested_importance":4}}
- 评分：`0.000`
- 结果：未通过
- 耗时：16593ms
- 错误类型：`logic`

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
      "id": "evo-x1",
      "memory_type": "episodic",
      "scope": "workspace",
      "summary": "修了一个 CSS 居中问题。",
      "importance": 2,
      "confidence": 0.6,
      "created_at": "2026-04-18T08:00:00.000Z",
      "updated_at": "2026-04-18T08:00:00.000Z"
    },
    {
      "id": "evo-x2",
      "memory_type": "fact_preference",
      "scope": "user",
      "summary": "用户偏好：用 Vim。",
      "importance": 4,
      "confidence": 0.9,
      "created_at": "2026-04-20T08:00:00.000Z",
      "updated_at": "2026-04-20T08:00:00.000Z"
    }
  ],
  "time_window": {
    "start": "2026-04-18T00:00:00.000Z",
    "end": "2026-04-22T23:59:59.000Z"
  },
  "evolution_type": "knowledge_extraction"
}
```

#### 模型原始输出

```json
{"evolution_type":"knowledge_extraction","source_records":["evo-x2"],"extracted_knowledge":{"pattern":"用户偏好使用 Vim。","confidence":0.9,"evidence_count":1,"suggested_scope":"user","suggested_importance":4}}
```

#### 结构化结果

```json
{
  "evolution_type": "knowledge_extraction",
  "source_records": [
    "evo-x2"
  ],
  "extracted_knowledge": {
    "pattern": "用户偏好使用 Vim。",
    "confidence": 0.9,
    "evidence_count": 1,
    "suggested_scope": "user",
    "suggested_importance": 4
  }
}
```

### evolution-high-evidence-count

- 模块：`evolution-planner`
- 指标：`knowledge_extraction_accuracy`
- Prompt：`MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT`
- 预期：多条一致证据时 evidence_count 应准确反映
- 实际：{"evidence_count":4,"confidence":0.96}
- 评分：`1.000`
- 结果：通过
- 耗时：20043ms

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
      "id": "evo-h1",
      "memory_type": "fact_preference",
      "scope": "user",
      "summary": "用户偏好：TypeScript strict。",
      "importance": 5,
      "confidence": 0.95,
      "created_at": "2026-04-01T08:00:00.000Z",
      "updated_at": "2026-04-01T08:00:00.000Z"
    },
    {
      "id": "evo-h2",
      "memory_type": "fact_preference",
      "scope": "user",
      "summary": "用户偏好：no-any 规则。",
      "importance": 5,
      "confidence": 0.94,
      "created_at": "2026-04-05T08:00:00.000Z",
      "updated_at": "2026-04-05T08:00:00.000Z"
    },
    {
      "id": "evo-h3",
      "memory_type": "fact_preference",
      "scope": "user",
      "summary": "用户偏好：开启所有 strict 检查。",
      "importance": 5,
      "confidence": 0.93,
      "created_at": "2026-04-10T08:00:00.000Z",
      "updated_at": "2026-04-10T08:00:00.000Z"
    },
    {
      "id": "evo-h4",
      "memory_type": "fact_preference",
      "scope": "user",
      "summary": "用户偏好：类型检查不用 as any。",
      "importance": 4,
      "confidence": 0.91,
      "created_at": "2026-04-15T08:00:00.000Z",
      "updated_at": "2026-04-15T08:00:00.000Z"
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
{"evolution_type":"knowledge_extraction","source_records":["evo-h1","evo-h2","evo-h3","evo-h4"],"extracted_knowledge":{"pattern":"用户稳定偏好严格的 TypeScript 类型安全：启用 strict 检查、遵守 no-any，并避免使用 as any。","confidence":0.96,"evidence_count":4,"suggested_scope":"user","suggested_importance":5},"consolidation_plan":{"new_summary":"用户偏好严格的 TypeScript 类型安全规范：使用 strict 模式，遵守 no-any，避免以 as any 绕过类型检查。","records_to_archive":["evo-h1","evo-h2","evo-h3","evo-h4"]}}
```

#### 结构化结果

```json
{
  "evolution_type": "knowledge_extraction",
  "source_records": [
    "evo-h1",
    "evo-h2",
    "evo-h3",
    "evo-h4"
  ],
  "extracted_knowledge": {
    "pattern": "用户稳定偏好严格的 TypeScript 类型安全：启用 strict 检查、遵守 no-any，并避免使用 as any。",
    "confidence": 0.96,
    "evidence_count": 4,
    "suggested_scope": "user",
    "suggested_importance": 5
  },
  "consolidation_plan": {
    "new_summary": "用户偏好严格的 TypeScript 类型安全规范：使用 strict 模式，遵守 no-any，避免以 as any 绕过类型检查。",
    "records_to_archive": [
      "evo-h1",
      "evo-h2",
      "evo-h3",
      "evo-h4"
    ]
  }
}
```

### govverify-reject-delete

- 模块：`governance-verifier`
- 指标：`governance_correctness_proxy`
- Prompt：`MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT`
- 预期：缺少删除依据的删除提案应拒绝
- 实际：{"decision":"reject","confidence":0.98,"notes":"删除提案依据不足。该提案仅以“看起来没用了，删掉”作为理由，未提供明确的 delete_reason、失效依据、重复替代记录，或被新记录取代的上下文。目标记录仍是 active 状态，且没有相关记录证明可安全删除。根据规则，应拒绝此类缺乏明确删除理由或替代关系的删除操作。"}
- 评分：`1.000`
- 结果：通过
- 耗时：18153ms

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
    "proposal_id": "p-1",
    "proposal_type": "delete",
    "targets": {
      "record_ids": [
        "gv-1"
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
      "model": "gpt-5.3",
      "confidence": 0.66
    }
  },
  "seed_records": [
    {
      "id": "gv-1",
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
      "created_at": "2026-04-20T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z",
      "last_used_at": null
    }
  ],
  "related_records": [],
  "open_conflicts": []
}
```

#### 模型原始输出

```json
{"decision":"reject","confidence":0.98,"notes":"删除提案依据不足。该提案仅以“看起来没用了，删掉”作为理由，未提供明确的 delete_reason、失效依据、重复替代记录，或被新记录取代的上下文。目标记录仍是 active 状态，且没有相关记录证明可安全删除。根据规则，应拒绝此类缺乏明确删除理由或替代关系的删除操作。"}
```

#### 结构化结果

```json
{
  "decision": "reject",
  "confidence": 0.98,
  "notes": "删除提案依据不足。该提案仅以“看起来没用了，删掉”作为理由，未提供明确的 delete_reason、失效依据、重复替代记录，或被新记录取代的上下文。目标记录仍是 active 状态，且没有相关记录证明可安全删除。根据规则，应拒绝此类缺乏明确删除理由或替代关系的删除操作。"
}
```

### govverify-approve-archive

- 模块：`governance-verifier`
- 指标：`governance_correctness_proxy`
- Prompt：`MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT`
- 预期：证据充分的归档提案应批准
- 实际：{"decision":"approve","confidence":0.97,"notes":"提案具体明确：将 gv-2 归档，理由为被更新的同类偏好记录 gv-3 替代。证据充分：两条记录属于同一 workspace、同一 user、同一 scope=user、同一 memory_type=fact_preference，且 gv-3 内容明显覆盖并扩展了 gv-2（“尽量简短”被“默认中文，回答自然且尽量简短”包含）。这是典型的较新记录清晰取代较旧记录的场景；无开放冲突，未见跨作用域问题，归档而非删除也降低风险。"}
- 评分：`1.000`
- 结果：通过
- 耗时：17883ms

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
    "proposal_id": "p-2",
    "proposal_type": "archive",
    "targets": {
      "record_ids": [
        "gv-2"
      ]
    },
    "suggested_changes": {
      "status": "archived"
    },
    "reason_code": "superseded",
    "reason_text": "该记录已被更新的同类偏好替代。",
    "evidence": {
      "matched_records": 2,
      "replacement_record_ids": [
        "gv-3"
      ]
    },
    "planner": {
      "model": "gpt-5.3",
      "confidence": 0.91
    }
  },
  "seed_records": [
    {
      "id": "gv-2",
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
      "updated_at": "2026-04-22T08:00:00.000Z",
      "last_used_at": "2026-04-05T09:00:00.000Z"
    }
  ],
  "related_records": [
    {
      "id": "gv-3",
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
      "updated_at": "2026-04-22T08:00:00.000Z",
      "last_used_at": "2026-04-22T09:00:00.000Z"
    }
  ],
  "open_conflicts": []
}
```

#### 模型原始输出

```json
{"decision":"approve","confidence":0.97,"notes":"提案具体明确：将 gv-2 归档，理由为被更新的同类偏好记录 gv-3 替代。证据充分：两条记录属于同一 workspace、同一 user、同一 scope=user、同一 memory_type=fact_preference，且 gv-3 内容明显覆盖并扩展了 gv-2（“尽量简短”被“默认中文，回答自然且尽量简短”包含）。这是典型的较新记录清晰取代较旧记录的场景；无开放冲突，未见跨作用域问题，归档而非删除也降低风险。"}
```

#### 结构化结果

```json
{
  "decision": "approve",
  "confidence": 0.97,
  "notes": "提案具体明确：将 gv-2 归档，理由为被更新的同类偏好记录 gv-3 替代。证据充分：两条记录属于同一 workspace、同一 user、同一 scope=user、同一 memory_type=fact_preference，且 gv-3 内容明显覆盖并扩展了 gv-2（“尽量简短”被“默认中文，回答自然且尽量简短”包含）。这是典型的较新记录清晰取代较旧记录的场景；无开放冲突，未见跨作用域问题，归档而非删除也降低风险。"
}
```

### govverify-reject-scope-mismatch

- 模块：`governance-verifier`
- 指标：`governance_correctness_proxy`
- Prompt：`MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT`
- 预期：跨 scope 错误的合并提案应拒绝
- 实际：{"decision":"reject","confidence":0.96,"notes":"提案尝试合并不同作用域的记录（user 与 workspace），存在明显跨 scope 风险。两条记录内容也不是同一持久事实：一条是用户偏好“默认中文”，另一条是项目/工作区规则“文档用中文写”。虽然表面相似，但语义和约束来源不同，不能视为重复记录。现有证据仅说明 matched_records=2，不足以支持合并。"}
- 评分：`1.000`
- 结果：通过
- 耗时：18378ms

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
    "proposal_id": "p-3",
    "proposal_type": "merge",
    "targets": {
      "record_ids": [
        "gv-user-1",
        "gv-ws-1"
      ]
    },
    "suggested_changes": {
      "merged_summary": "合并后的记录"
    },
    "reason_code": "duplicate",
    "reason_text": "两条内容相似。",
    "evidence": {
      "matched_records": 2
    },
    "planner": {
      "model": "gpt-5.3",
      "confidence": 0.72
    }
  },
  "seed_records": [
    {
      "id": "gv-user-1",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "task_id": null,
      "session_id": null,
      "memory_type": "fact_preference",
      "scope": "user",
      "status": "active",
      "summary": "用户偏好：默认中文。",
      "details": null,
      "importance": 5,
      "confidence": 0.95,
      "created_at": "2026-04-20T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z",
      "last_used_at": null
    },
    {
      "id": "gv-ws-1",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "task_id": null,
      "session_id": null,
      "memory_type": "fact_preference",
      "scope": "workspace",
      "status": "active",
      "summary": "项目规则：文档用中文写。",
      "details": null,
      "importance": 4,
      "confidence": 0.88,
      "created_at": "2026-04-20T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z",
      "last_used_at": null
    }
  ],
  "related_records": [],
  "open_conflicts": []
}
```

#### 模型原始输出

```json
{"decision":"reject","confidence":0.96,"notes":"提案尝试合并不同作用域的记录（user 与 workspace），存在明显跨 scope 风险。两条记录内容也不是同一持久事实：一条是用户偏好“默认中文”，另一条是项目/工作区规则“文档用中文写”。虽然表面相似，但语义和约束来源不同，不能视为重复记录。现有证据仅说明 matched_records=2，不足以支持合并。"}
```

#### 结构化结果

```json
{
  "decision": "reject",
  "confidence": 0.96,
  "notes": "提案尝试合并不同作用域的记录（user 与 workspace），存在明显跨 scope 风险。两条记录内容也不是同一持久事实：一条是用户偏好“默认中文”，另一条是项目/工作区规则“文档用中文写”。虽然表面相似，但语义和约束来源不同，不能视为重复记录。现有证据仅说明 matched_records=2，不足以支持合并。"
}
```

### govverify-approve-merge-same-fact

- 模块：`governance-verifier`
- 指标：`governance_correctness_proxy`
- Prompt：`MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT`
- 预期：同 scope 同事实的合并提案应批准
- 实际：{"decision":"reject","confidence":0.97,"notes":"提议将两条不同的用户偏好合并为重复记录，但证据不足以表明它们是同一 durable fact。gv-m1 表示语言偏好（默认中文回答），gv-m2 表示风格偏好（回答简短）；二者可以同时成立，但不是明显重复项。该操作更像是聚合两个独立偏好，而非合并重复记录。根据规则，合并不清晰属于同一事实的记录应拒绝。"}
- 评分：`0.000`
- 结果：未通过
- 耗时：15309ms
- 错误类型：`logic`

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
    "proposal_id": "p-4",
    "proposal_type": "merge",
    "targets": {
      "record_ids": [
        "gv-m1",
        "gv-m2"
      ]
    },
    "suggested_changes": {
      "merged_summary": "用户偏好：默认中文回答，简短输出。"
    },
    "reason_code": "duplicate",
    "reason_text": "两条描述同一偏好。",
    "evidence": {
      "matched_records": 2
    },
    "planner": {
      "model": "gpt-5.3",
      "confidence": 0.92
    }
  },
  "seed_records": [
    {
      "id": "gv-m1",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "task_id": null,
      "session_id": null,
      "memory_type": "fact_preference",
      "scope": "user",
      "status": "active",
      "summary": "用户偏好：默认中文回答。",
      "details": null,
      "importance": 5,
      "confidence": 0.94,
      "created_at": "2026-04-20T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z",
      "last_used_at": null
    },
    {
      "id": "gv-m2",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "task_id": null,
      "session_id": null,
      "memory_type": "fact_preference",
      "scope": "user",
      "status": "active",
      "summary": "用户偏好：回答简短。",
      "details": null,
      "importance": 4,
      "confidence": 0.9,
      "created_at": "2026-04-20T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z",
      "last_used_at": null
    }
  ],
  "related_records": [],
  "open_conflicts": []
}
```

#### 模型原始输出

```json
{"decision":"reject","confidence":0.97,"notes":"提议将两条不同的用户偏好合并为重复记录，但证据不足以表明它们是同一 durable fact。gv-m1 表示语言偏好（默认中文回答），gv-m2 表示风格偏好（回答简短）；二者可以同时成立，但不是明显重复项。该操作更像是聚合两个独立偏好，而非合并重复记录。根据规则，合并不清晰属于同一事实的记录应拒绝。"}
```

#### 结构化结果

```json
{
  "decision": "reject",
  "confidence": 0.97,
  "notes": "提议将两条不同的用户偏好合并为重复记录，但证据不足以表明它们是同一 durable fact。gv-m1 表示语言偏好（默认中文回答），gv-m2 表示风格偏好（回答简短）；二者可以同时成立，但不是明显重复项。该操作更像是聚合两个独立偏好，而非合并重复记录。根据规则，合并不清晰属于同一事实的记录应拒绝。"
}
```

### govverify-reject-insufficient-conflict

- 模块：`governance-verifier`
- 指标：`governance_correctness_proxy`
- Prompt：`MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT`
- 预期：证据不足的冲突解决提案应拒绝
- 实际：{"decision":"reject","confidence":0.95,"notes":"Proposal resolves a contradiction conflict via auto_merge, but there is insufficient evidence to support resolution. The conflicting counterpart record gv-c2 is not included in seed_records or related_records, and matched_records=1 does not establish that both records describe the same durable fact or how the contradiction should be resolved. Rejecting due to insufficient evidence for conflict resolution."}
- 评分：`1.000`
- 结果：通过
- 耗时：11084ms

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
    "proposal_id": "p-5",
    "proposal_type": "resolve_conflict",
    "targets": {
      "record_ids": [
        "gv-c1"
      ]
    },
    "suggested_changes": {
      "resolution": "auto_merge"
    },
    "reason_code": "resolve",
    "reason_text": "自动解决冲突。",
    "evidence": {
      "matched_records": 1
    },
    "planner": {
      "model": "gpt-5.3",
      "confidence": 0.55
    }
  },
  "seed_records": [
    {
      "id": "gv-c1",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "task_id": null,
      "session_id": null,
      "memory_type": "fact_preference",
      "scope": "workspace",
      "status": "active",
      "summary": "测试框架用 Jest。",
      "details": null,
      "importance": 3,
      "confidence": 0.7,
      "created_at": "2026-04-20T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z",
      "last_used_at": null
    }
  ],
  "related_records": [],
  "open_conflicts": [
    {
      "id": "conflict-gv",
      "record_id": "gv-c1",
      "conflict_with_record_id": "gv-c2",
      "conflict_type": "contradiction",
      "conflict_summary": "测试框架选择矛盾",
      "created_at": "2026-04-22T10:00:00.000Z"
    }
  ]
}
```

#### 模型原始输出

```json
{"decision":"reject","confidence":0.95,"notes":"Proposal resolves a contradiction conflict via auto_merge, but there is insufficient evidence to support resolution. The conflicting counterpart record gv-c2 is not included in seed_records or related_records, and matched_records=1 does not establish that both records describe the same durable fact or how the contradiction should be resolved. Rejecting due to insufficient evidence for conflict resolution."}
```

#### 结构化结果

```json
{
  "decision": "reject",
  "confidence": 0.95,
  "notes": "Proposal resolves a contradiction conflict via auto_merge, but there is insufficient evidence to support resolution. The conflicting counterpart record gv-c2 is not included in seed_records or related_records, and matched_records=1 does not establish that both records describe the same durable fact or how the contradiction should be resolved. Rejecting due to insufficient evidence for conflict resolution."
}
```

### govverify-approve-downgrade

- 模块：`governance-verifier`
- 指标：`governance_correctness_proxy`
- Prompt：`MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT`
- 预期：合理的降级提案应批准
- 实际：{"decision":"approve","confidence":0.96,"notes":"The proposal is specific and low-ambiguity: it downgrades a single episodic session-scoped record whose content is just a greeting ('用户打了个招呼'). That content does not justify importance=5, so reducing it to 1 is well-supported by the seed record itself. No merge, deletion, conflict resolution, or scope-crossing issue is involved."}
- 评分：`1.000`
- 结果：通过
- 耗时：20622ms

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
    "proposal_id": "p-6",
    "proposal_type": "downgrade",
    "targets": {
      "record_ids": [
        "gv-d1"
      ]
    },
    "suggested_changes": {
      "new_importance": 1
    },
    "reason_code": "inflated",
    "reason_text": "低价值 session 记录被标为 importance=5，明显虚高。",
    "evidence": {
      "matched_records": 1
    },
    "planner": {
      "model": "gpt-5.3",
      "confidence": 0.94
    }
  },
  "seed_records": [
    {
      "id": "gv-d1",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "task_id": null,
      "session_id": null,
      "memory_type": "episodic",
      "scope": "session",
      "status": "active",
      "summary": "用户打了个招呼。",
      "details": null,
      "importance": 5,
      "confidence": 0.45,
      "created_at": "2026-04-20T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z",
      "last_used_at": null
    }
  ],
  "related_records": [],
  "open_conflicts": []
}
```

#### 模型原始输出

```json
{"decision":"approve","confidence":0.96,"notes":"The proposal is specific and low-ambiguity: it downgrades a single episodic session-scoped record whose content is just a greeting ('用户打了个招呼'). That content does not justify importance=5, so reducing it to 1 is well-supported by the seed record itself. No merge, deletion, conflict resolution, or scope-crossing issue is involved."}
```

#### 结构化结果

```json
{
  "decision": "approve",
  "confidence": 0.96,
  "notes": "The proposal is specific and low-ambiguity: it downgrades a single episodic session-scoped record whose content is just a greeting ('用户打了个招呼'). That content does not justify importance=5, so reducing it to 1 is well-supported by the seed record itself. No merge, deletion, conflict resolution, or scope-crossing issue is involved."
}
```

### govverify-reject-no-replacement

- 模块：`governance-verifier`
- 指标：`governance_correctness_proxy`
- Prompt：`MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT`
- 预期：无替代记录的归档提案应拒绝
- 实际：{"decision":"reject","confidence":0.94,"notes":"The archive action is not well-supported. The target is an active user-scoped preference record ('4-space indentation') with high confidence and no replacement, superseding record, delete/archive rationale beyond 'low value,' or related evidence showing it is obsolete or incorrect. This is not a clear low-ambiguity cleanup case, so the proposal should be rejected."}
- 评分：`1.000`
- 结果：通过
- 耗时：19268ms

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
    "proposal_id": "p-7",
    "proposal_type": "archive",
    "targets": {
      "record_ids": [
        "gv-only"
      ]
    },
    "suggested_changes": {
      "status": "archived"
    },
    "reason_code": "low_value",
    "reason_text": "价值不高。",
    "evidence": {
      "matched_records": 1
    },
    "planner": {
      "model": "gpt-5.3",
      "confidence": 0.58
    }
  },
  "seed_records": [
    {
      "id": "gv-only",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "task_id": null,
      "session_id": null,
      "memory_type": "fact_preference",
      "scope": "user",
      "status": "active",
      "summary": "用户偏好：4 空格缩进。",
      "details": null,
      "importance": 5,
      "confidence": 0.95,
      "created_at": "2026-04-20T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z",
      "last_used_at": null
    }
  ],
  "related_records": [],
  "open_conflicts": []
}
```

#### 模型原始输出

```json
{"decision":"reject","confidence":0.94,"notes":"The archive action is not well-supported. The target is an active user-scoped preference record ('4-space indentation') with high confidence and no replacement, superseding record, delete/archive rationale beyond 'low value,' or related evidence showing it is obsolete or incorrect. This is not a clear low-ambiguity cleanup case, so the proposal should be rejected."}
```

#### 结构化结果

```json
{
  "decision": "reject",
  "confidence": 0.94,
  "notes": "The archive action is not well-supported. The target is an active user-scoped preference record ('4-space indentation') with high confidence and no replacement, superseding record, delete/archive rationale beyond 'low value,' or related evidence showing it is obsolete or incorrect. This is not a clear low-ambiguity cleanup case, so the proposal should be rejected."
}
```

### govverify-high-confidence-approve

- 模块：`governance-verifier`
- 指标：`governance_correctness_proxy`
- Prompt：`MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT`
- 预期：高置信度且证据充分的提案应批准
- 实际：网络/上游错误
- 评分：`0.000`
- 结果：未通过
- 耗时：45004ms
- 错误类型：`network`
- 错误：`memory_llm_timeout`

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
    "proposal_id": "p-8",
    "proposal_type": "delete",
    "targets": {
      "record_ids": [
        "gv-del"
      ]
    },
    "suggested_changes": {
      "status": "deleted",
      "delete_mode": "soft"
    },
    "reason_code": "obsolete",
    "reason_text": "monkey patch 已被正式修复替代，临时记录应删除。",
    "evidence": {
      "matched_records": 2,
      "replacement_record_ids": [
        "gv-fix"
      ]
    },
    "planner": {
      "model": "gpt-5.3",
      "confidence": 0.96
    }
  },
  "seed_records": [
    {
      "id": "gv-del",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "task_id": null,
      "session_id": null,
      "memory_type": "episodic",
      "scope": "workspace",
      "status": "active",
      "summary": "临时 monkey patch 已移除。",
      "details": null,
      "importance": 1,
      "confidence": 0.4,
      "created_at": "2026-04-20T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z",
      "last_used_at": null
    }
  ],
  "related_records": [
    {
      "id": "gv-fix",
      "workspace_id": "eval-workspace",
      "user_id": "eval-user",
      "task_id": null,
      "session_id": null,
      "memory_type": "task_state",
      "scope": "workspace",
      "status": "active",
      "summary": "bug 已正式修复并合入主分支。",
      "details": null,
      "importance": 4,
      "confidence": 0.95,
      "created_at": "2026-04-20T08:00:00.000Z",
      "updated_at": "2026-04-22T08:00:00.000Z",
      "last_used_at": null
    }
  ],
  "open_conflicts": []
}
```

### effectiveness-memory-used

- 模块：`effectiveness-evaluator`
- 指标：`effectiveness_adjustment_direction_proxy`
- Prompt：`MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT`
- 预期：回复明显使用了注入记忆时应正向评估
- 实际：网络/上游错误
- 评分：`0.000`
- 结果：未通过
- 耗时：45005ms
- 错误类型：`network`
- 错误：`memory_llm_timeout`

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
      "summary": "用户偏好：默认中文，先给结论再补短点。",
      "importance": 5
    }
  ],
  "assistant_output": "结论：这些指标可以用真实模型测。后面按中文短句格式补到文档里。",
  "user_feedback": {
    "rating": 5,
    "comment": "格式符合预期。"
  }
}
```

### effectiveness-memory-ignored

- 模块：`effectiveness-evaluator`
- 指标：`effectiveness_adjustment_direction_proxy`
- Prompt：`MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT`
- 预期：注入记忆未被使用时应负向调整
- 实际：网络/上游错误
- 评分：`0.000`
- 结果：未通过
- 耗时：45003ms
- 错误类型：`network`
- 错误：`memory_llm_timeout`

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
      "record_id": "eff-2",
      "summary": "用户偏好：默认中文回答。",
      "importance": 5
    }
  ],
  "assistant_output": "The quicksort algorithm works by choosing a pivot element and partitioning the array into two sub-arrays.",
  "user_feedback": null
}
```

### effectiveness-partial-use

- 模块：`effectiveness-evaluator`
- 指标：`effectiveness_adjustment_direction_proxy`
- Prompt：`MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT`
- 预期：部分使用时应中性评估
- 实际：网络/上游错误
- 评分：`0.000`
- 结果：未通过
- 耗时：45009ms
- 错误类型：`network`
- 错误：`memory_llm_timeout`

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
      "record_id": "eff-3a",
      "summary": "用户偏好：默认中文。",
      "importance": 5
    },
    {
      "record_id": "eff-3b",
      "summary": "迁移进度：第 3 步完成。",
      "importance": 4
    }
  ],
  "assistant_output": "好的，用中文回答。关于你的问题，我来分析一下这个函数的逻辑。",
  "user_feedback": null
}
```

### effectiveness-with-positive-feedback

- 模块：`effectiveness-evaluator`
- 指标：`effectiveness_adjustment_direction_proxy`
- Prompt：`MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT`
- 预期：用户正向反馈时 effectiveness_score 应更高
- 实际：网络/上游错误
- 评分：`0.000`
- 结果：未通过
- 耗时：45016ms
- 错误类型：`network`
- 错误：`memory_llm_timeout`

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
      "record_id": "eff-4",
      "summary": "项目规则：API 前缀 /api/v2。",
      "importance": 5
    }
  ],
  "assistant_output": "新路由已创建：`/api/v2/users`，按项目规范添加了前缀。",
  "user_feedback": {
    "rating": 5,
    "comment": "完美，前缀正确。"
  }
}
```

### effectiveness-with-negative-feedback

- 模块：`effectiveness-evaluator`
- 指标：`effectiveness_adjustment_direction_proxy`
- Prompt：`MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT`
- 预期：用户负向反馈应降低 effectiveness_score
- 实际：网络/上游错误
- 评分：`0.000`
- 结果：未通过
- 耗时：45010ms
- 错误类型：`network`
- 错误：`memory_llm_timeout`

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
      "record_id": "eff-5",
      "summary": "用户偏好：使用 tab 缩进。",
      "importance": 4
    }
  ],
  "assistant_output": "已使用 tab 缩进编写代码。",
  "user_feedback": {
    "rating": 1,
    "comment": "我早就改用空格了，这个记忆过期了。"
  }
}
```

### effectiveness-no-memories

- 模块：`effectiveness-evaluator`
- 指标：`effectiveness_adjustment_direction_proxy`
- Prompt：`MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT`
- 预期：无注入记忆时应返回空评估
- 实际：网络/上游错误
- 评分：`0.000`
- 结果：未通过
- 耗时：45003ms
- 错误类型：`network`
- 错误：`memory_llm_timeout`

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
  "injected_memories": [],
  "assistant_output": "这是一个普通的回复。",
  "user_feedback": null
}
```

### effectiveness-usage-evidence

- 模块：`effectiveness-evaluator`
- 指标：`effectiveness_adjustment_direction_proxy`
- Prompt：`MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT`
- 预期：明确使用时应提供 usage_evidence
- 实际：网络/上游错误
- 评分：`0.000`
- 结果：未通过
- 耗时：45001ms
- 错误类型：`network`
- 错误：`memory_llm_timeout`

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
      "record_id": "eff-7",
      "summary": "迁移到第 3 步，下一步创建索引。",
      "importance": 4
    }
  ],
  "assistant_output": "继续执行第 4 步：创建索引。根据之前的进度，第 3 步已完成。",
  "user_feedback": {
    "rating": 4,
    "comment": "进度正确。"
  }
}
```

## 说明

- 这份报告是离线代理评测，只验证真实模型在当前 prompt 和 schema 下的结构化决策质量。
- 评分采用 0-1 梯度评分，pass = score >= 0.6。avgScore 反映的是实际质量，比通过率更连续。
- 错误分类：`network`（上游/超时），`schema`（输出结构不合规），`logic`（输出合规但决策错误）。
- 基线对比来自 `--output-base` 同名 `-baseline.json`，使用 `--update-baseline` 可写入新基线。
- 推荐采纳率、用户满意度、优先级调整后的长期命中率，仍然需要真实线上埋点或人工采样。
