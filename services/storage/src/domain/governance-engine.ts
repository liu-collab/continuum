import type {
  ArchiveRecordInput,
  MemoryConflict,
  MemoryRecord,
  RecordPatchInput,
  ResolveConflictInput,
  RestoreVersionInput,
} from "../contracts.js";
import { ConflictResolutionError, NotFoundError } from "../errors.js";
import { snapshotRecord, type StorageRepositories } from "../db/repositories.js";

export class GovernanceEngine {
  constructor(private readonly repositories: StorageRepositories) {}

  async patchRecord(recordId: string, input: RecordPatchInput): Promise<MemoryRecord> {
    return this.repositories.transaction(async (tx) => {
      const existing = await tx.records.findById(recordId);

      if (!existing) {
        throw new NotFoundError("memory record not found", { recordId });
      }

      const updated = await tx.records.updateRecord(recordId, {
        ...(definedPatch({
          summary: input.summary,
          details_json: input.details_json,
          scope: input.scope,
          status: input.status,
          importance: input.importance,
          confidence: input.confidence,
          archived_at: input.status === "archived" ? new Date().toISOString() : undefined,
        }) as Parameters<typeof tx.records.updateRecord>[1]),
      });

      await tx.records.appendVersion({
        record_id: updated.id,
        version_no: updated.version,
        snapshot_json: snapshotRecord(updated),
        change_type: "update",
        change_reason: input.reason,
        changed_by_type: input.actor.actor_type,
        changed_by_id: input.actor.actor_id,
      });

      await tx.governance.appendAction({
        record_id: updated.id,
        action_type: "edit",
        action_payload: {
          reason: input.reason,
          patch: input,
        },
        actor_type: input.actor.actor_type,
        actor_id: input.actor.actor_id,
      });

      await tx.readModel.enqueueRefresh({
        source_record_id: updated.id,
        refresh_type: "update",
      });
      return updated;
    });
  }

  async archiveRecord(recordId: string, input: ArchiveRecordInput) {
    return this.repositories.transaction(async (tx) => {
      const existing = await tx.records.findById(recordId);

      if (!existing) {
        throw new NotFoundError("memory record not found", { recordId });
      }

      const archived = await tx.records.updateRecord(recordId, {
        status: "archived",
        archived_at: new Date().toISOString(),
      });

      await tx.records.appendVersion({
        record_id: archived.id,
        version_no: archived.version,
        snapshot_json: snapshotRecord(archived),
        change_type: "archive",
        change_reason: input.reason,
        changed_by_type: input.actor.actor_type,
        changed_by_id: input.actor.actor_id,
      });

      await tx.governance.appendAction({
        record_id: archived.id,
        action_type: "archive",
        action_payload: { reason: input.reason },
        actor_type: input.actor.actor_type,
        actor_id: input.actor.actor_id,
      });

      await tx.readModel.enqueueRefresh({
        source_record_id: archived.id,
        refresh_type: "update",
      });
      return archived;
    });
  }

  async restoreVersion(recordId: string, input: RestoreVersionInput) {
    return this.repositories.transaction(async (tx) => {
      const version = await tx.records.getVersion(recordId, input.version_no);

      if (!version) {
        throw new NotFoundError("memory record version not found", {
          recordId,
          version: input.version_no,
        });
      }

      const snapshot = version.snapshot_json as Partial<MemoryRecord>;
      const restored = await tx.records.updateRecord(recordId, {
        ...(definedPatch({
          summary: snapshot.summary,
          details_json: snapshot.details_json,
          importance: snapshot.importance,
          confidence: snapshot.confidence,
          status: snapshot.status,
          scope: snapshot.scope,
          archived_at: snapshot.archived_at ?? undefined,
          deleted_at: snapshot.deleted_at ?? undefined,
          last_confirmed_at: snapshot.last_confirmed_at ?? undefined,
        }) as Parameters<typeof tx.records.updateRecord>[1]),
      });

      await tx.records.appendVersion({
        record_id: restored.id,
        version_no: restored.version,
        snapshot_json: snapshotRecord(restored),
        change_type: "restore",
        change_reason: input.reason,
        changed_by_type: input.actor.actor_type,
        changed_by_id: input.actor.actor_id,
      });

      await tx.governance.appendAction({
        record_id: restored.id,
        action_type: "restore_version",
        action_payload: {
          reason: input.reason,
          version_no: input.version_no,
        },
        actor_type: input.actor.actor_type,
        actor_id: input.actor.actor_id,
      });

      await tx.readModel.enqueueRefresh({
        source_record_id: restored.id,
        refresh_type: "update",
      });
      return restored;
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
