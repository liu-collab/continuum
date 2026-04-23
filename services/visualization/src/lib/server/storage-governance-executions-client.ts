import "server-only";

import {
  GovernanceExecutionDetail,
  GovernanceExecutionFilters,
  GovernanceExecutionListItem,
} from "@/lib/contracts";
import {
  governanceExecutionStatusLabel,
  governanceProposalTypeLabel,
  summarizeGovernanceTarget,
} from "@/lib/format";
import { getAppConfig } from "@/lib/env";
import { asRecord, pickArray, pickBoolean, pickNumber, pickRecord, pickString } from "@/lib/records";
import { fetchJsonFromSource } from "@/lib/server/http-client";

function unwrapData(value: unknown) {
  const record = asRecord(value);

  if (record && "data" in record) {
    return record.data;
  }

  return value;
}

function buildExecutionUrl(filters: GovernanceExecutionFilters) {
  const { values } = getAppConfig();

  if (!values.STORAGE_API_BASE_URL) {
    return undefined;
  }

  const url = new URL("/v1/storage/governance-executions", values.STORAGE_API_BASE_URL);
  if (filters.workspaceId) {
    url.searchParams.set("workspace_id", filters.workspaceId);
  }
  if (filters.proposalType) {
    url.searchParams.set("proposal_type", filters.proposalType);
  }
  if (filters.executionStatus) {
    url.searchParams.set("execution_status", filters.executionStatus);
  }
  url.searchParams.set("limit", String(filters.limit));
  return url.toString();
}

function buildExecutionDetailUrl(executionId: string) {
  const { values } = getAppConfig();
  return values.STORAGE_API_BASE_URL
    ? `${values.STORAGE_API_BASE_URL}/v1/storage/governance-executions/${executionId}`
    : undefined;
}

function mapExecutionRow(value: unknown): GovernanceExecutionListItem | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const execution = pickRecord(record, "execution") ?? record;
  const proposal = pickRecord(record, "proposal") ?? null;
  const targets = pickArray(record, "targets");

  const proposalType = pickString(execution, "proposal_type", "proposalType")
    ?? pickString(proposal ?? {}, "proposal_type", "proposalType")
    ?? "unknown";
  const executionStatus = pickString(execution, "execution_status", "executionStatus") ?? "unknown";
  const targetSummary = summarizeGovernanceTarget(
    targets
      .map((target) => asRecord(target))
      .filter((target): target is NonNullable<ReturnType<typeof asRecord>> => Boolean(target))
      .map((target) => ({
        recordId: pickString(target, "record_id", "recordId") ?? null,
        conflictId: pickString(target, "conflict_id", "conflictId") ?? null,
        role: pickString(target, "role") ?? "target",
      })),
  );
  const targetRecordIds = targets
    .map((target) => asRecord(target))
    .filter((target): target is NonNullable<ReturnType<typeof asRecord>> => Boolean(target))
    .map((target) => pickString(target, "record_id", "recordId"))
    .filter((target): target is string => Boolean(target));
  const evidence = pickRecord(proposal ?? {}, "evidence_json", "evidence") ?? {};
  const verifierRequired = pickBoolean(proposal ?? {}, "verifier_required", "verifierRequired") ?? false;
  const verifierDecision = pickString(proposal ?? {}, "verifier_decision", "verifierDecision") ?? null;
  const executionError = pickString(execution, "error_message", "errorMessage") ?? null;
  const verificationBlocked =
    verifierRequired
    && executionStatus === "rejected_by_guard"
    && verifierDecision !== "approve";

  return {
    executionId: pickString(execution, "id") ?? "unknown-execution",
    proposalId: pickString(execution, "proposal_id", "proposalId")
      ?? pickString(proposal ?? {}, "id")
      ?? "unknown-proposal",
    workspaceId: pickString(execution, "workspace_id", "workspaceId")
      ?? pickString(proposal ?? {}, "workspace_id", "workspaceId")
      ?? "unknown-workspace",
    proposalType,
    proposalTypeLabel: governanceProposalTypeLabel(proposalType),
    executionStatus,
    executionStatusLabel: governanceExecutionStatusLabel(executionStatus),
    reasonCode: pickString(proposal ?? {}, "reason_code", "reasonCode") ?? "unknown_reason",
    reasonText: pickString(proposal ?? {}, "reason_text", "reasonText") ?? "未记录原因",
    deleteReason: pickString(evidence, "delete_reason", "deleteReason") ?? null,
    startedAt: pickString(execution, "started_at", "startedAt") ?? null,
    finishedAt: pickString(execution, "finished_at", "finishedAt") ?? null,
    sourceService: pickString(execution, "source_service", "sourceService") ?? "unknown",
    plannerModel: pickString(proposal ?? {}, "planner_model", "plannerModel") ?? "unknown",
    plannerConfidence: pickNumber(proposal ?? {}, "planner_confidence", "plannerConfidence") ?? null,
    verifierRequired,
    verifierModel: pickString(proposal ?? {}, "verifier_model", "verifierModel") ?? null,
    verifierDecision,
    verifierConfidence:
      pickNumber(proposal ?? {}, "verifier_confidence", "verifierConfidence") ?? null,
    verifierNotes: pickString(proposal ?? {}, "verifier_notes", "verifierNotes") ?? null,
    verificationBlocked,
    verificationBlockedReason:
      verificationBlocked
        ? executionError ?? pickString(proposal ?? {}, "verifier_notes", "verifierNotes") ?? "等待 verifier 通过"
        : null,
    targetSummary,
    targetRecordIds,
    resultSummary: pickString(execution, "result_summary", "resultSummary") ?? null,
    errorMessage: executionError,
  };
}

