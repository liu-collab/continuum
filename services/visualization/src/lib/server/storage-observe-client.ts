import "server-only";

import { getAppConfig } from "@/lib/env";
import { asRecord, pickNumber, pickString } from "@/lib/records";
import { fetchJsonFromSource } from "@/lib/server/http-client";

export type StorageMetricsSnapshot = {
  writeAccepted: number | null;
  writeSucceeded: number | null;
  duplicateIgnoredRate: number | null;
  mergeRate: number | null;
  conflictRate: number | null;
  deadLetterJobs: number | null;
  refreshFailureRate: number | null;
  writeP95Ms: number | null;
  newPendingEmbeddingRecords: number | null;
  retryPendingEmbeddingRecords: number | null;
  oldestPendingEmbeddingAgeSeconds: number | null;
  governanceProposalCount: number | null;
  governanceVerifierRequiredCount: number | null;
  governanceVerifierApprovedCount: number | null;
  governanceGuardRejectedCount: number | null;
  governanceExecutionCount: number | null;
  governanceExecutionSuccessCount: number | null;
  governanceExecutionFailureCount: number | null;
  governanceSoftDeleteCount: number | null;
  governanceRetryCount: number | null;
};

export type StorageWriteJobRecord = {
  id: string;
  status: string;
  resultStatus: string | null;
  receivedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
};

export type WriteJobSnapshot = {
  queued: number | null;
  processing: number | null;
  failed: number | null;
  deadLetter: number | null;
  items: StorageWriteJobRecord[];
};

function readMetric(raw: Record<string, unknown>, keys: string[]) {
  return pickNumber(raw, ...keys) ?? null;
}

function unwrapData(value: unknown) {
  const record = asRecord(value);

  if (record && "data" in record) {
    return record.data;
  }

  return value;
}

function safeRate(numerator: number | null, denominator: number | null) {
  if (numerator === null || denominator === null || denominator === 0) {
    return null;
  }

  return numerator / denominator;
}

function toWriteJobRecord(value: unknown): StorageWriteJobRecord | null {
  const record = asRecord(value);

  if (!record) {
    return null;
  }

  return {
    id: pickString(record, "id") ?? "unknown-job",
    status: pickString(record, "job_status", "status") ?? "unknown",
    resultStatus: pickString(record, "result_status", "resultStatus") ?? null,
    receivedAt: pickString(record, "received_at", "receivedAt") ?? null,
    startedAt: pickString(record, "started_at", "startedAt") ?? null,
    finishedAt: pickString(record, "finished_at", "finishedAt") ?? null,
    errorMessage: pickString(record, "error_message", "errorMessage") ?? null
  };
}

