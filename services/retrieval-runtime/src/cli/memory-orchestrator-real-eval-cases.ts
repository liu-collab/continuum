import { z } from "zod";

import {
  MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT,
  MEMORY_GOVERNANCE_PLAN_SYSTEM_PROMPT,
  MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT,
  MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT,
  MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT,
  MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT,
  MEMORY_RECALL_INJECTION_SYSTEM_PROMPT,
  MEMORY_RECALL_SEARCH_SYSTEM_PROMPT,
  MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT,
  MEMORY_WRITEBACK_EXTRACTION_SYSTEM_PROMPT,
  MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT,
  MEMORY_WRITEBACK_REFINE_SYSTEM_PROMPT,
} from "../memory-orchestrator/prompts.js";
import {
  memoryEffectivenessEvaluationResultSchema,
  memoryEvolutionPlanSchema,
  memoryGovernancePlanSchema,
  memoryGovernanceVerificationSchema,
  memoryIntentAnalyzerSchema,
  memoryProactiveRecommendationSchema,
  memoryQualityAssessmentResultSchema,
  memoryRecallInjectionSchema,
  memoryRecallSearchSchema,
  memoryRelationDiscoverySchema,
  memoryWritebackExtractionSchema,
  memoryWritebackRefineSchema,
} from "../memory-orchestrator/schemas.js";
import type { EvalCase } from "./memory-orchestrator-real-eval.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sessionCtx(id: string, ws = "eval-workspace", turns: Array<{ user_input: string; assistant_output: string }> = []) {
  return { session_id: id, workspace_id: ws, recent_turns: turns };
}

function candidate(id: string, scope: string, memType: string, summary: string, importance: number, confidence: number, rerank: number, semantic: number, updatedAt: string) {
  return { id, scope, memory_type: memType, summary, importance, confidence, rerank_score: rerank, semantic_score: semantic, updated_at: updatedAt };
}

