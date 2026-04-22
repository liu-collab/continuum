import { createHash, randomUUID } from "node:crypto";
import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import type { DependencyGuard } from "../dependency/dependency-guard.js";
import { ConflictAppError } from "../errors.js";
import type {
  GovernanceAction,
  GovernancePlan,
  GovernancePlanner,
  RelationDiscoverer,
  EvolutionPlanner,
  GovernanceVerifier,
} from "../memory-orchestrator/index.js";
import type { RuntimeRepository } from "../observability/runtime-repository.js";
import type {
  GovernanceExecutionBatch,
  GovernanceExecutionItem,
  MaintenanceRunSummary,
  MemoryConflictSnapshot,
  MemoryRecordSnapshot,
  MemoryType,
  ScopeType,
} from "../shared/types.js";
import { jaccardOverlap, nowIso } from "../shared/utils.js";
import type { StorageWritebackClient } from "./storage-client.js";

const GOVERNANCE_PLAN_PROMPT_VERSION = "memory-governance-plan-v1";
const GOVERNANCE_PLAN_SCHEMA_VERSION = "memory-governance-schema-v1";
const RELATION_PLAN_PROMPT_VERSION = "memory-relation-plan-v1";
const EVOLUTION_PLAN_PROMPT_VERSION = "memory-evolution-plan-v1";

export interface MaintenanceWorkerOptions {
  workspaceId?: string;
  forced?: boolean;
}

interface ApplyOutcome {
  applied: number;
  skipped: number;
  conflicts_resolved: number;
}

interface WorkspaceMaintenanceContext {
  seed_records: MemoryRecordSnapshot[];
  related_records: MemoryRecordSnapshot[];
  open_conflicts: MemoryConflictSnapshot[];
}

function summarizePlanText(value: string, maxLength = 220) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

export class WritebackMaintenanceWorker {
  private timer: NodeJS.Timeout | null = null;
  private sweepRunning = false;
  private readonly workspaceLocks = new Set<string>();

