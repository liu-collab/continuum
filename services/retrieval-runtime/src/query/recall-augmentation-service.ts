import type { Logger } from "pino";

import type { DependencyGuard } from "../dependency/dependency-guard.js";
import type { MemoryOrchestrator } from "../memory-orchestrator/index.js";
import type { RuntimeRepository } from "../observability/runtime-repository.js";
import { applyOpenConflictPenalty, compareRankedCandidates } from "./query-engine.js";
import type {
  CandidateMemory,
  MemoryMode,
  MemoryRelationSnapshot,
  ProactiveRecommendation,
  TriggerContext,
} from "../shared/types.js";
import { nowIso } from "../shared/utils.js";
import type { StorageWritebackClient } from "../writeback/storage-client.js";

const MEMORY_RELATION_PROMPT_VERSION = "memory-relation-plan-v1";
const MEMORY_RECOMMENDATION_PROMPT_VERSION = "memory-recommendation-plan-v1";
const MEMORY_PLAN_SCHEMA_VERSION = "memory-plan-schema-v1";

type RecallAugmentationStorageClient = Pick<
  StorageWritebackClient,
  "getRecordsByIds" | "listConflicts" | "listRecords" | "listRelations"
>;

type RecallAugmentationServiceOptions = {
  dependencyGuard: DependencyGuard;
  repository: Pick<RuntimeRepository, "recordMemoryPlanRun">;
  logger: Logger;
  embeddingTimeoutMs: number;
  memoryLlmTimeoutMs: number;
  memoryOrchestrator?: Pick<MemoryOrchestrator, "recommendation">;
  storageClient?: RecallAugmentationStorageClient;
};

export class RecallAugmentationService {
  constructor(private readonly options: RecallAugmentationServiceOptions) {}

  async collectProactiveRecommendations(
    context: TriggerContext & { memory_mode: MemoryMode },
    traceId: string,
  ): Promise<ProactiveRecommendation[]> {
    const recommender = this.options.memoryOrchestrator?.recommendation;
    if (!recommender || !this.options.storageClient) {
      return [];
    }

    const startedAt = Date.now();
    const recordsResult = await this.options.dependencyGuard.run(
      "storage_writeback",
      this.options.embeddingTimeoutMs,
      (signal) =>
        this.options.storageClient!.listRecords(
          {
            workspace_id: context.workspace_id,
            user_id: context.user_id,
            status: "active",
            page: 1,
            page_size: 12,
          },
          signal,
        ),
    );

    if (!recordsResult.ok || !recordsResult.value) {
      await this.options.repository.recordMemoryPlanRun({
        trace_id: traceId,
        phase: context.phase,
        plan_kind: "memory_recommendation_plan",
        input_summary: summarizeText(`session=${context.session_id}`),
        output_summary: summarizeText(`fallback=${recordsResult.error?.code ?? "storage_writeback_unavailable"}`),
        prompt_version: MEMORY_RECOMMENDATION_PROMPT_VERSION,
        schema_version: MEMORY_PLAN_SCHEMA_VERSION,
        degraded: true,
        degradation_reason: recordsResult.error?.code ?? "storage_writeback_unavailable",
        result_state: "fallback",
        duration_ms: Date.now() - startedAt,
        created_at: nowIso(),
      });
      return [];
    }

    const availableMemories = recordsResult.value.items.slice(0, 12);
    if (availableMemories.length === 0) {
      await this.options.repository.recordMemoryPlanRun({
        trace_id: traceId,
        phase: context.phase,
        plan_kind: "memory_recommendation_plan",
        input_summary: summarizeText(`session=${context.session_id}`),
        output_summary: summarizeText("recommendations=0"),
        prompt_version: MEMORY_RECOMMENDATION_PROMPT_VERSION,
        schema_version: MEMORY_PLAN_SCHEMA_VERSION,
        degraded: false,
        result_state: "skipped",
        duration_ms: Date.now() - startedAt,
        created_at: nowIso(),
      });
      return [];
    }

    const planResult = await this.options.dependencyGuard.run(
      "memory_llm",
      this.options.memoryLlmTimeoutMs,
      () =>
        recommender.recommend({
          current_context: {
            user_input: context.current_input,
            session_context: {
              session_id: context.session_id,
              workspace_id: context.workspace_id,
              user_id: context.user_id,
              recent_context_summary: context.recent_context_summary,
            },
          },
          available_memories: availableMemories,
        }),
    );

    if (!planResult.ok || !planResult.value) {
      await this.options.repository.recordMemoryPlanRun({
        trace_id: traceId,
        phase: context.phase,
        plan_kind: "memory_recommendation_plan",
        input_summary: summarizeText(`available=${availableMemories.length}`),
        output_summary: summarizeText(`fallback=${planResult.error?.code ?? "memory_llm_unavailable"}`),
        prompt_version: MEMORY_RECOMMENDATION_PROMPT_VERSION,
        schema_version: MEMORY_PLAN_SCHEMA_VERSION,
        degraded: true,
        degradation_reason: planResult.error?.code ?? "memory_llm_unavailable",
        result_state: "fallback",
        duration_ms: Date.now() - startedAt,
        created_at: nowIso(),
      });
      return [];
    }

    const recommendations = planResult.value.recommendations
      .filter((item) => item.relevance_score >= 0.7)
      .map((item) => ({
        record_id: item.record_id,
        relevance_score: item.relevance_score,
        trigger_reason: item.trigger_reason,
        suggestion: item.suggestion,
        auto_inject: item.auto_inject || item.relevance_score > 0.9,
      })) satisfies ProactiveRecommendation[];

    await this.options.repository.recordMemoryPlanRun({
      trace_id: traceId,
      phase: context.phase,
      plan_kind: "memory_recommendation_plan",
      input_summary: summarizeText(`available=${availableMemories.length}`),
      output_summary: summarizeText(
        `recommendations=${recommendations.length}; auto_inject=${recommendations.filter((item) => item.auto_inject).length}`,
      ),
      prompt_version: MEMORY_RECOMMENDATION_PROMPT_VERSION,
      schema_version: MEMORY_PLAN_SCHEMA_VERSION,
      degraded: false,
      result_state: recommendations.length > 0 ? "planned" : "skipped",
      duration_ms: Date.now() - startedAt,
      created_at: nowIso(),
    });

    return recommendations;
  }

