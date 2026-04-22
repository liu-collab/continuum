import { createHash } from "node:crypto";

import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import type { DependencyGuard } from "../dependency/dependency-guard.js";
import type { RuntimeRepository } from "../observability/runtime-repository.js";
import type {
  MaintenanceRunSummary,
  MemoryConflictSnapshot,
  MemoryRecordSnapshot,
  MemoryType,
  ScopeType,
  SubmittedWriteBackJob,
  WriteBackCandidate,
} from "../shared/types.js";
import { jaccardOverlap, nowIso } from "../shared/utils.js";
import type {
  LlmMaintenancePlanner,
  MaintenanceAction,
  MaintenancePlan,
} from "./llm-maintenance-planner.js";
import type {
  StorageActor,
  StorageWritebackClient,
} from "./storage-client.js";

export interface MaintenanceWorkerOptions {
  workspaceId?: string;
  forced?: boolean;
}

interface ApplyOutcome {
  applied: number;
  skipped: number;
  conflicts_resolved: number;
  submitted_jobs: SubmittedWriteBackJob[];
}

export class WritebackMaintenanceWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly repository: RuntimeRepository,
    private readonly storageClient: StorageWritebackClient,
    private readonly planner: LlmMaintenancePlanner | undefined,
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
          seed_records: seeds,
          related_records: related,
          open_conflicts: conflicts,
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

    const outcome = await this.applyActions(workspaceId, plan);
    summary.actions_applied += outcome.applied;
    summary.actions_skipped += outcome.skipped;
    summary.conflicts_resolved += outcome.conflicts_resolved;

    await this.repository.upsertMaintenanceCheckpoint({
      workspace_id: workspaceId,
      last_scanned_at: summary.next_checkpoint,
    });
  }

  private capPlan(plan: MaintenancePlan): MaintenancePlan {
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

  private async applyActions(workspaceId: string, plan: MaintenancePlan): Promise<ApplyOutcome> {
    const outcome: ApplyOutcome = {
      applied: 0,
      skipped: 0,
      conflicts_resolved: 0,
      submitted_jobs: [],
    };

    const actor: StorageActor = {
      actor_type: "system",
      actor_id: this.config.WRITEBACK_MAINTENANCE_ACTOR_ID,
    };

    for (const action of plan.actions) {
      try {
        switch (action.type) {
          case "merge":
            await this.applyMerge(action, actor);
            break;
          case "archive":
            await this.applyArchive(action, actor);
            break;
          case "downgrade":
            await this.applyDowngrade(action, actor);
            break;
          case "summarize":
            outcome.submitted_jobs.push(...(await this.applySummarize(action, actor, workspaceId)));
            break;
          case "resolve_conflict":
            await this.applyResolveConflict(action);
            outcome.conflicts_resolved += 1;
            break;
        }
        outcome.applied += 1;
      } catch (error) {
        outcome.skipped += 1;
        this.logger.warn(
          { err: error, workspace_id: workspaceId, action_type: action.type },
          "maintenance action failed",
        );
      }
    }

    return outcome;
  }

  private async applyMerge(
    action: Extract<MaintenanceAction, { type: "merge" }>,
    actor: StorageActor,
  ): Promise<void> {
    const [first, ...rest] = action.target_record_ids;
    if (!first) {
      throw new Error("merge action missing target ids");
    }
    await this.storageClient.patchRecord(first, {
      summary: action.merged_summary,
      details_json: {
        merged_from: action.target_record_ids,
      },
      importance: action.merged_importance,
      actor,
      reason: action.reason,
    });
    for (const id of rest) {
      await this.storageClient.archiveRecord(id, {
        actor,
        reason: action.reason,
      });
    }
  }

  private async applyArchive(
    action: Extract<MaintenanceAction, { type: "archive" }>,
    actor: StorageActor,
  ): Promise<void> {
    await this.storageClient.archiveRecord(action.record_id, {
      actor,
      reason: action.reason,
    });
  }

  private async applyDowngrade(
    action: Extract<MaintenanceAction, { type: "downgrade" }>,
    actor: StorageActor,
  ): Promise<void> {
    if (action.new_importance < this.config.WRITEBACK_MAINTENANCE_MIN_IMPORTANCE) {
      await this.storageClient.archiveRecord(action.record_id, {
        actor,
        reason: action.reason,
      });
      return;
    }
    await this.storageClient.patchRecord(action.record_id, {
      importance: action.new_importance,
      actor,
      reason: action.reason,
    });
  }

  private async applySummarize(
    action: Extract<MaintenanceAction, { type: "summarize" }>,
    actor: StorageActor,
    workspaceId: string,
  ): Promise<SubmittedWriteBackJob[]> {
    const idempotencyKey = createHash("sha256")
      .update(
        JSON.stringify({
          workspace_id: workspaceId,
          scope: action.scope,
          candidate_type: action.candidate_type,
          summary: action.new_summary,
          source_ids: action.source_record_ids,
        }),
      )
      .digest("hex");

    const candidate: WriteBackCandidate = {
      workspace_id: workspaceId,
      user_id: null,
      task_id: null,
      session_id: null,
      candidate_type: action.candidate_type,
      scope: action.scope,
      summary: action.new_summary,
      details: {
        extraction_method: "llm",
        maintenance_action: "summarize",
        source_record_ids: action.source_record_ids,
      },
      importance: action.new_importance,
      confidence: 0.85,
      write_reason: action.reason,
      source: {
        source_type: "writeback_maintenance",
        source_ref: action.source_record_ids.join(","),
        service_name: "retrieval-runtime",
        extraction_method: "llm",
      },
      idempotency_key: idempotencyKey,
    };

    const jobs = await this.storageClient.submitCandidates([candidate]);

    for (const id of action.source_record_ids) {
      await this.storageClient.archiveRecord(id, {
        actor,
        reason: action.reason,
      });
    }

    return jobs;
  }

  private async applyResolveConflict(
    action: Extract<MaintenanceAction, { type: "resolve_conflict" }>,
  ): Promise<void> {
    await this.storageClient.resolveConflict(action.conflict_id, {
      resolution_type: action.resolution_type,
      resolved_by: this.config.WRITEBACK_MAINTENANCE_ACTOR_ID,
      resolution_note: action.resolution_note,
      activate_record_id: action.activate_record_id,
    });
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
}
