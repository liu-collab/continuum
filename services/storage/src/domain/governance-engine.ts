import type {
  ArchiveRecordInput,
  ConfirmRecordInput,
  DeleteRecordInput,
  InvalidateRecordInput,
  MemoryConflict,
  MemoryRecord,
  RecordPatchInput,
  ResolveConflictInput,
  RestoreVersionInput,
} from "../contracts.js";
import { ConflictResolutionError, NotFoundError } from "../errors.js";
import { snapshotRecord, type StorageRepositories } from "../db/repositories.js";

type RecordUpdatePatch = Parameters<StorageRepositories["records"]["updateRecord"]>[1];

export class GovernanceEngine {
  constructor(private readonly repositories: StorageRepositories) {}

  async patchRecord(recordId: string, input: RecordPatchInput): Promise<MemoryRecord> {
    return this.applyManualAction({
      recordId,
      updateFields: definedPatch({
        summary: input.summary,
        details_json: input.details_json,
        scope: input.scope,
        status: input.status,
        importance: input.importance,
        confidence: input.confidence,
        archived_at: input.status === "archived" ? new Date().toISOString() : undefined,
      }) as RecordUpdatePatch,
      actionType: "edit",
      actionPayload: {
        reason: input.reason,
        patch: input,
      },
      changeType: "update",
      actor: input.actor,
      reason: input.reason,
    });
  }

  async archiveRecord(recordId: string, input: ArchiveRecordInput) {
    const archivedAt = new Date().toISOString();
    return this.applyManualAction({
      recordId,
      updateFields: {
        status: "archived",
        archived_at: archivedAt,
      },
      actionType: "archive",
      actionPayload: { reason: input.reason },
      changeType: "archive",
      actor: input.actor,
      reason: input.reason,
    });
  }

  async confirmRecord(recordId: string, input: ConfirmRecordInput) {
    const confirmedAt = new Date().toISOString();
    return this.applyManualAction({
      recordId,
      updateFields: {
        status: "active",
        archived_at: null,
        last_confirmed_at: confirmedAt,
      },
      actionType: "confirm",
      actionPayload: {
        reason: input.reason,
        last_confirmed_at: confirmedAt,
      },
      changeType: "update",
      actor: input.actor,
      reason: input.reason,
    });
  }

  async invalidateRecord(recordId: string, input: InvalidateRecordInput) {
    const archivedAt = new Date().toISOString();
    return this.applyManualAction({
      recordId,
      updateFields: {
        status: "archived",
        archived_at: archivedAt,
      },
      actionType: "invalidate",
      actionPayload: {
        reason: input.reason,
        resulting_status: "archived",
      },
      changeType: "archive",
      actor: input.actor,
      reason: input.reason,
    });
  }

  async deleteRecord(recordId: string, input: DeleteRecordInput) {
    const deletedAt = new Date().toISOString();
    return this.applyManualAction({
      recordId,
      updateFields: {
        status: "deleted",
        deleted_at: deletedAt,
      },
      actionType: "delete",
      actionPayload: {
        reason: input.reason,
        deleted_at: deletedAt,
      },
      changeType: "delete",
      actor: input.actor,
      reason: input.reason,
      refreshType: "delete",
    });
  }

  async restoreVersion(recordId: string, input: RestoreVersionInput) {
    const version = await this.repositories.records.getVersion(recordId, input.version_no);

    if (!version) {
      throw new NotFoundError("memory record version not found", {
        recordId,
        version: input.version_no,
      });
    }

    const snapshot = version.snapshot_json as Partial<MemoryRecord>;
    return this.applyManualAction({
      recordId,
      updateFields: definedPatch({
        summary: snapshot.summary,
        details_json: snapshot.details_json,
        importance: snapshot.importance,
        confidence: snapshot.confidence,
        status: snapshot.status,
        scope: snapshot.scope,
        archived_at: snapshot.archived_at ?? undefined,
        deleted_at: snapshot.deleted_at ?? undefined,
        last_confirmed_at: snapshot.last_confirmed_at ?? undefined,
      }) as RecordUpdatePatch,
      actionType: "restore_version",
      actionPayload: {
        reason: input.reason,
        version_no: input.version_no,
      },
      changeType: "restore",
      actor: input.actor,
      reason: input.reason,
    });
  }