  async expandCandidatesWithRelations(
    context: TriggerContext & { memory_mode: MemoryMode },
    candidates: CandidateMemory[],
    traceId: string,
  ): Promise<CandidateMemory[]> {
    if (!this.options.storageClient || candidates.length === 0) {
      return [];
    }

    const startedAt = Date.now();
    const sourceIds = candidates.slice(0, 5).map((candidate) => candidate.id);
    const relationItems: MemoryRelationSnapshot[] = [];

    for (const recordId of sourceIds) {
      const relationsResult = await this.options.dependencyGuard.run(
        "storage_writeback",
        this.options.embeddingTimeoutMs,
        (signal) =>
          this.options.storageClient!.listRelations(
            {
              workspace_id: context.workspace_id,
              record_id: recordId,
              limit: 20,
            },
            signal,
          ),
      );
      if (!relationsResult.ok || !relationsResult.value) {
        await this.options.repository.recordMemoryPlanRun({
          trace_id: traceId,
          phase: context.phase,
          plan_kind: "memory_relation_plan",
          input_summary: summarizeText(`seed=${sourceIds.join(",")}`),
          output_summary: summarizeText(`fallback=${relationsResult.error?.code ?? "storage_writeback_unavailable"}`),
          prompt_version: MEMORY_RELATION_PROMPT_VERSION,
          schema_version: MEMORY_PLAN_SCHEMA_VERSION,
          degraded: true,
          degradation_reason: relationsResult.error?.code ?? "storage_writeback_unavailable",
          result_state: "fallback",
          duration_ms: Date.now() - startedAt,
          created_at: nowIso(),
        });
        return [];
      }
      relationItems.push(...relationsResult.value);
    }

    const relationTargetIds = [...new Set(
      relationItems
        .filter((relation) => relation.strength >= 0.7)
        .map((relation) => relation.source_record_id === relation.target_record_id ? null : relation.target_record_id)
        .filter((id): id is string => typeof id === "string" && !sourceIds.includes(id)),
    )];

    if (relationTargetIds.length === 0) {
      await this.options.repository.recordMemoryPlanRun({
        trace_id: traceId,
        phase: context.phase,
        plan_kind: "memory_relation_plan",
        input_summary: summarizeText(`seed=${sourceIds.join(",")}`),
        output_summary: summarizeText("relations=0"),
        prompt_version: MEMORY_RELATION_PROMPT_VERSION,
        schema_version: MEMORY_PLAN_SCHEMA_VERSION,
        degraded: false,
        result_state: "skipped",
        duration_ms: Date.now() - startedAt,
        created_at: nowIso(),
      });
      return [];
    }

    const relatedRecordsResult = await this.options.dependencyGuard.run(
      "storage_writeback",
      this.options.embeddingTimeoutMs,
      (signal) => this.options.storageClient!.getRecordsByIds(relationTargetIds, signal),
    );

    if (!relatedRecordsResult.ok || !relatedRecordsResult.value) {
      await this.options.repository.recordMemoryPlanRun({
        trace_id: traceId,
        phase: context.phase,
        plan_kind: "memory_relation_plan",
        input_summary: summarizeText(`targets=${relationTargetIds.join(",")}`),
        output_summary: summarizeText(`fallback=${relatedRecordsResult.error?.code ?? "storage_writeback_unavailable"}`),
        prompt_version: MEMORY_RELATION_PROMPT_VERSION,
        schema_version: MEMORY_PLAN_SCHEMA_VERSION,
        degraded: true,
        degradation_reason: relatedRecordsResult.error?.code ?? "storage_writeback_unavailable",
        result_state: "fallback",
        duration_ms: Date.now() - startedAt,
        created_at: nowIso(),
      });
      return [];
    }

    const relationByTarget = new Map<string, MemoryRelationSnapshot>();
    for (const relation of relationItems) {
      if (!relationByTarget.has(relation.target_record_id)) {
        relationByTarget.set(relation.target_record_id, relation);
      }
    }

    const relatedCandidates = relatedRecordsResult.value
      .filter((record) => record.status === "active")
      .map((record) => {
        const relation = relationByTarget.get(record.id);
        return {
          id: record.id,
          workspace_id: record.workspace_id,
          user_id: record.user_id ?? context.user_id,
          task_id: record.task_id ?? null,
          session_id: record.session_id ?? null,
          memory_type: record.memory_type,
          scope: record.scope,
          summary: record.summary,
          details: {
            ...(record.details ?? {}),
            relation_type: relation?.relation_type,
            relation_reason: relation?.reason,
            relation_strength: relation?.strength,
          },
          importance: Math.max(record.importance, relation?.strength ? Math.round(relation.strength * 5) : record.importance),
          confidence: record.confidence,
          status: record.status,
          updated_at: record.updated_at,
          last_confirmed_at: null,
          rerank_score: relation?.strength ?? 0.7,
        } satisfies CandidateMemory;
      });
    const conflictAwareRelatedCandidates = await this.annotateOpenConflicts(context, relatedCandidates);

    await this.options.repository.recordMemoryPlanRun({
      trace_id: traceId,
      phase: context.phase,
      plan_kind: "memory_relation_plan",
      input_summary: summarizeText(`seed=${sourceIds.join(",")}`),
      output_summary: summarizeText(`relations=${relationItems.length}; expanded=${conflictAwareRelatedCandidates.length}`),
      prompt_version: MEMORY_RELATION_PROMPT_VERSION,
      schema_version: MEMORY_PLAN_SCHEMA_VERSION,
      degraded: false,
      result_state: conflictAwareRelatedCandidates.length > 0 ? "planned" : "skipped",
      duration_ms: Date.now() - startedAt,
      created_at: nowIso(),
    });

    return conflictAwareRelatedCandidates;
  }

