import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { RecordListFilters, StorageService } from "../services.js";
import { failed, ok } from "./responses.js";
import {
  archiveRecordSchema,
  confirmRecordSchema,
  deleteRecordSchema,
  governanceExecutionBatchRequestSchema,
  invalidateRecordSchema,
  recordPatchSchema,
  recordQuerySchema,
  resolveConflictSchema,
  restoreVersionSchema,
  writeBackBatchRequestSchema,
  writeBackCandidateSchema,
} from "../contracts.js";
import { AppError } from "../errors.js";

export function createApp(service: StorageService): FastifyInstance {
  const app = Fastify({
    logger: false,
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.status_code).send(
        failed({
          code: error.code,
          message: error.message,
          details: error.details,
        }),
      );
      return;
    }

    if ((error as { issues?: unknown }).issues) {
      reply.status(400).send(
        failed({
          code: "validation_failed",
          message: "request validation failed",
          details: (error as { issues?: unknown }).issues,
        }),
      );
      return;
    }

    reply.status(500).send(
      failed({
        code: "internal_error",
        message: error instanceof Error ? error.message : "internal error",
      }),
    );
  });

  app.get("/v1/storage/health/liveness", async () => ok(await service.getLiveness()));
  app.get("/v1/storage/health/readiness", async () => ok(await service.getReadiness()));
  app.get("/v1/storage/health/dependencies", async () => ok(await service.getDependencies()));
  app.get("/health", async () => ok(await service.getHealth()));

  app.post("/v1/storage/write-back-candidates", async (request, reply) => {
    const batch = writeBackBatchRequestSchema.safeParse(request.body);

    if (batch.success) {
      const jobs = await service.submitAcceptedWriteBackCandidates(batch.data.candidates);
      reply.status(202).send({
        jobs: jobs.map((job) => ({
          job_id: job.job_id,
          status: job.status,
          received_at: job.received_at,
        })),
        submitted_jobs: jobs.map((job) => ({
          candidate_summary: job.candidate_summary ?? "",
          job_id: job.job_id,
          status: job.status,
        })),
      });
      return;
    }

    const candidate = writeBackCandidateSchema.parse(request.body);
    const job = await service.submitAcceptedWriteBackCandidate(candidate);

    reply.status(202).send({
      jobs: [
        {
          job_id: job.job_id,
          status: job.status,
          received_at: job.received_at,
        },
      ],
      submitted_jobs: [
        {
          candidate_summary: job.candidate_summary ?? candidate.summary,
          job_id: job.job_id,
          status: job.status,
        },
      ],
    });
  });

  app.post("/v1/storage/write-back-candidates/projection-status", async (request) => {
    const payload = z.object({
      job_ids: z.array(z.uuid()).min(1).max(100),
    }).parse(request.body);

    return ok({
      items: await service.getWriteProjectionStatuses(payload.job_ids),
    });
  });

  app.get("/v1/storage/write-back-candidates/:jobId", async (request) => {
    const params = z.object({ jobId: z.uuid() }).parse(request.params);
    const job = await service.getWriteJob(params.jobId);

    if (!job) {
      throw new AppError("not_found", "write job not found", 404, params);
    }

    return ok(job);
  });

  app.get("/v1/storage/records", async (request) => {
    const query = recordQuerySchema.parse(request.query);
    const filters: RecordListFilters = {
      workspace_id: query.workspace_id,
      user_id: query.user_id,
      task_id: query.task_id,
      memory_type: query.memory_type,
      scope: query.scope,
      status: query.status,
      created_after: query.created_after,
      page: query.page,
      page_size: query.page_size,
    };
    const records = await service.listRecords(filters);
    return ok(records);
  });

  app.post("/v1/storage/records/by-ids", async (request) => {
    const payload = z.object({
      ids: z.array(z.uuid()).min(1).max(200),
    }).parse(request.body);
    return ok(await service.getRecordsByIds(payload.ids));
  });

  app.patch("/v1/storage/records/:recordId", async (request) => {
    const params = z.object({ recordId: z.uuid() }).parse(request.params);
    const payload = recordPatchSchema.parse(request.body);
    const record = await service.patchRecord(params.recordId, payload);
    return ok(record);
  });

  app.post("/v1/storage/records/:recordId/archive", async (request) => {
    const params = z.object({ recordId: z.uuid() }).parse(request.params);
    const payload = archiveRecordSchema.parse(request.body);
    const record = await service.archiveRecord(params.recordId, payload);
    return ok(record);
  });

  app.post("/v1/storage/records/:recordId/confirm", async (request) => {
    const params = z.object({ recordId: z.uuid() }).parse(request.params);
    const payload = confirmRecordSchema.parse(request.body);
    const record = await service.confirmRecord(params.recordId, payload);
    return ok(record);
  });

  app.post("/v1/storage/records/:recordId/invalidate", async (request) => {
    const params = z.object({ recordId: z.uuid() }).parse(request.params);
    const payload = invalidateRecordSchema.parse(request.body);
    const record = await service.invalidateRecord(params.recordId, payload);
    return ok(record);
  });

  app.post("/v1/storage/records/:recordId/delete", async (request) => {
    const params = z.object({ recordId: z.uuid() }).parse(request.params);
    const payload = deleteRecordSchema.parse(request.body);
    const record = await service.deleteRecord(params.recordId, payload);
    return ok(record);
  });

  app.post("/v1/storage/records/:recordId/restore-version", async (request) => {
    const params = z.object({ recordId: z.uuid() }).parse(request.params);
    const payload = restoreVersionSchema.parse(request.body);
    const record = await service.restoreVersion(params.recordId, payload);
    return ok(record);
  });

  app.get("/v1/storage/records/:recordId/versions", async (request) => {
    const params = z.object({ recordId: z.uuid() }).parse(request.params);
    return ok(await service.listRecordVersions(params.recordId));
  });

  app.get("/v1/storage/records/:recordId/history", async (request) => {
    const params = z.object({ recordId: z.uuid() }).parse(request.params);
    return ok(await service.getRecordHistory(params.recordId));
  });

  app.get("/v1/storage/conflicts", async (request) => {
    const query = z.object({ status: z.enum(["open", "resolved", "ignored"]).optional() }).parse(
      request.query,
    );
    const conflicts = await service.listConflicts(query.status);
    return ok(conflicts);
  });

  app.post("/v1/storage/conflicts/:conflictId/resolve", async (request) => {
    const params = z.object({ conflictId: z.uuid() }).parse(request.params);
    const payload = resolveConflictSchema.parse(request.body);
    const conflict = await service.resolveConflict(params.conflictId, payload);
    return ok(conflict);
  });

  app.post("/v1/storage/governance-executions", async (request) => {
    const payload = governanceExecutionBatchRequestSchema.parse(request.body);
    return ok(await service.submitGovernanceExecutions(payload));
  });

  app.get("/v1/storage/governance-proposals/recent-rejected", async (request) => {
    const query = z.object({
      workspace_id: z.uuid(),
      limit: z.coerce.number().int().min(1).max(20).default(5),
    }).parse(request.query);
    const proposals = await service.listRecentRejectedProposals(query.workspace_id, query.limit);
    return ok(proposals.map((proposal) => ({
      id: proposal.id,
      proposal_type: proposal.proposal_type,
      reason_text: proposal.reason_text,
      verifier_notes: proposal.verifier_notes,
      created_at: proposal.created_at,
    })));
  });

  app.post("/v1/storage/relations", async (request) => {
    const payload = z.object({
      relations: z.array(z.object({
        workspace_id: z.uuid(),
        source_record_id: z.uuid(),
        target_record_id: z.uuid(),
        relation_type: z.enum(["depends_on", "conflicts_with", "extends", "supersedes", "related_to"]),
        strength: z.number().min(0).max(1),
        bidirectional: z.boolean(),
        reason: z.string().trim().min(3).max(240),
        created_by_service: z.string().trim().min(1).default("retrieval-runtime"),
      })).min(1).max(100),
    }).parse(request.body);
    return ok(await service.upsertRelations(payload.relations));
  });

  app.get("/v1/storage/relations", async (request) => {
    const query = z.object({
      workspace_id: z.uuid(),
      record_id: z.uuid().optional(),
      relation_type: z.enum(["depends_on", "conflicts_with", "extends", "supersedes", "related_to"]).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    }).parse(request.query);
    return ok(await service.listRelations({
      workspace_id: query.workspace_id,
      ...(query.record_id ? { record_id: query.record_id } : {}),
      ...(query.relation_type ? { relation_type: query.relation_type } : {}),
      limit: query.limit,
    }));
  });

  app.get("/v1/storage/governance-executions", async (request) => {
    const query = z
      .object({
        workspace_id: z.uuid().optional(),
        proposal_type: z
          .enum(["merge", "archive", "downgrade", "confirm", "resolve_conflict", "summarize", "delete"])
          .optional(),
        execution_status: z
          .enum(["proposed", "verified", "rejected_by_guard", "executing", "executed", "failed", "superseded", "cancelled"])
          .optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);

    return ok(
      await service.listGovernanceExecutions({
        ...(query.workspace_id ? { workspace_id: query.workspace_id } : {}),
        ...(query.proposal_type ? { proposal_type: query.proposal_type } : {}),
        ...(query.execution_status ? { execution_status: query.execution_status } : {}),
        limit: query.limit,
      }),
    );
  });

  app.get("/v1/storage/governance-executions/:executionId", async (request) => {
    const params = z.object({ executionId: z.uuid() }).parse(request.params);
    const execution = await service.getGovernanceExecution(params.executionId);
    if (!execution) {
      throw new AppError("not_found", "governance execution not found", 404, params);
    }
    return ok(execution);
  });

  app.post("/v1/storage/governance-executions/:executionId/retry", async (request) => {
    const params = z.object({ executionId: z.uuid() }).parse(request.params);
    return ok(await service.retryGovernanceExecution(params.executionId));
  });

  app.get("/v1/storage/observe/metrics", async () => ok(await service.getMetrics()));

  app.get("/v1/storage/observe/write-jobs", async (request) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(
      request.query,
    );
    return ok(await service.listWriteJobs(query.limit));
  });

  return app;
}
