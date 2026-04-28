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
import { createTranslator, DEFAULT_APP_LOCALE, type AppLocale } from "@/lib/i18n/messages";
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

type GovernanceRequestOptions = {
  locale?: AppLocale;
};

async function sendGovernanceRequest(
  action: MemoryGovernanceAction,
  memoryId: string,
  payload: Record<string, unknown>,
  options: GovernanceRequestOptions = {}
): Promise<MemoryGovernanceResponse> {
  const { values } = getAppConfig();
  const locale = options.locale ?? DEFAULT_APP_LOCALE;
  const t = createTranslator(locale);
  const actionLabel = t(`service.governance.actionLabels.${action}`);
  const method = action === "edit" ? "PATCH" : "POST";
  const suffix =
    action === "edit" ? "" : action === "restore_version" ? "/restore-version" : `/${action}`;

  const response = await fetchJsonFromSource<unknown>({
    sourceName: "storage_governance_api",
    sourceLabel: t("service.sources.storageGovernanceApi"),
    url: values.STORAGE_API_BASE_URL
      ? `${values.STORAGE_API_BASE_URL}/v1/storage/records/${memoryId}${suffix}`
      : undefined,
    timeoutMs: values.STORAGE_API_TIMEOUT_MS,
    method,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    locale
  });

  return {
    ok: response.ok,
    action,
    memoryId,
    message: response.ok
      ? t("service.governance.submitted", { action: actionLabel })
      : mapErrorMessage(response.status, t("service.governance.failed", { action: actionLabel })),
    upstreamStatus: null,
    sourceStatus: response.status
  };
}

export async function confirmMemory(
  memoryId: string,
  request: MemoryGovernanceActionRequest,
  options?: GovernanceRequestOptions
) {
  return sendGovernanceRequest("confirm", memoryId, {
    actor: createActor(),
    reason: request.reason
  }, options);
}

export async function invalidateMemory(
  memoryId: string,
  request: MemoryGovernanceActionRequest,
  options?: GovernanceRequestOptions
) {
  return sendGovernanceRequest("invalidate", memoryId, {
    actor: createActor(),
    reason: request.reason
  }, options);
}

export async function archiveMemory(
  memoryId: string,
  request: MemoryGovernanceActionRequest,
  options?: GovernanceRequestOptions
) {
  return sendGovernanceRequest("archive", memoryId, {
    actor: createActor(),
    reason: request.reason
  }, options);
}

export async function deleteMemory(
  memoryId: string,
  request: MemoryGovernanceActionRequest,
  options?: GovernanceRequestOptions
) {
  return sendGovernanceRequest("delete", memoryId, {
    actor: createActor(),
    reason: request.reason
  }, options);
}

export async function editMemory(
  memoryId: string,
  request: MemoryEditRequest,
  options?: GovernanceRequestOptions
) {
  return sendGovernanceRequest("edit", memoryId, {
    actor: createActor(),
    reason: request.reason,
    summary: request.summary,
    details_json: request.details,
    scope: request.scope,
    status: request.status
  }, options);
}

export async function restoreMemoryVersion(
  memoryId: string,
  request: MemoryRestoreVersionRequest,
  options?: GovernanceRequestOptions
) {
  return sendGovernanceRequest("restore_version", memoryId, {
    actor: createActor(),
    reason: request.reason,
    version_no: Number.parseInt(request.versionId, 10)
  }, options);
}
