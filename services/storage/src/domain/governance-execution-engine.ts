import { randomUUID } from "node:crypto";
import type {
  GovernanceExecution,
  GovernanceExecutionBatchRequest,
  GovernanceExecutionItem,
  GovernanceProposal,
  MemoryRecord,
} from "../contracts.js";
import { ConflictResolutionError, NotFoundError } from "../errors.js";
import { snapshotRecord, type StorageRepositories } from "../db/repositories.js";

export interface GovernanceExecutionResult {
  proposal: GovernanceProposal;
  execution: GovernanceExecution;
}

export class GovernanceExecutionEngine {
  constructor(private readonly repositories: StorageRepositories) {}

  async executeBatch(
    input: GovernanceExecutionBatchRequest,
  ): Promise<GovernanceExecutionResult[]> {
    const results: GovernanceExecutionResult[] = [];
    for (const item of input.items) {
      results.push(await this.executeItem(input.workspace_id, input.source_service, item));
    }
    return results;
  }

  async retryExecution(executionId: string): Promise<GovernanceExecutionResult> {
    const existing = await this.repositories.governance.findExecutionById(executionId);
    if (!existing) {
      throw new NotFoundError("governance execution not found", { executionId });
    }
    const proposal = await this.repositories.governance.findProposalById(existing.proposal_id);
    if (!proposal) {
      throw new NotFoundError("governance proposal not found", { proposalId: existing.proposal_id });
    }
    const targets = await this.repositories.governance.listProposalTargets(proposal.id);
    const item = this.toExecutionItem(proposal, targets);
    return this.executeItem(existing.workspace_id, existing.source_service, item);
  }

  private async executeItem(
    workspaceId: string,
    sourceService: string,
    item: GovernanceExecutionItem,
  ): Promise<GovernanceExecutionResult> {
    const proposal = await this.upsertProposal(workspaceId, item);
    const startedAt = new Date().toISOString();
    const execution = await this.repositories.governance.createExecution({
      workspace_id: workspaceId,
      proposal_id: proposal.id,
      proposal_type: proposal.proposal_type,
      execution_status: "executing",
      source_service: sourceService,
      started_at: startedAt,
    });

    try {
      await this.repositories.transaction(async (tx) => {
        await this.applyAction(tx, proposal, item);
      });

      const finished = await this.repositories.governance.updateExecution(execution.id, {
        execution_status: "executed",
        result_summary: `${proposal.proposal_type} executed`,
        finished_at: new Date().toISOString(),
      });

      return {
        proposal,
        execution: finished,
      };
    } catch (error) {
      const failed = await this.repositories.governance.updateExecution(execution.id, {
        execution_status: "failed",
        error_message: error instanceof Error ? error.message : String(error),
        finished_at: new Date().toISOString(),
      });
      return {
        proposal,
        execution: failed,
      };
    }
  }

  private async upsertProposal(
    workspaceId: string,
    item: GovernanceExecutionItem,
  ): Promise<GovernanceProposal> {
    const existing = await this.repositories.governance.findProposalByIdempotencyKey(
      item.idempotency_key,
    );
    if (existing) {
      return existing;
    }

    return this.repositories.governance.createProposal({
      proposal: {
        workspace_id: workspaceId,
        proposal_type: item.proposal_type,
        status: item.verifier.required ? "verified" : "proposed",
        reason_code: item.reason_code,
        reason_text: item.reason_text,
        suggested_changes_json: item.suggested_changes,
        evidence_json: item.evidence,
        planner_model: item.planner.model,
        planner_confidence: item.planner.confidence,
        verifier_required: item.verifier.required,
        verifier_model: item.verifier.model ?? null,
        verifier_decision: item.verifier.decision ?? null,
        verifier_confidence: item.verifier.confidence ?? null,
        verifier_notes: item.verifier.notes ?? null,
        policy_version: item.policy_version,
        idempotency_key: item.idempotency_key,
      },
      targets: [
        ...item.targets.record_ids.map((recordId) => ({
          proposal_id: "",
          record_id: recordId,
          conflict_id: null,
          role: "target" as const,
        })),
        ...(item.targets.winner_record_id
          ? [
              {
                proposal_id: "",
                record_id: item.targets.winner_record_id,
                conflict_id: null,
                role: "winner" as const,
              },
            ]
          : []),
        ...(item.targets.conflict_id
          ? [
              {
                proposal_id: "",
                record_id: null,
                conflict_id: item.targets.conflict_id,
                role: "target" as const,
              },
            ]
          : []),
      ],
    });
  }

