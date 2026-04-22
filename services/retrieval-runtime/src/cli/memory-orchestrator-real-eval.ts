import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import { callMemoryLlm, parseMemoryLlmJsonPayload } from "../memory-orchestrator/llm-client.js";
import {
  MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT,
  MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT,
  MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT,
  MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT,
  MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT,
  MEMORY_RECALL_INJECTION_SYSTEM_PROMPT,
  MEMORY_RECALL_SEARCH_SYSTEM_PROMPT,
  MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT,
  MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT,
} from "../memory-orchestrator/prompts.js";
import {
  memoryEffectivenessEvaluationResultSchema,
  memoryEvolutionPlanSchema,
  memoryGovernanceVerificationSchema,
  memoryIntentAnalyzerSchema,
  memoryProactiveRecommendationSchema,
  memoryQualityAssessmentResultSchema,
  memoryRecallInjectionSchema,
  memoryRecallSearchSchema,
  memoryRelationDiscoverySchema,
} from "../memory-orchestrator/schemas.js";

const DEFAULT_MODEL = "gpt-5.3-codex-spark";
const DEFAULT_OUTPUT_BASE = path.resolve("docs", "memory-orchestrator-real-llm-eval");
const DEFAULT_MANAGED_CONFIG_PATH = path.join(os.homedir(), ".continuum", "managed", "mna", "config.json");

type Protocol = "anthropic" | "openai-compatible";

type CliArgs = {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  protocol?: Protocol;
  timeoutMs?: number;
  outputBase?: string;
  configPath?: string;
};

type EvalCase<T> = {
  id: string;
  metric: string;
  module: string;
  promptName: string;
  expected: string;
  systemPrompt: string;
  payload: unknown;
  schema: z.ZodType<T>;
  maxTokens: number;
  check: (output: T) => { pass: boolean; actual: string };
};

export type EvalCaseResult = {
  id: string;
  metric: string;
  module: string;
  promptName: string;
  expected: string;
  pass: boolean;
  actual: string;
  durationMs: number;
  systemPrompt: string;
  payload: unknown;
  rawOutput?: string;
  parsedOutput?: unknown;
  error?: string;
};

export type MetricSummary = {
  metric: string;
  passed: number;
  total: number;
  rate: number;
};

type ManagedConfig = {
  provider?: {
    kind?: string;
    base_url?: string;
    api_key?: string;
    model?: string;
  };
};

function parseInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--")) {
      continue;
    }

    switch (key) {
      case "--base-url":
        args.baseUrl = value;
        index += 1;
        break;
      case "--api-key":
        args.apiKey = value;
        index += 1;
        break;
      case "--model":
        args.model = value;
        index += 1;
        break;
      case "--protocol":
        args.protocol = value === "anthropic" ? "anthropic" : "openai-compatible";
        index += 1;
        break;
      case "--timeout-ms":
        args.timeoutMs = parseInteger(value);
        index += 1;
        break;
      case "--output-base":
        args.outputBase = value;
        index += 1;
        break;
      case "--config-path":
        args.configPath = value;
        index += 1;
        break;
      default:
        break;
    }
  }

  return args;
}

async function loadManagedConfig(configPath: string): Promise<ManagedConfig> {
  const text = await readFile(configPath, "utf8");
  return JSON.parse(text) as ManagedConfig;
}

