import { randomUUID } from "node:crypto";

import type {
  GovernanceAction,
  GovernanceExecution,
  GovernanceProposal,
  GovernanceProposalTarget,
  MemoryRelation,
  MemoryRelationUpsertInput,
  MemoryConflict,
  MemoryRecord,
  MemoryRecordVersion,
  MemoryWriteJob,
  ReadModelEntry,
  ReadModelRefreshJob,
  ResolveConflictInput,
  StorageMetrics,
  WriteBackCandidate,
} from "../src/contracts.js";
import { EXPECTED_SUMMARY_EMBEDDING_DIMENSION } from "../src/contracts.js";
import type {
  ConflictRepository,
  GovernanceRepository,
  JobCreateInput,
  MetricsRepository,
  ReadModelRepository,
  RelationRepository,
  RecordRepository,
  StorageRepositories,
  WriteJobRepository,
} from "../src/db/repositories.js";
import { NotFoundError } from "../src/errors.js";

export function createMemoryRepositories(
  seed?: Partial<{
    jobs: MemoryWriteJob[];
    records: MemoryRecord[];
    versions: MemoryRecordVersion[];
    conflicts: MemoryConflict[];
    readModel: ReadModelEntry[];
    refreshJobs: ReadModelRefreshJob[];
  }>,
): StorageRepositories {
  const state = {
    jobs: [...(seed?.jobs ?? [])],
    records: [...(seed?.records ?? [])],
    versions: [...(seed?.versions ?? [])],
    conflicts: [...(seed?.conflicts ?? [])],
    governanceActions: [] as Array<Record<string, unknown>>,
    governanceProposals: [] as GovernanceProposal[],
    governanceProposalTargets: [] as GovernanceProposalTarget[],
    governanceExecutions: [] as GovernanceExecution[],
    relations: [] as MemoryRelation[],
    readModel: [...(seed?.readModel ?? [])],
    refreshJobs: [...(seed?.refreshJobs ?? [])],
  };

  const jobs: WriteJobRepository = {
    async enqueue(input: JobCreateInput) {
      const existing = state.jobs.find((job) => job.idempotency_key === input.idempotency_key);
      if (existing) {
        return existing;
      }

      const now = new Date().toISOString();
      const created: MemoryWriteJob = {
        id: randomUUID(),
        idempotency_key: input.idempotency_key,
        workspace_id: input.candidate.workspace_id,
        user_id: input.candidate.user_id ?? null,
        candidate_json: input.candidate,
        candidate_hash: input.candidate_hash,
        source_service: input.source_service,
        job_status: "queued",
        result_record_id: null,
        result_status: null,
        error_code: null,
        error_message: null,
        retry_count: 0,
        received_at: now,
        started_at: null,
        finished_at: null,
      };

      state.jobs.push(created);
      return created;
    },
    async findById(id) {
      return state.jobs.find((job) => job.id === id) ?? null;
    },
    async findByIdempotencyKey(idempotencyKey) {
      return state.jobs.find((job) => job.idempotency_key === idempotencyKey) ?? null;
    },
    async enqueueMany(inputs) {
      const jobs: MemoryWriteJob[] = [];
      for (const input of inputs) {
        jobs.push(await this.enqueue(input));
      }
      return jobs;
    },
    async claimQueuedJobs(limit) {
      const claimed = state.jobs
        .filter((job) => job.job_status === "queued" || job.job_status === "failed")
        .slice(0, limit);

      for (const job of claimed) {
        job.job_status = "processing";
        job.started_at = new Date().toISOString();
        job.error_code = null;
        job.error_message = null;
      }

      return claimed;
    },
    async markSucceeded(jobId, payload) {
      const job = state.jobs.find((item) => item.id === jobId);
      if (!job) throw new NotFoundError("job not found", { jobId });
      job.job_status = "succeeded";
      job.result_record_id = payload.result_record_id;
      job.result_status = payload.result_status;
      job.finished_at = new Date().toISOString();
    },
    async markDeadLetter(jobId, payload) {
      const job = state.jobs.find((item) => item.id === jobId);
      if (!job) throw new NotFoundError("job not found", { jobId });
      job.job_status = "dead_letter";
      job.error_code = payload.error_code;
      job.error_message = payload.error_message;
      job.retry_count += 1;
      job.finished_at = new Date().toISOString();
    },
    async requeue(jobId, errorMessage) {
      const job = state.jobs.find((item) => item.id === jobId);
      if (!job) throw new NotFoundError("job not found", { jobId });
      job.job_status = "failed";
      job.error_message = errorMessage;
      job.retry_count += 1;
      job.finished_at = new Date().toISOString();
    },
    async listRecent(limit) {
      return [...state.jobs]
        .sort((left, right) => right.received_at.localeCompare(left.received_at))
        .slice(0, limit);
    },
  };

  const records: RecordRepository = {
    async findById(recordId) {
      return state.records.find((record) => record.id === recordId) ?? null;
    },
    async findByIds(recordIds) {
      const idSet = new Set(recordIds);
      return state.records.filter((record) => idSet.has(record.id));
    },
    async findByDedupeScope(input) {
      return state.records
        .filter((record) => {
          if (record.scope !== input.scope || record.dedupe_key !== input.dedupe_key) {
            return false;
          }

          if (input.scope === "user") {
            return (record.user_id ?? null) === input.user_id;
          }

          if (record.workspace_id !== input.workspace_id) {
            return false;
          }

          if (input.scope === "task") {
            return (record.task_id ?? null) === (input.task_id ?? null);
          }

          if (input.scope === "session") {
            return (record.session_id ?? null) === (input.session_id ?? null);
          }

          return true;
        })
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
    },
    async insertRecord(record) {
      const now = new Date().toISOString();
      const created: MemoryRecord = {
        ...record,
        created_at: now,
        updated_at: now,
        version: 1,
      };
      state.records.push(created);
      return created;
    },
    async updateRecord(recordId, patch) {
      const record = state.records.find((item) => item.id === recordId);
      if (!record) throw new NotFoundError("memory record not found", { recordId });

      Object.assign(record, patch);
      record.updated_at = new Date().toISOString();
      record.version += 1;
      return record;
    },
    async appendVersion(input) {
      const version: MemoryRecordVersion = {
        id: randomUUID(),
        ...input,
        changed_at: new Date().toISOString(),
      };
      state.versions.push(version);
      return version;
    },
    async listRecords(filters) {
      const filtered = state.records
        .filter((record) => {
          if (
            filters.scope !== "user" &&
            record.scope !== "user" &&
            record.workspace_id !== filters.workspace_id
          ) {
            return false;
          }
          if (
            filters.workspace_id &&
            !filters.scope &&
            record.scope !== "user" &&
            record.workspace_id !== filters.workspace_id
          ) {
            return false;
          }
          if (filters.user_id && record.user_id !== filters.user_id) return false;
          if (filters.task_id && record.task_id !== filters.task_id) return false;
          if (filters.memory_type && record.memory_type !== filters.memory_type) return false;
          if (filters.scope && record.scope !== filters.scope) return false;
          if (filters.status && record.status !== filters.status) return false;
          return true;
        });

      const offset = (filters.page - 1) * filters.page_size;

      return {
        items: filtered.slice(offset, offset + filters.page_size),
        total: filtered.length,
        page: filters.page,
        page_size: filters.page_size,
      };
    },
    async getVersion(recordId, versionNo) {
      return (
        state.versions.find(
          (version) => version.record_id === recordId && version.version_no === versionNo,
        ) ?? null
      );
    },
    async listVersions(recordId) {
      return state.versions
        .filter((version) => version.record_id === recordId)
        .sort((left, right) => right.changed_at.localeCompare(left.changed_at));
    },
  };

  const conflicts: ConflictRepository = {
    async openConflict(input) {
      const created: MemoryConflict = {
        id: randomUUID(),
        workspace_id: input.workspace_id,
        user_id: input.user_id,
        record_id: input.record_id,
        conflict_with_record_id: input.conflict_with_record_id,
        pending_record_id: input.pending_record_id,
        existing_record_id: input.existing_record_id,
        conflict_type: input.conflict_type,
        conflict_summary: input.conflict_summary,
        status: "open",
        resolution_type: null,
        resolved_by: null,
        created_at: new Date().toISOString(),
        resolved_at: null,
      };
      state.conflicts.push(created);
      return created;
    },
    async listConflicts(status) {
      return status
        ? state.conflicts.filter((conflict) => conflict.status === status)
        : [...state.conflicts];
    },
    async findById(conflictId) {
      return state.conflicts.find((conflict) => conflict.id === conflictId) ?? null;
    },
    async resolveConflict(conflictId, payload: ResolveConflictInput) {
      const conflict = state.conflicts.find((item) => item.id === conflictId);
      if (!conflict) throw new NotFoundError("memory conflict not found", { conflictId });
      conflict.status = "resolved";
      conflict.resolution_type = payload.resolution_type;
      conflict.resolved_by = payload.resolved_by;
      conflict.resolved_at = new Date().toISOString();
      return conflict;
    },
  };

  const governance: GovernanceRepository = {
    async appendAction(input) {
      state.governanceActions.push(input);
    },
    async listActions(recordId) {
      return state.governanceActions
        .filter((action) => action.record_id === recordId)
        .map((action) => ({
          record_id: String(action.record_id),
          action_type: String(action.action_type) as GovernanceAction["action_type"],
          action_payload: (action.action_payload as Record<string, unknown> | null) ?? {},
          actor_type: String(action.actor_type) as GovernanceAction["actor_type"],
          actor_id: String(action.actor_id),
          created_at: new Date().toISOString(),
        }));
    },
    async createProposal(input) {
      const now = new Date().toISOString();
      const created: GovernanceProposal = {
        id: randomUUID(),
        ...input.proposal,
        created_at: now,
        updated_at: now,
      };
      state.governanceProposals.push(created);
      state.governanceProposalTargets.push(
        ...input.targets.map((target) => ({
          ...target,
          proposal_id: created.id,
        })),
      );
      return created;
    },
    async findProposalById(proposalId) {
      return state.governanceProposals.find((proposal) => proposal.id === proposalId) ?? null;
    },
    async findProposalByIdempotencyKey(idempotencyKey) {
      return (
        state.governanceProposals.find((proposal) => proposal.idempotency_key === idempotencyKey) ??
        null
      );
    },
    async updateProposal(proposalId, patch) {
      const proposal = state.governanceProposals.find((item) => item.id === proposalId);
      if (!proposal) {
        throw new NotFoundError("governance proposal not found", { proposalId });
      }
      Object.assign(proposal, patch, {
        updated_at: patch.updated_at ?? new Date().toISOString(),
      });
      return proposal;
    },
    async listProposals(filters) {
      return state.governanceProposals
        .filter((proposal) => {
          if (filters?.workspace_id && proposal.workspace_id !== filters.workspace_id) return false;
          if (filters?.status && proposal.status !== filters.status) return false;
          if (filters?.proposal_type && proposal.proposal_type !== filters.proposal_type) return false;
          return true;
        })
        .sort((left, right) => right.created_at.localeCompare(left.created_at))
        .slice(0, filters?.limit ?? 100);
    },
    async listProposalTargets(proposalId) {
      return state.governanceProposalTargets.filter((target) => target.proposal_id === proposalId);
    },
    async createExecution(input) {
      const created: GovernanceExecution = {
        id: randomUUID(),
        workspace_id: input.workspace_id,
        proposal_id: input.proposal_id,
        proposal_type: input.proposal_type,
        execution_status: input.execution_status,
        result_summary: input.result_summary ?? null,
        error_message: input.error_message ?? null,
        source_service: input.source_service,
        started_at: input.started_at,
        finished_at: input.finished_at ?? null,
      };
      state.governanceExecutions.push(created);
      return created;
    },
    async updateExecution(executionId, patch) {
      const execution = state.governanceExecutions.find((item) => item.id === executionId);
      if (!execution) throw new NotFoundError("governance execution not found", { executionId });
      Object.assign(execution, patch);
      return execution;
    },
    async findExecutionById(executionId) {
      return state.governanceExecutions.find((execution) => execution.id === executionId) ?? null;
    },
    async findExecutionByProposalId(proposalId) {
      return (
        state.governanceExecutions.find((execution) => execution.proposal_id === proposalId) ?? null
      );
    },
    async listExecutions(filters) {
      return state.governanceExecutions
        .filter((execution) => {
          if (filters?.workspace_id && execution.workspace_id !== filters.workspace_id) return false;
          if (filters?.proposal_type && execution.proposal_type !== filters.proposal_type) return false;
          if (filters?.execution_status && execution.execution_status !== filters.execution_status) {
            return false;
          }
          return true;
        })
        .sort((left, right) => right.started_at.localeCompare(left.started_at))
        .slice(0, filters?.limit ?? 100);
    },
  };

  const relations: RelationRepository = {
    async upsertRelations(input: MemoryRelationUpsertInput[]) {
      const now = new Date().toISOString();
      const saved: MemoryRelation[] = [];

      for (const relation of input) {
        const existing = state.relations.find((item) => {
          return item.workspace_id === relation.workspace_id
            && item.source_record_id === relation.source_record_id
            && item.target_record_id === relation.target_record_id
            && item.relation_type === relation.relation_type;
        });

        if (existing) {
          existing.strength = relation.strength;
          existing.bidirectional = relation.bidirectional;
          existing.reason = relation.reason;
          existing.created_by_service = relation.created_by_service;
          existing.updated_at = now;
          saved.push(existing);
          continue;
        }

        const created: MemoryRelation = {
          id: randomUUID(),
          workspace_id: relation.workspace_id,
          source_record_id: relation.source_record_id,
          target_record_id: relation.target_record_id,
          relation_type: relation.relation_type,
          strength: relation.strength,
          bidirectional: relation.bidirectional,
          reason: relation.reason,
          created_by_service: relation.created_by_service,
          created_at: now,
          updated_at: now,
        };
        state.relations.push(created);
        saved.push(created);
      }

      return saved;
    },
    async listRelations(filters) {
      return state.relations
        .filter((relation) => {
          if (relation.workspace_id !== filters.workspace_id) {
            return false;
          }
          if (
            filters.record_id
            && relation.source_record_id !== filters.record_id
            && relation.target_record_id !== filters.record_id
          ) {
            return false;
          }
          if (filters.relation_type && relation.relation_type !== filters.relation_type) {
            return false;
          }
          return true;
        })
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
        .slice(0, filters.limit ?? 100);
    },
  };

  const readModel: ReadModelRepository = {
    async upsert(entry) {
      const normalizedEntry =
        entry.summary_embedding &&
        entry.summary_embedding.length >= 128 &&
        entry.summary_embedding.length !== EXPECTED_SUMMARY_EMBEDDING_DIMENSION
          ? {
              ...entry,
              summary_embedding: null,
              embedding_status: "pending" as const,
            }
          : entry;
      const index = state.readModel.findIndex((item) => item.id === entry.id);
      if (index >= 0) {
        state.readModel[index] = normalizedEntry;
      } else {
        state.readModel.push(normalizedEntry);
      }
    },
    async delete(recordId) {
      const index = state.readModel.findIndex((item) => item.id === recordId);
      if (index >= 0) {
        state.readModel.splice(index, 1);
      }
    },
    async findById(recordId) {
      return state.readModel.find((item) => item.id === recordId) ?? null;
    },
    async findLatestRefreshBySourceRecordId(recordId) {
      return state.refreshJobs
        .filter((job) => job.source_record_id === recordId)
        .sort((left, right) => right.created_at.localeCompare(left.created_at))[0] ?? null;
    },
    async listPendingEmbeddings(limit) {
      return state.readModel
        .filter((item) => item.embedding_status === "pending")
        .slice(0, limit);
    },
    async enqueueRefresh(input) {
      const job: ReadModelRefreshJob = {
        id: randomUUID(),
        source_record_id: input.source_record_id,
        refresh_type: input.refresh_type,
        job_status: "queued",
        retry_count: 0,
        error_message: null,
        created_at: new Date().toISOString(),
        started_at: null,
        finished_at: null,
      };
      state.refreshJobs.push(job);
      return job;
    },
    async claimRefreshJobs(limit) {
      const jobs = state.refreshJobs
        .filter((job) => job.job_status === "queued" || job.job_status === "failed")
        .slice(0, limit);

      for (const job of jobs) {
        job.job_status = "processing";
        job.started_at = new Date().toISOString();
        job.error_message = null;
      }

      return jobs;
    },
    async claimRecoverableDeadLetterRefreshJobs(input) {
      const jobs = state.refreshJobs
        .filter(
          (job) =>
            job.job_status === "dead_letter" &&
            typeof job.error_message === "string" &&
            job.error_message.includes(input.errorPattern),
        )
        .slice(0, input.limit);

      for (const job of jobs) {
        job.job_status = "processing";
        job.started_at = new Date().toISOString();
        job.error_message = null;
      }

      return jobs;
    },
    async markRefreshSucceeded(jobId, payload) {
      const job = state.refreshJobs.find((item) => item.id === jobId);
      if (!job) throw new NotFoundError("refresh job not found", { jobId });
      job.job_status = "succeeded";
      job.error_message = payload?.degradation_reason ?? null;
      job.finished_at = new Date().toISOString();
    },
    async markRefreshFailed(jobId, errorMessage) {
      const job = state.refreshJobs.find((item) => item.id === jobId);
      if (!job) throw new NotFoundError("refresh job not found", { jobId });
      job.job_status = "failed";
      job.retry_count += 1;
      job.error_message = errorMessage;
      job.finished_at = new Date().toISOString();
    },
    async markRefreshDeadLetter(jobId, errorMessage) {
      const job = state.refreshJobs.find((item) => item.id === jobId);
      if (!job) throw new NotFoundError("refresh job not found", { jobId });
      job.job_status = "dead_letter";
      job.retry_count += 1;
      job.error_message = errorMessage;
      job.finished_at = new Date().toISOString();
    },
  };

  const metrics: MetricsRepository = {
    async collect(): Promise<StorageMetrics> {
      return {
        write_jobs_total: state.jobs.length,
        queued_jobs: state.jobs.filter((job) => job.job_status === "queued").length,
        processing_jobs: state.jobs.filter((job) => job.job_status === "processing").length,
        succeeded_jobs: state.jobs.filter((job) => job.job_status === "succeeded").length,
        failed_jobs: state.jobs.filter((job) => job.job_status === "failed").length,
        dead_letter_jobs: state.jobs.filter((job) => job.job_status === "dead_letter").length,
        active_records: state.records.filter((record) => record.status === "active").length,
        pending_confirmation_records: state.records.filter(
          (record) => record.status === "pending_confirmation",
        ).length,
        archived_records: state.records.filter((record) => record.status === "archived").length,
        conflicts_open: state.conflicts.filter((conflict) => conflict.status === "open").length,
        duplicate_ignored_jobs: state.jobs.filter(
          (job) => job.result_status === "ignore_duplicate",
        ).length,
        merged_jobs: state.jobs.filter((job) => job.result_status === "merge_existing").length,
        updated_jobs: state.jobs.filter((job) => job.result_status === "update_existing").length,
        inserted_jobs: state.jobs.filter((job) => job.result_status === "insert_new").length,
        projector_failed_jobs: state.refreshJobs.filter((job) => job.job_status === "failed")
          .length,
        projector_dead_letter_jobs: state.refreshJobs.filter(
          (job) => job.job_status === "dead_letter",
        ).length,
        projector_embedding_degraded_jobs: state.refreshJobs.filter(
          (job) => job.job_status === "succeeded" && job.error_message === "embedding_unavailable",
        ).length,
        pending_embedding_records: state.readModel.filter((record) => record.embedding_status === "pending").length,
        new_pending_embedding_records: state.readModel.filter(
          (record) => record.embedding_status === "pending" && (record.embedding_attempt_count ?? 0) <= 1,
        ).length,
        retry_pending_embedding_records: state.readModel.filter(
          (record) => record.embedding_status === "pending" && (record.embedding_attempt_count ?? 0) > 1,
        ).length,
        oldest_pending_embedding_age_seconds: state.readModel
          .filter((record) => record.embedding_status === "pending")
          .reduce((maxAge, record) => {
            const baseTime = record.embedding_attempted_at ?? record.updated_at ?? record.created_at;
            const ageSeconds = Math.max(0, Math.floor((Date.now() - new Date(baseTime).getTime()) / 1000));
            return Math.max(maxAge, ageSeconds);
          }, 0),
        governance_proposal_count: state.governanceProposals.length,
        governance_verifier_required_count: state.governanceProposals.filter(
          (proposal) => proposal.verifier_required,
        ).length,
        governance_verifier_approved_count: state.governanceProposals.filter(
          (proposal) => proposal.verifier_required && proposal.verifier_decision === "approve",
        ).length,
        governance_guard_rejected_count: state.governanceExecutions.filter(
          (execution) => execution.execution_status === "rejected_by_guard",
        ).length,
        governance_execution_count: state.governanceExecutions.length,
        governance_execution_success_count: state.governanceExecutions.filter(
          (execution) => execution.execution_status === "executed",
        ).length,
        governance_execution_failure_count: state.governanceExecutions.filter(
          (execution) => execution.execution_status === "failed",
        ).length,
        governance_soft_delete_count: state.governanceExecutions.filter(
          (execution) => execution.proposal_type === "delete",
        ).length,
        governance_retry_count: Math.max(
          state.governanceExecutions.length
            - new Set(state.governanceExecutions.map((execution) => execution.proposal_id)).size,
          0,
        ),
      };
    },
  };

  const repositories: StorageRepositories = {
    jobs,
    records,
    conflicts,
    governance,
    relations,
    readModel,
    metrics,
    async transaction<T>(callback: (repositories: StorageRepositories) => Promise<T>) {
      return callback(repositories);
    },
  };

  return repositories;
}

export function buildCandidate(overrides?: Partial<WriteBackCandidate>): WriteBackCandidate {
  const workspaceId = overrides?.workspace_id ?? "11111111-1111-4111-8111-111111111111";
  const baseSource = {
    source_type: "user_input",
    source_ref: "turn-1",
    service_name: "retrieval-runtime",
    origin_workspace_id: workspaceId,
    confirmed_by_user: true,
  } satisfies WriteBackCandidate["source"];

  return {
    user_id: "22222222-2222-4222-8222-222222222222",
    task_id: null,
    session_id: null,
    candidate_type: "fact_preference",
    scope: "user",
    summary: "User prefers concise answers",
    details: {
      subject: "user",
      predicate: "prefers concise answers",
    },
    importance: 5,
    confidence: 0.9,
    write_reason: "stable preference confirmed",
    ...overrides,
    workspace_id: workspaceId,
    source: {
      ...baseSource,
      ...overrides?.source,
    },
    idempotency_key: overrides?.idempotency_key ?? "fact-pref-user-prefers-concise-answers",
  };
}