  private async applyAction(
    tx: StorageRepositories,
    proposal: GovernanceProposal,
    item: GovernanceExecutionItem,
  ): Promise<void> {
    switch (proposal.proposal_type) {
      case "archive":
        await this.applyArchive(tx, item);
        return;
      case "confirm":
        await this.applyConfirm(tx, item);
        return;
      case "downgrade":
        await this.applyDowngrade(tx, item);
        return;
      case "resolve_conflict":
        await this.applyResolveConflict(tx, item);
        return;
      case "delete":
        await this.applySoftDelete(tx, item);
        return;
      case "merge":
        await this.applyMerge(tx, item);
        return;
      case "summarize":
        await this.applySummarize(tx, item);
        return;
    }
  }

  private async applyArchive(tx: StorageRepositories, item: GovernanceExecutionItem) {
    for (const recordId of item.targets.record_ids) {
      await this.guardRecord(tx, recordId);
      await tx.records.updateRecord(recordId, {
        status: "archived",
        archived_at: new Date().toISOString(),
      });
    }
  }

  private async applyConfirm(tx: StorageRepositories, item: GovernanceExecutionItem) {
    for (const recordId of item.targets.record_ids) {
      await this.guardRecord(tx, recordId);
      await tx.records.updateRecord(recordId, {
        status: "active",
        archived_at: null,
        last_confirmed_at: new Date().toISOString(),
      });
    }
  }

  private async applyDowngrade(tx: StorageRepositories, item: GovernanceExecutionItem) {
    const importance = item.suggested_changes.importance;
    if (importance === undefined) {
      throw new Error("downgrade action missing suggested importance");
    }
    for (const recordId of item.targets.record_ids) {
      await this.guardRecord(tx, recordId);
      await tx.records.updateRecord(recordId, {
        importance,
      });
    }
  }

  private async applyResolveConflict(tx: StorageRepositories, item: GovernanceExecutionItem) {
    if (!item.targets.conflict_id) {
      throw new Error("resolve_conflict action missing conflict_id");
    }
    const conflict = await tx.conflicts.findById(item.targets.conflict_id);
    if (!conflict || conflict.status !== "open") {
      throw new ConflictResolutionError("conflict is not open", {
        conflictId: item.targets.conflict_id,
      });
    }
    await tx.conflicts.resolveConflict(item.targets.conflict_id, {
      resolution_type: "auto_merge",
      resolved_by: "governance-execution-engine",
      resolution_note: item.reason_text,
      activate_record_id: item.targets.winner_record_id,
    });
  }

  private async applySoftDelete(tx: StorageRepositories, item: GovernanceExecutionItem) {
    const deleteReason = item.evidence["delete_reason"];
    if (typeof deleteReason !== "string" || deleteReason.trim().length < 3) {
      throw new Error("soft delete requires delete_reason");
    }
    for (const recordId of item.targets.record_ids) {
      await this.guardRecord(tx, recordId);
      await tx.records.updateRecord(recordId, {
        status: "deleted",
        deleted_at: new Date().toISOString(),
      });
      await tx.governance.appendAction({
        record_id: recordId,
        action_type: "delete",
        action_payload: {
          reason: item.reason_text,
          delete_reason: deleteReason,
        },
        actor_type: "system",
        actor_id: "governance-execution-engine",
      });
      await tx.readModel.enqueueRefresh({
        source_record_id: recordId,
        refresh_type: "delete",
      });
    }
  }