function buildCases(): Array<EvalCase<unknown>> {
  return [
    {
      id: "intent-continue-task",
      metric: "intent_accuracy",
      module: "intent-analyzer",
      promptName: "MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT",
      expected: "应判断需要记忆，并识别 `task_state`（任务状态）或 `fact_preference`（偏好）",
      systemPrompt: MEMORY_INTENT_ANALYZER_SYSTEM_PROMPT,
      payload: {
        current_input: "继续昨天那个 memory orchestrator 验收，把测试样本文档补完整，格式还是按之前那版。",
        session_context: {
          session_id: "eval-session-intent-1",
          workspace_id: "eval-workspace",
          recent_turns: [
            {
              user_input: "先把 memory orchestrator 的验收文档写出来，默认中文，先给一句结论再补几个短点。",
              assistant_output: "已创建测试样本文档，后面再补真实指标。",
            },
          ],
        },
      },
      schema: memoryIntentAnalyzerSchema,
      maxTokens: 800,
      check: (output) => {
        const typed = output as z.infer<typeof memoryIntentAnalyzerSchema>;
        const hitScope = (typed.suggested_scopes ?? []).some((scope) => scope === "task" || scope === "user");
        const hitType = typed.memory_types.includes("task_state") || typed.memory_types.includes("fact_preference");
        return {
          pass: typed.needs_memory && hitScope && hitType,
          actual: JSON.stringify({
            needs_memory: typed.needs_memory,
            urgency: typed.urgency,
            memory_types: typed.memory_types,
            suggested_scopes: typed.suggested_scopes ?? [],
          }),
        };
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
        session_context: {
          session_id: "eval-session-intent-2",
          workspace_id: "eval-workspace",
          recent_turns: [],
        },
      },
      schema: memoryIntentAnalyzerSchema,
      maxTokens: 800,
      check: (output) => {
        const typed = output as z.infer<typeof memoryIntentAnalyzerSchema>;
        return {
          pass: typed.needs_memory === false,
          actual: JSON.stringify({ needs_memory: typed.needs_memory, reason: typed.reason }),
        };
      },
    },
    {
      id: "search-continue-task",
      metric: "recall_accuracy_proxy",
      module: "recall-search-planner",
      promptName: "MEMORY_RECALL_SEARCH_SYSTEM_PROMPT",
      expected: "应触发检索，并给出可用的查询提示",
      systemPrompt: MEMORY_RECALL_SEARCH_SYSTEM_PROMPT,
      payload: {
        current_input: "继续刚才那份 memory orchestrator 测试报告，把真实模型的实际指标补上。",
        recent_context_summary: "本会话前文已经讨论过测试样本文档、真实模型验证和验收指标。",
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
        const typed = output as z.infer<typeof memoryRecallSearchSchema>;
        return {
          pass: typed.should_search && Boolean(typed.query_hint),
          actual: JSON.stringify({
            should_search: typed.should_search,
            query_hint: typed.query_hint ?? "",
            requested_scopes: typed.requested_scopes ?? [],
          }),
        };
      },
    },
    {
      id: "inject-relevant-memory",
      metric: "recall_accuracy_proxy",
      module: "recall-injection-planner",
      promptName: "MEMORY_RECALL_INJECTION_SYSTEM_PROMPT",
      expected: "应选择与当前任务连续性最相关的记忆",
      systemPrompt: MEMORY_RECALL_INJECTION_SYSTEM_PROMPT,
      payload: {
        current_input: "继续把测试样本文档写完，按之前的短句中文风格来。",
        recent_context_summary: "用户正在完善 memory orchestrator 测试与验收文档。",
        phase: "before_response",
        memory_mode: "workspace_plus_global",
        requested_scopes: ["workspace", "user", "task"],
        requested_memory_types: ["fact_preference", "task_state"],
        search_reason: "用户显式要求延续之前风格和任务状态",
        candidates: [
          {
            id: "mem-style-1",
            scope: "user",
            memory_type: "fact_preference",
            summary: "用户偏好：默认中文，先给一句结论，再补最多 3 个短点。",
            importance: 5,
            confidence: 0.96,
            rerank_score: 0.91,
            semantic_score: 0.88,
            updated_at: "2026-04-22T10:00:00.000Z",
          },
          {
            id: "mem-task-1",
            scope: "task",
            memory_type: "task_state",
            summary: "当前任务：正在补 memory orchestrator 测试样本文档的实际指标。",
            importance: 4,
            confidence: 0.93,
            rerank_score: 0.89,
            semantic_score: 0.86,
            updated_at: "2026-04-22T10:05:00.000Z",
          },
          {
            id: "mem-noise-1",
            scope: "workspace",
            memory_type: "episodic",
            summary: "上周修过一个和代理无关的 CSS 样式问题。",
            importance: 2,
            confidence: 0.51,
            rerank_score: 0.22,
            semantic_score: 0.19,
            updated_at: "2026-04-10T09:00:00.000Z",
          },
        ],
        semantic_score: 0.61,
        semantic_threshold: 0.72,
        task_id_present: true,
      },
      schema: memoryRecallInjectionSchema,
      maxTokens: 1000,
      check: (output) => {
        const typed = output as z.infer<typeof memoryRecallInjectionSchema>;
        const selected = typed.selected_record_ids ?? [];
        return {
          pass: typed.should_inject && (selected.includes("mem-style-1") || selected.includes("mem-task-1")),
          actual: JSON.stringify({
            should_inject: typed.should_inject,
            selected_record_ids: selected,
            memory_summary: typed.memory_summary ?? "",
          }),
        };
      },
    },
    {
      id: "inject-irrelevant-memory-skip",
      metric: "recall_accuracy_proxy",
      module: "recall-injection-planner",
      promptName: "MEMORY_RECALL_INJECTION_SYSTEM_PROMPT",
      expected: "当候选记忆与当前问题无关时，应跳过注入",
      systemPrompt: MEMORY_RECALL_INJECTION_SYSTEM_PROMPT,
      payload: {
        current_input: "解释一下 HTTP 204 和 304 的区别，用最短的话说清楚。",
        recent_context_summary: "当前是一次独立的协议知识问答。",
        phase: "before_response",
        memory_mode: "workspace_plus_global",
        requested_scopes: ["workspace", "user", "task"],
        requested_memory_types: ["fact_preference", "task_state", "episodic"],
        search_reason: "语义检索有弱命中，但未确认是否适合注入。",
        candidates: [
          {
            id: "mem-style-2",
            scope: "user",
            memory_type: "fact_preference",
            summary: "用户偏好：默认中文，先给一句结论，再补 3 个短点。",
            importance: 5,
            confidence: 0.95,
            rerank_score: 0.31,
            semantic_score: 0.28,
            updated_at: "2026-04-22T10:00:00.000Z",
          },
          {
            id: "mem-task-old-2",
            scope: "task",
            memory_type: "task_state",
            summary: "当前任务：补 memory orchestrator 测试样本文档。",
            importance: 4,
            confidence: 0.92,
            rerank_score: 0.18,
            semantic_score: 0.16,
            updated_at: "2026-04-22T10:05:00.000Z",
          },
        ],
        semantic_score: 0.41,
        semantic_threshold: 0.72,
        task_id_present: false,
      },
      schema: memoryRecallInjectionSchema,
      maxTokens: 1000,
      check: (output) => {
        const typed = output as z.infer<typeof memoryRecallInjectionSchema>;
        return {
          pass: typed.should_inject === false,
          actual: JSON.stringify({
            should_inject: typed.should_inject,
            selected_record_ids: typed.selected_record_ids ?? [],
            memory_summary: typed.memory_summary ?? "",
          }),
        };
      },
    },
    {
      id: "quality-low-signal",
      metric: "low_quality_intercept_rate",
      module: "writeback-quality-assessor",
      promptName: "MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT",
      expected: "应识别低信号候选，并给出低质量或待确认判断",
      systemPrompt: MEMORY_WRITEBACK_QUALITY_ASSESSOR_SYSTEM_PROMPT,
      payload: {
        writeback_candidates: [
          {
            id: "cand-low-1",
            candidate_type: "episodic",
            scope: "session",
            summary: "好的，我来处理。",
            importance: 3,
            confidence: 0.72,
            write_reason: "assistant acknowledged the request",
          },
          {
            id: "cand-good-1",
            candidate_type: "fact_preference",
            scope: "user",
            summary: "用户偏好：写说明时先给一句结论，再补 3 个短点。",
            importance: 5,
            confidence: 0.94,
            write_reason: "stable formatting preference",
          },
        ],
        existing_similar_records: [
          {
            id: "rec-good-1",
            scope: "user",
            memory_type: "fact_preference",
            status: "active",
            summary: "用户偏好：默认中文回答。",
            importance: 5,
            confidence: 0.9,
          },
        ],
        turn_context: {
          user_input: "以后这种说明文档先给结论，再补几个短点。",
          assistant_output: "好的，我来处理。后续我会按这个格式写。",
        },
      },
      schema: memoryQualityAssessmentResultSchema,
      maxTokens: 1000,
      check: (output) => {
        const typed = output as z.infer<typeof memoryQualityAssessmentResultSchema>;
        const low = typed.assessments.find((item) => item.candidate_id === "cand-low-1");
        const flagged =
          low !== undefined &&
          (low.quality_score <= 0.45 ||
            low.issues.some((issue) => issue.type === "low_quality" || issue.type === "vague"));
        return {
          pass: flagged,
          actual: JSON.stringify(low ?? null),
        };
      },
    },
    {
      id: "relation-task-state",
      metric: "relation_discovery_accuracy",
      module: "relation-discoverer",
      promptName: "MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT",
      expected: "应发现同一任务上下文里的扩展或相关关系",
      systemPrompt: MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT,
      payload: {
        source_record: {
          id: "rec-source-1",
          memory_type: "task_state",
          scope: "task",
          summary: "当前任务：补齐 memory orchestrator 验收文档的真实指标。",
          importance: 4,
          confidence: 0.91,
        },
        candidate_records: [
          {
            id: "rec-related-1",
            memory_type: "task_state",
            scope: "task",
            summary: "当前任务下一步：补充真实模型评测提示词和输出结果。",
            importance: 4,
            confidence: 0.9,
          },
          {
            id: "rec-unrelated-1",
            memory_type: "episodic",
            scope: "workspace",
            summary: "昨天修过一个日志滚动配置。",
            importance: 2,
            confidence: 0.62,
          },
        ],
        context: {
          workspace_id: "eval-workspace",
          user_id: "eval-user",
        },
      },
      schema: memoryRelationDiscoverySchema,
      maxTokens: 1000,
      check: (output) => {
        const typed = output as z.infer<typeof memoryRelationDiscoverySchema>;
        const hit = typed.relations.some((relation) => relation.target_record_id === "rec-related-1");
        return {
          pass: hit,
          actual: JSON.stringify(typed.relations),
        };
      },
    },
    {
      id: "relation-no-clear-link",
      metric: "relation_discovery_accuracy",
      module: "relation-discoverer",
      promptName: "MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT",
      expected: "当候选记录没有明确语义关联时，不应强行输出关系",
      systemPrompt: MEMORY_RELATION_DISCOVERER_SYSTEM_PROMPT,
      payload: {
        source_record: {
          id: "rec-source-2",
          memory_type: "fact_preference",
          scope: "user",
          summary: "用户偏好：默认中文回答。",
          importance: 5,
          confidence: 0.95,
        },
        candidate_records: [
          {
            id: "rec-unrelated-2",
            memory_type: "episodic",
            scope: "workspace",
            summary: "上周处理过一个 nginx 日志切割问题。",
            importance: 2,
            confidence: 0.58,
          },
          {
            id: "rec-unrelated-3",
            memory_type: "task_state",
            scope: "task",
            summary: "当前任务：补一份前端配色稿。",
            importance: 3,
            confidence: 0.72,
          },
        ],
        context: {
          workspace_id: "eval-workspace",
          user_id: "eval-user",
        },
      },
      schema: memoryRelationDiscoverySchema,
      maxTokens: 1000,
      check: (output) => {
        const typed = output as z.infer<typeof memoryRelationDiscoverySchema>;
        return {
          pass: typed.relations.length === 0,
          actual: JSON.stringify(typed.relations),
        };
      },
    },
    {
      id: "recommend-task-memory",
      metric: "recommendation_acceptance_proxy",
      module: "proactive-recommender",
      promptName: "MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT",
      expected: "应推荐与当前任务连续性相关、宿主大概率会采纳的高价值记忆",
      systemPrompt: MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT,
      payload: {
        current_context: {
          user_input: "继续完善验收文档，保持之前的写法。",
          session_context: {
            session_id: "eval-session-recommend-1",
            workspace_id: "eval-workspace",
            user_id: "eval-user",
            recent_context_summary: "本会话一直在完善 memory orchestrator 的测试与验收材料。",
          },
          detected_task_type: "documentation",
        },
        available_memories: [
          {
            id: "mem-rec-1",
            memory_type: "task_state",
            scope: "task",
            status: "active",
            summary: "当前任务：完善 memory orchestrator 测试样本文档。",
            importance: 5,
            confidence: 0.95,
          },
          {
            id: "mem-rec-2",
            memory_type: "fact_preference",
            scope: "user",
            status: "active",
            summary: "用户偏好：默认中文，短句输出。",
            importance: 5,
            confidence: 0.94,
          },
          {
            id: "mem-rec-3",
            memory_type: "episodic",
            scope: "workspace",
            status: "archived",
            summary: "三个月前讨论过图标颜色。",
            importance: 1,
            confidence: 0.4,
          },
        ],
      },
      schema: memoryProactiveRecommendationSchema,
      maxTokens: 1000,
      check: (output) => {
        const typed = output as z.infer<typeof memoryProactiveRecommendationSchema>;
        const hit = typed.recommendations.some(
          (item) =>
            (item.record_id === "mem-rec-1" || item.record_id === "mem-rec-2")
            && item.relevance_score >= 0.7,
        );
        return {
          pass: hit,
          actual: JSON.stringify(typed.recommendations),
        };
      },
    },
    {
      id: "recommend-noisy-memory-skip",
      metric: "recommendation_acceptance_proxy",
      module: "proactive-recommender",
      promptName: "MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT",
      expected: "当上下文没有明确连续性时，不应推荐低价值或过期记忆",
      systemPrompt: MEMORY_PROACTIVE_RECOMMENDER_SYSTEM_PROMPT,
      payload: {
        current_context: {
          user_input: "解释一下 TCP 三次握手，给一个最短版本。",
          session_context: {
            session_id: "eval-session-recommend-2",
            workspace_id: "eval-workspace",
            user_id: "eval-user",
            recent_context_summary: "这是一个新的网络基础知识问题。",
          },
          detected_task_type: "qa",
        },
        available_memories: [
          {
            id: "mem-rec-noise-1",
            memory_type: "episodic",
            scope: "workspace",
            status: "active",
            summary: "两个月前讨论过 memory orchestrator 的验收文档。",
            importance: 2,
            confidence: 0.62,
          },
          {
            id: "mem-rec-noise-2",
            memory_type: "task_state",
            scope: "task",
            status: "archived",
            summary: "上一个任务：整理前端视觉稿。",
            importance: 1,
            confidence: 0.45,
          },
        ],
      },
      schema: memoryProactiveRecommendationSchema,
      maxTokens: 1000,
      check: (output) => {
        const typed = output as z.infer<typeof memoryProactiveRecommendationSchema>;
        return {
          pass: typed.recommendations.length === 0,
          actual: JSON.stringify(typed.recommendations),
        };
      },
    },
    {
      id: "evolution-knowledge-extraction",
      metric: "knowledge_extraction_accuracy",
      module: "evolution-planner",
      promptName: "MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT",
      expected: "应从多条相关记录提炼出稳定模式",
      systemPrompt: MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT,
      payload: {
        source_records: [
          {
            id: "evo-1",
            memory_type: "fact_preference",
            scope: "user",
            summary: "用户偏好：默认中文回答。",
            importance: 5,
            confidence: 0.96,
            created_at: "2026-04-20T08:00:00.000Z",
            updated_at: "2026-04-20T08:00:00.000Z",
          },
          {
            id: "evo-2",
            memory_type: "fact_preference",
            scope: "user",
            summary: "用户偏好：说明文档先给结论，再补几个短点。",
            importance: 5,
            confidence: 0.94,
            created_at: "2026-04-21T08:00:00.000Z",
            updated_at: "2026-04-21T08:00:00.000Z",
          },
          {
            id: "evo-3",
            memory_type: "fact_preference",
            scope: "user",
            summary: "用户偏好：不要写太长，尽量自然中文。",
            importance: 4,
            confidence: 0.92,
            created_at: "2026-04-22T08:00:00.000Z",
            updated_at: "2026-04-22T08:00:00.000Z",
          },
        ],
        time_window: {
          start: "2026-04-20T00:00:00.000Z",
          end: "2026-04-22T23:59:59.000Z",
        },
        evolution_type: "knowledge_extraction",
      },
      schema: memoryEvolutionPlanSchema,
      maxTokens: 1200,
      check: (output) => {
        const typed = output as z.infer<typeof memoryEvolutionPlanSchema>;
        const pass = typed.evolution_type === "knowledge_extraction" && Boolean(typed.extracted_knowledge?.pattern);
        return {
          pass,
          actual: JSON.stringify({
            evolution_type: typed.evolution_type,
            extracted_knowledge: typed.extracted_knowledge ?? null,
          }),
        };
      },
    },
    {
      id: "evolution-pattern-knowledge-extraction",
      metric: "knowledge_extraction_accuracy",
      module: "evolution-planner",
      promptName: "MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT",
      expected: "应从多条任务状态中提炼出稳定的长期工作模式",
      systemPrompt: MEMORY_EVOLUTION_PLAN_SYSTEM_PROMPT,
      payload: {
        source_records: [
          {
            id: "evo-task-1",
            memory_type: "task_state",
            scope: "workspace",
            summary: "最近 3 次验收任务都先补测试样本，再补实际指标。",
            importance: 4,
            confidence: 0.9,
            created_at: "2026-04-01T08:00:00.000Z",
            updated_at: "2026-04-18T08:00:00.000Z",
          },
          {
            id: "evo-task-2",
            memory_type: "task_state",
            scope: "workspace",
            summary: "最近 2 次真实模型评测都先做链路验证，再回写指标文档。",
            importance: 4,
            confidence: 0.89,
            created_at: "2026-04-10T08:00:00.000Z",
            updated_at: "2026-04-20T08:00:00.000Z",
          },
          {
            id: "evo-task-3",
            memory_type: "task_state",
            scope: "workspace",
            summary: "当前团队验收习惯：先通链路，再补统计数。",
            importance: 4,
            confidence: 0.87,
            created_at: "2026-04-15T08:00:00.000Z",
            updated_at: "2026-04-22T08:00:00.000Z",
          },
        ],
        time_window: {
          start: "2026-04-01T00:00:00.000Z",
          end: "2026-04-22T23:59:59.000Z",
        },
        evolution_type: "knowledge_extraction",
      },
      schema: memoryEvolutionPlanSchema,
      maxTokens: 1200,
      check: (output) => {
        const typed = output as z.infer<typeof memoryEvolutionPlanSchema>;
        const pattern = typed.extracted_knowledge?.pattern ?? "";
        const pass =
          typed.evolution_type === "knowledge_extraction"
          && typed.source_records.length >= 2
          && (pattern.includes("先") || pattern.includes("链路") || pattern.includes("验收"));
        return {
          pass,
          actual: JSON.stringify({
            evolution_type: typed.evolution_type,
            source_records: typed.source_records,
            extracted_knowledge: typed.extracted_knowledge ?? null,
          }),
        };
      },
    },
    {
      id: "governance-verify-reject-delete",
      metric: "governance_correctness_proxy",
      module: "governance-verifier",
      promptName: "MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT",
      expected: "对于缺少删除依据的删除提案，应拒绝执行",
      systemPrompt: MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT,
      payload: {
        proposal: {
          proposal_id: "proposal-1",
          proposal_type: "delete",
          targets: {
            record_ids: ["gov-1"],
          },
          suggested_changes: {
            status: "deleted",
            delete_mode: "soft",
          },
          reason_code: "cleanup",
          reason_text: "看起来没用了，删掉。",
          evidence: {
            matched_records: 1,
          },
          planner: {
            model: DEFAULT_MODEL,
            confidence: 0.66,
          },
        },
        seed_records: [
          {
            id: "gov-1",
            workspace_id: "eval-workspace",
            user_id: "eval-user",
            task_id: null,
            session_id: null,
            memory_type: "episodic",
            scope: "session",
            status: "active",
            summary: "今天跑过一次真实模型评测。",
            details: null,
            importance: 2,
            confidence: 0.82,
            created_at: "2026-04-22T09:00:00.000Z",
            updated_at: "2026-04-22T09:00:00.000Z",
            last_used_at: null,
          },
        ],
        related_records: [],
        open_conflicts: [],
      },
      schema: memoryGovernanceVerificationSchema,
      maxTokens: 1000,
      check: (output) => {
        const typed = output as z.infer<typeof memoryGovernanceVerificationSchema>;
        return {
          pass: typed.decision === "reject",
          actual: JSON.stringify(typed),
        };
      },
    },
    {
      id: "governance-verify-approve-archive",
      metric: "governance_correctness_proxy",
      module: "governance-verifier",
      promptName: "MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT",
      expected: "对于证据充分、目标明确的归档提案，应允许通过",
      systemPrompt: MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT,
      payload: {
        proposal: {
          proposal_id: "proposal-2",
          proposal_type: "archive",
          targets: {
            record_ids: ["gov-2"],
          },
          suggested_changes: {
            status: "archived",
          },
          reason_code: "superseded",
          reason_text: "该记录已被更新的同类偏好替代，保留会造成重复召回。",
          evidence: {
            matched_records: 2,
            replacement_record_ids: ["gov-3"],
          },
          planner: {
            model: DEFAULT_MODEL,
            confidence: 0.91,
          },
        },
        seed_records: [
          {
            id: "gov-2",
            workspace_id: "eval-workspace",
            user_id: "eval-user",
            task_id: null,
            session_id: null,
            memory_type: "fact_preference",
            scope: "user",
            status: "active",
            summary: "用户偏好：回答尽量简短。",
            details: null,
            importance: 3,
            confidence: 0.84,
            created_at: "2026-04-01T09:00:00.000Z",
            updated_at: "2026-04-01T09:00:00.000Z",
            last_used_at: "2026-04-05T09:00:00.000Z",
          },
        ],
        related_records: [
          {
            id: "gov-3",
            workspace_id: "eval-workspace",
            user_id: "eval-user",
            task_id: null,
            session_id: null,
            memory_type: "fact_preference",
            scope: "user",
            status: "active",
            summary: "用户偏好：默认中文，回答自然且尽量简短。",
            details: null,
            importance: 5,
            confidence: 0.95,
            created_at: "2026-04-20T09:00:00.000Z",
            updated_at: "2026-04-20T09:00:00.000Z",
            last_used_at: "2026-04-22T09:00:00.000Z",
          },
        ],
        open_conflicts: [],
      },
      schema: memoryGovernanceVerificationSchema,
      maxTokens: 1000,
      check: (output) => {
        const typed = output as z.infer<typeof memoryGovernanceVerificationSchema>;
        return {
          pass: typed.decision === "approve",
          actual: JSON.stringify(typed),
        };
      },
    },
    {
      id: "effectiveness-memory-used",
      metric: "effectiveness_adjustment_direction_proxy",
      module: "effectiveness-evaluator",
      promptName: "MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT",
      expected: "当回复明显使用了注入记忆时，应给出正向使用判断",
      systemPrompt: MEMORY_RECALL_EFFECTIVENESS_SYSTEM_PROMPT,
      payload: {
        injected_memories: [
          {
            record_id: "eff-1",
            summary: "用户偏好：默认中文，先给一句结论，再补 3 个短点。",
            importance: 5,
          },
        ],
        assistant_output: "结论：这些指标可以用真实模型测。后面我会按中文短句格式，把测试提示词、预期指标和实际指标一起补到文档里。",
        user_feedback: {
          rating: 5,
          comment: "格式符合预期。",
        },
      },
      schema: memoryEffectivenessEvaluationResultSchema,
      maxTokens: 1000,
      check: (output) => {
        const typed = output as z.infer<typeof memoryEffectivenessEvaluationResultSchema>;
        const first = typed.evaluations[0];
        const pass =
          first !== undefined &&
          first.was_used &&
          first.suggested_importance_adjustment >= 0;
        return {
          pass,
          actual: JSON.stringify(first ?? null),
        };
      },
    },
  ];
}

