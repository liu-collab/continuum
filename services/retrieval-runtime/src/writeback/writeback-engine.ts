import { createHash } from "node:crypto";

import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import type { DependencyGuard } from "../dependency/dependency-guard.js";
import type { QualityAssessor, WritebackPlanner } from "../memory-orchestrator/index.js";
import type { FinalizeTurnInput, MemoryType, ScopeType, SubmittedWriteBackJob, WriteBackCandidate } from "../shared/types.js";
import { jaccardOverlap, normalizeText, tokenizeForOverlap } from "../shared/utils.js";
import type { LlmExtractionCandidate } from "./llm-extractor.js";
import {
  buildUnvalidatedCrossReference,
  type CrossReferencePair,
  type CrossReferenceResult,
  type CrossReferenceValidatedDraft,
  type EmbeddingCrossReferenceEngine,
} from "./cross-reference.js";
import type { StorageWritebackClient } from "./storage-client.js";

export interface WritebackEngineResult {
  candidates: WriteBackCandidate[];
  filtered_count: number;
  filtered_reasons: string[];
  scope_reasons: string[];
  plan_observation?: {
    input_summary: string;
    output_summary: string;
    prompt_version: string;
    schema_version: string;
    degraded: boolean;
    degradation_reason?: string;
    result_state: "planned" | "skipped" | "fallback" | "failed";
    duration_ms: number;
  };
}

interface CandidateDraft {
  candidate_type: "fact_preference" | "task_state" | "episodic";
  scope: ScopeType;
  summary: string;
  details: Record<string, unknown>;
  importance: number;
  confidence: number;
  write_reason: string;
  source_type: string;
  source_ref: string;
  confirmed_by_user?: boolean;
  extraction_method: "rules" | "llm";
}

interface ClassifiedDraft extends CandidateDraft {
  scope_reason: string;
}

