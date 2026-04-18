import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { RecordListFilters, StorageService } from "../services.js";
import { failed, ok } from "./responses.js";
import {
  archiveRecordSchema,
  confirmRecordSchema,
  deleteRecordSchema,
  invalidateRecordSchema,
  recordPatchSchema,
  recordQuerySchema,
  resolveConflictSchema,
  restoreVersionSchema,
  runtimeCompatibleWriteBackBatchRequestSchema,
  runtimeWriteBackBatchRequestSchema,
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
    const runtimeBatch = runtimeWriteBackBatchRequestSchema.safeParse(request.body);

    if (runtimeBatch.success) {
      const submittedJobs = await service.submitRuntimeWriteBackBatch(runtimeBatch.data);
      reply.status(202).send({
        jobs: submittedJobs.map((job) => ({
          job_id: job.job_id,
          status: job.status,
        })),
        submitted_jobs: submittedJobs,
      });
      return;
    }

    const runtimeCompatibleBatch = runtimeCompatibleWriteBackBatchRequestSchema.safeParse(
      request.body,
    );

    if (runtimeCompatibleBatch.success) {
      const submittedJobs = await service.submitRuntimeCompatibleWriteBackBatch(
        runtimeCompatibleBatch.data,
      );
      reply.status(202).send({
        jobs: submittedJobs.map((job) => ({
          job_id: job.job_id,
          status: job.status,
        })),
        submitted_jobs: submittedJobs,
      });
      return;
    }

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
      page: query.page,
      page_size: query.page_size,
    };
    const records = await service.listRecords(filters);
    return ok(records);
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

  app.get("/v1/storage/observe/metrics", async () => ok(await service.getMetrics()));

  app.get("/v1/storage/observe/write-jobs", async (request) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(
      request.query,
    );
    return ok(await service.listWriteJobs(query.limit));
  });

  return app;
}