export async function fetchGovernanceExecutions(filters: GovernanceExecutionFilters) {
  const { values } = getAppConfig();
  const response = await fetchJsonFromSource<unknown>({
    sourceName: "storage_governance_executions",
    sourceLabel: "Storage governance executions",
    url: buildExecutionUrl(filters),
    timeoutMs: values.STORAGE_API_TIMEOUT_MS,
  });

  if (!response.ok || !response.data) {
    return {
      status: response.status,
      items: [] as GovernanceExecutionListItem[],
    };
  }

  const raw = unwrapData(response.data);
  const rows: unknown[] = Array.isArray(raw) ? raw : [];
  return {
    status: response.status,
    items: rows
      .map((row: unknown) => mapExecutionRow(row))
      .filter((row: GovernanceExecutionListItem | null): row is GovernanceExecutionListItem => Boolean(row)),
  };
}

export async function fetchGovernanceExecutionDetail(executionId: string) {
  const { values } = getAppConfig();
  const response = await fetchJsonFromSource<unknown>({
    sourceName: "storage_governance_execution_detail",
    sourceLabel: "Storage governance execution detail",
    url: buildExecutionDetailUrl(executionId),
    timeoutMs: values.STORAGE_API_TIMEOUT_MS,
  });

  if (!response.ok || !response.data) {
    return {
      status: response.status,
      detail: null as GovernanceExecutionDetail | null,
    };
  }

  const record = asRecord(unwrapData(response.data));
  if (!record) {
    return {
      status: {
        ...response.status,
        status: "partial" as const,
        lastError: "Upstream returned a non-object payload.",
        detail: "Upstream returned a non-object payload.",
      },
      detail: null,
    };
  }

  const base = mapExecutionRow(record);
  const proposal = pickRecord(record, "proposal") ?? {};
  const evidence = pickRecord(proposal, "evidence_json", "evidence") ?? {};
  const suggestedChanges = pickRecord(proposal, "suggested_changes_json", "suggestedChanges") ?? {};
  const targets = pickArray(record, "targets")
    .map((target) => asRecord(target))
    .filter((target): target is NonNullable<ReturnType<typeof asRecord>> => Boolean(target))
    .map((target) => ({
      recordId: pickString(target, "record_id", "recordId") ?? null,
      conflictId: pickString(target, "conflict_id", "conflictId") ?? null,
      role: pickString(target, "role") ?? "target",
    }));

  if (!base) {
    return {
      status: response.status,
      detail: null,
    };
  }

  return {
    status: response.status,
    detail: {
      ...base,
      policyVersion: pickString(proposal, "policy_version", "policyVersion") ?? "unknown",
      verifierModel: pickString(proposal, "verifier_model", "verifierModel") ?? null,
      verifierNotes: pickString(proposal, "verifier_notes", "verifierNotes") ?? null,
      suggestedChanges,
      evidence,
      targets,
    },
  };
}
