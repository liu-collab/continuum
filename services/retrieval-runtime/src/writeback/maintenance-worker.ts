import { createHash, randomUUID } from "node:crypto";
import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import type { DependencyGuard } from "../dependency/dependency-guard.js";
import type {
  GovernanceAction,
  GovernancePlan,
  GovernancePlanner,
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

export class WritebackMaintenanceWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly repository: RuntimeRepository,
    private readonly storageClient: StorageWritebackClient,
    private readonly planner: GovernancePlanner | undefined,
    private readonly verifier: GovernanceVerifier | undefined,
    private readonly dependencyGuard: DependencyGuard,
    private readonly config: AppConfig,
    private readonly logger: Logger,
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

    if (this.running) {
      summary.degraded = true;
      summary.degradation_reason = "maintenance_already_running";
      return summary;
    }
    this.running = true;
    try {
      const workspaces = await this.selectWorkspaces(options, summary.next_checkpoint);
      for (const workspaceId of workspaces) {
        await this.processWorkspace(workspaceId, summary).catch((error) => {
          summary.degraded = true;
          summary.degradation_reason = summary.degradation_reason ?? (error instanceof Error ? error.message : String(error));
          this.logger.warn({ err: error, workspace_id: workspaceId }, "maintenance workspace failed");
        });
        summary.workspace_ids_scanned.push(workspaceId);
      }

      this.logger.info({ maintenance: summary }, "writeback maintenance tick");
      return summary;
    } finally {
      this.running = false;
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

    if (seeds.length + related.length < 2 && conflicts.length === 0) {
      await this.repository.upsertMaintenanceCheckpoint({
        workspace_id: workspaceId,
        last_scanned_at: summary.next_checkpoint,
      });
      return;
    }

    if (!this.planner) {
      summary.degraded = true;
      summary.degradation_reason = summary.degradation_reason ?? "writeback_llm_unavailable";
      await this.repository.upsertMaintenanceCheckpoint({
        workspace_id: workspaceId,
        last_scanned_at: summary.next_checkpoint,
      });
      return;
    }

    const planResult = await this.dependencyGuard.run(
      "writeback_llm",
      this.config.WRITEBACK_MAINTENANCE_TIMEOUT_MS,
      () =>
        this.planner!.plan({
          seed_records: workspaceContext.seed_records,
          related_records: workspaceContext.related_records,
          open_conflicts: workspaceContext.open_conflicts,
        }),
    );

    if (!planResult.ok || !planResult.value) {
      summary.degraded = true;
      summary.degradation_reason = summary.degradation_reason ?? planResult.error?.code ?? "writeback_llm_unavailable";
      await this.repository.upsertMaintenanceCheckpoint({
        workspace_id: workspaceId,
        last_scanned_at: summary.next_checkpoint,
      });
      return;
    }

    const plan = this.capPlan(planResult.value);
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
      "writeback_llm",
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
        model: "writeback_llm",
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
        model: "writeback_llm",
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
}
