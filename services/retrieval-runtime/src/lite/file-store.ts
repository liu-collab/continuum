import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { MemoryType, RecordStatus, ScopeType } from "../shared/types.js";

export interface LiteMemoryRecord {
  id: string;
  workspace_id: string;
  user_id: string | null;
  task_id: string | null;
  session_id: string | null;
  memory_type: MemoryType;
  scope: ScopeType;
  status: RecordStatus;
  summary: string;
  details: Record<string, unknown>;
  importance: number;
  confidence: number;
  dedupe_key?: string;
  created_at: string;
  updated_at: string;
}

export interface LiteMemoryDeleteEntry {
  action: "delete";
  record_id: string;
  deleted_at: string;
}

export type LiteMemoryJsonlEntry = LiteMemoryRecord | LiteMemoryDeleteEntry;

export interface FileMemoryStoreLoadResult {
  loaded: number;
  deleted: number;
  skipped: number;
}

export interface FileMemorySearchQuery {
  query?: string;
  workspace_id?: string;
  user_id?: string;
  task_id?: string;
  session_id?: string;
  memory_types?: MemoryType[];
  scopes?: ScopeType[];
  statuses?: RecordStatus[];
  importance_min?: number;
  limit?: number;
}

export interface FileMemorySearchMatch extends LiteMemoryRecord {
  score: number;
}

export interface FileMemorySearchResult {
  records: FileMemorySearchMatch[];
  total: number;
  query: string;
}

export interface FileMemoryStoreOptions {
  memoryDir: string;
  recordsFileName?: string;
}

const DEFAULT_RECORDS_FILE_NAME = "records.jsonl";
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 30;

export class FileMemoryStore {
  private readonly recordsPath: string;
  private readonly recordsById = new Map<string, LiteMemoryRecord>();
  private readonly idsByMemoryType = new Map<MemoryType, Set<string>>();
  private readonly idsByScope = new Map<ScopeType, Set<string>>();
  private readonly idsByWorkspace = new Map<string, Set<string>>();

  constructor(private readonly options: FileMemoryStoreOptions) {
    this.recordsPath = path.join(
      options.memoryDir,
      options.recordsFileName ?? DEFAULT_RECORDS_FILE_NAME,
    );
  }

  get path() {
    return this.recordsPath;
  }

  async load(): Promise<FileMemoryStoreLoadResult> {
    this.clearIndexes();

    const content = await readFile(this.recordsPath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return "";
      }
      throw error;
    });

    let loaded = 0;
    let deleted = 0;
    let skipped = 0;

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const parsed = parseJsonLine(trimmed);
      if (!parsed || !isLiteMemoryJsonlEntry(parsed)) {
        skipped += 1;
        continue;
      }

      if (isDeleteEntry(parsed)) {
        this.removeRecord(parsed.record_id);
        deleted += 1;
        continue;
      }

      this.applyRecord(parsed);
      loaded += 1;
    }

    return { loaded, deleted, skipped };
  }

  listRecords(): LiteMemoryRecord[] {
    return [...this.recordsById.values()].sort(compareRecords);
  }

  get(recordId: string): LiteMemoryRecord | undefined {
    return this.recordsById.get(recordId);
  }

  async appendRecord(record: LiteMemoryRecord): Promise<void> {
    await this.appendEntry(record);
    this.applyRecord(record);
  }

  async deleteRecord(recordId: string, deletedAt: string): Promise<void> {
    await this.appendEntry({
      action: "delete",
      record_id: recordId,
      deleted_at: deletedAt,
    });
    this.removeRecord(recordId);
  }

  search(query: FileMemorySearchQuery = {}): FileMemorySearchResult {
    const terms = tokenize(query.query ?? "");
    const limit = normalizeLimit(query.limit);
    const statuses = query.statuses ?? ["active"];
    const memoryTypes = new Set(query.memory_types ?? []);
    const scopes = new Set(query.scopes ?? []);

    const matches = this.listRecords()
      .filter((record) => statuses.includes(record.status))
      .filter((record) => !query.workspace_id || record.workspace_id === query.workspace_id)
      .filter((record) => !query.user_id || record.user_id === query.user_id)
      .filter((record) => !query.task_id || record.task_id === query.task_id)
      .filter((record) => !query.session_id || record.session_id === query.session_id)
      .filter((record) => memoryTypes.size === 0 || memoryTypes.has(record.memory_type))
      .filter((record) => scopes.size === 0 || scopes.has(record.scope))
      .filter((record) => record.importance >= (query.importance_min ?? 1))
      .map((record) => ({
        ...record,
        score: scoreRecord(record, terms),
      }))
      .filter((record) => terms.length === 0 || record.score > 0)
      .sort(compareSearchMatches);

    return {
      records: matches.slice(0, limit),
      total: matches.length,
      query: query.query ?? "",
    };
  }

  size(): number {
    return this.recordsById.size;
  }

  idsForMemoryType(memoryType: MemoryType): string[] {
    return [...(this.idsByMemoryType.get(memoryType) ?? [])].sort();
  }

  idsForScope(scope: ScopeType): string[] {
    return [...(this.idsByScope.get(scope) ?? [])].sort();
  }

  idsForWorkspace(workspaceId: string): string[] {
    return [...(this.idsByWorkspace.get(workspaceId) ?? [])].sort();
  }

  private async appendEntry(entry: LiteMemoryJsonlEntry): Promise<void> {
    await mkdir(path.dirname(this.recordsPath), { recursive: true });
    await appendFile(this.recordsPath, `${JSON.stringify(entry)}\n`, "utf8");
  }

  private applyRecord(record: LiteMemoryRecord): void {
    const existing = this.recordsById.get(record.id);
    if (existing && Date.parse(existing.updated_at) > Date.parse(record.updated_at)) {
      return;
    }

    if (existing) {
      this.removeRecord(existing.id);
    }

    if (record.status === "deleted") {
      return;
    }

    this.recordsById.set(record.id, record);
    addToIndex(this.idsByMemoryType, record.memory_type, record.id);
    addToIndex(this.idsByScope, record.scope, record.id);
    addToIndex(this.idsByWorkspace, record.workspace_id, record.id);
  }

  private removeRecord(recordId: string): void {
    const existing = this.recordsById.get(recordId);
    if (!existing) {
      return;
    }

    this.recordsById.delete(recordId);
    removeFromIndex(this.idsByMemoryType, existing.memory_type, recordId);
    removeFromIndex(this.idsByScope, existing.scope, recordId);
    removeFromIndex(this.idsByWorkspace, existing.workspace_id, recordId);
  }

  private clearIndexes(): void {
    this.recordsById.clear();
    this.idsByMemoryType.clear();
    this.idsByScope.clear();
    this.idsByWorkspace.clear();
  }
}