async function runCase(
  config: {
    MEMORY_LLM_BASE_URL: string;
    MEMORY_LLM_MODEL: string;
    MEMORY_LLM_API_KEY?: string;
    MEMORY_LLM_PROTOCOL: Protocol;
    MEMORY_LLM_TIMEOUT_MS: number;
    MEMORY_LLM_EFFORT: "low" | "medium" | "high" | "xhigh" | "max";
  },
  evalCase: EvalCase<unknown>,
): Promise<EvalCaseResult> {
  const startedAt = Date.now();

  try {
    const rawOutput = await callMemoryLlm(
      config,
      evalCase.systemPrompt,
      evalCase.payload,
      evalCase.maxTokens,
    );
    const parsed = evalCase.schema.parse(parseMemoryLlmJsonPayload(rawOutput));
    const checked = evalCase.check(parsed);

    return {
      id: evalCase.id,
      metric: evalCase.metric,
      module: evalCase.module,
      promptName: evalCase.promptName,
      expected: evalCase.expected,
      pass: checked.pass,
      actual: checked.actual,
      durationMs: Date.now() - startedAt,
      systemPrompt: evalCase.systemPrompt,
      payload: evalCase.payload,
      rawOutput,
      parsedOutput: parsed,
    };
  } catch (error) {
    return {
      id: evalCase.id,
      metric: evalCase.metric,
      module: evalCase.module,
      promptName: evalCase.promptName,
      expected: evalCase.expected,
      pass: false,
      actual: "执行失败",
      durationMs: Date.now() - startedAt,
      systemPrompt: evalCase.systemPrompt,
      payload: evalCase.payload,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function summarizeResults(results: EvalCaseResult[]): MetricSummary[] {
  const grouped = new Map<string, { passed: number; total: number }>();

  for (const result of results) {
    const current = grouped.get(result.metric) ?? { passed: 0, total: 0 };
    current.total += 1;
    if (result.pass) {
      current.passed += 1;
    }
    grouped.set(result.metric, current);
  }

  return Array.from(grouped.entries()).map(([metric, value]) => ({
    metric,
    passed: value.passed,
    total: value.total,
    rate: value.total === 0 ? 0 : Number((value.passed / value.total).toFixed(4)),
  }));
}

function buildMarkdownReport(
  config: {
    baseUrl: string;
    model: string;
    protocol: Protocol;
    timeoutMs: number;
  },
  results: EvalCaseResult[],
  summary: MetricSummary[],
): string {
  const lines: string[] = [];
  lines.push("# Memory Orchestrator 真实模型离线评测");
  lines.push("");
  lines.push(`- 评测时间：${new Date().toISOString()}`);
  lines.push(`- 模型：\`${config.model}\``);
  lines.push(`- 协议：\`${config.protocol}\``);
  lines.push(`- 端点：\`${config.baseUrl}\``);
  lines.push(`- 超时：\`${config.timeoutMs}\`（毫秒）`);
  lines.push("");
  lines.push("## 指标汇总");
  lines.push("");
  lines.push("| 指标 | 通过数 | 总数 | 实际指标 |");
  lines.push("|---|---:|---:|---:|");
  for (const item of summary) {
    lines.push(`| ${item.metric} | ${item.passed} | ${item.total} | ${(item.rate * 100).toFixed(1)}% |`);
  }
  lines.push("");
  lines.push("## 样本明细");
  lines.push("");

  for (const result of results) {
    lines.push(`### ${result.id}`);
    lines.push("");
    lines.push(`- 模块：\`${result.module}\``);
    lines.push(`- 指标：\`${result.metric}\``);
    lines.push(`- Prompt：\`${result.promptName}\``);
    lines.push(`- 预期：${result.expected}`);
    lines.push(`- 实际：${result.actual}`);
    lines.push(`- 结果：${result.pass ? "通过" : "未通过"}`);
    lines.push(`- 耗时：${result.durationMs}ms`);
    if (result.error) {
      lines.push(`- 错误：\`${result.error}\``);
    }
    lines.push("");
    lines.push("#### 测试提示词");
    lines.push("");
    lines.push("```text");
    lines.push(result.systemPrompt);
    lines.push("```");
    lines.push("");
    lines.push("#### 测试输入");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(result.payload, null, 2));
    lines.push("```");
    lines.push("");
    if (result.rawOutput) {
      lines.push("#### 模型原始输出");
      lines.push("");
      lines.push("```json");
      lines.push(result.rawOutput);
      lines.push("```");
      lines.push("");
    }
    if (result.parsedOutput) {
      lines.push("#### 结构化结果");
      lines.push("");
      lines.push("```json");
      lines.push(JSON.stringify(result.parsedOutput, null, 2));
      lines.push("```");
      lines.push("");
    }
  }

  lines.push("## 说明");
  lines.push("");
  lines.push("- 这份报告是离线代理评测，只验证真实模型在当前 prompt 和 schema 下的结构化决策质量。");
  lines.push("- 推荐采纳率、用户满意度、优先级调整后的长期命中率，仍然需要真实线上埋点或人工采样。");
  lines.push("");

  return lines.join("\n");
}

export async function runRealEval(argv: string[]): Promise<{
  results: EvalCaseResult[];
  summary: MetricSummary[];
  markdownPath: string;
  jsonPath: string;
}> {
  const args = parseCliArgs(argv);
  const managedConfig = await loadManagedConfig(args.configPath ?? DEFAULT_MANAGED_CONFIG_PATH);
  const baseUrl = args.baseUrl ?? managedConfig.provider?.base_url;
  const apiKey = args.apiKey ?? managedConfig.provider?.api_key;
  const model = args.model ?? DEFAULT_MODEL;
  const protocol = args.protocol ?? "openai-compatible";
  const timeoutMs = args.timeoutMs ?? 20_000;
  const outputBase = path.resolve(args.outputBase ?? DEFAULT_OUTPUT_BASE);

  if (!baseUrl) {
    throw new Error("缺少 baseUrl，可通过 --base-url 或托管配置提供");
  }

  const llmConfig = {
    MEMORY_LLM_BASE_URL: baseUrl,
    MEMORY_LLM_MODEL: model,
    MEMORY_LLM_API_KEY: apiKey,
    MEMORY_LLM_PROTOCOL: protocol,
    MEMORY_LLM_TIMEOUT_MS: timeoutMs,
    MEMORY_LLM_EFFORT: "medium" as const,
  };

  const cases = buildCases();
  const results: EvalCaseResult[] = [];
  for (const evalCase of cases) {
    const result = await runCase(llmConfig, evalCase);
    results.push(result);
  }

  const summary = summarizeResults(results);
  await mkdir(path.dirname(outputBase), { recursive: true });

  const markdownPath = `${outputBase}.md`;
  const jsonPath = `${outputBase}.json`;
  const markdown = buildMarkdownReport(
    {
      baseUrl,
      model,
      protocol,
      timeoutMs,
    },
    results,
    summary,
  );

  await writeFile(markdownPath, markdown, "utf8");
  await writeFile(
    jsonPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        model,
        protocol,
        base_url: baseUrl,
        timeout_ms: timeoutMs,
        summary,
        results,
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    results,
    summary,
    markdownPath,
    jsonPath,
  };
}

async function main(): Promise<void> {
  const { summary, markdownPath, jsonPath } = await runRealEval(process.argv.slice(2));
  process.stdout.write(`memory orchestrator real eval finished\n`);
  process.stdout.write(`markdown: ${markdownPath}\n`);
  process.stdout.write(`json: ${jsonPath}\n`);
  for (const item of summary) {
    process.stdout.write(`${item.metric}: ${item.passed}/${item.total} (${(item.rate * 100).toFixed(1)}%)\n`);
  }
}

const isMainModule = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMainModule) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
