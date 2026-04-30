import { randomUUID } from "node:crypto";

import type { FileMemoryStore, LiteMemoryRecord } from "./file-store.js";
import type { LiteMemoryModelStatus } from "./memory-model-config.js";
import type { LiteWritebackOutbox, LiteWritebackOutboxRetryResult } from "./writeback-outbox.js";
import type { WritebackPlanner } from "../memory-orchestrator/types.js";
import type { HostKind, MemoryMode, MemoryType, RecordStatus, ScopeType, WriteBackCandidate } from "../shared/types.js";
import { normalizeText } from "../shared/utils.js";

export interface LiteWritebackRecentTurn {
  role: "user" | "assistant" | "system" | "tool";
  content?: string;
  summary?: string;
  turn_id?: string;
}

export interface LiteAfterResponseInput {
  trace_id?: string;
  host: HostKind | string;
  workspace_id: string;
  user_id: string;
  session_id: string;
  current_input: string;
  assistant_output: string;
  task_id?: string;
  thread_id?: string;
  turn_id?: string;
  recent_context_summary?: string;
  recent_turns?: LiteWritebackRecentTurn[];
  tool_results_summary?: string;
  memory_mode?: MemoryMode;
  candidates?: unknown[];
}

export interface LiteWritebackExtractorTrace {
  source: "provided_candidates" | "rules" | "rules_and_llm";
  rules_count: number;
  llm_attempted: boolean;
  llm_degraded: boolean;
  recent_turns_count: number;
}

export interface LiteAfterResponseResult {
  trace_id: string;
  writeback_status: "accepted" | "skipped" | "retry_queued";
  accepted_count: number;
  filtered_reasons: string[];
  accepted_record_ids: string[];
  outbox_queued_count: number;
  outbox_retry: LiteWritebackOutboxRetryResult;
  degraded: boolean;
  degradation_reason?: string;
  extractor: LiteWritebackExtractorTrace;
}

export interface LiteWritebackEngineOptions {
  store: {
    load(): Promise<unknown>;
    listRecords(): LiteMemoryRecord[];
    appendRecord(record: LiteMemoryRecord): Promise<void>;
  };
  memoryModelStatus?: LiteMemoryModelStatus;
  writebackPlanner?: Pick<WritebackPlanner, "extract">;
  outbox?: LiteWritebackOutbox;
  maxCandidates?: number;
  traceIdFactory?: () => string;
  now?: () => string;
}

interface LiteCandidateDraft {
  candidate_type: MemoryType;
  scope: ScopeType;
  summary: string;
  details: Record<string, unknown>;
  importance: number;
  confidence: number;
  write_reason: string;
  idempotency_key?: string;
  suggested_status?: "active" | "pending_confirmation";
  source_type: string;
  extraction_method: "provided" | "rules" | "llm";
}

interface CandidateExtractionResult {
  drafts: LiteCandidateDraft[];
  filtered_reasons: string[];
  extractor: LiteWritebackExtractorTrace;
  degraded: boolean;
  degradation_reason?: string;
}

const DEFAULT_MAX_CANDIDATES = 8;
const TRIVIAL_SUMMARIES = new Set([
  "ok",
  "okay",
  "好的",
  "好",
  "收到",
  "哈哈",
  "嗯",
  "done",
  "finished",
]);

export class LiteWritebackEngine {
  private readonly maxCandidates: number;
  private readonly traceIdFactory: () => string;
  private readonly now: () => string;

