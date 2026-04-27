import { createHash } from "node:crypto";

import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import type { DependencyGuard } from "../dependency/dependency-guard.js";
import type { QualityAssessor, WritebackPlanner } from "../memory-orchestrator/index.js";
import type { FinalizeTurnInput, MemoryType, ScopeType, SubmittedWriteBackJob, WriteBackCandidate } from "../shared/types.js";
import { jaccardOverlap, normalizeText, tokenizeForOverlap } from "../shared/utils.js";
import type {
  LlmExtractionCandidate,
  LlmRefineItem,
  LlmRefineResult,
  RuleCandidateDigest,
} from "./llm-extractor.js";
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
];

const TRIVIAL_TOOL_PATTERNS = /^(exit code|success|ok|done|completed|finished)\b/i;
const STABLE_PREFERENCE_HINTS = [
  "默认",
  "以后",
  "长期偏好",
  "偏好",
  "习惯",
  "通常",
  "prefer",
  "preferred",
  "default",
  "usually",
  "always",
];

const MEMORY_WRITEBACK_PROMPT_VERSION = "memory-writeback-refine-v1";
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
  const directMatch = PREFERENCE_PATTERNS.map((pattern) => text.match(pattern)).find((match) => match?.[1]);
  if (directMatch?.[1]) {
    return cleanupPreferenceSummary(directMatch[1]);
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
  ) {}

  async extractCandidates(
    input: FinalizeTurnInput,
  ): Promise<WritebackEngineResult> {
    const startedAt = Date.now();
    const ruleResult = this.runRulesOnly(input);

    if (!this.writebackPlanner || !this.config.WRITEBACK_REFINE_ENABLED) {
      const result = await this.applyQualityAssessment(
        input,
        this.postProcess(input, ruleResult.drafts, ruleResult.filtered_reasons),
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

    try {
      const extracted = await this.writebackPlanner.extract({
        current_input: input.current_input,
        assistant_output: input.assistant_output,
        tool_results_summary: input.tool_results_summary,
        task_id: input.task_id,
      });
      const llmDrafts = extracted.candidates.map((candidate) => this.toDraftFromLlm(input, candidate));
      const refineResult = await this.refineRuleCandidates(input, ruleResult.drafts);
      const allDrafts = [...llmDrafts, ...refineResult.drafts];
      const result = await this.applyQualityAssessment(
        input,
        this.postProcess(
          input,
          allDrafts,
          [...ruleResult.filtered_reasons, ...refineResult.filtered_reasons],
        ),
      );
      return {
        ...result,
        plan_observation: {
          input_summary: summarizeObservationText(
            `current_input=${input.current_input}; llm_candidates=${extracted.candidates.length}; rule_candidates=${ruleResult.drafts.length}`,
          ),
          output_summary: summarizeObservationText(
            `candidates=${result.candidates.length}; filtered=${result.filtered_count}; reasons=${result.filtered_reasons.join(",")}`,
          ),
          prompt_version: MEMORY_WRITEBACK_EXTRACTION_PROMPT_VERSION,
          schema_version: MEMORY_WRITEBACK_SCHEMA_VERSION,
          degraded: refineResult.degraded,
          degradation_reason: refineResult.degradation_reason,
          result_state: result.candidates.length > 0 ? "planned" : "skipped",
          duration_ms: Date.now() - startedAt,
        },
      };
    } catch (error) {
      this.logger?.warn?.({ err: error }, "memory llm extraction failed, using rule output");
      const result = await this.applyQualityAssessment(
        input,
        this.postProcess(input, ruleResult.drafts, ruleResult.filtered_reasons),
      );
      return {
        ...result,
        plan_observation: {
          input_summary: summarizeObservationText(
            `current_input=${input.current_input}; rule_candidates=${ruleResult.drafts.length}`,
          ),
          output_summary: summarizeObservationText(
            `fallback=${error instanceof Error ? error.message : "memory_llm_unavailable"}; candidates=${result.candidates.length}; filtered=${result.filtered_count}`,
          ),
          prompt_version: MEMORY_WRITEBACK_PROMPT_VERSION,
          schema_version: MEMORY_WRITEBACK_SCHEMA_VERSION,
          degraded: true,
          degradation_reason: error instanceof Error ? error.message : "memory_llm_unavailable",
          result_state: "fallback",
          duration_ms: Date.now() - startedAt,
        },
      };
    }
  }

  private extractByRules(input: FinalizeTurnInput): { candidates: WriteBackCandidate[]; filtered_count: number; filtered_reasons: string[]; scope_reasons: string[] } {
    const rules = this.runRulesOnly(input);
    return this.postProcess(input, rules.drafts, rules.filtered_reasons);
  }

  private async refineRuleCandidates(
    input: FinalizeTurnInput,
    ruleDrafts: CandidateDraft[],
  ): Promise<{ drafts: CandidateDraft[]; filtered_reasons: string[]; degraded: boolean; degradation_reason?: string }> {
    if (!this.writebackPlanner || ruleDrafts.length === 0) {
      return {
        drafts: ruleDrafts,
        filtered_reasons: [],
        degraded: false,
      };
    }

    try {
      const refined = await this.writebackPlanner.refine({
        current_input: input.current_input,
        assistant_output: input.assistant_output,
        tool_results_summary: input.tool_results_summary,
        task_id: input.task_id,
        rule_candidates: ruleDrafts.map((draft, index) => toRuleDigest(draft, index)),
      });
      return {
        ...this.applyRefineResult(input, ruleDrafts, refined),
        degraded: false,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "memory_llm_refine_unavailable";
      this.logger?.warn?.({ err: error }, "memory llm refine failed, keeping extracted and rule output");
      return {
        drafts: ruleDrafts,
        filtered_reasons: [`llm_refine_failed:${reason}`],
        degraded: true,
        degradation_reason: reason,
      };
    }
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

    const taskMatch = normalizedAssistant.match(/(?:下一步|todo|plan|任务状态)\s*[:：]?\s*(.+)$/i);
    if (taskMatch?.[1] && input.task_id) {
      rawCandidates.push(withOriginTrace({
        candidate_type: "task_state",
        scope: "task",
        summary: taskMatch[1],
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

        const extractionMethod = candidate.source.extraction_method;
        if (extractionMethod === "llm") {
          const hasInputOverlap = hasSufficientInputOverlap(
            candidate.summary,
            [input.current_input, input.assistant_output, input.tool_results_summary ?? ""].join(" "),
            this.config.WRITEBACK_INPUT_OVERLAP_THRESHOLD,
          );
          if (!hasInputOverlap) {
            filteredReasons.push(`low_input_overlap:${candidate.candidate_type}`);
            return false;
          }
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

  private applyRefineResult(
    input: FinalizeTurnInput,
    ruleDrafts: CandidateDraft[],
    refined: LlmRefineResult,
  ): { drafts: CandidateDraft[]; filtered_reasons: string[] } {
    const droppedIndices = new Set<number>();
    const consumedIndices = new Set<number>();
    const out: CandidateDraft[] = [];
    const filtered: string[] = [];

    for (const item of refined.refined_candidates) {
      if (item.action === "drop") {
        const idx = parseRuleIndex(item.source);
        if (idx !== null) {
          droppedIndices.add(idx);
          consumedIndices.add(idx);
          filtered.push(`llm_drop:${idx}`);
        }
        continue;
      }

      if (item.action === "keep") {
        const idx = parseRuleIndex(item.source);
        if (idx === null || !ruleDrafts[idx]) {
          continue;
        }
        consumedIndices.add(idx);
        out.push(mergeLlmCorrections(ruleDrafts[idx], item, input));
        continue;
      }

      if (item.action === "merge") {
        const anchor = parseRuleIndex(item.source);
        const others = (item.merge_with ?? [])
          .map(parseRuleIndex)
          .filter((n): n is number => n !== null);
        const anchorDraft = anchor !== null ? ruleDrafts[anchor] : undefined;
        if (!anchorDraft) {
          continue;
        }
        consumedIndices.add(anchor!);
        for (const n of others) {
          consumedIndices.add(n);
        }
        out.push(this.buildMergedDraft(anchorDraft, item, input));
        continue;
      }

      if (item.action === "new") {
        const draft = this.buildDraftFromLlmNew(item, input);
        if (draft) {
          out.push(draft);
        }
      }
    }

    ruleDrafts.forEach((draft, idx) => {
      if (droppedIndices.has(idx) || consumedIndices.has(idx)) {
        return;
      }
      out.push(draft);
    });

    return { drafts: out, filtered_reasons: filtered };
  }

  private buildMergedDraft(
    anchor: CandidateDraft,
    item: LlmRefineItem,
    input: FinalizeTurnInput,
  ): CandidateDraft {
    const scope = item.scope ?? anchor.scope;
    const normalizedScope = scope === "task" && !input.task_id ? "workspace" : scope;
    const summary = normalizeText(item.summary ?? anchor.summary);
    return withOriginTrace({
      candidate_type: item.candidate_type ?? anchor.candidate_type,
      scope: normalizedScope,
      summary,
      details: {
        ...anchor.details,
        extraction_method: "llm",
        refine_action: "merge",
        refine_reason: item.reason,
      },
      importance: item.importance ?? anchor.importance,
      confidence: item.confidence ?? anchor.confidence,
      write_reason: item.reason,
      source_type: "memory_llm",
      source_ref: anchor.source_ref,
      confirmed_by_user: anchor.confirmed_by_user,
      extraction_method: "llm",
    }, input, item.summary ?? anchor.summary);
  }

  private buildDraftFromLlmNew(
    item: LlmRefineItem,
    input: FinalizeTurnInput,
  ): CandidateDraft | null {
    if (!item.summary || !item.candidate_type || !item.scope || item.importance === undefined || item.confidence === undefined) {
      return null;
    }
    const normalizedSummary = normalizeText(item.summary);
    const scope = item.scope === "task" && !input.task_id ? "workspace" : item.scope;
    return withOriginTrace({
      candidate_type: item.candidate_type,
      scope,
      summary: normalizedSummary,
      details: {
        extraction_method: "llm",
        refine_action: "new",
        refine_reason: item.reason,
        extracted_summary: normalizedSummary,
        candidate_type: item.candidate_type,
        ...(scope === "task" && input.task_id ? { task_id: input.task_id } : {}),
      },
      importance: item.importance,
      confidence: item.confidence,
      write_reason: item.reason,
      source_type: "memory_llm",
      source_ref: input.turn_id ?? input.session_id,
      confirmed_by_user: item.candidate_type === "fact_preference" && scope === "user" ? true : undefined,
      extraction_method: "llm",
    }, input, item.summary);
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

    if (draft.candidate_type === "task_state") {
      return {
        ...draft,
        scope: draft.scope === "task" && input.task_id ? "task" : input.task_id ? "task" : "workspace",
        scope_reason: input.task_id
          ? "task_state candidates are stored as task memory when task_id is available"
          : "task_state without task_id falls back to workspace memory",
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

    if (workspaceHints.some((hint) => text.includes(hint))) {
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
        const refineAction =
          typeof candidate.details.refine_action === "string" ? candidate.details.refine_action : undefined;

        if (extractionMethod !== "llm") {
          return true;
        }

        if (refineAction === "keep" || refineAction === "merge") {
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

function toRuleDigest(draft: CandidateDraft, index: number): RuleCandidateDigest {
  return {
    index,
    candidate_type: draft.candidate_type,
    scope: draft.scope,
    summary: draft.summary,
    importance: draft.importance,
    confidence: draft.confidence,
    write_reason: draft.write_reason,
  };
}

function parseRuleIndex(source: LlmRefineItem["source"]): number | null {
  if (source === "llm_new") {
    return null;
  }
  const match = source.match(/^rule_index:(\d+)$/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1]!, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function mergeLlmCorrections(
  draft: CandidateDraft,
  item: LlmRefineItem,
  input: FinalizeTurnInput,
): CandidateDraft {
  const scope = item.scope ?? draft.scope;
  const normalizedScope = scope === "task" && !input.task_id ? "workspace" : scope;
  return {
    ...draft,
    candidate_type: item.candidate_type ?? draft.candidate_type,
    scope: normalizedScope,
    summary: item.summary ? normalizeText(item.summary) : draft.summary,
    importance: item.importance ?? draft.importance,
    confidence: item.confidence ?? draft.confidence,
    write_reason: item.reason ?? draft.write_reason,
    details: {
      ...draft.details,
      extraction_method: "llm",
      refine_action: "keep",
      refine_reason: item.reason,
    },
    source_type: "memory_llm",
    extraction_method: "llm",
  };
}
