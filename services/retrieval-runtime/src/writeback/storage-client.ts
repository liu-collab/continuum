import type { AppConfig } from "../config.js";
import type {
  ConflictStatus,
  GovernanceExecutionBatch,
  GovernanceExecutionResponseItem,
  MemoryConflictSnapshot,
  MemoryRecordSnapshot,
  MemoryType,
  RecordStatus,
  ScopeType,
  SubmittedWriteBackJob,
  WriteBackCandidate,
} from "../shared/types.js";

export interface RecordListFilters {
  workspace_id: string;
  user_id?: string;
  task_id?: string;
  memory_type?: MemoryType;
  scope?: ScopeType;
  status?: RecordStatus;
  page?: number;
  page_size?: number;
}

export interface RecordListPage {
  items: MemoryRecordSnapshot[];
  total: number;
  page: number;
  page_size: number;
}

export interface StorageActor {
  actor_type: "system" | "user" | "operator";
  actor_id: string;
}

export interface StorageMutationPayload {
  actor: StorageActor;
  reason: string;
}

export interface RecordPatchPayload extends StorageMutationPayload {
  summary?: string;
  details_json?: Record<string, unknown>;
  scope?: ScopeType;
  importance?: number;
  confidence?: number;
  status?: Exclude<RecordStatus, "deleted">;
}

export interface ResolveConflictPayload {
  resolution_type: "manual_fix" | "auto_merge" | "dismissed";
  resolved_by: string;
  resolution_note: string;
  activate_record_id?: string;
}

export interface StorageWritebackClient {
  submitCandidates(
    candidates: WriteBackCandidate[],
    signal?: AbortSignal,
  ): Promise<SubmittedWriteBackJob[]>;
  listRecords(filters: RecordListFilters, signal?: AbortSignal): Promise<RecordListPage>;
  patchRecord(
    recordId: string,
    payload: RecordPatchPayload,
    signal?: AbortSignal,
  ): Promise<MemoryRecordSnapshot>;
  archiveRecord(
    recordId: string,
    payload: StorageMutationPayload,
    signal?: AbortSignal,
  ): Promise<MemoryRecordSnapshot>;
  listConflicts(
    status?: ConflictStatus,
    signal?: AbortSignal,
  ): Promise<MemoryConflictSnapshot[]>;
  resolveConflict(
    conflictId: string,
    payload: ResolveConflictPayload,
    signal?: AbortSignal,
  ): Promise<MemoryConflictSnapshot>;
  submitGovernanceExecutions(
    batch: GovernanceExecutionBatch,
    signal?: AbortSignal,
  ): Promise<GovernanceExecutionResponseItem[]>;
}

export class HttpStorageWritebackClient implements StorageWritebackClient {
  constructor(private readonly config: AppConfig) {}

  async submitCandidates(
    candidates: WriteBackCandidate[],
    signal?: AbortSignal,
  ): Promise<SubmittedWriteBackJob[]> {
    const payload = await this.postJson<{ submitted_jobs?: SubmittedWriteBackJob[] }>(
      "/v1/storage/write-back-candidates",
      { candidates },
      signal,
    );
    return payload.submitted_jobs ?? [];
  }

  async listRecords(filters: RecordListFilters, signal?: AbortSignal): Promise<RecordListPage> {
    const url = new URL("/v1/storage/records", this.config.STORAGE_WRITEBACK_URL);
    url.searchParams.set("workspace_id", filters.workspace_id);
    if (filters.user_id) url.searchParams.set("user_id", filters.user_id);
    if (filters.task_id) url.searchParams.set("task_id", filters.task_id);
    if (filters.memory_type) url.searchParams.set("memory_type", filters.memory_type);
    if (filters.scope) url.searchParams.set("scope", filters.scope);
    if (filters.status) url.searchParams.set("status", filters.status);
    if (filters.page) url.searchParams.set("page", String(filters.page));
    if (filters.page_size) url.searchParams.set("page_size", String(filters.page_size));

    const envelope = await fetchJson<{
      data?: {
        items?: unknown[];
        total?: number;
        page?: number;
        page_size?: number;
      };
    }>(url, { method: "GET", signal });
    return {
      items: (envelope.data?.items ?? []).map(mapMemoryRecordRow),
      total: envelope.data?.total ?? 0,
      page: envelope.data?.page ?? filters.page ?? 1,
      page_size: envelope.data?.page_size ?? filters.page_size ?? 20,
    };
  }

