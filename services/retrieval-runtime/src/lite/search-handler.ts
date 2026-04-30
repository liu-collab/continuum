import type {
  FileMemorySearchQuery,
  FileMemorySearchResult,
  FileMemoryStore,
  LiteMemoryRecord,
} from "./file-store.js";
import type { MemoryType, ScopeType } from "../shared/types.js";
import { normalizeText } from "../shared/utils.js";

export type LiteMemoryFunctionName = "memory_search" | "memory_get";

export interface LiteMemoryFunctionContext {
  workspace_id: string;
  user_id: string;
  session_id: string;
  task_id?: string;
}

export interface LiteMemorySearchArguments {
  query?: unknown;
  memory_types?: unknown;
  scopes?: unknown;
  importance_min?: unknown;
  limit?: unknown;
}

export interface LiteMemoryGetArguments {
  record_id?: unknown;
}

export interface LiteMemoryFunctionRecord {
  id: string;
  memory_type: MemoryType;
  scope: ScopeType;
  summary: string;
  details: Record<string, unknown>;
  importance: number;
  confidence: number;
  status: LiteMemoryRecord["status"];
  updated_at: string;
  score?: number;
}

export interface LiteMemorySearchFunctionResult {
  records: LiteMemoryFunctionRecord[];
  total: number;
  query: string;
  effective_query: FileMemorySearchQuery;
}

export interface LiteMemoryFunctionHandlerOptions {
  store: Pick<FileMemoryStore, "search" | "get">;
}

const MEMORY_TYPES: MemoryType[] = ["fact", "preference", "task_state", "episodic"];
const SCOPES: ScopeType[] = ["workspace", "user", "task", "session"];
const DEFAULT_IMPORTANCE_MIN = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;

export class LiteMemoryFunctionHandler {
  constructor(private readonly options: LiteMemoryFunctionHandlerOptions) {}

  memorySearch(
    context: LiteMemoryFunctionContext,
    args: LiteMemorySearchArguments = {},
  ): LiteMemorySearchFunctionResult {
    const effectiveQuery: FileMemorySearchQuery = {
      query: normalizeOptionalString(args.query),
      workspace_id: context.workspace_id,
      user_id: context.user_id,
      session_id: context.session_id,
      task_id: context.task_id,
      memory_types: normalizeEnumList(args.memory_types, MEMORY_TYPES),
      scopes: normalizeEnumList(args.scopes, SCOPES),
      statuses: ["active"],
      importance_min: normalizeImportance(args.importance_min),
      limit: normalizeLimit(args.limit),
    };
    const result = this.options.store.search(effectiveQuery);
    return {
      records: result.records.map(toFunctionRecord),
      total: result.total,
      query: result.query,
      effective_query: effectiveQuery,
    };
  }

  memoryGet(
    context: LiteMemoryFunctionContext,
    args: LiteMemoryGetArguments,
  ): LiteMemoryRecord | null {
    const recordId = normalizeOptionalString(args.record_id);
    if (!recordId) {
      return null;
    }

    const record = this.options.store.get(recordId);
    if (!record || record.status !== "active" || !isVisibleInContext(record, context)) {
      return null;
    }

    return record;
  }

  call(
    context: LiteMemoryFunctionContext,
    name: LiteMemoryFunctionName,
    args: LiteMemorySearchArguments | LiteMemoryGetArguments,
  ): LiteMemorySearchFunctionResult | LiteMemoryRecord | null {
    if (name === "memory_search") {
      return this.memorySearch(context, args as LiteMemorySearchArguments);
    }
    return this.memoryGet(context, args as LiteMemoryGetArguments);
  }
}

function toFunctionRecord(record: FileMemorySearchResult["records"][number]): LiteMemoryFunctionRecord {
  return {
    id: record.id,
    memory_type: record.memory_type,
    scope: record.scope,
    summary: record.summary,
    details: record.details,
    importance: record.importance,
    confidence: record.confidence,
    status: record.status,
    updated_at: record.updated_at,
    score: record.score,
  };
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = normalizeText(value);
  return normalized || undefined;
}

function normalizeEnumList<T extends string>(value: unknown, allowed: readonly T[]): T[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const allowedValues = new Set(allowed);
  const normalized: T[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !allowedValues.has(item as T)) {
      continue;
    }
    if (!normalized.includes(item as T)) {
      normalized.push(item as T);
    }
  }
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeImportance(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_IMPORTANCE_MIN;
  }
  return Math.min(5, Math.max(1, Math.trunc(value)));
}

function normalizeLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(value)));
}

function isVisibleInContext(record: LiteMemoryRecord, context: LiteMemoryFunctionContext): boolean {
  switch (record.scope) {
    case "workspace":
      return record.workspace_id === context.workspace_id;
    case "user":
      return record.user_id === context.user_id;
    case "task":
      return record.workspace_id === context.workspace_id
        && Boolean(context.task_id)
        && record.task_id === context.task_id;
    case "session":
      return record.workspace_id === context.workspace_id
        && record.session_id === context.session_id;
  }
}