  constructor(
    private readonly repository: RuntimeRepository,
    private readonly storageClient: StorageWritebackClient,
    private readonly planner: GovernancePlanner | undefined,
    private readonly verifier: GovernanceVerifier | undefined,
    private readonly dependencyGuard: DependencyGuard,
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly relationDiscoverer?: RelationDiscoverer,
    private readonly evolutionPlanner?: EvolutionPlanner,
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }
    if (!this.config.WRITEBACK_MAINTENANCE_ENABLED) {
      return;
    }
    this.timer = setInterval(() => {
      void this.runOnce().catch((error) => {
        this.logger.warn({ err: error }, "writeback maintenance tick failed");
      });
    }, this.config.WRITEBACK_MAINTENANCE_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(options: MaintenanceWorkerOptions = {}): Promise<MaintenanceRunSummary> {
    const summary: MaintenanceRunSummary = {
      workspace_ids_scanned: [],
      seeds_inspected: 0,
      related_fetched: 0,
      actions_proposed: 0,
      actions_applied: 0,
      actions_skipped: 0,
      conflicts_resolved: 0,
      degraded: false,
      next_checkpoint: nowIso(),
    };

    if (!options.workspaceId && this.sweepRunning) {
      summary.degraded = true;
      summary.degradation_reason = "maintenance_already_running";
      return summary;
    }
    if (options.workspaceId) {
      if (this.workspaceLocks.has(options.workspaceId)) {
        throw new ConflictAppError("maintenance workspace is already running", {
          workspace_id: options.workspaceId,
        });
      }
      this.workspaceLocks.add(options.workspaceId);
    }
    if (!options.workspaceId) {
      this.sweepRunning = true;
    }
    try {
      const workspaces = await this.selectWorkspaces(options, summary.next_checkpoint);
      for (const workspaceId of workspaces) {
        if (options.workspaceId) {
          await this.processWorkspace(workspaceId, summary);
        } else {
          await this.withWorkspaceLock(workspaceId, () => this.processWorkspace(workspaceId, summary)).catch((error) => {
            summary.degraded = true;
            summary.degradation_reason = summary.degradation_reason ?? (error instanceof Error ? error.message : String(error));
            this.logger.warn({ err: error, workspace_id: workspaceId }, "maintenance workspace failed");
          });
        }
        summary.workspace_ids_scanned.push(workspaceId);
      }

      this.logger.info({ maintenance: summary }, "writeback maintenance tick");
      return summary;
    } finally {
      if (options.workspaceId) {
        this.workspaceLocks.delete(options.workspaceId);
      }
      if (!options.workspaceId) {
        this.sweepRunning = false;
      }
    }
  }

  private async selectWorkspaces(
    options: MaintenanceWorkerOptions,
    now: string,
  ): Promise<string[]> {
    const batch = this.config.WRITEBACK_MAINTENANCE_WORKSPACE_BATCH;

    if (options.workspaceId) {
      return [options.workspaceId];
    }

    const minInterval = options.forced ? 0 : this.config.WRITEBACK_MAINTENANCE_WORKSPACE_INTERVAL_MS;
    const checkpoints = await this.repository.getMaintenanceCheckpoints(now, minInterval, batch);
    const ids = new Set<string>();
    for (const record of checkpoints) {
      ids.add(record.workspace_id);
    }

    if (ids.size < batch) {
      const lookback = new Date(Date.parse(now) - this.config.WRITEBACK_MAINTENANCE_SEED_LOOKBACK_MS).toISOString();
      const recent = await this.repository.listWorkspacesWithRecentWrites(lookback, batch);
      for (const workspaceId of recent) {
        if (ids.size >= batch) {
          break;
        }
        ids.add(workspaceId);
      }
    }

    return [...ids];
  }

  private async processWorkspace(workspaceId: string, summary: MaintenanceRunSummary): Promise<void> {
    const traceId = `maintenance:${workspaceId}:${summary.next_checkpoint}`;
    await this.repository.recordTurn({
      trace_id: traceId,
      host: "memory_native_agent",
      workspace_id: workspaceId,
      user_id: this.config.WRITEBACK_MAINTENANCE_ACTOR_ID,
      session_id: `maintenance:${workspaceId}`,
      phase: "after_response",
      current_input: `governance maintenance scan for workspace ${workspaceId}`,
      assistant_output: "memory governance maintenance",
      created_at: summary.next_checkpoint,
    });

    const seeds = await this.fetchSeeds(workspaceId);
    summary.seeds_inspected += seeds.length;

    const related = await this.fetchRelated(workspaceId, seeds);
    summary.related_fetched += related.length;

    const conflicts = await this.fetchConflicts(workspaceId);
    const workspaceContext: WorkspaceMaintenanceContext = {
      seed_records: seeds,
      related_records: related,
      open_conflicts: conflicts,
    };

    await this.discoverRelations(workspaceId, seeds, related, traceId, summary.next_checkpoint);
    await this.planEvolution(workspaceId, seeds, related, traceId, summary.next_checkpoint);

    if (seeds.length + related.length < 2 && conflicts.length === 0) {
      await this.repository.upsertMaintenanceCheckpoint({
        workspace_id: workspaceId,
        last_scanned_at: summary.next_checkpoint,
      });
      return;
    }

    if (!this.planner) {
      summary.degraded = true;
      summary.degradation_reason = summary.degradation_reason ?? "memory_llm_unavailable";
      await this.repository.upsertMaintenanceCheckpoint({
        workspace_id: workspaceId,
        last_scanned_at: summary.next_checkpoint,
      });
      return;
    }

    const planStartedAt = Date.now();
    const planResult = await this.dependencyGuard.run(
      "memory_llm",
      this.config.WRITEBACK_MAINTENANCE_TIMEOUT_MS,
      () =>
        this.planner!.plan({
          seed_records: workspaceContext.seed_records,
          related_records: workspaceContext.related_records,
          open_conflicts: workspaceContext.open_conflicts,
        }),
    );

    if (!planResult.ok || !planResult.value) {
      await this.repository.recordMemoryPlanRun({
        trace_id: traceId,
        phase: "after_response",
        plan_kind: "memory_governance_plan",
        input_summary: summarizePlanText(
          `workspace=${workspaceId}; seeds=${seeds.length}; related=${related.length}; conflicts=${conflicts.length}`,
        ),
        output_summary: summarizePlanText(`fallback=${planResult.error?.code ?? "memory_llm_unavailable"}`),
        prompt_version: GOVERNANCE_PLAN_PROMPT_VERSION,
        schema_version: GOVERNANCE_PLAN_SCHEMA_VERSION,
        degraded: true,
        degradation_reason: planResult.error?.code ?? "memory_llm_unavailable",
        result_state: "fallback",
        duration_ms: Date.now() - planStartedAt,
        created_at: summary.next_checkpoint,
      });
      summary.degraded = true;
      summary.degradation_reason = summary.degradation_reason ?? planResult.error?.code ?? "memory_llm_unavailable";
      await this.repository.upsertMaintenanceCheckpoint({
        workspace_id: workspaceId,
        last_scanned_at: summary.next_checkpoint,
      });
      return;
    }

    const plan = this.capPlan(planResult.value);
    await this.repository.recordMemoryPlanRun({
      trace_id: traceId,
      phase: "after_response",
      plan_kind: "memory_governance_plan",
      input_summary: summarizePlanText(
        `workspace=${workspaceId}; seeds=${seeds.length}; related=${related.length}; conflicts=${conflicts.length}`,
      ),
      output_summary: summarizePlanText(
        `actions=${plan.actions.length}; notes=${plan.notes ?? ""}; action_types=${plan.actions.map((action) => action.type).join(",")}`,
      ),
      prompt_version: GOVERNANCE_PLAN_PROMPT_VERSION,
      schema_version: GOVERNANCE_PLAN_SCHEMA_VERSION,
      degraded: false,
      result_state: plan.actions.length > 0 ? "planned" : "skipped",
      duration_ms: Date.now() - planStartedAt,
      created_at: summary.next_checkpoint,
    });
    summary.actions_proposed += plan.actions.length;

    const outcome = await this.applyActions(workspaceId, plan, workspaceContext);
    summary.actions_applied += outcome.applied;
    summary.actions_skipped += outcome.skipped;
    summary.conflicts_resolved += outcome.conflicts_resolved;

    await this.repository.upsertMaintenanceCheckpoint({
      workspace_id: workspaceId,
      last_scanned_at: summary.next_checkpoint,
    });
  }

  private async discoverRelations(
    workspaceId: string,
    seeds: MemoryRecordSnapshot[],
    related: MemoryRecordSnapshot[],
    traceId: string,
    createdAt: string,
  ) {
    if (!this.relationDiscoverer || seeds.length === 0 || related.length === 0) {
      return;
    }

    const startedAt = Date.now();
    let proposed = 0;
    for (const seed of seeds.slice(0, 5)) {
      const candidates = related.filter((record) => record.id !== seed.id).slice(0, 10);
      if (candidates.length === 0) {
        continue;
      }

      const planResult = await this.dependencyGuard.run(
        "memory_llm",
        this.config.WRITEBACK_MAINTENANCE_TIMEOUT_MS,
        () =>
          this.relationDiscoverer!.discover({
            source_record: seed,
            candidate_records: candidates,
            context: {
              workspace_id: workspaceId,
              user_id: this.config.WRITEBACK_MAINTENANCE_ACTOR_ID,
            },
          }),
      );

      if (!planResult.ok || !planResult.value) {
        await this.repository.recordMemoryPlanRun({
          trace_id: traceId,
          phase: "after_response",
          plan_kind: "memory_relation_plan",
          input_summary: summarizePlanText(`workspace=${workspaceId}; source=${seed.id}; candidates=${candidates.length}`),
          output_summary: summarizePlanText(`fallback=${planResult.error?.code ?? "memory_llm_unavailable"}`),
          prompt_version: RELATION_PLAN_PROMPT_VERSION,
          schema_version: GOVERNANCE_PLAN_SCHEMA_VERSION,
          degraded: true,
          degradation_reason: planResult.error?.code ?? "memory_llm_unavailable",
          result_state: "fallback",
          duration_ms: Date.now() - startedAt,
          created_at: createdAt,
        });
        continue;
      }

      const relations = planResult.value.relations
        .filter((relation) => relation.strength >= 0.7)
        .map((relation) => ({
          workspace_id: workspaceId,
          source_record_id: seed.id,
          target_record_id: relation.target_record_id,
          relation_type: relation.relation_type,
          strength: relation.strength,
          bidirectional: relation.bidirectional,
          reason: relation.reason,
          created_by_service: "retrieval-runtime",
        }));

      proposed += relations.length;
      if (relations.length > 0) {
        await this.runStorage((signal) => this.storageClient.upsertRelations(relations, signal));
      }
    }

    await this.repository.recordMemoryPlanRun({
      trace_id: traceId,
      phase: "after_response",
      plan_kind: "memory_relation_plan",
      input_summary: summarizePlanText(`workspace=${workspaceId}; seeds=${seeds.length}; related=${related.length}`),
      output_summary: summarizePlanText(`relations=${proposed}`),
      prompt_version: RELATION_PLAN_PROMPT_VERSION,
      schema_version: GOVERNANCE_PLAN_SCHEMA_VERSION,
      degraded: false,
      result_state: proposed > 0 ? "planned" : "skipped",
      duration_ms: Date.now() - startedAt,
      created_at: createdAt,
    });
  }

  private async planEvolution(
    workspaceId: string,
    seeds: MemoryRecordSnapshot[],
    related: MemoryRecordSnapshot[],
    traceId: string,
    createdAt: string,
  ) {
    if (!this.evolutionPlanner) {
      return;
    }

    const sourceRecords = [...seeds, ...related].slice(0, 12);
    if (sourceRecords.length < 2) {
      return;
    }

    const startedAt = Date.now();
    const planResult = await this.dependencyGuard.run(
      "memory_llm",
      this.config.WRITEBACK_MAINTENANCE_TIMEOUT_MS,
      () =>
        this.evolutionPlanner!.plan({
          source_records: sourceRecords,
          time_window: {
            start: new Date(Date.now() - this.config.WRITEBACK_MAINTENANCE_SEED_LOOKBACK_MS).toISOString(),
            end: createdAt,
          },
          evolution_type: sourceRecords.length >= 6 ? "knowledge_extraction" : "summarization",
        }),
    );

    if (!planResult.ok || !planResult.value) {
      await this.repository.recordMemoryPlanRun({
        trace_id: traceId,
        phase: "after_response",
        plan_kind: "memory_evolution_plan",
        input_summary: summarizePlanText(`workspace=${workspaceId}; sources=${sourceRecords.length}`),
        output_summary: summarizePlanText(`fallback=${planResult.error?.code ?? "memory_llm_unavailable"}`),
        prompt_version: EVOLUTION_PLAN_PROMPT_VERSION,
        schema_version: GOVERNANCE_PLAN_SCHEMA_VERSION,
        degraded: true,
        degradation_reason: planResult.error?.code ?? "memory_llm_unavailable",
        result_state: "fallback",
        duration_ms: Date.now() - startedAt,
        created_at: createdAt,
      });
      return;
    }

    const evolutionPlan = planResult.value;

    if (evolutionPlan.extracted_knowledge) {
      const knowledge = evolutionPlan.extracted_knowledge;
      const candidate_type = knowledge.suggested_scope === "user" ? "fact_preference" : "episodic";
      await this.runStorage((signal) =>
        this.storageClient.submitCandidates(
          [
            {
              workspace_id: workspaceId,
              user_id: knowledge.suggested_scope === "user" ? sourceRecords[0]?.user_id ?? null : null,
              task_id: null,
              session_id: null,
              candidate_type,
              scope: knowledge.suggested_scope,
              summary: knowledge.pattern,
              details: {
                evolution_type: evolutionPlan.evolution_type,
                evidence_count: knowledge.evidence_count,
                source_record_ids: evolutionPlan.source_records,
              },
              importance: knowledge.suggested_importance,
              confidence: knowledge.confidence,
              write_reason: `memory evolution ${evolutionPlan.evolution_type}`,
              source: {
                source_type: "memory_evolution",
                source_ref: traceId,
                service_name: "retrieval-runtime",
              },
              idempotency_key: `${traceId}:${evolutionPlan.evolution_type}:${knowledge.pattern}`,
            },
          ],
          signal,
        ),
      );
    }

    await this.repository.recordMemoryPlanRun({
      trace_id: traceId,
      phase: "after_response",
      plan_kind: "memory_evolution_plan",
      input_summary: summarizePlanText(`workspace=${workspaceId}; sources=${sourceRecords.length}`),
      output_summary: summarizePlanText(
        `evolution_type=${evolutionPlan.evolution_type}; knowledge=${evolutionPlan.extracted_knowledge ? 1 : 0}; archive=${evolutionPlan.consolidation_plan?.records_to_archive.length ?? 0}`,
      ),
      prompt_version: EVOLUTION_PLAN_PROMPT_VERSION,
      schema_version: GOVERNANCE_PLAN_SCHEMA_VERSION,
      degraded: false,
      result_state: evolutionPlan.extracted_knowledge || evolutionPlan.consolidation_plan ? "planned" : "skipped",
      duration_ms: Date.now() - startedAt,
      created_at: createdAt,
    });
  }

  private capPlan(plan: GovernancePlan): GovernancePlan {
    return {
      actions: plan.actions.slice(0, this.config.WRITEBACK_MAINTENANCE_MAX_ACTIONS),
      notes: plan.notes,
    };
  }

  private async fetchSeeds(workspaceId: string): Promise<MemoryRecordSnapshot[]> {
    const lookbackMs = this.config.WRITEBACK_MAINTENANCE_SEED_LOOKBACK_MS;
    const threshold = Date.now() - lookbackMs;

    const response = await this.runStorage((signal) =>
      this.storageClient.listRecords(
        {
          workspace_id: workspaceId,
          status: "active",
          page: 1,
          page_size: this.config.WRITEBACK_MAINTENANCE_SEED_LIMIT,
        },
        signal,
      ),
    );
    if (!response) {
      return [];
    }

    return response.items.filter((record) => {
      const createdAt = Date.parse(record.created_at);
      if (!Number.isFinite(createdAt)) {
        return true;
      }
      return createdAt >= threshold;
    });
  }

  private async fetchRelated(
    workspaceId: string,
    seeds: MemoryRecordSnapshot[],
  ): Promise<MemoryRecordSnapshot[]> {
    if (seeds.length === 0) {
      return [];
    }

    const groupKey = (scope: ScopeType, memoryType: MemoryType) => `${scope}::${memoryType}`;
    const groups = new Map<string, { scope: ScopeType; memory_type: MemoryType; seeds: MemoryRecordSnapshot[] }>();
    for (const seed of seeds) {
      const key = groupKey(seed.scope, seed.memory_type);
      const bucket = groups.get(key) ?? {
        scope: seed.scope,
        memory_type: seed.memory_type,
        seeds: [],
      };
      bucket.seeds.push(seed);
      groups.set(key, bucket);
    }

    const seedIds = new Set(seeds.map((seed) => seed.id));
    const related = new Map<string, MemoryRecordSnapshot>();

    for (const bucket of groups.values()) {
      const response = await this.runStorage((signal) =>
        this.storageClient.listRecords(
          {
            workspace_id: workspaceId,
            scope: bucket.scope,
            memory_type: bucket.memory_type,
            status: "active",
            page: 1,
            page_size: this.config.WRITEBACK_MAINTENANCE_RELATED_LIMIT,
          },
          signal,
        ),
      );
      if (!response) {
        continue;
      }
      for (const candidate of response.items) {
        if (seedIds.has(candidate.id) || related.has(candidate.id)) {
          continue;
        }
        const maxOverlap = Math.max(
          0,
          ...bucket.seeds.map((seed) => jaccardOverlap(seed.summary, candidate.summary)),
        );
        if (maxOverlap >= this.config.WRITEBACK_MAINTENANCE_SIMILARITY_THRESHOLD) {
          related.set(candidate.id, candidate);
        }
      }
    }

    return [...related.values()];
  }

  private async fetchConflicts(workspaceId: string): Promise<MemoryConflictSnapshot[]> {
    const response = await this.runStorage((signal) => this.storageClient.listConflicts("open", signal));
    if (!response) {
      return [];
    }
    return response.filter((conflict) => conflict.workspace_id === workspaceId).slice(0, 10);
  }

  private async applyActions(
    workspaceId: string,
    plan: GovernancePlan,
    workspaceContext: WorkspaceMaintenanceContext,
  ): Promise<ApplyOutcome> {
    const outcome: ApplyOutcome = {
      applied: 0,
      skipped: 0,
      conflicts_resolved: 0,
    };
    const items: GovernanceExecutionItem[] = [];
    for (const action of plan.actions) {
      const built = await this.buildExecutionItem(workspaceId, action, workspaceContext);
      if (!built) {
        outcome.skipped += 1;
        continue;
      }
      items.push(built);
      if (action.type === "resolve_conflict") {
        outcome.conflicts_resolved += 1;
      }
    }

    if (items.length === 0) {
      return outcome;
    }

    if (this.config.WRITEBACK_GOVERNANCE_SHADOW_MODE) {
      outcome.applied += items.length;
      this.logger.info(
        { workspace_id: workspaceId, item_count: items.length },
        "maintenance governance shadow mode enabled, skipping storage execution",
      );
      return outcome;
    }

    const batch: GovernanceExecutionBatch = {
      workspace_id: workspaceId,
      source_service: "retrieval-runtime",
      items,
    };

    try {
      const results = await this.storageClient.submitGovernanceExecutions(batch);
      outcome.applied += results.filter((result) => result.execution.execution_status === "executed").length;
      outcome.skipped += results.filter((result) => result.execution.execution_status !== "executed").length;
    } catch (error) {
      outcome.skipped += items.length;
      this.logger.warn({ err: error, workspace_id: workspaceId }, "maintenance governance execution batch failed");
    }

    return outcome;
  }

  private async runStorage<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    const result = await this.dependencyGuard.run(
      "storage_writeback",
      this.config.WRITEBACK_MAINTENANCE_TIMEOUT_MS,
      task,
    );
    if (!result.ok) {
      return undefined;
    }
    return result.value;
  }