function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isDeleteEntry(value: LiteMemoryJsonlEntry): value is LiteMemoryDeleteEntry {
  return "action" in value && value.action === "delete";
}

function isLiteMemoryJsonlEntry(value: unknown): value is LiteMemoryJsonlEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.action === "delete") {
    return typeof candidate.record_id === "string" && typeof candidate.deleted_at === "string";
  }

  return (
    typeof candidate.id === "string"
    && typeof candidate.workspace_id === "string"
    && (typeof candidate.user_id === "string" || candidate.user_id === null)
    && (typeof candidate.task_id === "string" || candidate.task_id === null)
    && (typeof candidate.session_id === "string" || candidate.session_id === null)
    && isMemoryType(candidate.memory_type)
    && isScope(candidate.scope)
    && isRecordStatus(candidate.status)
    && typeof candidate.summary === "string"
    && typeof candidate.details === "object"
    && candidate.details !== null
    && typeof candidate.importance === "number"
    && typeof candidate.confidence === "number"
    && typeof candidate.created_at === "string"
    && typeof candidate.updated_at === "string"
  );
}

function isMemoryType(value: unknown): value is MemoryType {
  return value === "fact" || value === "preference" || value === "task_state" || value === "episodic";
}

function isScope(value: unknown): value is ScopeType {
  return value === "workspace" || value === "user" || value === "task" || value === "session";
}

function isRecordStatus(value: unknown): value is RecordStatus {
  return value === "active"
    || value === "pending_confirmation"
    || value === "superseded"
    || value === "archived"
    || value === "deleted";
}

function addToIndex<TKey>(index: Map<TKey, Set<string>>, key: TKey, recordId: string): void {
  const ids = index.get(key) ?? new Set<string>();
  ids.add(recordId);
  index.set(key, ids);
}

function removeFromIndex<TKey>(index: Map<TKey, Set<string>>, key: TKey, recordId: string): void {
  const ids = index.get(key);
  if (!ids) {
    return;
  }
  ids.delete(recordId);
  if (ids.size === 0) {
    index.delete(key);
  }
}

function tokenize(input: string): string[] {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .split(/[\s,.;:!?，。；：！？、"'`()[\]{}<>/\\|-]+/u)
    .map((term) => term.trim())
    .filter(Boolean);
}

function scoreRecord(record: LiteMemoryRecord, terms: string[]): number {
  if (terms.length === 0) {
    return 0;
  }

  const haystack = `${record.summary} ${JSON.stringify(record.details)}`
    .normalize("NFKC")
    .toLowerCase();

  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit ?? DEFAULT_SEARCH_LIMIT)) {
    return DEFAULT_SEARCH_LIMIT;
  }
  return Math.min(MAX_SEARCH_LIMIT, Math.max(1, Math.trunc(limit ?? DEFAULT_SEARCH_LIMIT)));
}

function compareRecords(left: LiteMemoryRecord, right: LiteMemoryRecord): number {
  const updatedDiff = Date.parse(right.updated_at) - Date.parse(left.updated_at);
  if (updatedDiff !== 0) {
    return updatedDiff;
  }
  return left.id.localeCompare(right.id);
}

function compareSearchMatches(left: FileMemorySearchMatch, right: FileMemorySearchMatch): number {
  return (
    right.score - left.score
    || right.importance - left.importance
    || Date.parse(right.updated_at) - Date.parse(left.updated_at)
    || left.id.localeCompare(right.id)
  );
}