function record(id: string, scope: string, memType: string, summary: string, importance: number, confidence: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    workspace_id: "eval-workspace",
    user_id: "eval-user",
    task_id: null,
    session_id: null,
    memory_type: memType,
    scope,
    status: "active" as const,
    summary,
    details: null,
    importance,
    confidence,
    created_at: "2026-04-20T08:00:00.000Z",
    updated_at: "2026-04-22T08:00:00.000Z",
    last_used_at: null,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// 1. intent_accuracy (10 cases)
// ---------------------------------------------------------------------------

function buildIntentCases(): Array<EvalCase<unknown>> {
  return [
    {
      id: "intent-continue-task",
      metric: "intent_accuracy",
      module: "intent-analyzer",
      promptName: "MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT",
      expected: "应判断需要记忆，并识别 task_state 或 fact_preference",
      systemPrompt: MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT,
      payload: {
        current_input: "继续昨天那个 memory orchestrator 验收，把测试样本文档补完整，格式还是按之前那版。",
        session_context: sessionCtx("intent-1", "eval-workspace", [
          { user_input: "先把 memory orchestrator 的验收文档写出来，默认中文。", assistant_output: "已创建测试样本文档。" },
        ]),
      },
      schema: memoryIntentAnalyzerSchema,
      maxTokens: 800,
      check: (output) => {
        const t = output as z.infer<typeof memoryIntentAnalyzerSchema>;
        const hitScope = (t.suggested_scopes ?? []).some((s) => s === "task" || s === "user");
        const hitType = t.memory_types.includes("task_state") || t.memory_types.includes("fact_preference");
        let score = 0;
        if (t.needs_memory) score += 0.4;
        if (hitScope) score += 0.3;
        if (hitType) score += 0.3;
        return { score, actual: JSON.stringify({ needs_memory: t.needs_memory, urgency: t.urgency, memory_types: t.memory_types, suggested_scopes: t.suggested_scopes ?? [] }) };
      },
    },
    {
      id: "intent-fresh-question",
      metric: "intent_accuracy",
      module: "intent-analyzer",
      promptName: "MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT",
      expected: "应判断为自包含问题，不需要记忆",
      systemPrompt: MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT,
      payload: {
        current_input: "解释一下 HTTP 204 和 304 的区别。",
        session_context: sessionCtx("intent-2", "eval-workspace", []),
      },
      schema: memoryIntentAnalyzerSchema,
      maxTokens: 800,
      check: (output) => {
        const t = output as z.infer<typeof memoryIntentAnalyzerSchema>;
        return { score: t.needs_memory === false ? 1.0 : 0.0, actual: JSON.stringify({ needs_memory: t.needs_memory, reason: t.reason }) };
      },
    },
    {
      id: "intent-ambiguous-reference",
      metric: "intent_accuracy",
      module: "intent-analyzer",
      promptName: "MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT",
      expected: "半相关引用，应倾向需要记忆（保守策略）",
      systemPrompt: MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT,
      payload: {
        current_input: "顺便提一下上次那个方案，你还记得吗？不过先帮我看看这个新需求。",
        session_context: sessionCtx("intent-3", "eval-workspace", []),
      },
      schema: memoryIntentAnalyzerSchema,
      maxTokens: 800,
      check: (output) => {
        const t = output as z.infer<typeof memoryIntentAnalyzerSchema>;
        let score = 0;
        if (t.needs_memory) score += 0.6;
        if (t.urgency === "deferred" || t.urgency === "optional") score += 0.2;
        if (t.confidence < 0.9) score += 0.2;
        return { score, actual: JSON.stringify({ needs_memory: t.needs_memory, urgency: t.urgency, confidence: t.confidence }) };
      },
    },
    {
      id: "intent-multi-type-trigger",
      metric: "intent_accuracy",
      module: "intent-analyzer",
      promptName: "MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT",
      expected: "应同时识别 task_state 和 episodic",
      systemPrompt: MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT,
      payload: {
        current_input: "昨天那个数据库迁移做到哪一步了？我记得当时还遇到了一个权限问题。",
        session_context: sessionCtx("intent-4", "eval-workspace", [
          { user_input: "开始做数据库迁移", assistant_output: "迁移脚本已执行到第 3 步，遇到权限问题暂停。" },
        ]),
      },
      schema: memoryIntentAnalyzerSchema,
      maxTokens: 800,
      check: (output) => {
        const t = output as z.infer<typeof memoryIntentAnalyzerSchema>;
        let score = 0;
        if (t.needs_memory) score += 0.4;
        if (t.memory_types.includes("task_state")) score += 0.3;
        if (t.memory_types.includes("episodic")) score += 0.3;
        return { score, actual: JSON.stringify({ needs_memory: t.needs_memory, memory_types: t.memory_types }) };
      },
    },
    {
      id: "intent-english-input",
      metric: "intent_accuracy",
      module: "intent-analyzer",
      promptName: "MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT",
      expected: "英文自包含问题，不需要记忆",
      systemPrompt: MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT,
      payload: {
        current_input: "What is the difference between a mutex and a semaphore?",
        session_context: sessionCtx("intent-5"),
      },
      schema: memoryIntentAnalyzerSchema,
      maxTokens: 800,
      check: (output) => {
        const t = output as z.infer<typeof memoryIntentAnalyzerSchema>;
        return { score: t.needs_memory === false ? 1.0 : 0.0, actual: JSON.stringify({ needs_memory: t.needs_memory }) };
      },
    },
    {
      id: "intent-preference-recall",
      metric: "intent_accuracy",
      module: "intent-analyzer",
      promptName: "MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT",
      expected: "用户引用偏好设置，应识别 fact_preference",
      systemPrompt: MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT,
      payload: {
        current_input: "按我习惯的格式写，不要太长。",
        session_context: sessionCtx("intent-6"),
      },
      schema: memoryIntentAnalyzerSchema,
      maxTokens: 800,
      check: (output) => {
        const t = output as z.infer<typeof memoryIntentAnalyzerSchema>;
        let score = 0;
        if (t.needs_memory) score += 0.5;
        if (t.memory_types.includes("fact_preference")) score += 0.3;
        if ((t.suggested_scopes ?? []).includes("user")) score += 0.2;
        return { score, actual: JSON.stringify({ needs_memory: t.needs_memory, memory_types: t.memory_types, suggested_scopes: t.suggested_scopes }) };
      },
    },
    {
      id: "intent-code-snippet-only",
      metric: "intent_accuracy",
      module: "intent-analyzer",
      promptName: "MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT",
      expected: "纯代码问题不需要记忆",
      systemPrompt: MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT,
      payload: {
        current_input: "function add(a, b) { return a + b; } 这段代码有什么问题？",
        session_context: sessionCtx("intent-7"),
      },
      schema: memoryIntentAnalyzerSchema,
      maxTokens: 800,
      check: (output) => {
        const t = output as z.infer<typeof memoryIntentAnalyzerSchema>;
        return { score: t.needs_memory === false ? 1.0 : 0.2, actual: JSON.stringify({ needs_memory: t.needs_memory }) };
      },
    },
    {
      id: "intent-workspace-convention",
      metric: "intent_accuracy",
      module: "intent-analyzer",
      promptName: "MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT",
      expected: "引用工作区约定，应识别 workspace scope",
      systemPrompt: MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT,
      payload: {
        current_input: "按照咱们项目的目录结构来放，别弄错路径。",
        session_context: sessionCtx("intent-8", "eval-workspace", [
          { user_input: "新建一个组件", assistant_output: "准备创建组件文件。" },
        ]),
      },
      schema: memoryIntentAnalyzerSchema,
      maxTokens: 800,
      check: (output) => {
        const t = output as z.infer<typeof memoryIntentAnalyzerSchema>;
        let score = 0;
        if (t.needs_memory) score += 0.5;
        if ((t.suggested_scopes ?? []).includes("workspace")) score += 0.3;
        if (t.memory_types.includes("fact_preference") || t.memory_types.includes("episodic")) score += 0.2;
        return { score, actual: JSON.stringify({ needs_memory: t.needs_memory, suggested_scopes: t.suggested_scopes }) };
      },
    },
    {
      id: "intent-session-continuation",
      metric: "intent_accuracy",
      module: "intent-analyzer",
      promptName: "MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT",
      expected: "明确延续会话上下文，urgency 应为 immediate",
      systemPrompt: MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT,
      payload: {
        current_input: "接着刚才说的，把第二步也做了。",
        session_context: sessionCtx("intent-9", "eval-workspace", [
          { user_input: "帮我做三件事", assistant_output: "第一步已完成。" },
        ]),
      },
      schema: memoryIntentAnalyzerSchema,
      maxTokens: 800,
      check: (output) => {
        const t = output as z.infer<typeof memoryIntentAnalyzerSchema>;
        let score = 0;
        if (t.needs_memory) score += 0.4;
        if (t.urgency === "immediate") score += 0.3;
        if (t.memory_types.includes("task_state")) score += 0.3;
        return { score, actual: JSON.stringify({ needs_memory: t.needs_memory, urgency: t.urgency, memory_types: t.memory_types }) };
      },
    },
    {
      id: "intent-math-question",
      metric: "intent_accuracy",
      module: "intent-analyzer",
      promptName: "MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT",
      expected: "纯数学问题不需要记忆",
      systemPrompt: MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT,
      payload: {
        current_input: "计算 17 的阶乘是多少？",
        session_context: sessionCtx("intent-10"),
      },
      schema: memoryIntentAnalyzerSchema,
      maxTokens: 800,
      check: (output) => {
        const t = output as z.infer<typeof memoryIntentAnalyzerSchema>;
        return { score: t.needs_memory === false ? 1.0 : 0.0, actual: JSON.stringify({ needs_memory: t.needs_memory }) };
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// 2. recall_accuracy_proxy — search planner (7 cases)
// ---------------------------------------------------------------------------

function buildSearchCases(): Array<EvalCase<unknown>> {
  return [
    {
      id: "search-continue-task",
      metric: "recall_accuracy_proxy",
      module: "recall-search-planner",
      promptName: "MEMORY_RECALL_SEARCH_SYSTEM_PROMPT",
      expected: "应触发检索并给出查询提示",
      systemPrompt: MEMORY_RECALL_SEARCH_SYSTEM_PROMPT,
      payload: {
        current_input: "继续刚才那份 memory orchestrator 测试报告，把真实模型的实际指标补上。",
        recent_context_summary: "本会话前文讨论过测试样本文档。",
        phase: "before_response",
        memory_mode: "workspace_plus_global",
        requested_scopes: ["workspace", "user", "task", "session"],
        requested_memory_types: ["fact_preference", "task_state", "episodic"],
        semantic_score: 0.61,
        semantic_threshold: 0.72,
        task_id_present: true,
      },
      schema: memoryRecallSearchSchema,
      maxTokens: 900,
      check: (output) => {
        const t = output as z.infer<typeof memoryRecallSearchSchema>;
        let score = 0;
        if (t.should_search) score += 0.5;
        if (t.query_hint) score += 0.3;
        if (t.reason.length > 0) score += 0.2;
        return { score, actual: JSON.stringify({ should_search: t.should_search, query_hint: t.query_hint ?? "" }) };
      },
    },
    {
      id: "search-fresh-http-question",
      metric: "recall_accuracy_proxy",
      module: "recall-search-planner",
      promptName: "MEMORY_RECALL_SEARCH_SYSTEM_PROMPT",
      expected: "自包含问题不应触发检索",
      systemPrompt: MEMORY_RECALL_SEARCH_SYSTEM_PROMPT,
      payload: {
        current_input: "解释一下 gRPC 和 REST 的区别。",
        recent_context_summary: "",
        phase: "before_response",
        memory_mode: "workspace_plus_global",
        requested_scopes: ["workspace", "user"],
        requested_memory_types: ["fact_preference"],
        semantic_score: 0.15,
        semantic_threshold: 0.72,
        task_id_present: false,
      },
      schema: memoryRecallSearchSchema,
      maxTokens: 900,
      check: (output) => {
        const t = output as z.infer<typeof memoryRecallSearchSchema>;
        return { score: t.should_search === false ? 1.0 : 0.0, actual: JSON.stringify({ should_search: t.should_search }) };
      },
    },
    {
      id: "search-prior-preference",
      metric: "recall_accuracy_proxy",
      module: "recall-search-planner",
      promptName: "MEMORY_RECALL_SEARCH_SYSTEM_PROMPT",
      expected: "引用偏好时应触发检索",
      systemPrompt: MEMORY_RECALL_SEARCH_SYSTEM_PROMPT,
      payload: {
        current_input: "按我习惯的缩进风格来写。",
        recent_context_summary: "用户之前表达过代码风格偏好。",
        phase: "before_response",
        memory_mode: "workspace_plus_global",
        requested_scopes: ["user"],
        requested_memory_types: ["fact_preference"],
        semantic_score: 0.55,
        semantic_threshold: 0.72,
        task_id_present: false,
      },
      schema: memoryRecallSearchSchema,
      maxTokens: 900,
      check: (output) => {
        const t = output as z.infer<typeof memoryRecallSearchSchema>;
        let score = 0;
        if (t.should_search) score += 0.6;
        if (t.query_hint) score += 0.4;
        return { score, actual: JSON.stringify({ should_search: t.should_search, query_hint: t.query_hint ?? "" }) };
      },
    },
    {
      id: "search-implicit-context-carry",
      metric: "recall_accuracy_proxy",
      module: "recall-search-planner",
      promptName: "MEMORY_RECALL_SEARCH_SYSTEM_PROMPT",
      expected: "隐式上下文延续应触发检索",
      systemPrompt: MEMORY_RECALL_SEARCH_SYSTEM_PROMPT,
      payload: {
        current_input: "还是那个方案，帮我再优化一下。",
        recent_context_summary: "前几轮讨论了一个架构方案。",
        phase: "before_response",
        memory_mode: "workspace_plus_global",
        requested_scopes: ["workspace", "task", "session"],
        requested_memory_types: ["task_state", "episodic"],
        semantic_score: 0.68,
        semantic_threshold: 0.72,
        task_id_present: true,
      },
      schema: memoryRecallSearchSchema,
      maxTokens: 900,
      check: (output) => {
        const t = output as z.infer<typeof memoryRecallSearchSchema>;
        let score = 0;
        if (t.should_search) score += 0.6;
        if (t.query_hint) score += 0.2;
        if ((t.requested_scopes ?? []).length > 0) score += 0.2;
        return { score, actual: JSON.stringify({ should_search: t.should_search, query_hint: t.query_hint ?? "" }) };
      },
    },
    {
      id: "search-english-no-context",
      metric: "recall_accuracy_proxy",
      module: "recall-search-planner",
      promptName: "MEMORY_RECALL_SEARCH_SYSTEM_PROMPT",
      expected: "英文独立问题不应触发检索",
      systemPrompt: MEMORY_RECALL_SEARCH_SYSTEM_PROMPT,
      payload: {
        current_input: "Explain the CAP theorem in distributed systems.",
        recent_context_summary: "",
        phase: "before_response",
        memory_mode: "workspace_plus_global",
        requested_scopes: ["workspace"],
        requested_memory_types: ["fact_preference"],
        semantic_score: 0.1,
        semantic_threshold: 0.72,
        task_id_present: false,
      },
      schema: memoryRecallSearchSchema,
      maxTokens: 900,
      check: (output) => {
        const t = output as z.infer<typeof memoryRecallSearchSchema>;
        return { score: t.should_search === false ? 1.0 : 0.0, actual: JSON.stringify({ should_search: t.should_search }) };
      },
    },
    {
      id: "search-borderline-semantic",
      metric: "recall_accuracy_proxy",
      module: "recall-search-planner",
      promptName: "MEMORY_RECALL_SEARCH_SYSTEM_PROMPT",
      expected: "语义分接近阈值且有隐式引用，应触发检索",
      systemPrompt: MEMORY_RECALL_SEARCH_SYSTEM_PROMPT,
      payload: {
        current_input: "用上次那个模板的格式。",
        recent_context_summary: "之前有过模板讨论。",
        phase: "before_response",
        memory_mode: "workspace_plus_global",
        requested_scopes: ["user", "workspace"],
        requested_memory_types: ["fact_preference", "episodic"],
        semantic_score: 0.70,
        semantic_threshold: 0.72,
        task_id_present: false,
      },
      schema: memoryRecallSearchSchema,
      maxTokens: 900,
      check: (output) => {
        const t = output as z.infer<typeof memoryRecallSearchSchema>;
        let score = 0;
        if (t.should_search) score += 0.7;
        if (t.query_hint) score += 0.3;
        return { score, actual: JSON.stringify({ should_search: t.should_search, query_hint: t.query_hint ?? "" }) };
      },
    },
    {
      id: "search-multi-task-reference",
      metric: "recall_accuracy_proxy",
      module: "recall-search-planner",
      promptName: "MEMORY_RECALL_SEARCH_SYSTEM_PROMPT",
      expected: "跨任务引用应触发检索并限定范围",
      systemPrompt: MEMORY_RECALL_SEARCH_SYSTEM_PROMPT,
      payload: {
        current_input: "上个任务里我们用的那个重试策略，这次也用同一个。",
        recent_context_summary: "当前任务是新的 API 开发，之前做过类似系统。",
        phase: "before_response",
        memory_mode: "workspace_plus_global",
        requested_scopes: ["workspace", "user", "task"],
        requested_memory_types: ["task_state", "fact_preference"],
        semantic_score: 0.58,
        semantic_threshold: 0.72,
        task_id_present: true,
      },
      schema: memoryRecallSearchSchema,
      maxTokens: 900,
      check: (output) => {
        const t = output as z.infer<typeof memoryRecallSearchSchema>;
        let score = 0;
        if (t.should_search) score += 0.5;
        if (t.query_hint) score += 0.3;
        if ((t.requested_scopes ?? []).length > 0) score += 0.2;
        return { score, actual: JSON.stringify({ should_search: t.should_search, query_hint: t.query_hint ?? "", requested_scopes: t.requested_scopes ?? [] }) };
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// 3. recall_accuracy_proxy — injection planner (8 cases)
// ---------------------------------------------------------------------------

function buildInjectionCases(): Array<EvalCase<unknown>> {
  const highRelevantCandidates = [
    candidate("mem-style-1", "user", "fact_preference", "用户偏好：默认中文，先给一句结论，再补最多 3 个短点。", 5, 0.96, 0.91, 0.88, "2026-04-22T10:00:00.000Z"),
    candidate("mem-task-1", "task", "task_state", "当前任务：正在补 memory orchestrator 测试样本文档的实际指标。", 4, 0.93, 0.89, 0.86, "2026-04-22T10:05:00.000Z"),
    candidate("mem-noise-1", "workspace", "episodic", "上周修过一个和代理无关的 CSS 样式问题。", 2, 0.51, 0.22, 0.19, "2026-04-10T09:00:00.000Z"),
  ];

  const lowRelevantCandidates = [
    candidate("mem-style-2", "user", "fact_preference", "用户偏好：默认中文，先给一句结论，再补 3 个短点。", 5, 0.95, 0.31, 0.28, "2026-04-22T10:00:00.000Z"),
    candidate("mem-task-old-2", "task", "task_state", "当前任务：补 memory orchestrator 测试样本文档。", 4, 0.92, 0.18, 0.16, "2026-04-22T10:05:00.000Z"),
  ];

  return [
    {
      id: "inject-relevant-memory",
      metric: "recall_accuracy_proxy",
      module: "recall-injection-planner",
      promptName: "MEMORY_RECALL_INJECTION_SYSTEM_PROMPT",
      expected: "应选择与当前任务连续性最相关的记忆，不选噪声",
      systemPrompt: MEMORY_RECALL_INJECTION_SYSTEM_PROMPT,
      payload: {
        current_input: "继续把测试样本文档写完，按之前的短句中文风格来。",
        recent_context_summary: "用户正在完善 memory orchestrator 测试与验收文档。",
        phase: "before_response",
        memory_mode: "workspace_plus_global",
        requested_scopes: ["workspace", "user", "task"],
        requested_memory_types: ["fact_preference", "task_state"],
        search_reason: "用户显式要求延续之前风格和任务状态",
        candidates: highRelevantCandidates,
        semantic_score: 0.61,
        semantic_threshold: 0.72,
        task_id_present: true,
      },
      schema: memoryRecallInjectionSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryRecallInjectionSchema>;
        const selected = t.selected_record_ids ?? [];
        let score = 0;
        if (t.should_inject) score += 0.3;
        if (selected.includes("mem-style-1")) score += 0.25;
        if (selected.includes("mem-task-1")) score += 0.25;
        if (!selected.includes("mem-noise-1")) score += 0.2;
        return { score, actual: JSON.stringify({ should_inject: t.should_inject, selected_record_ids: selected }) };
      },
    },
    {
      id: "inject-irrelevant-skip",
      metric: "recall_accuracy_proxy",
      module: "recall-injection-planner",
      promptName: "MEMORY_RECALL_INJECTION_SYSTEM_PROMPT",
      expected: "候选记忆与当前问题无关时应跳过注入",
      systemPrompt: MEMORY_RECALL_INJECTION_SYSTEM_PROMPT,
      payload: {
        current_input: "解释一下 HTTP 204 和 304 的区别，用最短的话说清楚。",
        recent_context_summary: "当前是一次独立的协议知识问答。",
        phase: "before_response",
        memory_mode: "workspace_plus_global",
        requested_scopes: ["workspace", "user", "task"],
        requested_memory_types: ["fact_preference", "task_state", "episodic"],
        search_reason: "语义检索有弱命中。",
        candidates: lowRelevantCandidates,
        semantic_score: 0.41,
        semantic_threshold: 0.72,
        task_id_present: false,
      },
      schema: memoryRecallInjectionSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryRecallInjectionSchema>;
        return { score: t.should_inject === false ? 1.0 : 0.0, actual: JSON.stringify({ should_inject: t.should_inject, selected_record_ids: t.selected_record_ids ?? [] }) };
      },
    },
    {
      id: "inject-borderline-score",
      metric: "recall_accuracy_proxy",
      module: "recall-injection-planner",
      promptName: "MEMORY_RECALL_INJECTION_SYSTEM_PROMPT",
      expected: "候选分数在阈值附近但内容相关时应注入",
      systemPrompt: MEMORY_RECALL_INJECTION_SYSTEM_PROMPT,
      payload: {
        current_input: "把缩进改成 4 空格，按我之前说的来。",
        recent_context_summary: "用户在修改代码格式。",
        phase: "before_response",
        memory_mode: "workspace_plus_global",
        requested_scopes: ["user"],
        requested_memory_types: ["fact_preference"],
        search_reason: "用户引用偏好设置",
        candidates: [
          candidate("mem-indent", "user", "fact_preference", "用户偏好：使用 4 空格缩进。", 5, 0.88, 0.73, 0.71, "2026-04-20T08:00:00.000Z"),
          candidate("mem-old-style", "user", "fact_preference", "用户偏好：变量名用 camelCase。", 3, 0.72, 0.42, 0.38, "2026-04-15T08:00:00.000Z"),
        ],
        semantic_score: 0.71,
        semantic_threshold: 0.72,
        task_id_present: false,
      },
      schema: memoryRecallInjectionSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryRecallInjectionSchema>;
        const selected = t.selected_record_ids ?? [];
        let score = 0;
        if (t.should_inject) score += 0.4;
        if (selected.includes("mem-indent")) score += 0.4;
        if (!selected.includes("mem-old-style")) score += 0.2;
        return { score, actual: JSON.stringify({ should_inject: t.should_inject, selected_record_ids: selected }) };
      },
    },
    {
      id: "inject-conflicting-candidates",
      metric: "recall_accuracy_proxy",
      module: "recall-injection-planner",
      promptName: "MEMORY_RECALL_INJECTION_SYSTEM_PROMPT",
      expected: "两条候选矛盾时应选择更新、更高置信度的那条",
      systemPrompt: MEMORY_RECALL_INJECTION_SYSTEM_PROMPT,
      payload: {
        current_input: "按我的偏好来设置 tab 还是空格。",
        recent_context_summary: "用户在配置编辑器。",
        phase: "before_response",
        memory_mode: "workspace_plus_global",
        requested_scopes: ["user"],
        requested_memory_types: ["fact_preference"],
        search_reason: "用户引用编辑器偏好",
        candidates: [
          candidate("mem-old-tab", "user", "fact_preference", "用户偏好：使用 tab 缩进。", 4, 0.78, 0.80, 0.77, "2026-03-01T08:00:00.000Z"),
          candidate("mem-new-space", "user", "fact_preference", "用户偏好：使用 4 空格缩进，不用 tab。", 5, 0.95, 0.85, 0.82, "2026-04-20T08:00:00.000Z"),
        ],
        semantic_score: 0.80,
        semantic_threshold: 0.72,
        task_id_present: false,
      },
      schema: memoryRecallInjectionSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryRecallInjectionSchema>;
        const selected = t.selected_record_ids ?? [];
        let score = 0;
        if (t.should_inject) score += 0.3;
        if (selected.includes("mem-new-space")) score += 0.5;
        if (!selected.includes("mem-old-tab")) score += 0.2;
        return { score, actual: JSON.stringify({ should_inject: t.should_inject, selected_record_ids: selected }) };
      },
    },
    {
      id: "inject-all-noise",
      metric: "recall_accuracy_proxy",
      module: "recall-injection-planner",
      promptName: "MEMORY_RECALL_INJECTION_SYSTEM_PROMPT",
      expected: "所有候选都是噪声时不应注入",
      systemPrompt: MEMORY_RECALL_INJECTION_SYSTEM_PROMPT,
      payload: {
        current_input: "帮我写一个 Python 快排。",
        recent_context_summary: "用户需要算法实现。",
        phase: "before_response",
        memory_mode: "workspace_plus_global",
        requested_scopes: ["workspace"],
        requested_memory_types: ["fact_preference", "episodic"],
        search_reason: "弱语义命中",
        candidates: [
          candidate("mem-css-fix", "workspace", "episodic", "上周修过一个 CSS 对齐问题。", 2, 0.45, 0.12, 0.10, "2026-04-05T08:00:00.000Z"),
          candidate("mem-deploy", "workspace", "episodic", "三天前部署过一次 staging 环境。", 2, 0.50, 0.15, 0.13, "2026-04-19T08:00:00.000Z"),
        ],
        semantic_score: 0.22,
        semantic_threshold: 0.72,
        task_id_present: false,
      },
      schema: memoryRecallInjectionSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryRecallInjectionSchema>;
        return { score: t.should_inject === false ? 1.0 : 0.0, actual: JSON.stringify({ should_inject: t.should_inject }) };
      },
    },
    {
      id: "inject-single-perfect-match",
      metric: "recall_accuracy_proxy",
      module: "recall-injection-planner",
      promptName: "MEMORY_RECALL_INJECTION_SYSTEM_PROMPT",
      expected: "单条高匹配候选应注入",
      systemPrompt: MEMORY_RECALL_INJECTION_SYSTEM_PROMPT,
      payload: {
        current_input: "延续上次的架构方案，继续设计 API 层。",
        recent_context_summary: "正在做系统设计。",
        phase: "before_response",
        memory_mode: "workspace_plus_global",
        requested_scopes: ["task", "workspace"],
        requested_memory_types: ["task_state"],
        search_reason: "用户延续上次方案",
        candidates: [
          candidate("mem-arch", "task", "task_state", "当前架构方案：微服务 + API Gateway + Redis 缓存层。", 5, 0.97, 0.95, 0.93, "2026-04-21T08:00:00.000Z"),
        ],
        semantic_score: 0.92,
        semantic_threshold: 0.72,
        task_id_present: true,
      },
      schema: memoryRecallInjectionSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryRecallInjectionSchema>;
        const selected = t.selected_record_ids ?? [];
        let score = 0;
        if (t.should_inject) score += 0.5;
        if (selected.includes("mem-arch")) score += 0.5;
        return { score, actual: JSON.stringify({ should_inject: t.should_inject, selected_record_ids: selected }) };
      },
    },
    {
      id: "inject-mixed-relevance",
      metric: "recall_accuracy_proxy",
      module: "recall-injection-planner",
      promptName: "MEMORY_RECALL_INJECTION_SYSTEM_PROMPT",
      expected: "混合相关度时只选高相关候选",
      systemPrompt: MEMORY_RECALL_INJECTION_SYSTEM_PROMPT,
      payload: {
        current_input: "继续改那个登录页的表单验证。",
        recent_context_summary: "用户在做前端表单工作。",
        phase: "before_response",
        memory_mode: "workspace_plus_global",
        requested_scopes: ["task", "workspace", "user"],
        requested_memory_types: ["task_state", "fact_preference"],
        search_reason: "延续前端任务",
        candidates: [
          candidate("mem-form", "task", "task_state", "当前任务：实现登录页表单验证，已完成邮箱字段。", 4, 0.92, 0.88, 0.86, "2026-04-22T08:00:00.000Z"),
          candidate("mem-color", "user", "fact_preference", "用户偏好：主色调用蓝色。", 3, 0.80, 0.45, 0.40, "2026-04-18T08:00:00.000Z"),
          candidate("mem-db", "workspace", "episodic", "上周优化过数据库索引。", 2, 0.55, 0.15, 0.12, "2026-04-14T08:00:00.000Z"),
        ],
        semantic_score: 0.75,
        semantic_threshold: 0.72,
        task_id_present: true,
      },
      schema: memoryRecallInjectionSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryRecallInjectionSchema>;
        const selected = t.selected_record_ids ?? [];
        let score = 0;
        if (t.should_inject) score += 0.3;
        if (selected.includes("mem-form")) score += 0.4;
        if (!selected.includes("mem-db")) score += 0.3;
        return { score, actual: JSON.stringify({ should_inject: t.should_inject, selected_record_ids: selected }) };
      },
    },
    {
      id: "inject-empty-candidates",
      metric: "recall_accuracy_proxy",
      module: "recall-injection-planner",
      promptName: "MEMORY_RECALL_INJECTION_SYSTEM_PROMPT",
      expected: "无候选时不应注入",
      systemPrompt: MEMORY_RECALL_INJECTION_SYSTEM_PROMPT,
      payload: {
        current_input: "帮我重构这个函数。",
        recent_context_summary: "用户在做代码重构。",
        phase: "before_response",
        memory_mode: "workspace_plus_global",
        requested_scopes: ["workspace"],
        requested_memory_types: ["fact_preference"],
        search_reason: "检索无结果",
        candidates: [],
        semantic_score: 0.30,
        semantic_threshold: 0.72,
        task_id_present: false,
      },
      schema: memoryRecallInjectionSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryRecallInjectionSchema>;
        return { score: t.should_inject === false ? 1.0 : 0.0, actual: JSON.stringify({ should_inject: t.should_inject }) };
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// 4. writeback_extraction_accuracy (8 cases)
// ---------------------------------------------------------------------------

function buildWritebackExtractionCases(): Array<EvalCase<unknown>> {
  return [
    {
      id: "extract-durable-preference",
      metric: "writeback_extraction_accuracy",
      module: "writeback-extractor",
      promptName: "MEMORY_WRITEBACK_EXTRACTION_SYSTEM_PROMPT",
      expected: "应提取用户偏好为 fact_preference",
      systemPrompt: MEMORY_WRITEBACK_EXTRACTION_SYSTEM_PROMPT,
      payload: {
        current_input: "以后我的代码都用 4 空格缩进，不要 tab。",
        assistant_output: "好的，后续所有代码默认使用 4 空格缩进。",
        tool_results_summary: "",
        task_id: null,
      },
      schema: memoryWritebackExtractionSchema,
      maxTokens: 600,
      check: (output) => {
        const t = output as z.infer<typeof memoryWritebackExtractionSchema>;
        const pref = t.candidates.find((c) => c.candidate_type === "fact_preference");
        let score = 0;
        if (pref) score += 0.5;
        if (pref && pref.scope === "user") score += 0.25;
        if (pref && pref.importance >= 4) score += 0.25;
        return { score, actual: JSON.stringify(t.candidates.map((c) => ({ type: c.candidate_type, scope: c.scope, summary: c.summary }))) };
      },
    },
    {
      id: "extract-skip-chatter",
      metric: "writeback_extraction_accuracy",
      module: "writeback-extractor",
      promptName: "MEMORY_WRITEBACK_EXTRACTION_SYSTEM_PROMPT",
      expected: "纯应答寒暄不应提取任何候选",
      systemPrompt: MEMORY_WRITEBACK_EXTRACTION_SYSTEM_PROMPT,
      payload: {
        current_input: "帮我看看这个报错。",
        assistant_output: "好的，我来帮你看看这个问题。",
        tool_results_summary: "",
        task_id: null,
      },
      schema: memoryWritebackExtractionSchema,
      maxTokens: 600,
      check: (output) => {
        const t = output as z.infer<typeof memoryWritebackExtractionSchema>;
        return { score: t.candidates.length === 0 ? 1.0 : 0.0, actual: JSON.stringify({ count: t.candidates.length }) };
      },
    },
    {
      id: "extract-task-progress",
      metric: "writeback_extraction_accuracy",
      module: "writeback-extractor",
      promptName: "MEMORY_WRITEBACK_EXTRACTION_SYSTEM_PROMPT",
      expected: "应提取任务进度为 task_state",
      systemPrompt: MEMORY_WRITEBACK_EXTRACTION_SYSTEM_PROMPT,
      payload: {
        current_input: "数据库迁移做到哪了？",
        assistant_output: "迁移脚本已执行到第 3 步（共 5 步），第 4 步是创建索引，预计 10 分钟完成。",
        tool_results_summary: "migration run: step 3/5 completed",
        task_id: "task-migrate-1",
      },
      schema: memoryWritebackExtractionSchema,
      maxTokens: 600,
      check: (output) => {
        const t = output as z.infer<typeof memoryWritebackExtractionSchema>;
        const task = t.candidates.find((c) => c.candidate_type === "task_state");
        let score = 0;
        if (task) score += 0.5;
        if (task && (task.scope === "task" || task.scope === "workspace")) score += 0.25;
        if (task && task.summary.includes("3") || task && task.summary.includes("迁移")) score += 0.25;
        return { score, actual: JSON.stringify(t.candidates.map((c) => ({ type: c.candidate_type, scope: c.scope, summary: c.summary }))) };
      },
    },
    {
      id: "extract-skip-file-path",
      metric: "writeback_extraction_accuracy",
      module: "writeback-extractor",
      promptName: "MEMORY_WRITEBACK_EXTRACTION_SYSTEM_PROMPT",
      expected: "路径/代码位置提及不应被提取",
      systemPrompt: MEMORY_WRITEBACK_EXTRACTION_SYSTEM_PROMPT,
      payload: {
        current_input: "auth 中间件在哪？",
        assistant_output: "认证中间件在 src/middleware/auth.ts 文件中，第 42 行开始。",
        tool_results_summary: "",
        task_id: null,
      },
      schema: memoryWritebackExtractionSchema,
      maxTokens: 600,
      check: (output) => {
        const t = output as z.infer<typeof memoryWritebackExtractionSchema>;
        return { score: t.candidates.length === 0 ? 1.0 : 0.2, actual: JSON.stringify({ count: t.candidates.length }) };
      },
    },
    {
      id: "extract-workspace-convention",
      metric: "writeback_extraction_accuracy",
      module: "writeback-extractor",
      promptName: "MEMORY_WRITEBACK_EXTRACTION_SYSTEM_PROMPT",
      expected: "项目约定应提取为 workspace scope 的 fact_preference",
      systemPrompt: MEMORY_WRITEBACK_EXTRACTION_SYSTEM_PROMPT,
      payload: {
        current_input: "这个项目所有 API 都要加 /api/v2 前缀。",
        assistant_output: "了解，后续所有新建的 API 路由都会加上 /api/v2 前缀。",
        tool_results_summary: "",
        task_id: null,
      },
      schema: memoryWritebackExtractionSchema,
      maxTokens: 600,
      check: (output) => {
        const t = output as z.infer<typeof memoryWritebackExtractionSchema>;
        const ws = t.candidates.find((c) => c.scope === "workspace" && c.candidate_type === "fact_preference");
        let score = 0;
        if (ws) score += 0.6;
        if (ws && ws.importance >= 4) score += 0.2;
        if (ws && ws.summary.includes("/api/v2")) score += 0.2;
        return { score, actual: JSON.stringify(t.candidates.map((c) => ({ type: c.candidate_type, scope: c.scope, summary: c.summary }))) };
      },
    },
    {
      id: "extract-episodic-event",
      metric: "writeback_extraction_accuracy",
      module: "writeback-extractor",
      promptName: "MEMORY_WRITEBACK_EXTRACTION_SYSTEM_PROMPT",
      expected: "具体的外部事件应提取为 episodic",
      systemPrompt: MEMORY_WRITEBACK_EXTRACTION_SYSTEM_PROMPT,
      payload: {
        current_input: "刚刚和运维确认过了，生产数据库已经升级到 PostgreSQL 16。",
        assistant_output: "记录到了，后续 SQL 可以用 PG16 新特性。",
        tool_results_summary: "",
        task_id: null,
      },
      schema: memoryWritebackExtractionSchema,
      maxTokens: 600,
      check: (output) => {
        const t = output as z.infer<typeof memoryWritebackExtractionSchema>;
        const ep = t.candidates.find((c) => c.candidate_type === "episodic" || c.candidate_type === "fact_preference");
        let score = 0;
        if (ep) score += 0.5;
        if (ep && (ep.summary.includes("PostgreSQL 16") || ep.summary.includes("PG16") || ep.summary.includes("PG 16"))) score += 0.3;
        if (ep && ep.scope === "workspace") score += 0.2;
        return { score, actual: JSON.stringify(t.candidates.map((c) => ({ type: c.candidate_type, scope: c.scope, summary: c.summary }))) };
      },
    },
    {
      id: "extract-skip-question-echo",
      metric: "writeback_extraction_accuracy",
      module: "writeback-extractor",
      promptName: "MEMORY_WRITEBACK_EXTRACTION_SYSTEM_PROMPT",
      expected: "助手重述用户问题不应被提取",
      systemPrompt: MEMORY_WRITEBACK_EXTRACTION_SYSTEM_PROMPT,
      payload: {
        current_input: "为什么构建会失败？",
        assistant_output: "你问的是构建失败的原因，让我检查一下日志。目前还没有定论。",
        tool_results_summary: "",
        task_id: null,
      },
      schema: memoryWritebackExtractionSchema,
      maxTokens: 600,
      check: (output) => {
        const t = output as z.infer<typeof memoryWritebackExtractionSchema>;
        return { score: t.candidates.length === 0 ? 1.0 : 0.1, actual: JSON.stringify({ count: t.candidates.length }) };
      },
    },
    {
      id: "extract-multi-fact",
      metric: "writeback_extraction_accuracy",
      module: "writeback-extractor",
      promptName: "MEMORY_WRITEBACK_EXTRACTION_SYSTEM_PROMPT",
      expected: "一轮包含多个持久事实时应提取多个候选",
      systemPrompt: MEMORY_WRITEBACK_EXTRACTION_SYSTEM_PROMPT,
      payload: {
        current_input: "记一下：我用 Vim 键位，终端用 zsh，测试框架用 vitest。",
        assistant_output: "已记录你的开发环境偏好。",
        tool_results_summary: "",
        task_id: null,
      },
      schema: memoryWritebackExtractionSchema,
      maxTokens: 600,
      check: (output) => {
        const t = output as z.infer<typeof memoryWritebackExtractionSchema>;
        let score = 0;
        if (t.candidates.length >= 2) score += 0.5;
        if (t.candidates.length >= 3) score += 0.3;
        if (t.candidates.every((c) => c.candidate_type === "fact_preference")) score += 0.2;
        return { score, actual: JSON.stringify({ count: t.candidates.length, types: t.candidates.map((c) => c.candidate_type) }) };
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// 5. writeback_refine_accuracy (8 cases)
// ---------------------------------------------------------------------------

function buildWritebackRefineCases(): Array<EvalCase<unknown>> {
  return [
    {
      id: "refine-drop-low-signal",
      metric: "writeback_refine_accuracy",
      module: "writeback-refiner",
      promptName: "MEMORY_WRITEBACK_REFINE_SYSTEM_PROMPT",
      expected: "应 drop 低信号的应答候选",
      systemPrompt: MEMORY_WRITEBACK_REFINE_SYSTEM_PROMPT,
      payload: {
        current_input: "帮我看看日志",
        assistant_output: "好的，我来处理。",
        tool_results_summary: "",
        task_id: null,
        rule_candidates: [
          { index: 0, candidate_type: "episodic", scope: "session", summary: "助手确认会处理日志查看请求。", importance: 2, confidence: 0.5, write_reason: "assistant acknowledged" },
        ],
      },
      schema: memoryWritebackRefineSchema,
      maxTokens: 800,
      check: (output) => {
        const t = output as z.infer<typeof memoryWritebackRefineSchema>;
        const dropped = t.refined_candidates.find((c) => c.source === "rule_index:0" && c.action === "drop");
        return { score: dropped ? 1.0 : 0.0, actual: JSON.stringify(t.refined_candidates.map((c) => ({ source: c.source, action: c.action }))) };
      },
    },
    {
      id: "refine-keep-good-candidate",
      metric: "writeback_refine_accuracy",
      module: "writeback-refiner",
      promptName: "MEMORY_WRITEBACK_REFINE_SYSTEM_PROMPT",
      expected: "应 keep 稳定偏好候选",
      systemPrompt: MEMORY_WRITEBACK_REFINE_SYSTEM_PROMPT,
      payload: {
        current_input: "以后默认中文回答，不要英文。",
        assistant_output: "已确认，后续默认使用中文。",
        tool_results_summary: "",
        task_id: null,
        rule_candidates: [
          { index: 0, candidate_type: "fact_preference", scope: "user", summary: "用户偏好：默认中文回答。", importance: 5, confidence: 0.95, write_reason: "stable language preference" },
        ],
      },
      schema: memoryWritebackRefineSchema,
      maxTokens: 800,
      check: (output) => {
        const t = output as z.infer<typeof memoryWritebackRefineSchema>;
        const kept = t.refined_candidates.find((c) => c.source === "rule_index:0" && c.action === "keep");
        return { score: kept ? 1.0 : 0.0, actual: JSON.stringify(t.refined_candidates.map((c) => ({ source: c.source, action: c.action }))) };
      },
    },
    {
      id: "refine-merge-duplicates",
      metric: "writeback_refine_accuracy",
      module: "writeback-refiner",
      promptName: "MEMORY_WRITEBACK_REFINE_SYSTEM_PROMPT",
      expected: "两条描述同一事实的候选应 merge",
      systemPrompt: MEMORY_WRITEBACK_REFINE_SYSTEM_PROMPT,
      payload: {
        current_input: "用中文回答，简短一点。",
        assistant_output: "好的，后续默认中文、简短输出。",
        tool_results_summary: "",
        task_id: null,
        rule_candidates: [
          { index: 0, candidate_type: "fact_preference", scope: "user", summary: "用户偏好：使用中文。", importance: 5, confidence: 0.92, write_reason: "language preference" },
          { index: 1, candidate_type: "fact_preference", scope: "user", summary: "用户偏好：简短回答。", importance: 4, confidence: 0.88, write_reason: "brevity preference" },
        ],
      },
      schema: memoryWritebackRefineSchema,
      maxTokens: 800,
      check: (output) => {
        const t = output as z.infer<typeof memoryWritebackRefineSchema>;
        const merged = t.refined_candidates.find((c) => c.action === "merge");
        const allKept = t.refined_candidates.filter((c) => c.action === "keep").length === 2;
        let score = 0;
        if (merged && merged.merge_with && merged.merge_with.length > 0) score = 1.0;
        else if (allKept) score = 0.6;
        return { score, actual: JSON.stringify(t.refined_candidates.map((c) => ({ source: c.source, action: c.action, merge_with: (c as { merge_with?: string[] }).merge_with }))) };
      },
    },
    {
      id: "refine-add-new-missed",
      metric: "writeback_refine_accuracy",
      module: "writeback-refiner",
      promptName: "MEMORY_WRITEBACK_REFINE_SYSTEM_PROMPT",
      expected: "规则遗漏的重要事实应作为 new 补充",
      systemPrompt: MEMORY_WRITEBACK_REFINE_SYSTEM_PROMPT,
      payload: {
        current_input: "项目从今天起不允许使用 any 类型。另外这个 bug 我看了。",
        assistant_output: "了解，已在 tsconfig 中启用 strict 模式。这个 bug 是空指针引起的。",
        tool_results_summary: "",
        task_id: "task-strict-1",
        rule_candidates: [
          { index: 0, candidate_type: "episodic", scope: "session", summary: "助手查看了一个 bug。", importance: 2, confidence: 0.55, write_reason: "assistant investigated bug" },
        ],
      },
      schema: memoryWritebackRefineSchema,
      maxTokens: 800,
      check: (output) => {
        const t = output as z.infer<typeof memoryWritebackRefineSchema>;
        const newItem = t.refined_candidates.find((c) => c.action === "new" && c.source === "llm_new");
        const dropped = t.refined_candidates.find((c) => c.source === "rule_index:0" && c.action === "drop");
        let score = 0;
        if (newItem) score += 0.5;
        if (newItem && newItem.summary && (newItem.summary.includes("any") || newItem.summary.includes("strict"))) score += 0.25;
        if (dropped) score += 0.25;
        return { score, actual: JSON.stringify(t.refined_candidates.map((c) => ({ source: c.source, action: c.action, summary: c.summary }))) };
      },
    },
    {
      id: "refine-keep-all-valid",
      metric: "writeback_refine_accuracy",
      module: "writeback-refiner",
      promptName: "MEMORY_WRITEBACK_REFINE_SYSTEM_PROMPT",
      expected: "多条有效且不重复的候选应全部 keep",
      systemPrompt: MEMORY_WRITEBACK_REFINE_SYSTEM_PROMPT,
      payload: {
        current_input: "记一下：Vim 键位、4 空格缩进。",
        assistant_output: "已记录。",
        tool_results_summary: "",
        task_id: null,
        rule_candidates: [
          { index: 0, candidate_type: "fact_preference", scope: "user", summary: "用户偏好：使用 Vim 键位。", importance: 4, confidence: 0.90, write_reason: "editor preference" },
          { index: 1, candidate_type: "fact_preference", scope: "user", summary: "用户偏好：4 空格缩进。", importance: 4, confidence: 0.90, write_reason: "formatting preference" },
        ],
      },
      schema: memoryWritebackRefineSchema,
      maxTokens: 800,
      check: (output) => {
        const t = output as z.infer<typeof memoryWritebackRefineSchema>;
        const keptCount = t.refined_candidates.filter((c) => c.action === "keep").length;
        return { score: keptCount >= 2 ? 1.0 : keptCount === 1 ? 0.5 : 0.0, actual: JSON.stringify(t.refined_candidates.map((c) => ({ source: c.source, action: c.action }))) };
      },
    },
    {
      id: "refine-drop-path-restate",
      metric: "writeback_refine_accuracy",
      module: "writeback-refiner",
      promptName: "MEMORY_WRITEBACK_REFINE_SYSTEM_PROMPT",
      expected: "文件路径重述应被 drop",
      systemPrompt: MEMORY_WRITEBACK_REFINE_SYSTEM_PROMPT,
      payload: {
        current_input: "配置文件在哪？",
        assistant_output: "配置文件在 src/config/index.ts。",
        tool_results_summary: "",
        task_id: null,
        rule_candidates: [
          { index: 0, candidate_type: "episodic", scope: "workspace", summary: "配置文件位于 src/config/index.ts。", importance: 2, confidence: 0.55, write_reason: "file location mentioned" },
        ],
      },
      schema: memoryWritebackRefineSchema,
      maxTokens: 800,
      check: (output) => {
        const t = output as z.infer<typeof memoryWritebackRefineSchema>;
        const dropped = t.refined_candidates.find((c) => c.source === "rule_index:0" && c.action === "drop");
        return { score: dropped ? 1.0 : 0.0, actual: JSON.stringify(t.refined_candidates.map((c) => ({ source: c.source, action: c.action }))) };
      },
    },
    {
      id: "refine-upgrade-importance",
      metric: "writeback_refine_accuracy",
      module: "writeback-refiner",
      promptName: "MEMORY_WRITEBACK_REFINE_SYSTEM_PROMPT",
      expected: "关键约束的重要度被低估时应 keep 并提升 importance",
      systemPrompt: MEMORY_WRITEBACK_REFINE_SYSTEM_PROMPT,
      payload: {
        current_input: "绝对不能用 eval，这是安全红线。",
        assistant_output: "理解，已在 ESLint 中禁用 eval。",
        tool_results_summary: "",
        task_id: null,
        rule_candidates: [
          { index: 0, candidate_type: "fact_preference", scope: "workspace", summary: "项目规则：禁止使用 eval。", importance: 2, confidence: 0.75, write_reason: "security rule" },
        ],
      },
      schema: memoryWritebackRefineSchema,
      maxTokens: 800,
      check: (output) => {
        const t = output as z.infer<typeof memoryWritebackRefineSchema>;
        const item = t.refined_candidates.find((c) => c.source === "rule_index:0");
        let score = 0;
        if (item && item.action === "keep") score += 0.5;
        if (item && item.importance !== undefined && item.importance >= 4) score += 0.5;
        return { score, actual: JSON.stringify(item ?? null) };
      },
    },
    {
      id: "refine-empty-input",
      metric: "writeback_refine_accuracy",
      module: "writeback-refiner",
      promptName: "MEMORY_WRITEBACK_REFINE_SYSTEM_PROMPT",
      expected: "无候选输入时应返回空列表",
      systemPrompt: MEMORY_WRITEBACK_REFINE_SYSTEM_PROMPT,
      payload: {
        current_input: "你好",
        assistant_output: "你好！有什么可以帮助你的？",
        tool_results_summary: "",
        task_id: null,
        rule_candidates: [],
      },
      schema: memoryWritebackRefineSchema,
      maxTokens: 800,
      check: (output) => {
        const t = output as z.infer<typeof memoryWritebackRefineSchema>;
        return { score: t.refined_candidates.length === 0 ? 1.0 : 0.0, actual: JSON.stringify({ count: t.refined_candidates.length }) };
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// 6. governance_plan_accuracy (8 cases)
// ---------------------------------------------------------------------------

function buildGovernancePlanCases(): Array<EvalCase<unknown>> {
  return [
    {
      id: "govplan-merge-duplicates",
      metric: "governance_plan_accuracy",
      module: "governance-planner",
      promptName: "MEMORY_GOVERNANCE_PLAN_SYSTEM_PROMPT",
      expected: "两条重复偏好应输出 merge action",
      systemPrompt: MEMORY_GOVERNANCE_PLAN_SYSTEM_PROMPT,
      payload: {
        seed_records: [
          record("gp-1", "user", "fact_preference", "用户偏好：默认中文回答。", 5, 0.95),
          record("gp-2", "user", "fact_preference", "用户偏好：回答请用中文。", 4, 0.88),
        ],
        related_records: [],
        open_conflicts: [],
      },
      schema: memoryGovernancePlanSchema,
      maxTokens: 1500,
      check: (output) => {
        const t = output as z.infer<typeof memoryGovernancePlanSchema>;
        const merge = t.actions.find((a) => a.type === "merge");
        let score = 0;
        if (merge && merge.type === "merge") {
          score += 0.5;
          if (merge.target_record_ids.includes("gp-1") && merge.target_record_ids.includes("gp-2")) score += 0.5;
        }
        const archive = t.actions.find((a) => a.type === "archive");
        if (!merge && archive) score += 0.5;
        return { score, actual: JSON.stringify(t.actions.map((a) => ({ type: a.type }))) };
      },
    },
    {
      id: "govplan-no-action-needed",
      metric: "governance_plan_accuracy",
      module: "governance-planner",
      promptName: "MEMORY_GOVERNANCE_PLAN_SYSTEM_PROMPT",
      expected: "记录互不重复且健康时不应输出 action",
      systemPrompt: MEMORY_GOVERNANCE_PLAN_SYSTEM_PROMPT,
      payload: {
        seed_records: [
          record("gp-3", "user", "fact_preference", "用户偏好：使用 Vim 键位。", 4, 0.90),
          record("gp-4", "workspace", "fact_preference", "项目规则：API 前缀 /api/v2。", 5, 0.95),
        ],
        related_records: [],
        open_conflicts: [],
      },
      schema: memoryGovernancePlanSchema,
      maxTokens: 1500,
      check: (output) => {
        const t = output as z.infer<typeof memoryGovernancePlanSchema>;
        return { score: t.actions.length === 0 ? 1.0 : 0.2, actual: JSON.stringify({ action_count: t.actions.length }) };
      },
    },
    {
      id: "govplan-archive-superseded",
      metric: "governance_plan_accuracy",
      module: "governance-planner",
      promptName: "MEMORY_GOVERNANCE_PLAN_SYSTEM_PROMPT",
      expected: "旧记录被新记录替代时应归档旧记录",
      systemPrompt: MEMORY_GOVERNANCE_PLAN_SYSTEM_PROMPT,
      payload: {
        seed_records: [
          record("gp-new", "user", "fact_preference", "用户偏好：默认中文，简短输出，先给结论。", 5, 0.96, { created_at: "2026-04-22T08:00:00.000Z" }),
        ],
        related_records: [
          record("gp-old", "user", "fact_preference", "用户偏好：默认中文回答。", 4, 0.82, { created_at: "2026-03-01T08:00:00.000Z", updated_at: "2026-03-01T08:00:00.000Z" }),
        ],
        open_conflicts: [],
      },
      schema: memoryGovernancePlanSchema,
      maxTokens: 1500,
      check: (output) => {
        const t = output as z.infer<typeof memoryGovernancePlanSchema>;
        const archive = t.actions.find((a) => a.type === "archive" && a.record_id === "gp-old");
        const merge = t.actions.find((a) => a.type === "merge");
        let score = 0;
        if (archive) score += 1.0;
        else if (merge) score += 0.6;
        return { score, actual: JSON.stringify(t.actions.map((a) => ({ type: a.type }))) };
      },
    },
    {
      id: "govplan-downgrade-inflated",
      metric: "governance_plan_accuracy",
      module: "governance-planner",
      promptName: "MEMORY_GOVERNANCE_PLAN_SYSTEM_PROMPT",
      expected: "重要度明显虚高的低价值记录应被降级",
      systemPrompt: MEMORY_GOVERNANCE_PLAN_SYSTEM_PROMPT,
      payload: {
        seed_records: [
          record("gp-inflated", "session", "episodic", "今天天气不错。", 5, 0.50),
        ],
        related_records: [],
        open_conflicts: [],
      },
      schema: memoryGovernancePlanSchema,
      maxTokens: 1500,
      check: (output) => {
        const t = output as z.infer<typeof memoryGovernancePlanSchema>;
        const downgrade = t.actions.find((a): a is Extract<typeof a, { type: "downgrade" }> => a.type === "downgrade" && a.record_id === "gp-inflated");
        const archive = t.actions.find((a) => a.type === "archive" && a.record_id === "gp-inflated");
        const deleteAction = t.actions.find((a) => a.type === "delete" && a.record_id === "gp-inflated");
        let score = 0;
        if (downgrade && downgrade.new_importance <= 2) score = 1.0;
        else if (archive || deleteAction) score = 0.8;
        else if (downgrade) score = 0.6;
        return { score, actual: JSON.stringify(t.actions.map((a) => ({ type: a.type }))) };
      },
    },
    {
      id: "govplan-summarize-episodics",
      metric: "governance_plan_accuracy",
      module: "governance-planner",
      promptName: "MEMORY_GOVERNANCE_PLAN_SYSTEM_PROMPT",
      expected: "三条以上短 episodic 记录应合并为摘要",
      systemPrompt: MEMORY_GOVERNANCE_PLAN_SYSTEM_PROMPT,
      payload: {
        seed_records: [
          record("gp-ep-1", "workspace", "episodic", "4/20 跑了一次集成测试。", 2, 0.70),
          record("gp-ep-2", "workspace", "episodic", "4/21 跑了一次回归测试。", 2, 0.70),
          record("gp-ep-3", "workspace", "episodic", "4/22 跑了一次端到端测试。", 2, 0.70),
        ],
        related_records: [],
        open_conflicts: [],
      },
      schema: memoryGovernancePlanSchema,
      maxTokens: 1500,
      check: (output) => {
        const t = output as z.infer<typeof memoryGovernancePlanSchema>;
        const summarize = t.actions.find((a) => a.type === "summarize");
        const merge = t.actions.find((a) => a.type === "merge");
        let score = 0;
        if (summarize) score += 1.0;
        else if (merge) score += 0.7;
        return { score, actual: JSON.stringify(t.actions.map((a) => ({ type: a.type }))) };
      },
    },
    {
      id: "govplan-resolve-conflict",
      metric: "governance_plan_accuracy",
      module: "governance-planner",
      promptName: "MEMORY_GOVERNANCE_PLAN_SYSTEM_PROMPT",
      expected: "有明确证据的冲突应被解决",
      systemPrompt: MEMORY_GOVERNANCE_PLAN_SYSTEM_PROMPT,
      payload: {
        seed_records: [
          record("gp-c1", "user", "fact_preference", "用户偏好：使用 tab 缩进。", 4, 0.78, { created_at: "2026-03-01T08:00:00.000Z" }),
          record("gp-c2", "user", "fact_preference", "用户偏好：使用 4 空格缩进。", 5, 0.96, { created_at: "2026-04-22T08:00:00.000Z" }),
        ],
        related_records: [],
        open_conflicts: [
          { id: "conflict-1", record_id: "gp-c1", conflict_with_record_id: "gp-c2", conflict_type: "contradiction", conflict_summary: "缩进偏好矛盾", created_at: "2026-04-22T10:00:00.000Z" },
        ],
      },
      schema: memoryGovernancePlanSchema,
      maxTokens: 1500,
      check: (output) => {
        const t = output as z.infer<typeof memoryGovernancePlanSchema>;
        const resolve = t.actions.find((a) => a.type === "resolve_conflict" && a.conflict_id === "conflict-1");
        const archive = t.actions.find((a) => a.type === "archive" && a.record_id === "gp-c1");
        let score = 0;
        if (resolve) score += 0.6;
        if (archive) score += 0.4;
        if (!resolve && archive) score = 0.5;
        return { score, actual: JSON.stringify(t.actions.map((a) => ({ type: a.type }))) };
      },
    },
    {
      id: "govplan-skip-ambiguous-conflict",
      metric: "governance_plan_accuracy",
      module: "governance-planner",
      promptName: "MEMORY_GOVERNANCE_PLAN_SYSTEM_PROMPT",
      expected: "证据不充分的冲突不应被自动解决",
      systemPrompt: MEMORY_GOVERNANCE_PLAN_SYSTEM_PROMPT,
      payload: {
        seed_records: [
          record("gp-a1", "workspace", "fact_preference", "测试框架用 Jest。", 3, 0.70),
          record("gp-a2", "workspace", "fact_preference", "测试框架用 Vitest。", 3, 0.72),
        ],
        related_records: [],
        open_conflicts: [
          { id: "conflict-2", record_id: "gp-a1", conflict_with_record_id: "gp-a2", conflict_type: "contradiction", conflict_summary: "测试框架选择矛盾", created_at: "2026-04-22T10:00:00.000Z" },
        ],
      },
      schema: memoryGovernancePlanSchema,
      maxTokens: 1500,
      check: (output) => {
        const t = output as z.infer<typeof memoryGovernancePlanSchema>;
        const resolve = t.actions.find((a) => a.type === "resolve_conflict");
        let score = 0;
        if (!resolve) score = 1.0;
        else if (resolve.resolution_type === "manual_fix") score = 0.7;
        return { score, actual: JSON.stringify(t.actions.map((a) => ({ type: a.type }))) };
      },
    },
    {
      id: "govplan-delete-obsolete",
      metric: "governance_plan_accuracy",
      module: "governance-planner",
      promptName: "MEMORY_GOVERNANCE_PLAN_SYSTEM_PROMPT",
      expected: "明确废弃的记录应被删除",
      systemPrompt: MEMORY_GOVERNANCE_PLAN_SYSTEM_PROMPT,
      payload: {
        seed_records: [
          record("gp-obsolete", "workspace", "episodic", "临时用了一个 monkey patch 修 bug，已在正式修复后移除。", 1, 0.40, { status: "active" }),
        ],
        related_records: [
          record("gp-fix", "workspace", "task_state", "bug 已正式修复并合入主分支。", 4, 0.95, { created_at: "2026-04-22T08:00:00.000Z" }),
        ],
        open_conflicts: [],
      },
      schema: memoryGovernancePlanSchema,
      maxTokens: 1500,
      check: (output) => {
        const t = output as z.infer<typeof memoryGovernancePlanSchema>;
        const del = t.actions.find((a) => a.type === "delete" && a.record_id === "gp-obsolete");
        const archive = t.actions.find((a) => a.type === "archive" && a.record_id === "gp-obsolete");
        let score = 0;
        if (del) score = 1.0;
        else if (archive) score = 0.7;
        return { score, actual: JSON.stringify(t.actions.map((a) => ({ type: a.type }))) };
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// 7. low_quality_intercept_rate (8 cases)
// ---------------------------------------------------------------------------

function buildQualityCases(): Array<EvalCase<unknown>> {
  return [
    {
      id: "quality-low-signal",
      metric: "low_quality_intercept_rate",
      module: "writeback-quality-assessor",
      promptName: "MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT",
      expected: "低信号候选应被标记低质量",
      systemPrompt: MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT,
      payload: {
        writeback_candidates: [
          { id: "cand-low-1", candidate_type: "episodic", scope: "session", summary: "好的，我来处理。", importance: 3, confidence: 0.72, write_reason: "assistant acknowledged" },
          { id: "cand-good-1", candidate_type: "fact_preference", scope: "user", summary: "用户偏好：写说明时先给结论再补短点。", importance: 5, confidence: 0.94, write_reason: "stable formatting preference" },
        ],
        existing_similar_records: [
          { id: "rec-good-1", scope: "user", memory_type: "fact_preference", status: "active", summary: "用户偏好：默认中文回答。", importance: 5, confidence: 0.9 },
        ],
        turn_context: { user_input: "以后这种说明文档先给结论，再补几个短点。", assistant_output: "好的，我来处理。后续按这个格式写。" },
      },
      schema: memoryQualityAssessmentResultSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryQualityAssessmentResultSchema>;
        const low = t.assessments.find((a) => a.candidate_id === "cand-low-1");
        let score = 0;
        if (low && low.quality_score <= 0.45) score += 0.5;
        if (low && low.issues.some((i) => i.type === "low_quality" || i.type === "vague")) score += 0.5;
        return { score, actual: JSON.stringify(low ?? null) };
      },
    },
    {
      id: "quality-duplicate-detection",
      metric: "low_quality_intercept_rate",
      module: "writeback-quality-assessor",
      promptName: "MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT",
      expected: "与已有记录高度重复的候选应标记 duplicate",
      systemPrompt: MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT,
      payload: {
        writeback_candidates: [
          { id: "cand-dup", candidate_type: "fact_preference", scope: "user", summary: "用户偏好：默认中文回答。", importance: 5, confidence: 0.92, write_reason: "language preference" },
        ],
        existing_similar_records: [
          { id: "rec-existing", scope: "user", memory_type: "fact_preference", status: "active", summary: "用户偏好：默认中文回答。", importance: 5, confidence: 0.95 },
        ],
        turn_context: { user_input: "记住用中文。", assistant_output: "已记录。" },
      },
      schema: memoryQualityAssessmentResultSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryQualityAssessmentResultSchema>;
        const dup = t.assessments.find((a) => a.candidate_id === "cand-dup");
        let score = 0;
        if (dup && dup.issues.some((i) => i.type === "duplicate")) score += 0.6;
        if (dup && dup.potential_conflicts.includes("rec-existing")) score += 0.4;
        return { score, actual: JSON.stringify(dup ?? null) };
      },
    },
    {
      id: "quality-high-signal-pass",
      metric: "low_quality_intercept_rate",
      module: "writeback-quality-assessor",
      promptName: "MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT",
      expected: "高质量候选应通过，无 issue",
      systemPrompt: MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT,
      payload: {
        writeback_candidates: [
          { id: "cand-high", candidate_type: "fact_preference", scope: "workspace", summary: "项目规则：所有 API 必须加 /api/v2 前缀。", importance: 5, confidence: 0.96, write_reason: "API convention" },
        ],
        existing_similar_records: [],
        turn_context: { user_input: "这个项目的 API 都要加 /api/v2 前缀。", assistant_output: "已记录。" },
      },
      schema: memoryQualityAssessmentResultSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryQualityAssessmentResultSchema>;
        const high = t.assessments.find((a) => a.candidate_id === "cand-high");
        let score = 0;
        if (high && high.quality_score >= 0.7) score += 0.5;
        if (high && high.issues.length === 0) score += 0.3;
        if (high && high.suggested_status === "active") score += 0.2;
        return { score, actual: JSON.stringify(high ?? null) };
      },
    },
    {
      id: "quality-vague-summary",
      metric: "low_quality_intercept_rate",
      module: "writeback-quality-assessor",
      promptName: "MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT",
      expected: "模糊摘要应标记 vague",
      systemPrompt: MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT,
      payload: {
        writeback_candidates: [
          { id: "cand-vague", candidate_type: "episodic", scope: "session", summary: "做了一些事情。", importance: 3, confidence: 0.60, write_reason: "session note" },
        ],
        existing_similar_records: [],
        turn_context: { user_input: "帮我整理一下。", assistant_output: "已整理完毕。" },
      },
      schema: memoryQualityAssessmentResultSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryQualityAssessmentResultSchema>;
        const vague = t.assessments.find((a) => a.candidate_id === "cand-vague");
        let score = 0;
        if (vague && vague.quality_score <= 0.4) score += 0.5;
        if (vague && vague.issues.some((i) => i.type === "vague" || i.type === "low_quality")) score += 0.5;
        return { score, actual: JSON.stringify(vague ?? null) };
      },
    },
    {
      id: "quality-conflict-flag",
      metric: "low_quality_intercept_rate",
      module: "writeback-quality-assessor",
      promptName: "MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT",
      expected: "与已有记录冲突的候选应标记 conflict",
      systemPrompt: MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT,
      payload: {
        writeback_candidates: [
          { id: "cand-conflict", candidate_type: "fact_preference", scope: "user", summary: "用户偏好：使用 tab 缩进。", importance: 4, confidence: 0.85, write_reason: "indent preference" },
        ],
        existing_similar_records: [
          { id: "rec-space", scope: "user", memory_type: "fact_preference", status: "active", summary: "用户偏好：使用 4 空格缩进。", importance: 5, confidence: 0.95 },
        ],
        turn_context: { user_input: "算了还是用 tab 吧。", assistant_output: "好的，切换到 tab 缩进。" },
      },
      schema: memoryQualityAssessmentResultSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryQualityAssessmentResultSchema>;
        const item = t.assessments.find((a) => a.candidate_id === "cand-conflict");
        let score = 0;
        if (item && item.issues.some((i) => i.type === "conflict")) score += 0.5;
        if (item && item.potential_conflicts.includes("rec-space")) score += 0.3;
        if (item && item.suggested_status === "pending_confirmation") score += 0.2;
        return { score, actual: JSON.stringify(item ?? null) };
      },
    },
    {
      id: "quality-multi-candidate-mixed",
      metric: "low_quality_intercept_rate",
      module: "writeback-quality-assessor",
      promptName: "MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT",
      expected: "多候选中应分别评估好坏",
      systemPrompt: MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT,
      payload: {
        writeback_candidates: [
          { id: "cand-ok", candidate_type: "task_state", scope: "task", summary: "迁移到第 3 步，下一步创建索引。", importance: 4, confidence: 0.90, write_reason: "task progress" },
          { id: "cand-bad", candidate_type: "episodic", scope: "session", summary: "嗯嗯。", importance: 1, confidence: 0.30, write_reason: "ack" },
        ],
        existing_similar_records: [],
        turn_context: { user_input: "迁移做到哪了？", assistant_output: "到第 3 步了，嗯嗯。" },
      },
      schema: memoryQualityAssessmentResultSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryQualityAssessmentResultSchema>;
        const ok = t.assessments.find((a) => a.candidate_id === "cand-ok");
        const bad = t.assessments.find((a) => a.candidate_id === "cand-bad");
        let score = 0;
        if (ok && ok.quality_score >= 0.6) score += 0.4;
        if (bad && bad.quality_score <= 0.4) score += 0.4;
        if (bad && bad.issues.length > 0) score += 0.2;
        return { score, actual: JSON.stringify({ ok_score: ok?.quality_score, bad_score: bad?.quality_score }) };
      },
    },
    {
      id: "quality-pending-confirmation",
      metric: "low_quality_intercept_rate",
      module: "writeback-quality-assessor",
      promptName: "MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT",
      expected: "存疑候选应标记 pending_confirmation",
      systemPrompt: MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT,
      payload: {
        writeback_candidates: [
          { id: "cand-maybe", candidate_type: "fact_preference", scope: "user", summary: "用户可能偏好暗色主题。", importance: 3, confidence: 0.65, write_reason: "inferred preference" },
        ],
        existing_similar_records: [],
        turn_context: { user_input: "这个暗色看起来还行。", assistant_output: "好的，可以后续继续使用暗色主题。" },
      },
      schema: memoryQualityAssessmentResultSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryQualityAssessmentResultSchema>;
        const item = t.assessments.find((a) => a.candidate_id === "cand-maybe");
        let score = 0;
        if (item && item.suggested_status === "pending_confirmation") score += 0.6;
        if (item && item.quality_score < 0.8) score += 0.4;
        return { score, actual: JSON.stringify(item ?? null) };
      },
    },
    {
      id: "quality-importance-adjustment",
      metric: "low_quality_intercept_rate",
      module: "writeback-quality-assessor",
      promptName: "MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT",
      expected: "重要度虚高的低质量候选应建议降低 importance",
      systemPrompt: MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT,
      payload: {
        writeback_candidates: [
          { id: "cand-inflated", candidate_type: "episodic", scope: "session", summary: "用户打了个招呼。", importance: 5, confidence: 0.50, write_reason: "greeting" },
        ],
        existing_similar_records: [],
        turn_context: { user_input: "嗨", assistant_output: "你好！" },
      },
      schema: memoryQualityAssessmentResultSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryQualityAssessmentResultSchema>;
        const item = t.assessments.find((a) => a.candidate_id === "cand-inflated");
        let score = 0;
        if (item && item.suggested_importance <= 2) score += 0.5;
        if (item && item.quality_score <= 0.3) score += 0.3;
        if (item && item.issues.length > 0) score += 0.2;
        return { score, actual: JSON.stringify(item ?? null) };
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// 8. relation_discovery_accuracy (10 cases)
// ---------------------------------------------------------------------------

function buildRelationCases(): Array<EvalCase<unknown>> {
  const ctx = { workspace_id: "eval-workspace", user_id: "eval-user" };
  const mkSrc = (id: string, type: string, scope: string, summary: string, imp: number, conf: number) => ({ id, memory_type: type, scope, summary, importance: imp, confidence: conf });

  return [
    {
      id: "relation-extends-task",
      metric: "relation_discovery_accuracy",
      module: "relation-discoverer",
      promptName: "MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT",
      expected: "同一任务上下文里的扩展关系应被发现",
      systemPrompt: MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT,
      payload: {
        source_record: mkSrc("rel-src-1", "task_state", "task", "当前任务：补齐 memory orchestrator 验收文档的真实指标。", 4, 0.91),
        candidate_records: [
          mkSrc("rel-rel-1", "task_state", "task", "当前任务下一步：补充真实模型评测提示词和输出结果。", 4, 0.90),
          mkSrc("rel-noise-1", "episodic", "workspace", "昨天修过一个日志滚动配置。", 2, 0.62),
        ],
        context: ctx,
      },
      schema: memoryRelationDiscoverySchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryRelationDiscoverySchema>;
        const hit = t.relations.some((r) => r.target_record_id === "rel-rel-1");
        const noise = t.relations.some((r) => r.target_record_id === "rel-noise-1");
        let score = 0;
        if (hit) score += 0.6;
        if (!noise) score += 0.4;
        return { score, actual: JSON.stringify(t.relations) };
      },
    },
    {
      id: "relation-no-clear-link",
      metric: "relation_discovery_accuracy",
      module: "relation-discoverer",
      promptName: "MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT",
      expected: "无明确语义关联时不应强行输出关系",
      systemPrompt: MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT,
      payload: {
        source_record: mkSrc("rel-src-2", "fact_preference", "user", "用户偏好：默认中文回答。", 5, 0.95),
        candidate_records: [
          mkSrc("rel-noise-2", "episodic", "workspace", "上周处理过一个 nginx 日志切割问题。", 2, 0.58),
          mkSrc("rel-noise-3", "task_state", "task", "当前任务：补一份前端配色稿。", 3, 0.72),
        ],
        context: ctx,
      },
      schema: memoryRelationDiscoverySchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryRelationDiscoverySchema>;
        return { score: t.relations.length === 0 ? 1.0 : 0.0, actual: JSON.stringify(t.relations) };
      },
    },
    {
      id: "relation-supersedes",
      metric: "relation_discovery_accuracy",
      module: "relation-discoverer",
      promptName: "MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT",
      expected: "新记录替代旧记录应识别为 supersedes",
      systemPrompt: MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT,
      payload: {
        source_record: mkSrc("rel-new-pref", "fact_preference", "user", "用户偏好：使用 4 空格缩进，不用 tab。", 5, 0.96),
        candidate_records: [
          mkSrc("rel-old-pref", "fact_preference", "user", "用户偏好：使用 tab 缩进。", 4, 0.78),
        ],
        context: ctx,
      },
      schema: memoryRelationDiscoverySchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryRelationDiscoverySchema>;
        const hit = t.relations.some((r) => r.target_record_id === "rel-old-pref" && (r.relation_type === "supersedes" || r.relation_type === "conflicts_with"));
        return { score: hit ? 1.0 : 0.0, actual: JSON.stringify(t.relations) };
      },
    },
    {
      id: "relation-conflicts-with",
      metric: "relation_discovery_accuracy",
      module: "relation-discoverer",
      promptName: "MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT",
      expected: "明确矛盾的记录应标记 conflicts_with",
      systemPrompt: MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT,
      payload: {
        source_record: mkSrc("rel-jest", "fact_preference", "workspace", "测试框架用 Jest。", 4, 0.85),
        candidate_records: [
          mkSrc("rel-vitest", "fact_preference", "workspace", "测试框架用 Vitest。", 4, 0.85),
        ],
        context: ctx,
      },
      schema: memoryRelationDiscoverySchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryRelationDiscoverySchema>;
        const hit = t.relations.some((r) => r.target_record_id === "rel-vitest" && (r.relation_type === "conflicts_with" || r.relation_type === "supersedes"));
        return { score: hit ? 1.0 : 0.0, actual: JSON.stringify(t.relations) };
      },
    },
    {
      id: "relation-depends-on",
      metric: "relation_discovery_accuracy",
      module: "relation-discoverer",
      promptName: "MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT",
      expected: "依赖关系应被识别为 depends_on",
      systemPrompt: MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT,
      payload: {
        source_record: mkSrc("rel-deploy", "task_state", "task", "当前任务：部署到 staging 环境。", 4, 0.90),
        candidate_records: [
          mkSrc("rel-build", "task_state", "task", "构建产物已生成，等待部署。", 4, 0.88),
        ],
        context: ctx,
      },
      schema: memoryRelationDiscoverySchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryRelationDiscoverySchema>;
        const hit = t.relations.some((r) => r.target_record_id === "rel-build" && (r.relation_type === "depends_on" || r.relation_type === "extends" || r.relation_type === "related_to"));
        return { score: hit ? 1.0 : 0.3, actual: JSON.stringify(t.relations) };
      },
    },
    {
      id: "relation-related-to-weak",
      metric: "relation_discovery_accuracy",
      module: "relation-discoverer",
      promptName: "MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT",
      expected: "弱相关记录应使用 related_to 而非更强的类型",
      systemPrompt: MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT,
      payload: {
        source_record: mkSrc("rel-auth", "task_state", "workspace", "正在实现用户登录模块。", 4, 0.90),
        candidate_records: [
          mkSrc("rel-perm", "task_state", "workspace", "权限管理模块设计中。", 3, 0.82),
        ],
        context: ctx,
      },
      schema: memoryRelationDiscoverySchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryRelationDiscoverySchema>;
        const hit = t.relations.find((r) => r.target_record_id === "rel-perm");
        let score = 0;
        if (hit) score += 0.5;
        if (hit && hit.relation_type === "related_to") score += 0.3;
        if (hit && hit.strength < 0.8) score += 0.2;
        return { score, actual: JSON.stringify(t.relations) };
      },
    },
    {
      id: "relation-bidirectional",
      metric: "relation_discovery_accuracy",
      module: "relation-discoverer",
      promptName: "MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT",
      expected: "互相关联的记录应标记为双向",
      systemPrompt: MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT,
      payload: {
        source_record: mkSrc("rel-fe", "task_state", "workspace", "前端用 React + TypeScript。", 4, 0.92),
        candidate_records: [
          mkSrc("rel-be", "task_state", "workspace", "后端用 Node.js + TypeScript。", 4, 0.92),
        ],
        context: ctx,
      },
      schema: memoryRelationDiscoverySchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryRelationDiscoverySchema>;
        const hit = t.relations.find((r) => r.target_record_id === "rel-be");
        let score = 0;
        if (hit) score += 0.5;
        if (hit && hit.relation_type === "related_to") score += 0.2;
        if (hit && hit.bidirectional) score += 0.3;
        return { score, actual: JSON.stringify(t.relations) };
      },
    },
    {
      id: "relation-single-candidate-hit",
      metric: "relation_discovery_accuracy",
      module: "relation-discoverer",
      promptName: "MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT",
      expected: "单条高相关候选应输出关系",
      systemPrompt: MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT,
      payload: {
        source_record: mkSrc("rel-v1", "fact_preference", "workspace", "API 版本当前为 v1。", 4, 0.90),
        candidate_records: [
          mkSrc("rel-v2", "fact_preference", "workspace", "API 版本已升级到 v2。", 5, 0.95),
        ],
        context: ctx,
      },
      schema: memoryRelationDiscoverySchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryRelationDiscoverySchema>;
        const hit = t.relations.some((r) => r.target_record_id === "rel-v2");
        return { score: hit ? 1.0 : 0.0, actual: JSON.stringify(t.relations) };
      },
    },
    {
      id: "relation-multiple-candidates-selective",
      metric: "relation_discovery_accuracy",
      module: "relation-discoverer",
      promptName: "MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT",
      expected: "多候选中只选有语义关联的",
      systemPrompt: MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT,
      payload: {
        source_record: mkSrc("rel-cache", "task_state", "workspace", "正在实现 Redis 缓存层。", 4, 0.90),
        candidate_records: [
          mkSrc("rel-redis-config", "fact_preference", "workspace", "Redis 地址配置在 env.REDIS_URL。", 3, 0.85),
          mkSrc("rel-css-fix", "episodic", "workspace", "上周修了一个 CSS bug。", 1, 0.40),
          mkSrc("rel-perf", "task_state", "workspace", "API 响应时间需要优化到 200ms 以内。", 4, 0.88),
        ],
        context: ctx,
      },
      schema: memoryRelationDiscoverySchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryRelationDiscoverySchema>;
        const hitRedis = t.relations.some((r) => r.target_record_id === "rel-redis-config");
        const hitPerf = t.relations.some((r) => r.target_record_id === "rel-perf");
        const noCss = !t.relations.some((r) => r.target_record_id === "rel-css-fix");
        let score = 0;
        if (hitRedis) score += 0.35;
        if (hitPerf) score += 0.35;
        if (noCss) score += 0.3;
        return { score, actual: JSON.stringify(t.relations.map((r) => r.target_record_id)) };
      },
    },
    {
      id: "relation-empty-candidates",
      metric: "relation_discovery_accuracy",
      module: "relation-discoverer",
      promptName: "MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT",
      expected: "无候选时应返回空关系列表",
      systemPrompt: MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT,
      payload: {
        source_record: mkSrc("rel-solo", "fact_preference", "user", "用户偏好：暗色主题。", 3, 0.85),
        candidate_records: [],
        context: ctx,
      },
      schema: memoryRelationDiscoverySchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryRelationDiscoverySchema>;
        return { score: t.relations.length === 0 ? 1.0 : 0.0, actual: JSON.stringify({ count: t.relations.length }) };
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// 9. recommendation_acceptance_proxy (10 cases)
// ---------------------------------------------------------------------------

function buildRecommendationCases(): Array<EvalCase<unknown>> {
  const mkMem = (id: string, type: string, scope: string, summary: string, imp: number, conf: number, status = "active") =>
    ({ id, memory_type: type, scope, status, summary, importance: imp, confidence: conf });

  return [
    {
      id: "recommend-task-memory",
      metric: "recommendation_acceptance_proxy",
      module: "proactive-recommender",
      promptName: "MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT",
      expected: "应推荐与当前任务相关的高价值记忆",
      systemPrompt: MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT,
      payload: {
        current_context: {
          user_input: "继续完善验收文档，保持之前的写法。",
          session_context: { session_id: "rec-1", workspace_id: "eval-workspace", user_id: "eval-user", recent_context_summary: "本会话在完善 memory orchestrator 测试材料。" },
          detected_task_type: "documentation",
        },
        available_memories: [
          mkMem("mem-rec-1", "task_state", "task", "当前任务：完善 memory orchestrator 测试样本文档。", 5, 0.95),
          mkMem("mem-rec-2", "fact_preference", "user", "用户偏好：默认中文，短句输出。", 5, 0.94),
          mkMem("mem-rec-3", "episodic", "workspace", "三个月前讨论过图标颜色。", 1, 0.40, "archived"),
        ],
      },
      schema: memoryProactiveRecommendationSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryProactiveRecommendationSchema>;
        const hit = t.recommendations.some((r) => (r.record_id === "mem-rec-1" || r.record_id === "mem-rec-2") && r.relevance_score >= 0.7);
        const noNoise = !t.recommendations.some((r) => r.record_id === "mem-rec-3");
        let score = 0;
        if (hit) score += 0.7;
        if (noNoise) score += 0.3;
        return { score, actual: JSON.stringify(t.recommendations) };
      },
    },
    {
      id: "recommend-noisy-skip",
      metric: "recommendation_acceptance_proxy",
      module: "proactive-recommender",
      promptName: "MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT",
      expected: "无明确连续性时不应推荐低价值记忆",
      systemPrompt: MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT,
      payload: {
        current_context: {
          user_input: "解释一下 TCP 三次握手。",
          session_context: { session_id: "rec-2", workspace_id: "eval-workspace", user_id: "eval-user", recent_context_summary: "新的网络知识问题。" },
          detected_task_type: "qa",
        },
        available_memories: [
          mkMem("mem-noise-r1", "episodic", "workspace", "两个月前讨论过 memory orchestrator。", 2, 0.62),
          mkMem("mem-noise-r2", "task_state", "task", "上一个任务：整理前端视觉稿。", 1, 0.45, "archived"),
        ],
      },
      schema: memoryProactiveRecommendationSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryProactiveRecommendationSchema>;
        return { score: t.recommendations.length === 0 ? 1.0 : 0.0, actual: JSON.stringify(t.recommendations) };
      },
    },
    {
      id: "recommend-borderline-relevance",
      metric: "recommendation_acceptance_proxy",
      module: "proactive-recommender",
      promptName: "MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT",
      expected: "边界相关度的记忆应谨慎推荐或不推荐",
      systemPrompt: MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT,
      payload: {
        current_context: {
          user_input: "帮我重写这个函数，用 TypeScript。",
          session_context: { session_id: "rec-3", workspace_id: "eval-workspace", user_id: "eval-user", recent_context_summary: "用户在做代码重构。" },
          detected_task_type: "coding",
        },
        available_memories: [
          mkMem("mem-ts-strict", "fact_preference", "workspace", "项目使用 TypeScript strict 模式。", 4, 0.88),
          mkMem("mem-old-meeting", "episodic", "workspace", "上个月开过一次 sprint 回顾会。", 1, 0.35, "archived"),
        ],
      },
      schema: memoryProactiveRecommendationSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryProactiveRecommendationSchema>;
        const hitTs = t.recommendations.some((r) => r.record_id === "mem-ts-strict");
        const noMeeting = !t.recommendations.some((r) => r.record_id === "mem-old-meeting");
        let score = 0;
        if (hitTs) score += 0.5;
        if (noMeeting) score += 0.5;
        return { score, actual: JSON.stringify(t.recommendations.map((r) => r.record_id)) };
      },
    },
    {
      id: "recommend-conflict-warning",
      metric: "recommendation_acceptance_proxy",
      module: "proactive-recommender",
      promptName: "MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT",
      expected: "应推荐带冲突预警的记忆",
      systemPrompt: MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT,
      payload: {
        current_context: {
          user_input: "用 tab 缩进写这个文件。",
          session_context: { session_id: "rec-4", workspace_id: "eval-workspace", user_id: "eval-user", recent_context_summary: "用户在写代码。" },
          detected_task_type: "coding",
        },
        available_memories: [
          mkMem("mem-space-pref", "fact_preference", "user", "用户偏好：使用 4 空格缩进，不用 tab。", 5, 0.96),
        ],
      },
      schema: memoryProactiveRecommendationSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryProactiveRecommendationSchema>;
        const hit = t.recommendations.some((r) => r.record_id === "mem-space-pref" && (r.trigger_reason === "conflict_warning" || r.trigger_reason === "forgotten_context"));
        return { score: hit ? 1.0 : t.recommendations.some((r) => r.record_id === "mem-space-pref") ? 0.5 : 0.0, actual: JSON.stringify(t.recommendations) };
      },
    },
    {
      id: "recommend-auto-inject-high",
      metric: "recommendation_acceptance_proxy",
      module: "proactive-recommender",
      promptName: "MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT",
      expected: "高度相关时 auto_inject 应为 true",
      systemPrompt: MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT,
      payload: {
        current_context: {
          user_input: "继续做迁移的下一步。",
          session_context: { session_id: "rec-5", workspace_id: "eval-workspace", user_id: "eval-user", recent_context_summary: "正在做数据库迁移。" },
          detected_task_type: "implementation",
        },
        available_memories: [
          mkMem("mem-migrate", "task_state", "task", "迁移进度：第 3 步完成，下一步创建索引。", 5, 0.97),
        ],
      },
      schema: memoryProactiveRecommendationSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryProactiveRecommendationSchema>;
        const hit = t.recommendations.find((r) => r.record_id === "mem-migrate");
        let score = 0;
        if (hit) score += 0.5;
        if (hit && hit.auto_inject) score += 0.3;
        if (hit && hit.relevance_score >= 0.8) score += 0.2;
        return { score, actual: JSON.stringify(t.recommendations) };
      },
    },
    {
      id: "recommend-no-auto-inject-low",
      metric: "recommendation_acceptance_proxy",
      module: "proactive-recommender",
      promptName: "MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT",
      expected: "弱相关时 auto_inject 应为 false",
      systemPrompt: MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT,
      payload: {
        current_context: {
          user_input: "写一个排序算法。",
          session_context: { session_id: "rec-6", workspace_id: "eval-workspace", user_id: "eval-user", recent_context_summary: "用户需要算法实现。" },
          detected_task_type: "coding",
        },
        available_memories: [
          mkMem("mem-lang-pref", "fact_preference", "user", "用户偏好：默认中文回答。", 5, 0.94),
        ],
      },
      schema: memoryProactiveRecommendationSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryProactiveRecommendationSchema>;
        if (t.recommendations.length === 0) return { score: 0.8, actual: "no recommendations" };
        const hit = t.recommendations.find((r) => r.record_id === "mem-lang-pref");
        const score = hit && !hit.auto_inject ? 1.0 : hit && hit.auto_inject ? 0.3 : 0.5;
        return { score, actual: JSON.stringify(t.recommendations) };
      },
    },
    {
      id: "recommend-multiple-relevant",
      metric: "recommendation_acceptance_proxy",
      module: "proactive-recommender",
      promptName: "MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT",
      expected: "多条高相关记忆应全部推荐",
      systemPrompt: MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT,
      payload: {
        current_context: {
          user_input: "继续写那个 API，按项目规范来。",
          session_context: { session_id: "rec-7", workspace_id: "eval-workspace", user_id: "eval-user", recent_context_summary: "正在开发 API。" },
          detected_task_type: "implementation",
        },
        available_memories: [
          mkMem("mem-api-prefix", "fact_preference", "workspace", "项目规则：API 前缀 /api/v2。", 5, 0.95),
          mkMem("mem-api-task", "task_state", "task", "当前任务：实现用户列表 API。", 4, 0.92),
          mkMem("mem-unrelated", "episodic", "workspace", "上周部署过一次 CDN。", 1, 0.40),
        ],
      },
      schema: memoryProactiveRecommendationSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryProactiveRecommendationSchema>;
        const hitPrefix = t.recommendations.some((r) => r.record_id === "mem-api-prefix");
        const hitTask = t.recommendations.some((r) => r.record_id === "mem-api-task");
        const noNoise = !t.recommendations.some((r) => r.record_id === "mem-unrelated");
        let score = 0;
        if (hitPrefix) score += 0.3;
        if (hitTask) score += 0.3;
        if (noNoise) score += 0.4;
        return { score, actual: JSON.stringify(t.recommendations.map((r) => r.record_id)) };
      },
    },
    {
      id: "recommend-empty-memories",
      metric: "recommendation_acceptance_proxy",
      module: "proactive-recommender",
      promptName: "MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT",
      expected: "无可用记忆时应返回空推荐",
      systemPrompt: MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT,
      payload: {
        current_context: {
          user_input: "写个 hello world。",
          session_context: { session_id: "rec-8", workspace_id: "eval-workspace", user_id: "eval-user", recent_context_summary: "" },
          detected_task_type: "coding",
        },
        available_memories: [],
      },
      schema: memoryProactiveRecommendationSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryProactiveRecommendationSchema>;
        return { score: t.recommendations.length === 0 ? 1.0 : 0.0, actual: JSON.stringify({ count: t.recommendations.length }) };
      },
    },
    {
      id: "recommend-archived-skip",
      metric: "recommendation_acceptance_proxy",
      module: "proactive-recommender",
      promptName: "MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT",
      expected: "归档记忆不应被推荐",
      systemPrompt: MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT,
      payload: {
        current_context: {
          user_input: "帮我写文档。",
          session_context: { session_id: "rec-9", workspace_id: "eval-workspace", user_id: "eval-user", recent_context_summary: "写文档。" },
          detected_task_type: "documentation",
        },
        available_memories: [
          mkMem("mem-archived-doc", "task_state", "task", "上次的文档任务已完成。", 2, 0.50, "archived"),
        ],
      },
      schema: memoryProactiveRecommendationSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryProactiveRecommendationSchema>;
        return { score: t.recommendations.length === 0 ? 1.0 : 0.2, actual: JSON.stringify(t.recommendations) };
      },
    },
    {
      id: "recommend-forgotten-context",
      metric: "recommendation_acceptance_proxy",
      module: "proactive-recommender",
      promptName: "MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT",
      expected: "用户可能遗忘的关键上下文应被推荐",
      systemPrompt: MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT,
      payload: {
        current_context: {
          user_input: "开始做新功能。",
          session_context: { session_id: "rec-10", workspace_id: "eval-workspace", user_id: "eval-user", recent_context_summary: "用户开始新任务。" },
          detected_task_type: "implementation",
        },
        available_memories: [
          mkMem("mem-freeze", "fact_preference", "workspace", "注意：4/25 后主分支冻结合并，仅允许关键修复。", 5, 0.98),
        ],
      },
      schema: memoryProactiveRecommendationSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryProactiveRecommendationSchema>;
        const hit = t.recommendations.some((r) => r.record_id === "mem-freeze");
        return { score: hit ? 1.0 : 0.0, actual: JSON.stringify(t.recommendations) };
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// 10. knowledge_extraction_accuracy (8 cases)
// ---------------------------------------------------------------------------

function buildEvolutionCases(): Array<EvalCase<unknown>> {
  const mkEvoRec = (id: string, type: string, scope: string, summary: string, imp: number, conf: number, created: string, updated: string) =>
    ({ id, memory_type: type, scope, summary, importance: imp, confidence: conf, created_at: created, updated_at: updated });

  return [
    {
      id: "evolution-preference-extraction",
      metric: "knowledge_extraction_accuracy",
      module: "evolution-planner",
      promptName: "MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT",
      expected: "应从多条偏好中提炼稳定模式",
      systemPrompt: MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT,
      payload: {
        source_records: [
          mkEvoRec("evo-1", "fact_preference", "user", "用户偏好：默认中文回答。", 5, 0.96, "2026-04-20T08:00:00.000Z", "2026-04-20T08:00:00.000Z"),
          mkEvoRec("evo-2", "fact_preference", "user", "用户偏好：说明文档先给结论，再补短点。", 5, 0.94, "2026-04-21T08:00:00.000Z", "2026-04-21T08:00:00.000Z"),
          mkEvoRec("evo-3", "fact_preference", "user", "用户偏好：不要写太长，自然中文。", 4, 0.92, "2026-04-22T08:00:00.000Z", "2026-04-22T08:00:00.000Z"),
        ],
        time_window: { start: "2026-04-20T00:00:00.000Z", end: "2026-04-22T23:59:59.000Z" },
        evolution_type: "knowledge_extraction",
      },
      schema: memoryEvolutionPlanSchema,
      maxTokens: 1200,
      check: (output) => {
        const t = output as z.infer<typeof memoryEvolutionPlanSchema>;
        let score = 0;
        if (t.evolution_type === "knowledge_extraction") score += 0.3;
        if (t.extracted_knowledge?.pattern) score += 0.4;
        if (t.source_records.length >= 2) score += 0.3;
        return { score, actual: JSON.stringify({ evolution_type: t.evolution_type, extracted_knowledge: t.extracted_knowledge ?? null }) };
      },
    },
    {
      id: "evolution-pattern-workflow",
      metric: "knowledge_extraction_accuracy",
      module: "evolution-planner",
      promptName: "MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT",
      expected: "应从任务状态记录中提炼工作模式",
      systemPrompt: MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT,
      payload: {
        source_records: [
          mkEvoRec("evo-t1", "task_state", "workspace", "最近 3 次验收都先补测试样本再补实际指标。", 4, 0.90, "2026-04-01T08:00:00.000Z", "2026-04-18T08:00:00.000Z"),
          mkEvoRec("evo-t2", "task_state", "workspace", "最近 2 次评测都先做链路验证再回写指标文档。", 4, 0.89, "2026-04-10T08:00:00.000Z", "2026-04-20T08:00:00.000Z"),
          mkEvoRec("evo-t3", "task_state", "workspace", "团队验收习惯：先通链路再补统计数。", 4, 0.87, "2026-04-15T08:00:00.000Z", "2026-04-22T08:00:00.000Z"),
        ],
        time_window: { start: "2026-04-01T00:00:00.000Z", end: "2026-04-22T23:59:59.000Z" },
        evolution_type: "knowledge_extraction",
      },
      schema: memoryEvolutionPlanSchema,
      maxTokens: 1200,
      check: (output) => {
        const t = output as z.infer<typeof memoryEvolutionPlanSchema>;
        let score = 0;
        if (t.evolution_type === "knowledge_extraction") score += 0.3;
        if (t.extracted_knowledge?.pattern) score += 0.4;
        if (t.source_records.length >= 2) score += 0.3;
        return { score, actual: JSON.stringify({ evolution_type: t.evolution_type, pattern: t.extracted_knowledge?.pattern ?? "" }) };
      },
    },
    {
      id: "evolution-summarization",
      metric: "knowledge_extraction_accuracy",
      module: "evolution-planner",
      promptName: "MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT",
      expected: "summarization 类型应输出 consolidation_plan",
      systemPrompt: MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT,
      payload: {
        source_records: [
          mkEvoRec("evo-s1", "episodic", "workspace", "4/20 跑了集成测试。", 2, 0.70, "2026-04-20T08:00:00.000Z", "2026-04-20T08:00:00.000Z"),
          mkEvoRec("evo-s2", "episodic", "workspace", "4/21 跑了回归测试。", 2, 0.70, "2026-04-21T08:00:00.000Z", "2026-04-21T08:00:00.000Z"),
          mkEvoRec("evo-s3", "episodic", "workspace", "4/22 跑了端到端测试。", 2, 0.70, "2026-04-22T08:00:00.000Z", "2026-04-22T08:00:00.000Z"),
        ],
        time_window: { start: "2026-04-20T00:00:00.000Z", end: "2026-04-22T23:59:59.000Z" },
        evolution_type: "summarization",
      },
      schema: memoryEvolutionPlanSchema,
      maxTokens: 1200,
      check: (output) => {
        const t = output as z.infer<typeof memoryEvolutionPlanSchema>;
        let score = 0;
        if (t.evolution_type === "summarization") score += 0.3;
        if (t.consolidation_plan?.new_summary) score += 0.4;
        if (t.consolidation_plan?.records_to_archive && t.consolidation_plan.records_to_archive.length >= 2) score += 0.3;
        return { score, actual: JSON.stringify({ evolution_type: t.evolution_type, consolidation_plan: t.consolidation_plan ?? null }) };
      },
    },
    {
      id: "evolution-too-few-records",
      metric: "knowledge_extraction_accuracy",
      module: "evolution-planner",
      promptName: "MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT",
      expected: "单条记录不足以提炼模式时应标记低置信度",
      systemPrompt: MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT,
      payload: {
        source_records: [
          mkEvoRec("evo-single", "fact_preference", "user", "用户偏好：用中文。", 4, 0.85, "2026-04-22T08:00:00.000Z", "2026-04-22T08:00:00.000Z"),
        ],
        time_window: { start: "2026-04-22T00:00:00.000Z", end: "2026-04-22T23:59:59.000Z" },
        evolution_type: "knowledge_extraction",
      },
      schema: memoryEvolutionPlanSchema,
      maxTokens: 1200,
      check: (output) => {
        const t = output as z.infer<typeof memoryEvolutionPlanSchema>;
        let score = 0;
        if (t.extracted_knowledge && t.extracted_knowledge.confidence <= 0.6) score += 0.5;
        if (t.extracted_knowledge && t.extracted_knowledge.evidence_count <= 1) score += 0.5;
        if (!t.extracted_knowledge) score = 0.7;
        return { score, actual: JSON.stringify({ extracted_knowledge: t.extracted_knowledge ?? null }) };
      },
    },
    {
      id: "evolution-cross-scope-pattern",
      metric: "knowledge_extraction_accuracy",
      module: "evolution-planner",
      promptName: "MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT",
      expected: "跨 scope 的记录应正确建议提炼后的 scope",
      systemPrompt: MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT,
      payload: {
        source_records: [
          mkEvoRec("evo-u1", "fact_preference", "user", "用户偏好：代码写英文注释。", 4, 0.88, "2026-04-15T08:00:00.000Z", "2026-04-15T08:00:00.000Z"),
          mkEvoRec("evo-u2", "fact_preference", "user", "用户偏好：commit message 用英文。", 4, 0.90, "2026-04-18T08:00:00.000Z", "2026-04-18T08:00:00.000Z"),
          mkEvoRec("evo-u3", "fact_preference", "user", "用户偏好：文档和回复用中文。", 4, 0.88, "2026-04-20T08:00:00.000Z", "2026-04-20T08:00:00.000Z"),
        ],
        time_window: { start: "2026-04-15T00:00:00.000Z", end: "2026-04-22T23:59:59.000Z" },
        evolution_type: "knowledge_extraction",
      },
      schema: memoryEvolutionPlanSchema,
      maxTokens: 1200,
      check: (output) => {
        const t = output as z.infer<typeof memoryEvolutionPlanSchema>;
        let score = 0;
        if (t.extracted_knowledge?.pattern) score += 0.5;
        if (t.extracted_knowledge?.suggested_scope === "user") score += 0.3;
        if (t.source_records.length >= 2) score += 0.2;
        return { score, actual: JSON.stringify({ extracted_knowledge: t.extracted_knowledge ?? null }) };
      },
    },
    {
      id: "evolution-pattern-discovery",
      metric: "knowledge_extraction_accuracy",
      module: "evolution-planner",
      promptName: "MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT",
      expected: "pattern_discovery 类型应识别行为模式",
      systemPrompt: MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT,
      payload: {
        source_records: [
          mkEvoRec("evo-p1", "task_state", "workspace", "每次 PR 前都会先跑 lint 和单元测试。", 4, 0.88, "2026-04-10T08:00:00.000Z", "2026-04-20T08:00:00.000Z"),
          mkEvoRec("evo-p2", "task_state", "workspace", "上次也是先 lint 再测试再提 PR。", 3, 0.82, "2026-04-18T08:00:00.000Z", "2026-04-21T08:00:00.000Z"),
        ],
        time_window: { start: "2026-04-10T00:00:00.000Z", end: "2026-04-22T23:59:59.000Z" },
        evolution_type: "pattern_discovery",
      },
      schema: memoryEvolutionPlanSchema,
      maxTokens: 1200,
      check: (output) => {
        const t = output as z.infer<typeof memoryEvolutionPlanSchema>;
        let score = 0;
        if (t.evolution_type === "pattern_discovery") score += 0.3;
        if (t.extracted_knowledge?.pattern) score += 0.5;
        if (t.source_records.length >= 1) score += 0.2;
        return { score, actual: JSON.stringify({ evolution_type: t.evolution_type, pattern: t.extracted_knowledge?.pattern ?? "" }) };
      },
    },
    {
      id: "evolution-unrelated-records",
      metric: "knowledge_extraction_accuracy",
      module: "evolution-planner",
      promptName: "MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT",
      expected: "不相关的记录不应被强行提炼",
      systemPrompt: MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT,
      payload: {
        source_records: [
          mkEvoRec("evo-x1", "episodic", "workspace", "修了一个 CSS 居中问题。", 2, 0.60, "2026-04-18T08:00:00.000Z", "2026-04-18T08:00:00.000Z"),
          mkEvoRec("evo-x2", "fact_preference", "user", "用户偏好：用 Vim。", 4, 0.90, "2026-04-20T08:00:00.000Z", "2026-04-20T08:00:00.000Z"),
        ],
        time_window: { start: "2026-04-18T00:00:00.000Z", end: "2026-04-22T23:59:59.000Z" },
        evolution_type: "knowledge_extraction",
      },
      schema: memoryEvolutionPlanSchema,
      maxTokens: 1200,
      check: (output) => {
        const t = output as z.infer<typeof memoryEvolutionPlanSchema>;
        let score = 0;
        if (!t.extracted_knowledge) score = 1.0;
        else if (t.extracted_knowledge.confidence <= 0.5) score = 0.7;
        return { score, actual: JSON.stringify({ extracted_knowledge: t.extracted_knowledge ?? null }) };
      },
    },
    {
      id: "evolution-high-evidence-count",
      metric: "knowledge_extraction_accuracy",
      module: "evolution-planner",
      promptName: "MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT",
      expected: "多条一致证据时 evidence_count 应准确反映",
      systemPrompt: MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT,
      payload: {
        source_records: [
          mkEvoRec("evo-h1", "fact_preference", "user", "用户偏好：TypeScript strict。", 5, 0.95, "2026-04-01T08:00:00.000Z", "2026-04-01T08:00:00.000Z"),
          mkEvoRec("evo-h2", "fact_preference", "user", "用户偏好：no-any 规则。", 5, 0.94, "2026-04-05T08:00:00.000Z", "2026-04-05T08:00:00.000Z"),
          mkEvoRec("evo-h3", "fact_preference", "user", "用户偏好：开启所有 strict 检查。", 5, 0.93, "2026-04-10T08:00:00.000Z", "2026-04-10T08:00:00.000Z"),
          mkEvoRec("evo-h4", "fact_preference", "user", "用户偏好：类型检查不用 as any。", 4, 0.91, "2026-04-15T08:00:00.000Z", "2026-04-15T08:00:00.000Z"),
        ],
        time_window: { start: "2026-04-01T00:00:00.000Z", end: "2026-04-22T23:59:59.000Z" },
        evolution_type: "knowledge_extraction",
      },
      schema: memoryEvolutionPlanSchema,
      maxTokens: 1200,
      check: (output) => {
        const t = output as z.infer<typeof memoryEvolutionPlanSchema>;
        let score = 0;
        if (t.extracted_knowledge?.pattern) score += 0.4;
        if (t.extracted_knowledge && t.extracted_knowledge.evidence_count >= 3) score += 0.3;
        if (t.extracted_knowledge && t.extracted_knowledge.confidence >= 0.8) score += 0.3;
        return { score, actual: JSON.stringify({ evidence_count: t.extracted_knowledge?.evidence_count, confidence: t.extracted_knowledge?.confidence }) };
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// 11. governance_correctness_proxy (8 cases)
// ---------------------------------------------------------------------------

function buildGovernanceVerifyCases(): Array<EvalCase<unknown>> {
  return [
    {
      id: "govverify-reject-delete",
      metric: "governance_correctness_proxy",
      module: "governance-verifier",
      promptName: "MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT",
      expected: "缺少删除依据的删除提案应拒绝",
      systemPrompt: MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT,
      payload: {
        proposal: { proposal_id: "p-1", proposal_type: "delete", targets: { record_ids: ["gv-1"] }, suggested_changes: { status: "deleted", delete_mode: "soft" }, reason_code: "cleanup", reason_text: "看起来没用了，删掉。", evidence: { matched_records: 1 }, planner: { model: "gpt-5.3", confidence: 0.66 } },
        seed_records: [record("gv-1", "session", "episodic", "今天跑过一次真实模型评测。", 2, 0.82)],
        related_records: [],
        open_conflicts: [],
      },
      schema: memoryGovernanceVerificationSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryGovernanceVerificationSchema>;
        return { score: t.decision === "reject" ? 1.0 : 0.0, actual: JSON.stringify(t) };
      },
    },
    {
      id: "govverify-approve-archive",
      metric: "governance_correctness_proxy",
      module: "governance-verifier",
      promptName: "MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT",
      expected: "证据充分的归档提案应批准",
      systemPrompt: MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT,
      payload: {
        proposal: { proposal_id: "p-2", proposal_type: "archive", targets: { record_ids: ["gv-2"] }, suggested_changes: { status: "archived" }, reason_code: "superseded", reason_text: "该记录已被更新的同类偏好替代。", evidence: { matched_records: 2, replacement_record_ids: ["gv-3"] }, planner: { model: "gpt-5.3", confidence: 0.91 } },
        seed_records: [record("gv-2", "user", "fact_preference", "用户偏好：回答尽量简短。", 3, 0.84, { created_at: "2026-04-01T09:00:00.000Z", last_used_at: "2026-04-05T09:00:00.000Z" })],
        related_records: [record("gv-3", "user", "fact_preference", "用户偏好：默认中文，回答自然且尽量简短。", 5, 0.95, { created_at: "2026-04-20T09:00:00.000Z", last_used_at: "2026-04-22T09:00:00.000Z" })],
        open_conflicts: [],
      },
      schema: memoryGovernanceVerificationSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryGovernanceVerificationSchema>;
        return { score: t.decision === "approve" ? 1.0 : 0.0, actual: JSON.stringify(t) };
      },
    },
    {
      id: "govverify-reject-scope-mismatch",
      metric: "governance_correctness_proxy",
      module: "governance-verifier",
      promptName: "MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT",
      expected: "跨 scope 错误的合并提案应拒绝",
      systemPrompt: MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT,
      payload: {
        proposal: { proposal_id: "p-3", proposal_type: "merge", targets: { record_ids: ["gv-user-1", "gv-ws-1"] }, suggested_changes: { merged_summary: "合并后的记录" }, reason_code: "duplicate", reason_text: "两条内容相似。", evidence: { matched_records: 2 }, planner: { model: "gpt-5.3", confidence: 0.72 } },
        seed_records: [
          record("gv-user-1", "user", "fact_preference", "用户偏好：默认中文。", 5, 0.95),
          record("gv-ws-1", "workspace", "fact_preference", "项目规则：文档用中文写。", 4, 0.88),
        ],
        related_records: [],
        open_conflicts: [],
      },
      schema: memoryGovernanceVerificationSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryGovernanceVerificationSchema>;
        return { score: t.decision === "reject" ? 1.0 : 0.0, actual: JSON.stringify(t) };
      },
    },
    {
      id: "govverify-approve-merge-same-fact",
      metric: "governance_correctness_proxy",
      module: "governance-verifier",
      promptName: "MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT",
      expected: "同 scope 同事实的合并提案应批准",
      systemPrompt: MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT,
      payload: {
        proposal: { proposal_id: "p-4", proposal_type: "merge", targets: { record_ids: ["gv-m1", "gv-m2"] }, suggested_changes: { merged_summary: "用户偏好：默认中文回答，简短输出。" }, reason_code: "duplicate", reason_text: "两条描述同一偏好。", evidence: { matched_records: 2 }, planner: { model: "gpt-5.3", confidence: 0.92 } },
        seed_records: [
          record("gv-m1", "user", "fact_preference", "用户偏好：默认中文回答。", 5, 0.94),
          record("gv-m2", "user", "fact_preference", "用户偏好：回答简短。", 4, 0.90),
        ],
        related_records: [],
        open_conflicts: [],
      },
      schema: memoryGovernanceVerificationSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryGovernanceVerificationSchema>;
        return { score: t.decision === "approve" ? 1.0 : 0.0, actual: JSON.stringify(t) };
      },
    },
    {
      id: "govverify-reject-insufficient-conflict",
      metric: "governance_correctness_proxy",
      module: "governance-verifier",
      promptName: "MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT",
      expected: "证据不足的冲突解决提案应拒绝",
      systemPrompt: MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT,
      payload: {
        proposal: { proposal_id: "p-5", proposal_type: "resolve_conflict", targets: { record_ids: ["gv-c1"] }, suggested_changes: { resolution: "auto_merge" }, reason_code: "resolve", reason_text: "自动解决冲突。", evidence: { matched_records: 1 }, planner: { model: "gpt-5.3", confidence: 0.55 } },
        seed_records: [record("gv-c1", "workspace", "fact_preference", "测试框架用 Jest。", 3, 0.70)],
        related_records: [],
        open_conflicts: [{ id: "conflict-gv", record_id: "gv-c1", conflict_with_record_id: "gv-c2", conflict_type: "contradiction", conflict_summary: "测试框架选择矛盾", created_at: "2026-04-22T10:00:00.000Z" }],
      },
      schema: memoryGovernanceVerificationSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryGovernanceVerificationSchema>;
        return { score: t.decision === "reject" ? 1.0 : 0.0, actual: JSON.stringify(t) };
      },
    },
    {
      id: "govverify-approve-downgrade",
      metric: "governance_correctness_proxy",
      module: "governance-verifier",
      promptName: "MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT",
      expected: "合理的降级提案应批准",
      systemPrompt: MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT,
      payload: {
        proposal: { proposal_id: "p-6", proposal_type: "downgrade", targets: { record_ids: ["gv-d1"] }, suggested_changes: { new_importance: 1 }, reason_code: "inflated", reason_text: "低价值 session 记录被标为 importance=5，明显虚高。", evidence: { matched_records: 1 }, planner: { model: "gpt-5.3", confidence: 0.94 } },
        seed_records: [record("gv-d1", "session", "episodic", "用户打了个招呼。", 5, 0.45)],
        related_records: [],
        open_conflicts: [],
      },
      schema: memoryGovernanceVerificationSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryGovernanceVerificationSchema>;
        return { score: t.decision === "approve" ? 1.0 : 0.0, actual: JSON.stringify(t) };
      },
    },
    {
      id: "govverify-reject-no-replacement",
      metric: "governance_correctness_proxy",
      module: "governance-verifier",
      promptName: "MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT",
      expected: "无替代记录的归档提案应拒绝",
      systemPrompt: MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT,
      payload: {
        proposal: { proposal_id: "p-7", proposal_type: "archive", targets: { record_ids: ["gv-only"] }, suggested_changes: { status: "archived" }, reason_code: "low_value", reason_text: "价值不高。", evidence: { matched_records: 1 }, planner: { model: "gpt-5.3", confidence: 0.58 } },
        seed_records: [record("gv-only", "user", "fact_preference", "用户偏好：4 空格缩进。", 5, 0.95)],
        related_records: [],
        open_conflicts: [],
      },
      schema: memoryGovernanceVerificationSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryGovernanceVerificationSchema>;
        return { score: t.decision === "reject" ? 1.0 : 0.0, actual: JSON.stringify(t) };
      },
    },
    {
      id: "govverify-high-confidence-approve",
      metric: "governance_correctness_proxy",
      module: "governance-verifier",
      promptName: "MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT",
      expected: "高置信度且证据充分的提案应批准",
      systemPrompt: MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT,
      payload: {
        proposal: { proposal_id: "p-8", proposal_type: "delete", targets: { record_ids: ["gv-del"] }, suggested_changes: { status: "deleted", delete_mode: "soft" }, reason_code: "obsolete", reason_text: "monkey patch 已被正式修复替代，临时记录应删除。", evidence: { matched_records: 2, replacement_record_ids: ["gv-fix"] }, planner: { model: "gpt-5.3", confidence: 0.96 } },
        seed_records: [record("gv-del", "workspace", "episodic", "临时 monkey patch 已移除。", 1, 0.40)],
        related_records: [record("gv-fix", "workspace", "task_state", "bug 已正式修复并合入主分支。", 4, 0.95)],
        open_conflicts: [],
      },
      schema: memoryGovernanceVerificationSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryGovernanceVerificationSchema>;
        return { score: t.decision === "approve" ? 1.0 : 0.0, actual: JSON.stringify(t) };
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// 12. effectiveness_adjustment_direction_proxy (7 cases)
// ---------------------------------------------------------------------------

function buildEffectivenessCases(): Array<EvalCase<unknown>> {
  return [
    {
      id: "effectiveness-memory-used",
      metric: "effectiveness_adjustment_direction_proxy",
      module: "effectiveness-evaluator",
      promptName: "MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT",
      expected: "回复明显使用了注入记忆时应正向评估",
      systemPrompt: MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT,
      payload: {
        injected_memories: [{ record_id: "eff-1", summary: "用户偏好：默认中文，先给结论再补短点。", importance: 5 }],
        assistant_output: "结论：这些指标可以用真实模型测。后面按中文短句格式补到文档里。",
        user_feedback: { rating: 5, comment: "格式符合预期。" },
      },
      schema: memoryEffectivenessEvaluationResultSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryEffectivenessEvaluationResultSchema>;
        const ev = t.evaluations.find((e) => e.record_id === "eff-1");
        let score = 0;
        if (ev && ev.was_used) score += 0.5;
        if (ev && ev.suggested_importance_adjustment >= 0) score += 0.3;
        if (ev && ev.effectiveness_score >= 0.6) score += 0.2;
        return { score, actual: JSON.stringify(ev ?? null) };
      },
    },
    {
      id: "effectiveness-memory-ignored",
      metric: "effectiveness_adjustment_direction_proxy",
      module: "effectiveness-evaluator",
      promptName: "MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT",
      expected: "注入记忆未被使用时应负向调整",
      systemPrompt: MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT,
      payload: {
        injected_memories: [{ record_id: "eff-2", summary: "用户偏好：默认中文回答。", importance: 5 }],
        assistant_output: "The quicksort algorithm works by choosing a pivot element and partitioning the array into two sub-arrays.",
        user_feedback: null,
      },
      schema: memoryEffectivenessEvaluationResultSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryEffectivenessEvaluationResultSchema>;
        const ev = t.evaluations.find((e) => e.record_id === "eff-2");
        let score = 0;
        if (ev && !ev.was_used) score += 0.5;
        if (ev && ev.suggested_importance_adjustment <= 0) score += 0.3;
        if (ev && ev.effectiveness_score <= 0.3) score += 0.2;
        return { score, actual: JSON.stringify(ev ?? null) };
      },
    },
    {
      id: "effectiveness-partial-use",
      metric: "effectiveness_adjustment_direction_proxy",
      module: "effectiveness-evaluator",
      promptName: "MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT",
      expected: "部分使用时应中性评估",
      systemPrompt: MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT,
      payload: {
        injected_memories: [
          { record_id: "eff-3a", summary: "用户偏好：默认中文。", importance: 5 },
          { record_id: "eff-3b", summary: "迁移进度：第 3 步完成。", importance: 4 },
        ],
        assistant_output: "好的，用中文回答。关于你的问题，我来分析一下这个函数的逻辑。",
        user_feedback: null,
      },
      schema: memoryEffectivenessEvaluationResultSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryEffectivenessEvaluationResultSchema>;
        const usedA = t.evaluations.find((e) => e.record_id === "eff-3a");
        const usedB = t.evaluations.find((e) => e.record_id === "eff-3b");
        let score = 0;
        if (usedA && usedA.was_used) score += 0.3;
        if (usedB && !usedB.was_used) score += 0.3;
        if (usedA && usedA.suggested_importance_adjustment >= 0) score += 0.2;
        if (usedB && usedB.suggested_importance_adjustment <= 0) score += 0.2;
        return { score, actual: JSON.stringify(t.evaluations) };
      },
    },
    {
      id: "effectiveness-with-positive-feedback",
      metric: "effectiveness_adjustment_direction_proxy",
      module: "effectiveness-evaluator",
      promptName: "MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT",
      expected: "用户正向反馈时 effectiveness_score 应更高",
      systemPrompt: MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT,
      payload: {
        injected_memories: [{ record_id: "eff-4", summary: "项目规则：API 前缀 /api/v2。", importance: 5 }],
        assistant_output: "新路由已创建：`/api/v2/users`，按项目规范添加了前缀。",
        user_feedback: { rating: 5, comment: "完美，前缀正确。" },
      },
      schema: memoryEffectivenessEvaluationResultSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryEffectivenessEvaluationResultSchema>;
        const ev = t.evaluations.find((e) => e.record_id === "eff-4");
        let score = 0;
        if (ev && ev.was_used) score += 0.3;
        if (ev && ev.effectiveness_score >= 0.8) score += 0.4;
        if (ev && ev.suggested_importance_adjustment > 0) score += 0.3;
        return { score, actual: JSON.stringify(ev ?? null) };
      },
    },
    {
      id: "effectiveness-with-negative-feedback",
      metric: "effectiveness_adjustment_direction_proxy",
      module: "effectiveness-evaluator",
      promptName: "MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT",
      expected: "用户负向反馈应降低 effectiveness_score",
      systemPrompt: MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT,
      payload: {
        injected_memories: [{ record_id: "eff-5", summary: "用户偏好：使用 tab 缩进。", importance: 4 }],
        assistant_output: "已使用 tab 缩进编写代码。",
        user_feedback: { rating: 1, comment: "我早就改用空格了，这个记忆过期了。" },
      },
      schema: memoryEffectivenessEvaluationResultSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryEffectivenessEvaluationResultSchema>;
        const ev = t.evaluations.find((e) => e.record_id === "eff-5");
        let score = 0;
        if (ev && ev.suggested_importance_adjustment < 0) score += 0.5;
        if (ev && ev.effectiveness_score <= 0.4) score += 0.3;
        if (ev) score += 0.2;
        return { score, actual: JSON.stringify(ev ?? null) };
      },
    },
    {
      id: "effectiveness-no-memories",
      metric: "effectiveness_adjustment_direction_proxy",
      module: "effectiveness-evaluator",
      promptName: "MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT",
      expected: "无注入记忆时应返回空评估",
      systemPrompt: MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT,
      payload: {
        injected_memories: [],
        assistant_output: "这是一个普通的回复。",
        user_feedback: null,
      },
      schema: memoryEffectivenessEvaluationResultSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryEffectivenessEvaluationResultSchema>;
        return { score: t.evaluations.length === 0 ? 1.0 : 0.0, actual: JSON.stringify({ count: t.evaluations.length }) };
      },
    },
    {
      id: "effectiveness-usage-evidence",
      metric: "effectiveness_adjustment_direction_proxy",
      module: "effectiveness-evaluator",
      promptName: "MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT",
      expected: "明确使用时应提供 usage_evidence",
      systemPrompt: MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT,
      payload: {
        injected_memories: [{ record_id: "eff-7", summary: "迁移到第 3 步，下一步创建索引。", importance: 4 }],
        assistant_output: "继续执行第 4 步：创建索引。根据之前的进度，第 3 步已完成。",
        user_feedback: { rating: 4, comment: "进度正确。" },
      },
      schema: memoryEffectivenessEvaluationResultSchema,
      maxTokens: 1000,
      check: (output) => {
        const t = output as z.infer<typeof memoryEffectivenessEvaluationResultSchema>;
        const ev = t.evaluations.find((e) => e.record_id === "eff-7");
        let score = 0;
        if (ev && ev.was_used) score += 0.4;
        if (ev && ev.usage_evidence && ev.usage_evidence.length > 5) score += 0.3;
        if (ev && ev.suggested_importance_adjustment >= 0) score += 0.3;
        return { score, actual: JSON.stringify(ev ?? null) };
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildEvalCases(): Array<EvalCase<unknown>> {
  return [
    ...buildIntentCases(),
    ...buildSearchCases(),
    ...buildInjectionCases(),
    ...buildWritebackExtractionCases(),
    ...buildWritebackRefineCases(),
    ...buildGovernancePlanCases(),
    ...buildQualityCases(),
    ...buildRelationCases(),
    ...buildRecommendationCases(),
    ...buildEvolutionCases(),
    ...buildGovernanceVerifyCases(),
    ...buildEffectivenessCases(),
  ];
}