const PREFERENCE_PATTERNS = [
  /(?:我一般|我喜欢|我偏好|我习惯|一直用的是|prefer|i usually|i always|my convention is|my default is)\s*[:：]?\s*(.+)/i,
  /((?:不要|不用|别|别给我|禁止|no more|stop using|don'?t use)\s+.+?)(?:[。.!]|$)/i,
  /(?:代码风格|编码规范|格式化|lint)(?:\s*(?:按|按照|使用|遵循|跟|走))\s*(.+)/i,
  /((?:用|使用|改用)\s*.+?而不是\s*.+?)(?:[。.!]|$)/i,
  /((?:这个项目|这个仓库|当前项目|当前仓库|项目里|仓库里|this project|this repo).*(?:默认|统一|规范|约定|使用|用).+?)(?:[。.!]|$)/i,
  /((?=.*(?:默认|长期偏好|偏好|习惯|prefer|default|usually|always))(?:以后|今后|后续|从现在开始|from now on|going forward).+?)(?:[。.!]|$)/i,
];

const REMEMBER_PREFERENCE_PATTERNS = [
  /(?:请记住|记住|记一下|remember(?: this)?)\s*[:：,-]?\s*(.+)/i,
];

const DEFAULT_PREFERENCE_PATTERNS = [
  /((?:以后|之后|后续)?\s*默认\s*.+)/i,
  /(.+?)\s*(?:这是|属于|算是)?\s*长期偏好/i,
];

const ASSISTANT_CONFIRM_PREFERENCE_PATTERNS = [
  /(?:已记住|记住了|好的，已记住|收到，已记住|i'?ve noted|noted)\s*[:：]?\s*(.+)$/i,
];

const COMMITMENT_PATTERNS = [
  /(?:我会|i will)\s+(?:在|after|before|每次|always|每天).{8,}/i,
  /(?:承诺|commit to|保证)\s*[:：]?\s*(.+)/i,
  /(?:明天|下周|这周|今天晚点|tonight|tomorrow|next week)\s*(?:开始|要|准备|打算)\s*(.+)/i,
  /(?:当|一旦|whenever|as soon as)\s*(.+?)\s*(?:就|则|我会|会)\s*(.+)/i,
  /(?:计划|打算|schedule|roadmap)\s*[:：]?\s*(.+)/i,
];

const TRIVIAL_TOOL_PATTERNS = /^(exit code|success|ok|done|completed|finished)\b/i;
const STABLE_PREFERENCE_HINTS = [
  "默认",
  "以后",
  "今后",
  "后续",
  "从现在开始",
  "长期偏好",
  "偏好",
  "习惯",
  "通常",
  "prefer",
  "preferred",
  "default",
  "usually",
  "always",
  "from now on",
  "going forward",
];

const TASK_STATE_PATTERNS = [
  /(?:下一步|todo|plan|任务状态)\s*[:：]?\s*(.+)$/i,
  /(?:已(?:经|完成|改完|实现|修复|处理)|搞定了|做好了|finished|completed|done with)\s*(.+?)(?:[。.!]|$|还剩|还要|接下来)/i,
  /(?:还剩|还要|接下来|仍需|remaining|left to do|pending)\s*[:：]?\s*(.+)/i,
  /(?:卡在|阻塞|等待|依赖|blocked by|waiting on|depends on)\s*[:：]?\s*(.+)/i,
  /(?:把|将|状态)?(?:从|由)\s*(\S+)\s*(?:改为|改成|变为|更新为|标记为)\s*(\S+)/i,
];

const OVERLAP_THRESHOLD_BY_METHOD: Record<string, number> = {
  rules: 0.35,
  llm: 0.35,
};

const MEANINGFUL_TOKEN_PATTERN = /[a-z0-9]{2,}|[\u4e00-\u9fff]{2,}/iu;

const MEMORY_WRITEBACK_PROMPT_VERSION = "memory-writeback-extract-v1";
const MEMORY_WRITEBACK_EXTRACTION_PROMPT_VERSION = "memory-writeback-extract-v1";
const MEMORY_WRITEBACK_SCHEMA_VERSION = "memory-writeback-schema-v1";
function summarizeObservationText(value: string, maxLength = 220) {
  const normalized = normalizeText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function buildSourceExcerpt(text: string | undefined, maxLength = 160) {
  const normalized = normalizeText(text ?? "");
  if (!normalized) {
    return undefined;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function extractPreferenceDetails(text: string): Record<string, unknown> {
  const normalized = normalizeText(text);
  const canonical = inferPreferenceCanonical(normalized);
  return {
    subject: "user",
    predicate: normalized,
    predicate_canonical: canonical.predicate_canonical,
    preference_axis: canonical.preference_axis,
    preference_value: canonical.preference_value,
    preference_polarity: canonical.preference_polarity,
    stability: "long_term",
  };
}

function cleanupPreferenceSummary(text: string): string {
  return normalizeText(
    text
      .replace(/^(?:请记住|记住|记一下|remember(?: this)?)\s*[:：,-]?\s*/i, "")
      .replace(/^(?:已记住|记住了|好的，已记住|收到，已记住)\s*[:：,-]?\s*/i, "")
      .replace(/[。.!?]\s*(?:这是|这属于|算是)?\s*长期偏好\s*$/i, "")
      .replace(/[。.!?]\s*(?:这会|我会)?\s*作为你的长期偏好来遵循\s*$/i, "")
      .replace(/[。.!?]\s*(?:我会|会)\s*按这个长期偏好执行\s*$/i, "")
      .replace(/[。.!?]\s*(?:请长期记住|请记住)\s*$/i, ""),
  );
}

function containsStablePreferenceHint(text: string): boolean {
  const normalized = normalizeText(text).toLowerCase();
  return STABLE_PREFERENCE_HINTS.some((hint) => normalized.includes(hint.toLowerCase()));
}

function inferPreferenceCanonical(text: string): {
  predicate_canonical: string;
  preference_axis: string;
  preference_value: string;
  preference_polarity: "positive" | "negative" | "neutral";
} {
  const normalized = normalizeText(text);

  if (
    normalized.includes("中文") ||
    normalized.includes("chinese")
  ) {
    return {
      predicate_canonical: "response_language zh",
      preference_axis: "response_language",
      preference_value: "zh",
      preference_polarity: "positive",
    };
  }

  if (
    normalized.includes("英文") ||
    normalized.includes("english")
  ) {
    return {
      predicate_canonical: "response_language en",
      preference_axis: "response_language",
      preference_value: "en",
      preference_polarity: "positive",
    };
  }

  if (
    normalized.includes("4 空格") ||
    normalized.includes("四 空格") ||
    normalized.includes("four spaces")
  ) {
    return {
      predicate_canonical: "indentation spaces 4",
      preference_axis: "indentation",
      preference_value: "spaces:4",
      preference_polarity: "positive",
    };
  }

  if (normalized.includes("tab")) {
    return {
      predicate_canonical: "indentation tab",
      preference_axis: "indentation",
      preference_value: "tab",
      preference_polarity:
        normalized.includes("不用 tab") || normalized.includes("不用tab") || normalized.includes("不要 tab")
          ? "negative"
          : "positive",
    };
  }

  if (
    normalized.includes("简洁") ||
    normalized.includes("简短") ||
    normalized.includes("concise") ||
    normalized.includes("brief")
  ) {
    return {
      predicate_canonical: "response_verbosity concise",
      preference_axis: "response_verbosity",
      preference_value: "concise",
      preference_polarity: normalized.includes("不") || normalized.includes("not") ? "negative" : "positive",
    };
  }

  return {
    predicate_canonical: normalized,
    preference_axis: normalized,
    preference_value: normalized,
    preference_polarity: normalized.includes("不") || normalized.includes("not") ? "negative" : "positive",
  };
}

function extractStablePreferenceFromUserInput(text: string): string | null {
  const directMatch = PREFERENCE_PATTERNS.map((pattern) => text.match(pattern)).find((match) => match?.[1] || match?.[2]);
  if (directMatch?.[1]) {
    return cleanupPreferenceSummary(directMatch[1]);
  }
  if (directMatch?.[2]) {
    return cleanupPreferenceSummary(directMatch[2]);
  }

  const defaultMatch = DEFAULT_PREFERENCE_PATTERNS.map((pattern) => text.match(pattern)).find((match) => match?.[1]);
  if (defaultMatch?.[1]) {
    const summary = cleanupPreferenceSummary(defaultMatch[1]);
    if (summary && containsStablePreferenceHint(summary)) {
      return summary;
    }
  }

  const rememberMatch = REMEMBER_PREFERENCE_PATTERNS
    .map((pattern) => text.match(pattern))
    .find((match) => match?.[1]);
  if (!rememberMatch?.[1]) {
    return null;
  }

  const summary = cleanupPreferenceSummary(rememberMatch[1]);
  if (!summary || !containsStablePreferenceHint(summary)) {
    return null;
  }

  return summary;
}

function extractTaskStateFromAssistantOutput(text: string): string | null {
  for (const pattern of TASK_STATE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }

    const summary = normalizeText(
      match[2] && match[1]
        ? `${match[1]} -> ${match[2]}`
        : match[1] ?? "",
    );
    if (summary.length >= 4) {
      return summary;
    }
  }

  return null;
}

function extractConfirmedPreferenceFromAssistantOutput(text: string): string | null {
  const confirmedMatch = text.match(/(?:已确认|确定|confirmed)\s*[:：]?\s*(.+)$/i);
  if (confirmedMatch?.[1]) {
    return cleanupPreferenceSummary(confirmedMatch[1]);
  }

  const rememberMatch = ASSISTANT_CONFIRM_PREFERENCE_PATTERNS
    .map((pattern) => text.match(pattern))
    .find((match) => match?.[1]);
  if (!rememberMatch?.[1]) {
    return null;
  }

  const summary = cleanupPreferenceSummary(rememberMatch[1]);
  if (!summary || !containsStablePreferenceHint(summary)) {
    return null;
  }

  return summary;
}

function buildCandidate(
  input: FinalizeTurnInput,
  draft: CandidateDraft,
): WriteBackCandidate {
  const normalizedSummary = normalizeText(draft.summary);
  const idempotencySeed = JSON.stringify({
    workspace_id: input.workspace_id,
    user_id: input.user_id,
    session_id: input.session_id,
    task_id: input.task_id ?? null,
    candidate_type: draft.candidate_type,
    scope: draft.scope,
    summary: normalizedSummary.toLowerCase(),
    source_ref: draft.source_ref,
  });
  const idempotencyKey = createHash("sha256").update(idempotencySeed).digest("hex");
  return {
    workspace_id: input.workspace_id,
    user_id: input.user_id,
    task_id: draft.scope === "task" ? input.task_id ?? null : null,
    session_id: draft.scope === "session" ? input.session_id : null,
    candidate_type: draft.candidate_type,
    scope: draft.scope,
    summary: normalizedSummary,
    details: draft.details,
    importance: draft.importance,
    confidence: draft.confidence,
    write_reason: draft.write_reason,
    source: {
      source_type: draft.source_type,
      source_ref: draft.source_ref,
      service_name: "retrieval-runtime",
      ...(draft.confirmed_by_user !== undefined ? { confirmed_by_user: draft.confirmed_by_user } : {}),
      extraction_method: draft.extraction_method,
    },
    idempotency_key: idempotencyKey,
  };
}

function uniqueCandidates(candidates: WriteBackCandidate[]): WriteBackCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.idempotency_key)) {
      return false;
    }
    seen.add(candidate.idempotency_key);
    return true;
  });
}

