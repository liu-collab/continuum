import "server-only";

import {
  MemoryEditRequest,
  MemoryGovernanceAction,
  MemoryGovernanceActionRequest,
  MemoryGovernanceResponse,
  MemoryRestoreVersionRequest,
  SourceStatus
} from "@/lib/contracts";
import { getAppConfig } from "@/lib/env";
import { fetchJsonFromSource } from "@/lib/server/http-client";

function createActor() {
  return {
    actor_type: "user",
    actor_id: "visualization"
  } as const;
}

function mapErrorMessage(status: SourceStatus, fallback: string) {
  return status.detail ?? status.lastError ?? fallback;
}

async function sendGovernanceRequest(
  action: MemoryGovernanceAction,
  memoryId: string,
  payload: Record<string, unknown>
): Promise<MemoryGovernanceResponse> {
  const { values } = getAppConfig();
  const method = action === "edit" ? "PATCH" : "POST";
  const suffix =
    action === "edit" ? "" : action === "restore_version" ? "/restore-version" : `/${action}`;

  const response = await fetchJsonFromSource<unknown>({
    sourceName: "storage_governance_api",
    sourceLabel: "Storage governance API",
    url: values.STORAGE_API_BASE_URL
      ? `${values.STORAGE_API_BASE_URL}/v1/storage/records/${memoryId}${suffix}`
      : undefined,
    timeoutMs: values.STORAGE_API_TIMEOUT_MS,
    method,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return {
    ok: response.ok,
    action,
    memoryId,
    message: response.ok
      ? `${action} submitted successfully.`
      : mapErrorMessage(response.status, `${action} failed.`),
    upstreamStatus: null,
    sourceStatus: response.status
  };
}

export async function confirmMemory(
  memoryId: string,
  request: MemoryGovernanceActionRequest
) {
  return sendGovernanceRequest("confirm", memoryId, {
    actor: createActor(),
    reason: request.reason
  });
}

export async function invalidateMemory(
  memoryId: string,
  request: MemoryGovernanceActionRequest
) {
  return sendGovernanceRequest("invalidate", memoryId, {
    actor: createActor(),
    reason: request.reason
  });
}

export async function archiveMemory(
  memoryId: string,
  request: MemoryGovernanceActionRequest
) {
  return sendGovernanceRequest("archive", memoryId, {
    actor: createActor(),
    reason: request.reason
  });
}

export async function deleteMemory(
  memoryId: string,
  request: MemoryGovernanceActionRequest
) {
  return sendGovernanceRequest("delete", memoryId, {
    actor: createActor(),
    reason: request.reason
  });
}

export async function editMemory(memoryId: string, request: MemoryEditRequest) {
  return sendGovernanceRequest("edit", memoryId, {
    actor: createActor(),
    reason: request.reason,
    summary: request.summary,
    details_json: request.details,
    scope: request.scope,
    status: request.status
  });
}

export async function restoreMemoryVersion(
  memoryId: string,
  request: MemoryRestoreVersionRequest
) {
  return sendGovernanceRequest("restore_version", memoryId, {
    actor: createActor(),
    reason: request.reason,
    version_no: Number.parseInt(request.versionId, 10)
  });
}