  private async applyManualAction(input: {
    recordId: string;
    updateFields: RecordUpdatePatch;
    actionType: string;
    actionPayload: Record<string, unknown>;
    changeType: string;
    actor: { actor_type: string; actor_id: string };
    reason: string;
    refreshType?: "update" | "delete";
  }): Promise<MemoryRecord> {
    return this.repositories.transaction(async (tx) => {
      const existing = await tx.records.findById(input.recordId);
      if (!existing) {
        throw new NotFoundError("memory record not found", { recordId: input.recordId });
      }

      const updated = await tx.records.updateRecord(input.recordId, input.updateFields);

      await tx.records.appendVersion({
        record_id: updated.id,
        version_no: updated.version,
        snapshot_json: snapshotRecord(updated),
        change_type: input.changeType,
        change_reason: input.reason,
        changed_by_type: input.actor.actor_type,
        changed_by_id: input.actor.actor_id,
      });

      await tx.governance.appendAction({
        record_id: updated.id,
        action_type: input.actionType,
        action_payload: input.actionPayload,
        actor_type: input.actor.actor_type,
        actor_id: input.actor.actor_id,
      });

      await tx.readModel.enqueueRefresh({
        source_record_id: updated.id,
        refresh_type: input.refreshType ?? "update",
      });
      return updated;
    });
  }

  async resolveConflict(conflictId: string, input: ResolveConflictInput): Promise<MemoryConflict> {
    return this.repositories.transaction(async (tx) => {
      const conflict = await tx.conflicts.findById(conflictId);

      if (!conflict) {
        throw new NotFoundError("memory conflict not found", { conflictId });
      }

      if (input.activate_record_id) {
        const candidate = await tx.records.findById(input.activate_record_id);

        if (!candidate) {
          throw new ConflictResolutionError("activate_record_id does not exist", {
            conflictId,
            activate_record_id: input.activate_record_id,
          });
        }

        const activated = await tx.records.updateRecord(candidate.id, {
          status: "active",
          last_confirmed_at: new Date().toISOString(),
        });

        await tx.records.appendVersion({
          record_id: activated.id,
          version_no: activated.version,
          snapshot_json: snapshotRecord(activated),
          change_type: "update",
          change_reason: input.resolution_note,
          changed_by_type: "operator",
          changed_by_id: input.resolved_by,
        });

        await tx.readModel.enqueueRefresh({
          source_record_id: activated.id,
          refresh_type: "update",
        });

        const losingRecordId =
          conflict.pending_record_id === activated.id
            ? conflict.existing_record_id
            : conflict.pending_record_id;

        if (losingRecordId) {
          const losingRecord = await tx.records.findById(losingRecordId);

          if (losingRecord && losingRecord.status !== "deleted") {
            const archivedLoser = await tx.records.updateRecord(losingRecord.id, {
              status: "archived",
              archived_at: new Date().toISOString(),
            });

            await tx.records.appendVersion({
              record_id: archivedLoser.id,
              version_no: archivedLoser.version,
              snapshot_json: snapshotRecord(archivedLoser),
              change_type: "archive",
              change_reason: input.resolution_note,
              changed_by_type: "operator",
              changed_by_id: input.resolved_by,
            });

            await tx.readModel.enqueueRefresh({
              source_record_id: archivedLoser.id,
              refresh_type: "update",
            });
          }
        }
      }

      const resolved = await tx.conflicts.resolveConflict(conflictId, input);

      await tx.governance.appendAction({
        record_id: conflict.record_id,
        action_type: "confirm",
        action_payload: {
          resolution_type: input.resolution_type,
          resolution_note: input.resolution_note,
        },
        actor_type: "operator",
        actor_id: input.resolved_by,
      });

      return resolved;
    });
  }
}

function definedPatch<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