  private async buildExecutionItem(
    workspaceId: string,
    action: GovernanceAction,
    workspaceContext: WorkspaceMaintenanceContext,
  ): Promise<GovernanceExecutionItem | null> {
    const base = this.toExecutionItem(workspaceId, action);
    if (!base) {
      return null;
    }

    const requiresVerifier = this.requiresVerifier(action);
    if (!requiresVerifier) {
      return base;
    }

    if (!this.config.WRITEBACK_GOVERNANCE_VERIFY_ENABLED) {
      this.logger.warn({ action_type: action.type }, "governance verifier disabled, skipping high-impact action");
      return null;
    }

    if (!this.verifier) {
      this.logger.warn({ action_type: action.type }, "governance verifier unavailable, skipping high-impact action");
      return null;
    }

    const verifyResult = await this.dependencyGuard.run(
      "memory_llm",
      this.config.WRITEBACK_MAINTENANCE_TIMEOUT_MS,
      () =>
        this.verifier!.verify({
          proposal: base,
          seed_records: workspaceContext.seed_records,
          related_records: workspaceContext.related_records,
          open_conflicts:
            action.type === "resolve_conflict"
              ? workspaceContext.open_conflicts.filter((conflict) => conflict.id === action.conflict_id)
              : workspaceContext.open_conflicts,
        }),
    );

    if (!verifyResult.ok || !verifyResult.value || verifyResult.value.decision !== "approve") {
      return null;
    }

    return {
      ...base,
      verifier: {
        required: true,
        model: "memory_llm",
        decision: verifyResult.value.decision,
        confidence: verifyResult.value.confidence,
        notes: verifyResult.value.notes,
      },
    };
  }