  private async applyMerge(tx: StorageRepositories, item: GovernanceExecutionItem) {
    const [first, ...rest] = item.targets.record_ids;
    if (!first || item.targets.record_ids.length < 2) {
      throw new Error("merge requires at least two records");
    }
    await this.guardRecord(tx, first);
    await tx.records.updateRecord(first, {
      ...(item.suggested_changes.summary ? { summary: item.suggested_changes.summary } : {}),
      ...(item.suggested_changes.importance !== undefined
        ? { importance: item.suggested_changes.importance }
        : {}),
    });
    for (const recordId of rest) {
      await this.guardRecord(tx, recordId);
      await tx.records.updateRecord(recordId, {
        status: "archived",
        archived_at: new Date().toISOString(),
      });
    }
  }

  private async applySummarize(tx: StorageRepositories, item: GovernanceExecutionItem) {
    const summary = item.suggested_changes.summary;
    const importance = item.suggested_changes.importance;
    const scope = item.suggested_changes.scope;
    const candidateType = item.suggested_changes.candidate_type;
    if (!summary || importance === undefined || !scope || !candidateType) {
      throw new Error("summarize requires summary, importance, scope and candidate_type");
    }

    const first = await this.guardRecord(tx, item.targets.record_ids[0]!);
    const created = await tx.records.insertRecord({
      id: randomUUID(),
      workspace_id: first.workspace_id,
      user_id: first.user_id,
      task_id: scope === "task" ? first.task_id : null,
      session_id: scope === "session" ? first.session_id : null,
      memory_type: candidateType,
      scope,
      status: "active",
      summary,
      details_json: {
        source_record_ids: item.targets.record_ids,
        summarize_reason: item.reason_text,
      },
      importance,
      confidence: Math.max(item.planner.confidence, item.verifier.confidence ?? 0.85),
      dedupe_key: item.idempotency_key,
      source_type: "governance_execution",
      source_ref: item.proposal_id,
      created_by_service: "storage",
      last_confirmed_at: null,
      archived_at: null,
      deleted_at: null,
    });
    await tx.records.appendVersion({
      record_id: created.id,
      version_no: created.version,
      snapshot_json: snapshotRecord(created),
      change_type: "create",
      change_reason: item.reason_text,
      changed_by_type: "system",
      changed_by_id: "governance-execution-engine",
    });
    await tx.readModel.enqueueRefresh({
      source_record_id: created.id,
      refresh_type: "insert",
    });

    for (const recordId of item.targets.record_ids) {
      await this.guardRecord(tx, recordId);
      await tx.records.updateRecord(recordId, {
        status: "archived",
        archived_at: new Date().toISOString(),
      });
    }
  }

  private async guardRecord(tx: StorageRepositories, recordId: string): Promise<MemoryRecord> {
    const record = await tx.records.findById(recordId);
    if (!record) {
      throw new NotFoundError("memory record not found", { recordId });
    }
    if (record.status === "deleted") {
      throw new Error(`record ${recordId} is already deleted`);
    }
    return record;
  }

  private toExecutionItem(
    proposal: GovernanceProposal,
    targets: Array<{ record_id: string | null; conflict_id: string | null; role: string }>,
  ): GovernanceExecutionItem {
    return {
      proposal_id: proposal.id,
      proposal_type: proposal.proposal_type,
      targets: {
        record_ids: targets.map((item) => item.record_id).filter((value): value is string => Boolean(value)),
        conflict_id: targets.find((item) => item.conflict_id)?.conflict_id ?? undefined,
        winner_record_id:
          targets.find((item) => item.role === "winner" && item.record_id)?.record_id ?? undefined,
      },
      suggested_changes: proposal.suggested_changes_json as GovernanceExecutionItem["suggested_changes"],
      reason_code: proposal.reason_code,
      reason_text: proposal.reason_text,
      evidence: proposal.evidence_json,
      planner: {
        model: proposal.planner_model,
        confidence: proposal.planner_confidence,
      },
      verifier: {
        required: proposal.verifier_required,
        model: proposal.verifier_model ?? undefined,
        decision: proposal.verifier_decision ?? undefined,
        confidence: proposal.verifier_confidence ?? undefined,
        notes: proposal.verifier_notes ?? undefined,
      },
      policy_version: proposal.policy_version,
      idempotency_key: proposal.idempotency_key,
    };
  }
}
