import { createHash } from "node:crypto";

import type { AppConfig } from "../config.js";
import type { DependencyGuard } from "../dependency/dependency-guard.js";
import type { FinalizeTurnInput, SubmittedWriteBackJob, WriteBackCandidate } from "../shared/types.js";
import { normalizeText } from "../shared/utils.js";
import type { LlmExtractionCandidate, LlmExtractor } from "./llm-extractor.js";
import type { StorageWritebackClient } from "./storage-client.js";

export interface WritebackEngineResult {
  candidates: WriteBackCandidate[];
  submitted_jobs: SubmittedWriteBackJob[];
  filtered_count: number;
  filtered_reasons: string[];
  degraded: boolean;
  degradation_reason?: string;
}

interface CandidateDraft {
  candidate_type: "fact_preference" | "task_state" | "episodic";
  scope: WriteBackCandidate["scope"];
  summary: string;
  details: Record<string, unknown>;
  importance: number;
  confidence: number;
  write_reason: string;
  source_type: string;
  source_ref: string;
  confirmed_by_user?: boolean;
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

export class WritebackEngine {
  constructor(
    private readonly config: AppConfig,
    private readonly storageClient: StorageWritebackClient,
    private readonly dependencyGuard: DependencyGuard,
    private readonly llmExtractor?: LlmExtractor,
  ) {}

  async extractCandidates(
    input: FinalizeTurnInput,
  ): Promise<{ candidates: WriteBackCandidate[]; filtered_count: number; filtered_reasons: string[] }> {
    if (this.llmExtractor) {
      try {
        const llmResult = await this.llmExtractor.extract({
          current_input: input.current_input,
          assistant_output: input.assistant_output,
          tool_results_summary: input.tool_results_summary,
          task_id: input.task_id,
        });

        return this.postProcess(
          input,
          llmResult.candidates.map((candidate) => this.toDraftFromLlm(input, candidate)),
          [],
        );
      } catch {
        return this.extractByRules(input);
      }
    }

    return this.extractByRules(input);
  }

  private extractByRules(input: FinalizeTurnInput): { candidates: WriteBackCandidate[]; filtered_count: number; filtered_reasons: string[] } {
    const rawCandidates: CandidateDraft[] = [];
    const filteredReasons: string[] = [];
    const normalizedUser = normalizeText(input.current_input);
    const normalizedAssistant = normalizeText(input.assistant_output);
    const normalizedTools = normalizeText(input.tool_results_summary ?? "");

    const preferenceMatch = normalizedUser.match(/(?:我一般|我喜欢|我偏好|prefer)\s*[:：]?\s*(.+)$/i);
    if (preferenceMatch?.[1]) {
      rawCandidates.push({
        candidate_type: "fact_preference",
        scope: "user",
        summary: preferenceMatch[1],
        details: { user_prompt: normalizedUser, extraction_method: "rules" },
        importance: 4,
        confidence: 0.9,
        write_reason: "user stated a stable preference explicitly",
        source_type: "host_user_input",
        source_ref: input.turn_id ?? input.session_id,
        confirmed_by_user: true,
      });
    } else if (normalizedUser.length > 0) {
      filteredReasons.push("no_stable_preference_detected");
    }

    const factMatch = normalizedAssistant.match(/(?:已确认|确定|confirmed)\s*[:：]?\s*(.+)$/i);
    if (factMatch?.[1]) {
      rawCandidates.push({
        candidate_type: "fact_preference",
        scope: "session",
        summary: factMatch[1],
        details: { assistant_output: normalizedAssistant, extraction_method: "rules" },
        importance: 4,
        confidence: 0.8,
        write_reason: "assistant produced a confirmed durable fact",
        source_type: "assistant_final",
        source_ref: input.turn_id ?? input.session_id,
      });
    } else {
      filteredReasons.push("no_confirmed_fact_detected");
    }

    const taskMatch = normalizedAssistant.match(/(?:下一步|todo|plan|任务状态)\s*[:：]?\s*(.+)$/i);
    if (taskMatch?.[1] && input.task_id) {
      rawCandidates.push({
        candidate_type: "task_state",
        scope: "task",
        summary: taskMatch[1],
        details: { assistant_output: normalizedAssistant, task_id: input.task_id, extraction_method: "rules" },
        importance: 4,
        confidence: 0.82,
        write_reason: "assistant updated task progress or next-step state",
        source_type: "assistant_final",
        source_ref: input.turn_id ?? input.session_id,
      });
    } else if (input.task_id) {
      filteredReasons.push("no_task_state_update_detected");
    }

    if (normalizedAssistant.includes("我会") || normalizedAssistant.toLowerCase().includes("i will")) {
      rawCandidates.push({
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
      });
    } else {
      filteredReasons.push("no_commitment_detected");
    }

    if (normalizedTools && normalizedTools.length > 24) {
      rawCandidates.push({
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
      });
    } else if (normalizedTools.length > 0) {
      filteredReasons.push("tool_summary_below_threshold");
    }

    return this.postProcess(input, rawCandidates, filteredReasons);
  }