  private toExecutionItem(
    workspaceId: string,
    action: GovernanceAction,
  ): GovernanceExecutionItem | null {
    const proposalType = this.toProposalType(action);
    const proposalId = randomUUID();
    const base = {
      proposal_id: proposalId,
      reason_code: this.toReasonCode(action),
      reason_text: action.type === "resolve_conflict" ? action.resolution_note : action.reason,
      planner: {
        model: "memory_llm",
        confidence: this.toPlannerConfidence(action),
      },
      verifier: {
        required: this.requiresVerifier(action),
      },
      policy_version: "memory-governance-v1",
      idempotency_key: this.toIdempotencyKey(workspaceId, proposalType, action),
    } satisfies Omit<GovernanceExecutionItem, "proposal_type" | "targets" | "suggested_changes" | "evidence">;

    switch (action.type) {
      case "archive":
        return {
          ...base,
          proposal_type: "archive",
          targets: { record_ids: [action.record_id] },
          suggested_changes: { status: "archived" },
          evidence: { archive_reason: action.reason },
        };
      case "downgrade":
        if (action.new_importance < this.config.WRITEBACK_MAINTENANCE_MIN_IMPORTANCE) {
          return {
            ...base,
            proposal_type: "archive",
            targets: { record_ids: [action.record_id] },
            suggested_changes: { status: "archived" },
            evidence: {
              archive_reason: action.reason,
              downgraded_importance: action.new_importance,
              original_action: "downgrade",
            },
          };
        }
        return {
          ...base,
          proposal_type: "downgrade",
          targets: { record_ids: [action.record_id] },
          suggested_changes: { importance: action.new_importance },
          evidence: { downgrade_reason: action.reason },
        };
      case "merge":
        return {
          ...base,
          proposal_type: "merge",
          targets: { record_ids: action.target_record_ids },
          suggested_changes: {
            summary: action.merged_summary,
            importance: action.merged_importance,
          },
          evidence: { merged_from: action.target_record_ids },
        };
      case "summarize":
        return {
          ...base,
          proposal_type: "summarize",
          targets: { record_ids: action.source_record_ids },
          suggested_changes: {
            summary: action.new_summary,
            importance: action.new_importance,
            scope: action.scope,
            candidate_type: action.candidate_type,
          },
          evidence: { source_record_ids: action.source_record_ids },
        };
      case "resolve_conflict":
        return {
          ...base,
          proposal_type: "resolve_conflict",
          targets: {
            record_ids: action.activate_record_id ? [action.activate_record_id] : [],
            conflict_id: action.conflict_id,
            winner_record_id: action.activate_record_id,
          },
          suggested_changes: { status: "active" },
          evidence: { resolution_type: action.resolution_type },
        };
      case "delete":
        return {
          ...base,
          proposal_type: "delete",
          targets: { record_ids: [action.record_id] },
          suggested_changes: { delete_mode: "soft", status: "deleted" },
          evidence: { delete_reason: action.delete_reason },
        };
      default:
        return null;
    }
  }