  async patchRecord(
    recordId: string,
    payload: RecordPatchPayload,
    signal?: AbortSignal,
  ): Promise<MemoryRecordSnapshot> {
    const url = new URL(
      `/v1/storage/records/${encodeURIComponent(recordId)}`,
      this.config.STORAGE_WRITEBACK_URL,
    );
    const envelope = await fetchJson<{ data?: unknown }>(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    return mapMemoryRecordRow(envelope.data);
  }

  async archiveRecord(
    recordId: string,
    payload: StorageMutationPayload,
    signal?: AbortSignal,
  ): Promise<MemoryRecordSnapshot> {
    const url = new URL(
      `/v1/storage/records/${encodeURIComponent(recordId)}/archive`,
      this.config.STORAGE_WRITEBACK_URL,
    );
    const envelope = await fetchJson<{ data?: unknown }>(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    return mapMemoryRecordRow(envelope.data);
  }

  async listConflicts(
    status?: ConflictStatus,
    signal?: AbortSignal,
  ): Promise<MemoryConflictSnapshot[]> {
    const url = new URL("/v1/storage/conflicts", this.config.STORAGE_WRITEBACK_URL);
    if (status) url.searchParams.set("status", status);
    const envelope = await fetchJson<{ data?: unknown[] }>(url, { method: "GET", signal });
    return (envelope.data ?? []).map(mapConflictRow);
  }

  async resolveConflict(
    conflictId: string,
    payload: ResolveConflictPayload,
    signal?: AbortSignal,
  ): Promise<MemoryConflictSnapshot> {
    const url = new URL(
      `/v1/storage/conflicts/${encodeURIComponent(conflictId)}/resolve`,
      this.config.STORAGE_WRITEBACK_URL,
    );
    const envelope = await fetchJson<{ data?: unknown }>(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    return mapConflictRow(envelope.data);
  }

  async submitGovernanceExecutions(
    batch: GovernanceExecutionBatch,
    signal?: AbortSignal,
  ): Promise<GovernanceExecutionResponseItem[]> {
    const url = new URL("/v1/storage/governance-executions", this.config.STORAGE_WRITEBACK_URL);
    const envelope = await fetchJson<{ data?: GovernanceExecutionResponseItem[] }>(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(batch),
      signal,
    });
    return envelope.data ?? [];
  }

  private async postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const url = new URL(path, this.config.STORAGE_WRITEBACK_URL);
    return fetchJson<T>(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  }
}

async function fetchJson<T>(url: URL, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`storage request ${init.method ?? "GET"} ${url.pathname} failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

function mapMemoryRecordRow(row: unknown): MemoryRecordSnapshot {
  if (!row || typeof row !== "object") {
    throw new Error("storage record row is not an object");
  }
  const r = row as Record<string, unknown>;
  return {
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    user_id: nullableString(r.user_id),
    task_id: nullableString(r.task_id),
    session_id: nullableString(r.session_id),
    memory_type: r.memory_type as MemoryType,
    scope: r.scope as ScopeType,
    status: r.status as RecordStatus,
    summary: String(r.summary ?? ""),
    details: (r.details_json ?? r.details ?? null) as Record<string, unknown> | null,
    importance: Number(r.importance ?? 0),
    confidence: Number(r.confidence ?? 0),
    dedupe_key: typeof r.dedupe_key === "string" ? r.dedupe_key : undefined,
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
    last_used_at: nullableString(r.last_used_at) ?? null,
  };
}

function mapConflictRow(row: unknown): MemoryConflictSnapshot {
  if (!row || typeof row !== "object") {
    throw new Error("storage conflict row is not an object");
  }
  const r = row as Record<string, unknown>;
  return {
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    record_id: String(r.record_id),
    conflict_with_record_id: String(r.conflict_with_record_id),
    conflict_type: String(r.conflict_type ?? ""),
    conflict_summary: String(r.conflict_summary ?? ""),
    status: r.status as ConflictStatus,
    created_at: String(r.created_at ?? ""),
  };
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return String(value);
}