function hasSufficientInputOverlap(summary: string, sourceText: string, threshold: number): boolean {
  if (threshold <= 0 || jaccardOverlap(summary, sourceText) >= threshold) {
    return true;
  }

  const summaryTokens = new Set(tokenizeForOverlap(summary));
  const sourceTokens = new Set(tokenizeForOverlap(sourceText));
  if (summaryTokens.size === 0 || sourceTokens.size === 0) {
    return false;
  }

  let intersection = 0;
  for (const token of summaryTokens) {
    if (sourceTokens.has(token)) {
      intersection += 1;
    }
  }

  const containment = intersection / Math.min(summaryTokens.size, sourceTokens.size);
  return containment >= threshold;
}

function hasMeaningfulTokenOverlap(summary: string, sourceText: string): boolean {
  const sourceTokens = new Set(tokenizeForOverlap(sourceText));
  if (sourceTokens.size === 0) {
    return false;
  }

  return tokenizeForOverlap(summary).some((token) => {
    return MEANINGFUL_TOKEN_PATTERN.test(token) && sourceTokens.has(token);
  });
}

function hasWorkspaceContext(text: string): boolean {
  return /这个项目|这个仓库|当前项目|当前仓库|项目里|仓库里|this project|this repo|workspace|repository|repo/i.test(text);
}