  private requiresVerifier(action: GovernanceAction): boolean {
    return action.type === "merge" || action.type === "summarize" || action.type === "resolve_conflict" || action.type === "delete";
  }

  private toProposalType(action: GovernanceAction): GovernanceExecutionItem["proposal_type"] {
    if (action.type === "downgrade" && action.new_importance < this.config.WRITEBACK_MAINTENANCE_MIN_IMPORTANCE) {
      return "archive";
    }
    return action.type;
  }

  private toPlannerConfidence(action: GovernanceAction): number {
    if (action.type === "delete") {
      return this.config.WRITEBACK_GOVERNANCE_DELETE_MIN_CONFIDENCE;
    }
    if (
      action.type === "archive"
      || (action.type === "downgrade" && action.new_importance < this.config.WRITEBACK_MAINTENANCE_MIN_IMPORTANCE)
    ) {
      return this.config.WRITEBACK_GOVERNANCE_ARCHIVE_MIN_CONFIDENCE;
    }
    return 0.9;
  }

  private toReasonCode(action: GovernanceAction): string {
    switch (action.type) {
      case "archive":
        return "superseded_record";
      case "downgrade":
        return "obsolete_task_state";
      case "merge":
        return "duplicate_preference";
      case "summarize":
        return "stale_summary";
      case "resolve_conflict":
        return "conflict_resolved";
      case "delete":
        return "obsolete_task_state";
    }
  }

  private toIdempotencyKey(
    workspaceId: string,
    proposalType: GovernanceExecutionItem["proposal_type"],
    action: GovernanceAction,
  ): string {
    return createHash("sha256")
      .update(
        JSON.stringify({
          workspaceId,
          proposalType,
          action,
        }),
      )
      .digest("hex");
  }

  private async withWorkspaceLock<T>(
    workspaceId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    if (this.workspaceLocks.has(workspaceId)) {
      throw new ConflictAppError("maintenance workspace is already running", {
        workspace_id: workspaceId,
      });
    }

    this.workspaceLocks.add(workspaceId);
    try {
      return await task();
    } finally {
      this.workspaceLocks.delete(workspaceId);
    }
  }
}