  constructor(private readonly options: LiteWritebackEngineOptions) {
    this.maxCandidates = normalizePositiveInteger(options.maxCandidates, DEFAULT_MAX_CANDIDATES);
    this.traceIdFactory = options.traceIdFactory ?? (() => randomUUID());
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async process(input: LiteAfterResponseInput): Promise<LiteAfterResponseResult> {
    await this.options.store.load();
    const traceId = input.trace_id ?? input.turn_id ?? this.traceIdFactory();
    const outboxRetry = await this.retryOutbox();
    const extraction = await this.extractCandidates(input);
    const validation = this.validateDrafts(input, extraction.drafts);
    const acceptedRecordIds: string[] = [];
    let outboxQueuedCount = 0;

    for (const record of validation.records) {
      try {
        await this.options.store.appendRecord(record);
        acceptedRecordIds.push(record.id);
      } catch (error) {
        if (this.options.outbox) {
          await this.options.outbox.enqueue({
            trace_id: traceId,
            record,
            error: error instanceof Error ? error.message : String(error),
            now: this.now(),
          });
          outboxQueuedCount += 1;
          validation.filtered_reasons.push("write_retry_queued");
          continue;
        }
        throw error;
      }
    }

    const acceptedCount = acceptedRecordIds.length;
    const status =
      acceptedCount > 0
        ? "accepted"
        : outboxQueuedCount > 0
          ? "retry_queued"
          : "skipped";

    return {
      trace_id: traceId,
      writeback_status: status,
      accepted_count: acceptedCount,
      filtered_reasons: [...extraction.filtered_reasons, ...validation.filtered_reasons],
      accepted_record_ids: acceptedRecordIds,
      outbox_queued_count: outboxQueuedCount,
      outbox_retry: outboxRetry,
      degraded: extraction.degraded,
      ...(extraction.degradation_reason ? { degradation_reason: extraction.degradation_reason } : {}),
      extractor: extraction.extractor,
    };
  }

  private async retryOutbox(): Promise<LiteWritebackOutboxRetryResult> {
    if (!this.options.outbox) {
      return { attempted: 0, submitted: 0, failed: 0 };
    }

    return this.options.outbox.retryPending(async (record) => {
      if (isDuplicate(this.options.store, record)) {
        return;
      }
      await this.options.store.appendRecord(record);
    }, this.now);
  }

  private async extractCandidates(input: LiteAfterResponseInput): Promise<CandidateExtractionResult> {
    if (input.candidates && input.candidates.length > 0) {
      const drafts: LiteCandidateDraft[] = [];
      const filteredReasons: string[] = [];
      for (const candidate of input.candidates) {
        const draft = toDraftFromProvidedCandidate(candidate);
        if (draft) {
          drafts.push(draft);
        } else {
          filteredReasons.push("invalid_candidate");
        }
      }

      return {
        drafts: drafts.slice(0, this.maxCandidates),
        filtered_reasons: filteredReasons,
        extractor: {
          source: "provided_candidates",
          rules_count: 0,
          llm_attempted: false,
          llm_degraded: false,
          recent_turns_count: input.recent_turns?.length ?? 0,
        },
        degraded: false,
      };
    }

    const ruleDrafts = extractRuleDrafts(input);
    let llmDrafts: LiteCandidateDraft[] = [];
    let llmAttempted = false;
    let llmDegraded = false;
    let degradationReason: string | undefined;

    if (this.options.writebackPlanner && this.options.memoryModelStatus?.configured) {
      llmAttempted = true;
      try {
        const extracted = await this.options.writebackPlanner.extract({
          current_input: input.current_input,
          assistant_output: input.assistant_output,
          recent_context_summary: input.recent_context_summary ?? buildRecentTurnsSummary(input.recent_turns),
          recent_turns: summarizeRecentTurns(input.recent_turns),
          tool_results_summary: input.tool_results_summary,
          task_id: input.task_id,
          rule_hints: ruleDrafts.map((draft) => ({
            summary: draft.summary,
            candidate_type: draft.candidate_type,
            scope: draft.scope,
            importance: draft.importance,
            confidence: draft.confidence,
          })),
        });
        llmDrafts = extracted.candidates.map((candidate) => ({
          candidate_type: candidate.candidate_type,
          scope: candidate.scope,
          summary: candidate.summary,
          details: {
            extraction_method: "llm",
            recent_context_summary: input.recent_context_summary ?? buildRecentTurnsSummary(input.recent_turns),
            recent_turns: summarizeRecentTurns(input.recent_turns),
          },
          importance: candidate.importance,
          confidence: candidate.confidence,
          write_reason: candidate.write_reason,
          source_type: "memory_llm",
          extraction_method: "llm",
        }));
      } catch (error) {
        llmDegraded = true;
        degradationReason = error instanceof Error ? error.message : "memory_llm_unavailable";
      }
    }

    return {
      drafts: [...ruleDrafts, ...llmDrafts].slice(0, this.maxCandidates),
      filtered_reasons: ruleDrafts.length === 0 && llmDrafts.length === 0 ? ["no_writeback_candidate"] : [],
      extractor: {
        source: llmAttempted ? "rules_and_llm" : "rules",
        rules_count: ruleDrafts.length,
        llm_attempted: llmAttempted,
        llm_degraded: llmDegraded,
        recent_turns_count: input.recent_turns?.length ?? 0,
      },
      degraded: llmDegraded,
      ...(degradationReason ? { degradation_reason: degradationReason } : {}),
    };
  }

  private validateDrafts(input: LiteAfterResponseInput, drafts: LiteCandidateDraft[]): {
    records: LiteMemoryRecord[];
    filtered_reasons: string[];
  } {
    const records: LiteMemoryRecord[] = [];
    const filteredReasons: string[] = [];
    const seenDedupeKeys = new Set<string>();

    for (const draft of drafts) {
      const summary = normalizeText(draft.summary);
      if (!summary || isTrivialSummary(summary)) {
        filteredReasons.push("empty_or_trivial");
        continue;
      }

      if (containsSecret(summary) || containsSecret(JSON.stringify(draft.details))) {
        filteredReasons.push("sensitive_content");
        continue;
      }

      const record = toLiteMemoryRecord(input, draft, summary, this.now());
      if (seenDedupeKeys.has(record.dedupe_key ?? record.id) || isDuplicate(this.options.store, record)) {
        filteredReasons.push("ignore_duplicate");
        continue;
      }

      seenDedupeKeys.add(record.dedupe_key ?? record.id);
      records.push(record);
    }

    return { records, filtered_reasons: filteredReasons };
  }
}

function toDraftFromProvidedCandidate(rawCandidate: unknown): LiteCandidateDraft | null {
  if (!rawCandidate || typeof rawCandidate !== "object") {
    return null;
  }

  const candidate = rawCandidate as Partial<WriteBackCandidate> & {
    memory_type?: unknown;
    candidate_type?: unknown;
    scope?: unknown;
    summary?: unknown;
    details?: unknown;
    importance?: unknown;
    confidence?: unknown;
    idempotency_key?: unknown;
    status?: unknown;
  };
  const candidateType = normalizeMemoryType(candidate.candidate_type ?? candidate.memory_type);
  const scope = normalizeScope(candidate.scope);
  const summary = typeof candidate.summary === "string" ? candidate.summary.trim() : "";
  const details = candidate.details && typeof candidate.details === "object" && !Array.isArray(candidate.details)
    ? candidate.details as Record<string, unknown>
    : {};

  if (!candidateType || !scope || summary.length === 0) {
    return null;
  }

  return {
    candidate_type: candidateType,
    scope,
    summary,
    details,
    importance: normalizeNumber(candidate.importance, 3, 1, 5),
    confidence: normalizeNumber(candidate.confidence, 0.7, 0, 1),
    write_reason: typeof candidate.write_reason === "string" ? candidate.write_reason : "provided candidate",
    idempotency_key: typeof candidate.idempotency_key === "string" ? candidate.idempotency_key : undefined,
    suggested_status: candidate.status === "pending_confirmation" || candidate.suggested_status === "pending_confirmation"
      ? "pending_confirmation"
      : "active",
    source_type: "provided_candidate",
    extraction_method: "provided",
  };
}

function extractRuleDrafts(input: LiteAfterResponseInput): LiteCandidateDraft[] {
  const drafts: LiteCandidateDraft[] = [];
  const currentInput = normalizeText(input.current_input);
  const assistantOutput = normalizeText(input.assistant_output);
  const recentContextSummary = input.recent_context_summary ?? buildRecentTurnsSummary(input.recent_turns);
  const recentTurns = summarizeRecentTurns(input.recent_turns);

  const preferenceSummary = extractStablePreference(currentInput);
  if (preferenceSummary) {
    const workspaceScoped = hasWorkspaceContext(currentInput) || hasWorkspaceContext(preferenceSummary);
    drafts.push({
      candidate_type: workspaceScoped ? "fact" : "preference",
      scope: workspaceScoped ? "workspace" : "user",
      summary: preferenceSummary,
      details: {
        current_input: currentInput,
        recent_context_summary: recentContextSummary,
        recent_turns: recentTurns,
        extraction_method: "rules",
      },
      importance: workspaceScoped ? 4 : 5,
      confidence: 0.9,
      write_reason: workspaceScoped
        ? "user stated a stable workspace fact explicitly"
        : "user stated a stable preference explicitly",
      source_type: "host_user_input",
      extraction_method: "rules",
    });
  }

  const confirmedPreference = extractConfirmedPreference(assistantOutput);
  if (confirmedPreference && !preferenceSummary) {
    drafts.push({
      candidate_type: "preference",
      scope: "user",
      summary: confirmedPreference,
      details: {
        assistant_output: assistantOutput,
        recent_context_summary: recentContextSummary,
        recent_turns: recentTurns,
        extraction_method: "rules",
      },
      importance: 4,
      confidence: 0.78,
      write_reason: "assistant confirmed a stable user preference",
      source_type: "assistant_final",
      extraction_method: "rules",
    });
  }

  const taskState = extractTaskState(assistantOutput);
  if (taskState && input.task_id) {
    drafts.push({
      candidate_type: "task_state",
      scope: "task",
      summary: taskState,
      details: {
        assistant_output: assistantOutput,
        task_id: input.task_id,
        recent_context_summary: recentContextSummary,
        recent_turns: recentTurns,
        extraction_method: "rules",
      },
      importance: 4,
      confidence: 0.82,
      write_reason: "assistant updated task progress or next-step state",
      source_type: "assistant_final",
      extraction_method: "rules",
    });
  }

  return drafts;
}

function toLiteMemoryRecord(
  input: LiteAfterResponseInput,
  draft: LiteCandidateDraft,
  summary: string,
  now: string,
): LiteMemoryRecord {
  const status: RecordStatus =
    draft.suggested_status === "pending_confirmation" || draft.confidence < 0.6
      ? "pending_confirmation"
      : "active";
  const dedupeKey = draft.idempotency_key ?? `${draft.candidate_type}:${draft.scope}:${summary}`;

  return {
    id: `lite_${hashLiteRecord([
      input.workspace_id,
      input.user_id,
      input.session_id,
      input.task_id ?? "",
      draft.candidate_type,
      draft.scope,
      summary,
    ].join("|"))}`,
    workspace_id: input.workspace_id,
    user_id: draft.scope === "workspace" ? null : input.user_id,
    task_id: draft.scope === "task" ? input.task_id ?? null : null,
    session_id: draft.scope === "session" ? input.session_id : null,
    memory_type: draft.candidate_type,
    scope: draft.scope,
    status,
    summary,
    details: {
      ...draft.details,
      write_reason: draft.write_reason,
      source_type: draft.source_type,
      extraction_method: draft.extraction_method,
    },
    importance: draft.importance,
    confidence: draft.confidence,
    dedupe_key: dedupeKey,
    created_at: now,
    updated_at: now,
  };
}

function extractStablePreference(text: string): string | undefined {
  const patterns = [
    /(?:请记住|记住|记一下|remember(?: this)?)\s*[:：,-]?\s*(.+)$/iu,
    /(?:我偏好|我喜欢|我希望|我习惯|prefer|i prefer)\s*[:：,-]?\s*(.+)$/iu,
    /((?:以后|今后|后续|从现在开始|from now on|going forward).*(?:默认|偏好|使用|用|回复|输出).*)$/iu,
    /((?:这个项目|这个仓库|当前项目|当前仓库|this project|this repo).*(?:默认|统一|约定|使用|用).*)$/iu,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      return cleanupSummary(value);
    }
  }

