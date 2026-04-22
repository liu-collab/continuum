import type { Logger } from "../logger.js";
import type { StorageRepositories } from "../db/repositories.js";
import { buildRecordFromNormalized, snapshotRecord } from "../db/repositories.js";
import type { MemoryWriteJob } from "../contracts.js";
import { evaluateConflict } from "./conflict-engine.js";
import { decideMerge } from "./merge-engine.js";
import { normalizeCandidate } from "./normalizer.js";

export class WritebackProcessor {
  constructor(
    private readonly repositories: StorageRepositories,
    private readonly logger: Logger,
  ) {}

  async processJob(job: MemoryWriteJob): Promise<{ record_id: string; result_status: string }> {
    const normalized = normalizeCandidate(job.candidate_json);
    const matches = await this.repositories.records.findByDedupeScope({
      workspace_id: normalized.workspace_id,
      user_id: normalized.user_id ?? null,
      task_id: normalized.task_id ?? null,
      session_id: normalized.session_id ?? null,
      scope: normalized.scope,
      dedupe_key: normalized.dedupe_key,
    });

    const decision = decideMerge(normalized, matches);
    this.logger.info({ jobId: job.id, decision: decision.decision }, "write job merge decision");

    if (decision.decision === "insert_new") {
      const inserted = await this.repositories.transaction(async (tx) => {
        const record = await tx.records.insertRecord(buildRecordFromNormalized(
          normalized.suggested_status
            ? {
                normalized,
                status: normalized.suggested_status,
              }
            : {
                normalized,
              },
        ));

        await tx.records.appendVersion({
          record_id: record.id,
          version_no: record.version,
          snapshot_json: snapshotRecord(record),
          change_type: "create",
          change_reason: normalized.write_reason,
          changed_by_type: "system",
          changed_by_id: normalized.source_service,
        });

        await tx.readModel.enqueueRefresh({
          source_record_id: record.id,
          refresh_type: "insert",
        });
        return record;
      });

      return { record_id: inserted.id, result_status: decision.decision };
    }

    const existing = decision.existing_record!;

    if (decision.decision === "ignore_duplicate") {
      return { record_id: existing.id, result_status: decision.decision };
    }

    if (decision.decision === "open_conflict") {
      const conflict = evaluateConflict(existing, normalized);

      const resolvedRecord = await this.repositories.transaction(async (tx) => {
        const updatedExisting = await tx.records.updateRecord(existing.id, {
          status: conflict.should_mark_pending_confirmation
            ? "pending_confirmation"
            : "superseded",
        });

        await tx.records.appendVersion({
          record_id: updatedExisting.id,
          version_no: updatedExisting.version,
          snapshot_json: snapshotRecord(updatedExisting),
          change_type: conflict.can_auto_supersede ? "supersede" : "update",
          change_reason: conflict.summary,
          changed_by_type: "system",
          changed_by_id: normalized.source_service,
        });

        if (conflict.can_auto_supersede) {
          const inserted = await tx.records.insertRecord(buildRecordFromNormalized(
            normalized.suggested_status
              ? {
                  normalized,
                  status: normalized.suggested_status,
                }
              : {
                  normalized,
                },
          ));

          await tx.records.appendVersion({
            record_id: inserted.id,
            version_no: inserted.version,
            snapshot_json: snapshotRecord(inserted),
            change_type: "create",
            change_reason: normalized.write_reason,
            changed_by_type: "system",
            changed_by_id: normalized.source_service,
          });

          await tx.readModel.enqueueRefresh({
            source_record_id: updatedExisting.id,
            refresh_type: "update",
          });
          await tx.readModel.enqueueRefresh({
            source_record_id: inserted.id,
            refresh_type: "insert",
          });
          return inserted;
        }

        const pendingRecord = await tx.records.insertRecord(
          buildRecordFromNormalized({
            normalized,
            status: "pending_confirmation",
          }),
        );

        await tx.records.appendVersion({
          record_id: pendingRecord.id,
          version_no: pendingRecord.version,
          snapshot_json: snapshotRecord(pendingRecord),
          change_type: "create",
          change_reason: normalized.write_reason,
          changed_by_type: "system",
          changed_by_id: normalized.source_service,
        });

        await tx.conflicts.openConflict({
          workspace_id: existing.workspace_id,
          user_id: existing.user_id,
          record_id: existing.id,
          conflict_with_record_id: pendingRecord.id,
          pending_record_id: pendingRecord.id,
          existing_record_id: existing.id,
          conflict_type: conflict.conflict_type,
          conflict_summary: conflict.summary,
        });

        await tx.readModel.enqueueRefresh({
          source_record_id: updatedExisting.id,
          refresh_type: "update",
        });
        await tx.readModel.enqueueRefresh({
          source_record_id: pendingRecord.id,
          refresh_type: "insert",
        });
        return pendingRecord;
      });

      return { record_id: resolvedRecord.id, result_status: decision.decision };
    }

    const updated = await this.repositories.transaction(async (tx) => {
      const record = await tx.records.updateRecord(existing.id, {
        summary: normalized.summary,
        details_json: decision.merged_details ?? normalized.details,
        importance:
          decision.decision === "merge_existing"
            ? Math.max(existing.importance, normalized.importance)
            : normalized.importance,
        confidence:
          decision.decision === "merge_existing"
            ? Math.max(existing.confidence, normalized.confidence)
            : normalized.confidence,
        status: "active",
      } satisfies {
        summary: string;
        details_json: Record<string, unknown>;
        importance: number;
        confidence: number;
        status: "active";
      });

      await tx.records.appendVersion({
        record_id: record.id,
        version_no: record.version,
        snapshot_json: snapshotRecord(record),
        change_type: decision.decision === "merge_existing" ? "merge" : "update",
        change_reason: decision.reason,
        changed_by_type: "system",
        changed_by_id: normalized.source_service,
      });

      await tx.readModel.enqueueRefresh({
        source_record_id: record.id,
        refresh_type: "update",
      });
      return record;
    });

    return { record_id: updated.id, result_status: decision.decision };
  }
}