  async annotateOpenConflicts(
    context: Pick<TriggerContext, "workspace_id">,
    candidates: CandidateMemory[],
  ): Promise<CandidateMemory[]> {
    if (!this.options.storageClient || candidates.length === 0) {
      return candidates;
    }

    const result = await this.options.dependencyGuard.run(
      "storage_writeback",
      this.options.embeddingTimeoutMs,
      (signal) => this.options.storageClient!.listConflicts("open", signal),
    );

    if (!result.ok || !result.value) {
      this.options.logger.warn(
        {
          workspace_id: context.workspace_id,
          code: result.error?.code,
          detail: result.error?.message,
        },
        "open conflict lookup degraded",
      );
      return candidates;
    }

    const candidateIds = new Set(candidates.map((candidate) => candidate.id));
    const conflictedIds = new Set<string>();
    for (const conflict of result.value) {
      if (conflict.workspace_id !== context.workspace_id) {
        continue;
      }
      if (candidateIds.has(conflict.record_id)) {
        conflictedIds.add(conflict.record_id);
      }
      if (candidateIds.has(conflict.conflict_with_record_id)) {
        conflictedIds.add(conflict.conflict_with_record_id);
      }
    }

    if (conflictedIds.size === 0) {
      return candidates;
    }

    return candidates
      .map((candidate) => {
        if (!conflictedIds.has(candidate.id)) {
          return candidate;
        }

        return {
          ...candidate,
          has_open_conflict: true,
          rerank_score: applyOpenConflictPenalty(
            { has_open_conflict: true },
            candidate.rerank_score ?? 0,
          ),
        } satisfies CandidateMemory;
      })
      .sort(compareRankedCandidates);
  }
}

function summarizeText(value: string | undefined, maxLength = 220) {
  if (!value) {
    return "";
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}