  return undefined;
}

function extractConfirmedPreference(text: string): string | undefined {
  const match = text.match(/(?:已记住|记住了|好的，已记住|收到，已记住|noted)\s*[:：,-]?\s*(.+)$/iu);
  const value = match?.[1]?.trim();
  return value ? cleanupSummary(value) : undefined;
}

function extractTaskState(text: string): string | undefined {
  const patterns = [
    /(?:还剩|还要|接下来|仍需|remaining|pending)\s*[:：]?\s*(.+)$/iu,
    /(?:已(?:经|完成|实现|修复|处理)|finished|completed)\s*(.+?)(?:[。.!]|$)/iu,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      return cleanupSummary(value);
    }
  }

  return undefined;
}

function cleanupSummary(text: string): string {
  return normalizeText(
    text
      .replace(/^[:：,-]+/, "")
      .replace(/^(?:以后|今后|后续|从现在开始)\s*/u, "")
      .replace(/[。.!?]+$/u, "")
      .replace(/^(?:默认|偏好)\s*[:：]\s*/u, "默认"),
  );
}

function buildRecentTurnsSummary(recentTurns: LiteWritebackRecentTurn[] | undefined): string | undefined {
  const summary = summarizeRecentTurns(recentTurns)
    .map((turn) => `${turn.role}: ${turn.summary}`)
    .join("\n");
  return summary ? normalizeText(summary) : undefined;
}