export async function fetchStorageMetrics() {
  const { values } = getAppConfig();
  const response = await fetchJsonFromSource<unknown>({
    sourceName: "storage_api",
    sourceLabel: "Storage observe API",
    url: values.STORAGE_API_BASE_URL
      ? `${values.STORAGE_API_BASE_URL}/v1/storage/observe/metrics`
      : undefined,
    timeoutMs: values.STORAGE_API_TIMEOUT_MS
  });

  if (!response.ok || !response.data) {
    return {
      status: response.status,
      metrics: null as StorageMetricsSnapshot | null
    };
  }

  const record = asRecord(unwrapData(response.data));

  if (!record) {
    return {
      status: {
        ...response.status,
        status: "partial" as const,
        lastError: "Upstream returned a non-object payload.",
        detail: "Upstream returned a non-object payload."
      },
      metrics: null
    };
  }

  const writeJobsTotal =
    readMetric(record, ["write_jobs_total", "writeJobsTotal", "write_accepted", "writeAccepted"]) ??
    null;
  const succeededJobs =
    readMetric(record, ["succeeded_jobs", "write_succeeded", "writeSucceeded"]) ?? null;
  const duplicateIgnoredJobs =
    readMetric(record, ["duplicate_ignored_jobs", "duplicateIgnoredJobs"]) ?? null;
  const mergedJobs = readMetric(record, ["merged_jobs", "mergedJobs"]) ?? null;
  const conflictsOpen = readMetric(record, ["conflicts_open", "conflictsOpen"]) ?? null;
  const projectorFailedJobs =
    readMetric(record, ["projector_failed_jobs", "projectorFailedJobs"]) ?? null;

  return {
    status: response.status,
    metrics: {
      writeAccepted: writeJobsTotal,
      writeSucceeded: succeededJobs,
      duplicateIgnoredRate: safeRate(duplicateIgnoredJobs, writeJobsTotal),
      mergeRate: safeRate(mergedJobs, writeJobsTotal),
      conflictRate: safeRate(conflictsOpen, writeJobsTotal),
      deadLetterJobs: readMetric(record, ["dead_letter_jobs", "deadLetterJobs"]),
      refreshFailureRate: safeRate(projectorFailedJobs, writeJobsTotal),
      writeP95Ms: readMetric(record, ["write_p95_ms", "writeP95Ms", "latency_p95_ms"]),
      newPendingEmbeddingRecords: readMetric(record, [
        "new_pending_embedding_records",
        "newPendingEmbeddingRecords"
      ]),
      retryPendingEmbeddingRecords: readMetric(record, [
        "retry_pending_embedding_records",
        "retryPendingEmbeddingRecords"
      ]),
      oldestPendingEmbeddingAgeSeconds: readMetric(record, [
        "oldest_pending_embedding_age_seconds",
        "oldestPendingEmbeddingAgeSeconds"
      ]),
      governanceProposalCount: readMetric(record, [
        "governance_proposal_count",
        "governanceProposalCount"
      ]),
      governanceVerifierRequiredCount: readMetric(record, [
        "governance_verifier_required_count",
        "governanceVerifierRequiredCount"
      ]),
      governanceVerifierApprovedCount: readMetric(record, [
        "governance_verifier_approved_count",
        "governanceVerifierApprovedCount"
      ]),
      governanceGuardRejectedCount: readMetric(record, [
        "governance_guard_rejected_count",
        "governanceGuardRejectedCount"
      ]),
      governanceExecutionCount: readMetric(record, [
        "governance_execution_count",
        "governanceExecutionCount"
      ]),
      governanceExecutionSuccessCount: readMetric(record, [
        "governance_execution_success_count",
        "governanceExecutionSuccessCount"
      ]),
      governanceExecutionFailureCount: readMetric(record, [
        "governance_execution_failure_count",
        "governanceExecutionFailureCount"
      ]),
      governanceSoftDeleteCount: readMetric(record, [
        "governance_soft_delete_count",
        "governanceSoftDeleteCount"
      ]),
      governanceRetryCount: readMetric(record, [
        "governance_retry_count",
        "governanceRetryCount"
      ])
    }
  };
}

export async function fetchStorageWriteJobs() {
  const { values } = getAppConfig();
  const response = await fetchJsonFromSource<unknown>({
    sourceName: "storage_write_jobs",
    sourceLabel: "Storage write jobs",
    url: values.STORAGE_API_BASE_URL
      ? `${values.STORAGE_API_BASE_URL}/v1/storage/observe/write-jobs`
      : undefined,
    timeoutMs: values.STORAGE_API_TIMEOUT_MS
  });

  if (!response.ok || !response.data) {
    return {
      status: response.status,
      jobs: null as WriteJobSnapshot | null
    };
  }

  const root = asRecord(unwrapData(response.data));

  if (!root) {
    return {
      status: {
        ...response.status,
        status: "partial" as const,
        lastError: "Upstream returned a non-object payload.",
        detail: "Upstream returned a non-object payload."
      },
      jobs: null
    };
  }

  const items = (Array.isArray(root.items) ? root.items : [])
    .map(toWriteJobRecord)
    .filter((item): item is StorageWriteJobRecord => Boolean(item));

  const accumulator = {
    queued: 0,
    processing: 0,
    failed: 0,
    deadLetter: 0
  };

  for (const item of items) {
    if (item.status === "queued") {
      accumulator.queued += 1;
    } else if (item.status === "processing") {
      accumulator.processing += 1;
    } else if (item.status === "failed") {
      accumulator.failed += 1;
    } else if (item.status === "dead_letter") {
      accumulator.deadLetter += 1;
    }
  }

  return {
    status: response.status,
    jobs: {
      queued: accumulator.queued,
      processing: accumulator.processing,
      failed: accumulator.failed,
      deadLetter: accumulator.deadLetter,
      items
    }
  };
}