  private postProcess(
    input: FinalizeTurnInput,
    drafts: CandidateDraft[],
    filteredReasons: string[],
  ): { candidates: WriteBackCandidate[]; filtered_count: number; filtered_reasons: string[] } {
    const candidates = drafts
      .map((draft) => {
        if (draft.scope === "task" && !input.task_id) {
          filteredReasons.push(`missing_task_id:${draft.candidate_type}`);
          return null;
        }
        return buildCandidate(input, draft);
      })
      .filter((candidate): candidate is WriteBackCandidate => {
        if (!candidate) {
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
    };
  }

  private toDraftFromLlm(input: FinalizeTurnInput, candidate: LlmExtractionCandidate): CandidateDraft {
    const normalizedSummary = normalizeText(candidate.summary);
    const scope = candidate.scope === "task" && !input.task_id ? "session" : candidate.scope;
    const details: Record<string, unknown> = {
      extraction_method: "llm",
      extracted_summary: normalizedSummary,
      candidate_type: candidate.candidate_type,
    };

    if (scope === "task" && input.task_id) {
      details.task_id = input.task_id;
    }

    return {
      candidate_type: candidate.candidate_type,
      scope,
      summary: normalizedSummary,
      details,
      importance: candidate.importance,
      confidence: candidate.confidence,
      write_reason: candidate.write_reason,
      source_type: "writeback_llm",
      source_ref: input.turn_id ?? input.session_id,
      confirmed_by_user: candidate.candidate_type === "fact_preference" && scope === "user" ? true : undefined,
    };
  }

  async submit(input: FinalizeTurnInput): Promise<WritebackEngineResult> {
    const extraction = await this.extractCandidates(input);
    const { candidates, filtered_count, filtered_reasons } = extraction;
    if (candidates.length === 0) {
      return {
        candidates: [],
        submitted_jobs: [],
        filtered_count,
        filtered_reasons,
        degraded: false,
      };
    }

    const writebackResult = await this.dependencyGuard.run(
      "storage_writeback",
      this.config.STORAGE_TIMEOUT_MS,
      (signal) => this.storageClient.submitCandidates(candidates, signal),
    );

    if (!writebackResult.ok) {
      return {
        candidates,
        submitted_jobs: candidates.map((candidate) => ({
          candidate_summary: candidate.summary,
          status: "dependency_unavailable",
          reason: writebackResult.error?.message,
        })),
        filtered_count,
        filtered_reasons,
        degraded: true,
        degradation_reason: writebackResult.error?.code ?? "dependency_unavailable",
      };
    }

    return {
      candidates,
      submitted_jobs: writebackResult.value ?? [],
      filtered_count,
      filtered_reasons,
      degraded: false,
    };
  }
}