function withOriginTrace(
  draft: CandidateDraft,
  input: FinalizeTurnInput,
  evidenceText: string | undefined,
): CandidateDraft {
  const source_excerpt = buildSourceExcerpt(evidenceText);
  return {
    ...draft,
    details: {
      ...draft.details,
      origin_trace: {
        source_turn_id: input.turn_id ?? input.session_id,
        source_message_role:
          draft.source_type === "host_user_input"
            ? "user"
            : draft.source_type === "assistant_final"
              ? "assistant"
              : "tool",
        source_excerpt,
        extraction_basis: draft.write_reason,
        extractor_version: MEMORY_WRITEBACK_PROMPT_VERSION,
        extraction_method: draft.extraction_method,
      },
    },
  };
}

export class WritebackEngine {
  constructor(
    private readonly config: AppConfig,
    private readonly storageClient: StorageWritebackClient,
    private readonly dependencyGuard: DependencyGuard,
    private readonly writebackPlanner?: WritebackPlanner,
    private readonly qualityAssessor?: QualityAssessor,
    private readonly logger?: Logger,
    private readonly crossReferenceEngine?: EmbeddingCrossReferenceEngine,
  ) {}

  async extractCandidates(
    input: FinalizeTurnInput,
  ): Promise<WritebackEngineResult> {
    const startedAt = Date.now();
    const ruleResult = this.runRulesOnly(input);

    if (!this.writebackPlanner || !this.config.WRITEBACK_REFINE_ENABLED) {
      const result = await this.applyQualityAssessment(
        input,
        this.postProcess(input, this.markRuleOnlyDrafts(ruleResult.drafts), ruleResult.filtered_reasons),
      );
      return {
        ...result,
        plan_observation: {
          input_summary: summarizeObservationText(
            `rules_only current_input=${input.current_input}; rule_candidates=${ruleResult.drafts.length}`,
          ),
          output_summary: summarizeObservationText(
            `candidates=${result.candidates.length}; filtered=${result.filtered_count}; reasons=${result.filtered_reasons.join(",")}`,
          ),
          prompt_version: MEMORY_WRITEBACK_PROMPT_VERSION,
          schema_version: MEMORY_WRITEBACK_SCHEMA_VERSION,
          degraded: false,
          result_state: result.candidates.length > 0 ? "planned" : "skipped",
          duration_ms: Date.now() - startedAt,
        },
      };
    }

    let llmDrafts: CandidateDraft[] = [];
    let llmDegraded = false;
    let llmDegradationReason: string | undefined;

    try {
      const extracted = await this.writebackPlanner.extract({
        current_input: input.current_input,
        assistant_output: input.assistant_output,
        tool_results_summary: input.tool_results_summary,
        task_id: input.task_id,
        rule_hints: ruleResult.drafts.map((draft) => ({
          summary: draft.summary,
          candidate_type: draft.candidate_type,
          scope: draft.scope,
          importance: draft.importance,
          confidence: draft.confidence,
        })),
      });
      llmDrafts = extracted.candidates.map((candidate) => this.toDraftFromLlm(input, candidate));
    } catch (error) {
      llmDegraded = true;
      llmDegradationReason = error instanceof Error ? error.message : "memory_llm_unavailable";
      this.logger?.warn?.({ err: error }, "memory llm extraction failed, using rule output");
    }

    let crossRefResult = buildUnvalidatedCrossReference(ruleResult.drafts, llmDrafts);
    let crossRefDegraded = false;
    let crossRefDegradationReason: string | undefined;

    if (this.crossReferenceEngine && ruleResult.drafts.length > 0 && llmDrafts.length > 0) {
      const crossRefAttempt = await this.dependencyGuard.run(
        "embeddings",
        this.config.EMBEDDING_TIMEOUT_MS,
        (signal) => this.crossReferenceEngine!.crossReference(ruleResult.drafts, llmDrafts, signal),
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

    const mergedDrafts = this.mergeWithCrossReference(crossRefResult);
    const result = await this.applyQualityAssessment(
      input,
      this.postProcess(input, mergedDrafts, ruleResult.filtered_reasons),
    );

    return {
      ...result,
      plan_observation: {
        input_summary: summarizeObservationText(
          `current_input=${input.current_input}; rule_candidates=${ruleResult.drafts.length}; llm_candidates=${llmDrafts.length}; cross_validated=${crossRefResult.cross_reference.filter((pair) => pair.verdict === "independent_confirmation").length}`,
        ),
        output_summary: summarizeObservationText(
          `candidates=${result.candidates.length}; filtered=${result.filtered_count}; reasons=${result.filtered_reasons.join(",")}`,
        ),
        prompt_version: MEMORY_WRITEBACK_EXTRACTION_PROMPT_VERSION,
        schema_version: MEMORY_WRITEBACK_SCHEMA_VERSION,
        degraded: llmDegraded || crossRefDegraded,
        degradation_reason: llmDegradationReason ?? crossRefDegradationReason,
        result_state: llmDegraded ? "fallback" : result.candidates.length > 0 ? "planned" : "skipped",
        duration_ms: Date.now() - startedAt,
      },
    };
  }

  private markRuleOnlyDrafts(ruleDrafts: CandidateDraft[]): CandidateDraft[] {
    return ruleDrafts.map((draft) => ({
      ...draft,
      confidence: Math.max(0.7, draft.confidence - 0.05),
      write_reason: `${draft.write_reason} (rule_only)`,
      details: {
        ...draft.details,
        cross_reference: "rule_only",
      },
    }));
  }

  private mergeWithCrossReference(
    crossRef: CrossReferenceResult<CandidateDraft>,
  ): CandidateDraft[] {
    const merged: CandidateDraft[] = [];
    const consumedRules = new Set<number>();
    const consumedLlms = new Set<number>();
    const confirmedPairs = crossRef.cross_reference
      .filter((pair) => pair.verdict === "independent_confirmation")
      .sort((left, right) => right.similarity - left.similarity);

    for (const pair of confirmedPairs) {
      if (consumedRules.has(pair.rule_idx) || consumedLlms.has(pair.llm_idx)) {
        continue;
      }

      const ruleDraft = crossRef.rule_drafts[pair.rule_idx];
      const llmDraft = crossRef.llm_drafts[pair.llm_idx];
      if (!ruleDraft || !llmDraft) {
        continue;
      }

      consumedRules.add(pair.rule_idx);
      consumedLlms.add(pair.llm_idx);
      merged.push(this.mergeConfirmedPair(ruleDraft, llmDraft, pair));
    }

    for (let index = 0; index < crossRef.rule_drafts.length; index += 1) {
      if (consumedRules.has(index)) {
        continue;
      }
      const draft = crossRef.rule_drafts[index];
      if (!draft) {
        continue;
      }
      merged.push({
        ...draft,
        confidence: Math.max(0.7, draft.confidence - 0.05),
        write_reason: `${draft.write_reason} (rule_only)`,
        details: {
          ...draft.details,
          cross_reference: "rule_only",
        },
      });
    }

    for (let index = 0; index < crossRef.llm_drafts.length; index += 1) {
      if (consumedLlms.has(index)) {
        continue;
      }
      const draft = crossRef.llm_drafts[index];
      if (!draft) {
        continue;
      }
      merged.push({
        ...draft,
        write_reason: `${draft.write_reason} (llm_only)`,
        details: {
          ...draft.details,
          cross_reference: "llm_only",
        },
      });
    }

    return merged;
  }

  private mergeConfirmedPair(
    ruleDraft: CandidateDraft & CrossReferenceValidatedDraft<CandidateDraft>,
    llmDraft: CandidateDraft & CrossReferenceValidatedDraft<CandidateDraft>,
    pair: CrossReferencePair,
  ): CandidateDraft {
    const llmSummaryIsClearer =
      llmDraft.summary.length >= ruleDraft.summary.length &&
      llmDraft.confidence >= ruleDraft.confidence - 0.1;
    const primary = llmSummaryIsClearer ? llmDraft : ruleDraft;
    const secondary = primary === llmDraft ? ruleDraft : llmDraft;

    return {
      ...primary,
      scope:
        llmDraft.confidence >= ruleDraft.confidence + 0.15
          ? llmDraft.scope
          : ruleDraft.scope,
      importance: Math.max(ruleDraft.importance, llmDraft.importance),
      confidence: Math.min(1, Math.max(ruleDraft.confidence, llmDraft.confidence) + 0.1),
      write_reason: `${primary.write_reason} (independent_confirmation similarity=${pair.similarity.toFixed(2)})`,
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

  private runRulesOnly(input: FinalizeTurnInput): { drafts: CandidateDraft[]; filtered_reasons: string[] } {
    const rawCandidates: CandidateDraft[] = [];
    const filteredReasons: string[] = [];
    const normalizedUser = normalizeText(input.current_input);
    const normalizedAssistant = normalizeText(input.assistant_output);
    const normalizedTools = normalizeText(input.tool_results_summary ?? "");
    let preferenceFromUserInput = false;

    const stablePreferenceSummary = extractStablePreferenceFromUserInput(normalizedUser);
    if (stablePreferenceSummary) {
      preferenceFromUserInput = true;
      rawCandidates.push(withOriginTrace({
        candidate_type: "fact_preference",
        scope: "user",
        summary: stablePreferenceSummary,
        details: {
          user_prompt: normalizedUser,
          extraction_method: "rules",
          ...extractPreferenceDetails(stablePreferenceSummary),
        },
        importance: 4,
        confidence: 0.9,
        write_reason: "user stated a stable preference explicitly",
        source_type: "host_user_input",
        source_ref: input.turn_id ?? input.session_id,
        confirmed_by_user: true,
        extraction_method: "rules",
      }, input, normalizedUser));
    } else if (normalizedUser.length > 0) {
      filteredReasons.push("no_stable_preference_detected");
    }

    const confirmedPreferenceSummary = extractConfirmedPreferenceFromAssistantOutput(normalizedAssistant);
    if (confirmedPreferenceSummary && !preferenceFromUserInput) {
      rawCandidates.push(withOriginTrace({
        candidate_type: "fact_preference",
        scope: "user",
        summary: confirmedPreferenceSummary,
        details: {
          assistant_output: normalizedAssistant,
          extraction_method: "rules",
          ...extractPreferenceDetails(confirmedPreferenceSummary),
        },
        importance: 4,
        confidence: 0.8,
        write_reason: "assistant produced a confirmed durable fact",
        source_type: "assistant_final",
        source_ref: input.turn_id ?? input.session_id,
        confirmed_by_user: true,
        extraction_method: "rules",
      }, input, normalizedAssistant));
    } else {
      filteredReasons.push("no_confirmed_fact_detected");
    }

    const taskStateSummary = extractTaskStateFromAssistantOutput(normalizedAssistant);
    if (taskStateSummary && input.task_id) {
      rawCandidates.push(withOriginTrace({
        candidate_type: "task_state",
        scope: "task",
        summary: taskStateSummary,
        details: { assistant_output: normalizedAssistant, task_id: input.task_id, extraction_method: "rules" },
        importance: 4,
        confidence: 0.82,
        write_reason: "assistant updated task progress or next-step state",
        source_type: "assistant_final",
        source_ref: input.turn_id ?? input.session_id,
        extraction_method: "rules",
      }, input, normalizedAssistant));
    } else if (input.task_id) {
      filteredReasons.push("no_task_state_update_detected");
    }

    const hasConcreteCommitment = COMMITMENT_PATTERNS.some((pattern) => pattern.test(normalizedAssistant));
    if (hasConcreteCommitment) {
      rawCandidates.push(withOriginTrace({
        candidate_type: "episodic",
        scope: input.task_id ? "task" : "session",
        summary: normalizedAssistant.slice(0, 180),
        details: {
          assistant_output: normalizedAssistant,
          runtime_candidate_type: "commitment",
          extraction_method: "rules",
        },
        importance: 3,
        confidence: 0.75,
        write_reason: "assistant made a concrete commitment that may matter later",
        source_type: "assistant_final",
        source_ref: input.turn_id ?? input.session_id,
        extraction_method: "rules",
      }, input, normalizedAssistant));
    } else {
      filteredReasons.push("no_commitment_detected");
    }

    if (normalizedTools && normalizedTools.length > 24 && !TRIVIAL_TOOL_PATTERNS.test(normalizedTools)) {
      rawCandidates.push(withOriginTrace({
        candidate_type: "episodic",
        scope: input.task_id ? "task" : "session",
        summary: normalizedTools.slice(0, 180),
        details: {
          tool_results_summary: normalizedTools,
          runtime_candidate_type: "important_event",
          extraction_method: "rules",
        },
        importance: 3,
        confidence: 0.72,
        write_reason: "tool summary indicates an externally observable event",
        source_type: "tool_trace_summary",
        source_ref: input.turn_id ?? input.session_id,
        extraction_method: "rules",
      }, input, normalizedTools));
    } else if (normalizedTools.length > 0) {
      filteredReasons.push("tool_summary_below_threshold");
    }

    return { drafts: rawCandidates, filtered_reasons: filteredReasons };
  }

  private postProcess(
    input: FinalizeTurnInput,
    drafts: CandidateDraft[],
    filteredReasons: string[],
  ): { candidates: WriteBackCandidate[]; filtered_count: number; filtered_reasons: string[]; scope_reasons: string[] } {
    const classifiedDrafts = drafts.map((draft) => this.classifyScope(input, draft));
    const scopeReasons: string[] = [];
    const sourceText = [input.current_input, input.assistant_output, input.tool_results_summary ?? ""].join(" ");
    const candidates = classifiedDrafts
      .map((draft) => {
        if (draft.scope === "task" && !input.task_id) {
          filteredReasons.push(`missing_task_id:${draft.candidate_type}`);
          return null;
        }
        scopeReasons.push(`${draft.summary}: ${draft.scope_reason}`);
        return buildCandidate(input, draft);
      })
      .filter((candidate): candidate is WriteBackCandidate => {
        if (!candidate) {
          return false;
        }

        const extractionMethod = candidate.source.extraction_method ?? "unknown";
        const overlapThreshold =
          OVERLAP_THRESHOLD_BY_METHOD[extractionMethod] ??
          this.config.WRITEBACK_INPUT_OVERLAP_THRESHOLD;
        const hasInputOverlap = hasSufficientInputOverlap(
          candidate.summary,
          sourceText,
          overlapThreshold,
        );
        const hasMeaningfulOverlap = hasMeaningfulTokenOverlap(candidate.summary, sourceText);
        if (!hasInputOverlap && !hasMeaningfulOverlap) {
          filteredReasons.push(`low_input_overlap:${candidate.candidate_type}`);
          return false;
        }

        if (candidate.summary.length < 4) {
          filteredReasons.push(`summary_too_short:${candidate.candidate_type}`);
          return false;
        }

        if (candidate.importance < 3) {
          filteredReasons.push(`importance_below_threshold:${candidate.candidate_type}`);
          return false;
        }

        if (candidate.confidence < 0.7) {
          filteredReasons.push(`confidence_below_threshold:${candidate.candidate_type}`);
          return false;
        }

        return true;
      });

    const unique = uniqueCandidates(candidates);
    const dedupedOutCount = candidates.length - unique.length;
    for (let index = 0; index < dedupedOutCount; index += 1) {
      filteredReasons.push("duplicate_candidate");
    }

    const limited = unique.slice(0, this.config.WRITEBACK_MAX_CANDIDATES);
    for (let index = limited.length; index < unique.length; index += 1) {
      filteredReasons.push("candidate_limit_exceeded");
    }

    return {
      candidates: limited,
      filtered_count: filteredReasons.length,
      filtered_reasons: filteredReasons,
      scope_reasons: scopeReasons.slice(0, limited.length),
    };
  }

  private toDraftFromLlm(input: FinalizeTurnInput, candidate: LlmExtractionCandidate): CandidateDraft {
    const normalizedSummary = normalizeText(candidate.summary);
    const scope = candidate.scope === "task" && !input.task_id ? "workspace" : candidate.scope;
    const details: Record<string, unknown> = {
      extraction_method: "llm",
      extracted_summary: normalizedSummary,
      candidate_type: candidate.candidate_type,
    };

    if (scope === "task" && input.task_id) {
      details.task_id = input.task_id;
    }

    return withOriginTrace({
      candidate_type: candidate.candidate_type,
      scope,
      summary: normalizedSummary,
      details,
      importance: candidate.importance,
      confidence: candidate.confidence,
      write_reason: candidate.write_reason,
      source_type: "memory_llm",
      source_ref: input.turn_id ?? input.session_id,
      confirmed_by_user: candidate.candidate_type === "fact_preference" && scope === "user" ? true : undefined,
      extraction_method: "llm",
    }, input, candidate.summary);
  }

  private classifyScope(input: FinalizeTurnInput, draft: CandidateDraft): ClassifiedDraft {
    const text = normalizeText(
      [draft.summary, JSON.stringify(draft.details), draft.write_reason, draft.source_type]
        .filter(Boolean)
        .join(" "),
    ).toLowerCase();
    const preferenceText = normalizeText([draft.summary, draft.write_reason].filter(Boolean).join(" ")).toLowerCase();
    const workspaceHints = ["仓库", "项目", "repo", "repository", "workspace", "目录", "convention", "constraint", "约束", "规则"];
    const userHints = ["偏好", "习惯", "风格", "prefer", "usually", "always", "默认"];
    const sessionHints = ["这轮", "本轮", "当前会话", "just now", "this turn", "temporary"];
    const taskHints = ["任务", "todo", "next step", "plan", "任务状态", "progress"];
    const workspaceSignal = hasWorkspaceContext(text) || workspaceHints.some((hint) => text.includes(hint));

    if (draft.candidate_type === "task_state") {
      return {
        ...draft,
        scope: draft.scope === "task" && input.task_id ? "task" : input.task_id ? "task" : "workspace",
        scope_reason: input.task_id
          ? "task_state candidates are stored as task memory when task_id is available"
          : "task_state without task_id falls back to workspace memory",
      };
    }

    if (draft.scope === "user" && workspaceSignal) {
      return {
        ...draft,
        scope: "workspace",
        scope_reason: "project or repository context overrides a generic user preference signal",
      };
    }

    if (draft.scope === "user") {
      return {
        ...draft,
        scope: "user",
        scope_reason: "upstream explicitly marked this candidate as user scope",
      };
    }

    if (draft.scope === "session") {
      return {
        ...draft,
        scope: "session",
        scope_reason: "upstream explicitly marked this candidate as session scope",
      };
    }

    if (draft.scope === "task" && input.task_id) {
      return {
        ...draft,
        scope: "task",
        scope_reason: "upstream explicitly marked this candidate as task scope",
      };
    }

    if (draft.scope === "workspace") {
      return {
        ...draft,
        scope: "workspace",
        scope_reason: "upstream explicitly marked this candidate as workspace scope",
      };
    }

    if (draft.candidate_type === "fact_preference" && userHints.some((hint) => preferenceText.includes(hint))) {
      return {
        ...draft,
        scope: "user",
        scope_reason: "stable preference or working habit is classified as global user memory",
      };
    }

    if (workspaceSignal) {
      return {
        ...draft,
        scope: "workspace",
        scope_reason: "repository or project-specific constraint is classified as workspace memory",
      };
    }

    if (draft.candidate_type === "episodic" && sessionHints.some((hint) => text.includes(hint))) {
      return {
        ...draft,
        scope: "session",
        scope_reason: "temporary session context stays in session scope",
      };
    }

    if (taskHints.some((hint) => text.includes(hint))) {
      return {
        ...draft,
        scope: input.task_id ? "task" : "workspace",
        scope_reason: input.task_id
          ? "task progress or next-step content is classified as task memory"
          : "task-like content without task_id falls back to workspace memory",
      };
    }

    return {
      ...draft,
      scope: draft.scope,
      scope_reason: "runtime keeps the suggested scope when no stronger local hint is available",
    };
  }

  async submit(input: FinalizeTurnInput): Promise<WritebackEngineResult> {
    const extraction = await this.extractCandidates(input);
    const { candidates, filtered_count, filtered_reasons, scope_reasons, plan_observation } = extraction;
    return {
      candidates,
      filtered_count,
      filtered_reasons,
      scope_reasons,
      plan_observation,
    };
  }

  async submitCandidates(candidates: WriteBackCandidate[]): Promise<
    | { ok: true; submitted_jobs: SubmittedWriteBackJob[] }
    | { ok: false; submitted_jobs: SubmittedWriteBackJob[]; degradation_reason: string }
  > {
    if (candidates.length === 0) {
      return {
        ok: true,
        submitted_jobs: [],
      };
    }

    const writebackResult = await this.dependencyGuard.run(
      "storage_writeback",
      this.config.STORAGE_TIMEOUT_MS,
      (signal) => this.storageClient.submitCandidates(candidates, signal),
    );

    if (!writebackResult.ok) {
      return {
        ok: false,
        submitted_jobs: candidates.map((candidate) => ({
          candidate_summary: candidate.summary,
          status: "dependency_unavailable",
          reason: writebackResult.error?.message,
        })),
        degradation_reason: writebackResult.error?.code ?? "dependency_unavailable",
      };
    }

    return {
      ok: true,
      submitted_jobs: writebackResult.value ?? [],
    };
  }

  async patchRecord(
    recordId: string,
    payload: Parameters<StorageWritebackClient["patchRecord"]>[1],
  ): Promise<void> {
    await this.dependencyGuard.run(
      "storage_writeback",
      this.config.STORAGE_TIMEOUT_MS,
      (signal) => this.storageClient.patchRecord(recordId, payload, signal),
    );
  }

  private async applyQualityAssessment(
    input: FinalizeTurnInput,
    result: { candidates: WriteBackCandidate[]; filtered_count: number; filtered_reasons: string[]; scope_reasons: string[] },
  ): Promise<{ candidates: WriteBackCandidate[]; filtered_count: number; filtered_reasons: string[]; scope_reasons: string[] }> {
    if (!this.qualityAssessor || result.candidates.length === 0) {
      return result;
    }

    try {
      const assessment = await this.qualityAssessor.assess({
        writeback_candidates: result.candidates,
        existing_similar_records: [],
        turn_context: {
          user_input: input.current_input,
          assistant_output: input.assistant_output,
        },
      });

      const byId = new Map(assessment.assessments.map((item) => [item.candidate_id, item]));
      const filteredReasons = [...result.filtered_reasons];
      const nextCandidates: WriteBackCandidate[] = [];

      for (const candidate of result.candidates) {
        const item = byId.get(candidate.idempotency_key);
        if (!item) {
          nextCandidates.push(candidate);
          continue;
        }

        if (item.quality_score < 0.6) {
          filteredReasons.push(`quality_blocked:${candidate.candidate_type}`);
          continue;
        }

        nextCandidates.push({
          ...candidate,
          importance: item.suggested_importance,
          suggested_status: item.suggested_status,
          details: {
            ...candidate.details,
            quality_score: item.quality_score,
            quality_confidence: item.confidence,
            quality_reason: item.reason,
            quality_issues: item.issues,
            potential_conflicts: item.potential_conflicts,
          },
        });
      }

      return {
        ...result,
        candidates: nextCandidates,
        filtered_count: filteredReasons.length,
        filtered_reasons: filteredReasons,
      };
    } catch (error) {
      this.logger?.warn?.({ err: error }, "memory quality assessor failed, applying conservative fallback");
      const filtered_reasons = [...result.filtered_reasons];
      const candidates = result.candidates.filter((candidate) => {
        const extractionMethod = candidate.source.extraction_method;
        const crossReference =
          typeof candidate.details.cross_reference === "string" ? candidate.details.cross_reference : undefined;

        if (extractionMethod !== "llm") {
          return true;
        }

        if (crossReference === "independent_confirmation") {
          return true;
        }

        filtered_reasons.push(`quality_assessor_fallback_blocked:${candidate.candidate_type}`);
        return false;
      });

      return {
        ...result,
        candidates,
        filtered_count: filtered_reasons.length,
        filtered_reasons,
      };
    }
  }
}