function summarizeRecentTurns(recentTurns: LiteWritebackRecentTurn[] | undefined) {
  return (recentTurns ?? [])
    .slice(-5)
    .map((turn) => ({
      role: turn.role,
      summary: normalizeText(turn.summary ?? turn.content ?? "").slice(0, 240),
      ...(turn.turn_id ? { turn_id: turn.turn_id } : {}),
    }))
    .filter((turn) => turn.summary.length > 0);
}

function isTrivialSummary(summary: string): boolean {
  const normalized = summary.toLowerCase();
  if (TRIVIAL_SUMMARIES.has(normalized)) {
    return true;
  }
  return !/[a-z0-9]{2,}|[\u4e00-\u9fff]{2,}/iu.test(summary);
}

function hasWorkspaceContext(text: string): boolean {
  return /(?:项目|仓库|工作区|repo|repository|workspace|project)/iu.test(text);
}

function normalizeMemoryType(value: unknown): MemoryType | undefined {
  return value === "fact" || value === "preference" || value === "task_state" || value === "episodic"
    ? value
    : undefined;
}

function normalizeScope(value: unknown): ScopeType | undefined {
  return value === "workspace" || value === "user" || value === "task" || value === "session"
    ? value
    : undefined;
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value ?? fallback)) {
    return fallback;
  }
  return Math.max(1, Math.trunc(value ?? fallback));
}

function isDuplicate(
  store: Pick<FileMemoryStore, "listRecords">,
  record: LiteMemoryRecord,
): boolean {
  const dedupeKey = record.dedupe_key;
  return store.listRecords().some((existing) =>
    existing.status === "active"
    && (
      (dedupeKey && existing.dedupe_key === dedupeKey)
      || (
        existing.memory_type === record.memory_type
        && existing.scope === record.scope
        && existing.summary === record.summary
      )
    ),
  );
}

function containsSecret(value: string): boolean {
  return /\b(sk-[a-z0-9_-]{12,}|api[_-]?key|bearer\s+[a-z0-9._-]{12,}|token\s*[:=])/iu.test(value);
}

function hashLiteRecord(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
