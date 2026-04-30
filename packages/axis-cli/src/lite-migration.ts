import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";

import { axisHomeDir } from "./managed-state.js";
import { bilingualMessage } from "./messages.js";
import { DEFAULT_STORAGE_URL, pathExists } from "./utils.js";

type LiteMemoryRecord = {
  id: string;
  workspace_id: string;
  user_id: string | null;
  task_id: string | null;
  session_id: string | null;
  memory_type: "fact" | "preference" | "task_state" | "episodic";
  scope: "workspace" | "user" | "task" | "session";
  status: "active" | "pending_confirmation" | "superseded" | "archived" | "deleted";
  summary: string;
  details: Record<string, unknown>;
  importance: number;
  confidence: number;
  dedupe_key?: string;
  created_at: string;
  updated_at: string;
};

type LiteMemoryDeleteEntry = {
  action: "delete";
  record_id: string;
  deleted_at: string;
};

type StorageWritebackCandidate = {
  workspace_id: string;
  user_id?: string | null;
  task_id?: string | null;
  session_id?: string | null;
  candidate_type: LiteMemoryRecord["memory_type"];
  scope: LiteMemoryRecord["scope"];
  summary: string;
  details: Record<string, unknown>;
  importance: number;
  confidence: number;
  write_reason: string;
  source: {
    source_type: string;
    source_ref: string;
    service_name: string;
    origin_workspace_id?: string;
    confirmed_by_user?: boolean;
  };
  idempotency_key: string;
  suggested_status: "active" | "pending_confirmation";
};

export type LiteMigrationDetection = {
  memoryDir: string;
  recordsPath: string;
  exists: boolean;
  count: number;
};

export type LiteMigrationResult = {
  detected: LiteMigrationDetection;
  submitted: number;
  skipped: Array<{
    record_id: string;
    reason: string;
  }>;
  jobs: Array<{
    lite_record_id: string;
    job_id?: string;
    status?: string;
  }>;
  mappingPath: string;
};

type LiteMigrationState = {
  version: 1;
  skipFullPrompt?: boolean;
  skippedAt?: string;
  lastMigratedAt?: string;
  lastResult?: {
    submitted: number;
    skipped: number;
  };
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_BATCH_SIZE = 50;

export function axisLiteMemoryDir() {
  return process.env.AXIS_LITE_MEMORY_DIR
    ?? path.join(process.env.AXIS_HOME ?? axisHomeDir(), "memory");
}

export function axisLiteMigrationStatePath() {
  return path.join(process.env.AXIS_HOME ?? axisHomeDir(), "managed", "lite-migration-state.json");
}

export function axisLiteMigrationMappingPath() {
  return path.join(process.env.AXIS_HOME ?? axisHomeDir(), "managed", "lite-migration-map.json");
}

export async function detectLiteMemoryData(memoryDir = axisLiteMemoryDir()): Promise<LiteMigrationDetection> {
  const recordsPath = path.join(memoryDir, "records.jsonl");
  if (!(await pathExists(recordsPath))) {
    return {
      memoryDir,
      recordsPath,
      exists: false,
      count: 0,
    };
  }

  const records = await readLiteRecords(recordsPath);
  return {
    memoryDir,
    recordsPath,
    exists: true,
    count: records.length,
  };
}

export async function maybePromptLiteMigrationBeforeFullStart(options: {
  skipPrompt?: boolean;
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
} = {}): Promise<boolean> {
  if (options.skipPrompt) {
    return false;
  }

  const detected = await detectLiteMemoryData();
  if (!detected.exists || detected.count === 0) {
    return false;
  }

  const state = await readLiteMigrationState();
  if (state.skipFullPrompt || state.lastMigratedAt) {
    return false;
  }

  const stdout = options.stdout ?? process.stdout;
  const stdin = options.stdin ?? process.stdin;
  if (!stdin.isTTY) {
    stdout.write(`${bilingualMessage(
      `检测到 ${detected.count} 条精简模式记忆。当前为非交互启动，默认不迁移；可稍后运行 axis migrate --to full。`,
      `Detected ${detected.count} lite memories. Non-interactive startup skips migration by default; run axis migrate --to full later.`,
    )}\n`);
    return false;
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(`${bilingualMessage(
      `检测到你之前使用过 Axis 精简模式，里面有 ${detected.count} 条记忆。是否迁移到完整平台？[Y/N] `,
      `Detected ${detected.count} lite memories. Migrate them to full mode? [Y/N] `,
    )}`)).trim().toLowerCase();
    if (answer === "y" || answer === "yes" || answer === "是") {
      return true;
    }

    await writeLiteMigrationState({
      version: 1,
      skipFullPrompt: true,
      skippedAt: new Date().toISOString(),
    });
    return false;
  } finally {
    rl.close();
  }
}

export async function runLiteToFullMigration(options: {
  storageUrl?: string;
  memoryDir?: string;
  batchSize?: number;
} = {}): Promise<LiteMigrationResult> {
  const detected = await detectLiteMemoryData(options.memoryDir);
  const mappingPath = axisLiteMigrationMappingPath();
  if (!detected.exists || detected.count === 0) {
    return {
      detected,
      submitted: 0,
      skipped: [],
      jobs: [],
      mappingPath,
    };
  }

  const records = await readLiteRecords(detected.recordsPath);
  const planned = records.map((record) => toStorageCandidate(record));
  const candidates = planned.filter((item): item is { record: LiteMemoryRecord; candidate: StorageWritebackCandidate } => Boolean(item.candidate));
  const skipped = planned
    .filter((item) => !item.candidate)
    .map((item) => ({ record_id: item.record.id, reason: item.skipReason ?? "invalid_record" }));
  const storageUrl = (options.storageUrl ?? DEFAULT_STORAGE_URL).replace(/\/+$/, "");
  const jobs: LiteMigrationResult["jobs"] = [];
  const batchSize = Math.min(DEFAULT_BATCH_SIZE, Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE));

  for (let index = 0; index < candidates.length; index += batchSize) {
    const batch = candidates.slice(index, index + batchSize);
    const response = await fetch(`${storageUrl}/v1/storage/write-back-candidates`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        candidates: batch.map((item) => item.candidate),
      }),
    });
    const payload = await response.json().catch(() => null) as {
      jobs?: Array<{ job_id?: string; status?: string }>;
      submitted_jobs?: Array<{ job_id?: string; status?: string }>;
      error?: { message?: string };
    } | null;

    if (!response.ok) {
      throw new Error(payload?.error?.message ?? `storage migration failed with http_${response.status}`);
    }

    const responseJobs = payload?.jobs ?? payload?.submitted_jobs ?? [];
    batch.forEach((item, batchIndex) => {
      jobs.push({
        lite_record_id: item.record.id,
        job_id: responseJobs[batchIndex]?.job_id,
        status: responseJobs[batchIndex]?.status,
      });
    });
  }

  await writeMigrationMap({
    migrated_at: new Date().toISOString(),
    records: jobs,
    skipped,
  });
  await writeLiteMigrationState({
    version: 1,
    lastMigratedAt: new Date().toISOString(),
    lastResult: {
      submitted: jobs.length,
      skipped: skipped.length,
    },
  });

  return {
    detected,
    submitted: jobs.length,
    skipped,
    jobs,
    mappingPath,
  };
}

async function readLiteRecords(recordsPath: string): Promise<LiteMemoryRecord[]> {
  const content = await readFile(recordsPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  });
  const recordsById = new Map<string, LiteMemoryRecord>();

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const parsed = parseJsonLine(trimmed);
    if (isDeleteEntry(parsed)) {
      recordsById.delete(parsed.record_id);
      continue;
    }
    if (isLiteMemoryRecord(parsed)) {
      const existing = recordsById.get(parsed.id);
      if (!existing || Date.parse(existing.updated_at) <= Date.parse(parsed.updated_at)) {
        recordsById.set(parsed.id, parsed);
      }
    }
  }

  return [...recordsById.values()].filter((record) => record.status !== "deleted");
}

function toStorageCandidate(record: LiteMemoryRecord): {
  record: LiteMemoryRecord;
  candidate?: StorageWritebackCandidate;
  skipReason?: string;
} {
  if (!record.summary.trim()) {
    return { record, skipReason: "empty_summary" };
  }

  const scope = resolveMigrationScope(record);
  const workspaceId = normalizeUuid(record.workspace_id, `workspace:${record.workspace_id}`);
  const userId = scope === "workspace"
    ? null
    : normalizeUuid(record.user_id ?? `${record.workspace_id}:user`, `user:${record.user_id ?? record.workspace_id}`);
  const taskId = scope === "task"
    ? normalizeUuid(record.task_id ?? `${record.id}:task`, `task:${record.task_id ?? record.id}`)
    : record.task_id
      ? normalizeUuid(record.task_id, `task:${record.task_id}`)
      : null;
  const sessionId = scope === "session"
    ? normalizeUuid(record.session_id ?? `${record.id}:session`, `session:${record.session_id ?? record.id}`)
    : record.session_id
      ? normalizeUuid(record.session_id, `session:${record.session_id}`)
      : null;
  const migrationDetails = scope === record.scope
    ? {}
    : {
        lite_migration_original_scope: record.scope,
        lite_migration_scope_downgraded: true,
      };

  return {
    record,
    candidate: {
      workspace_id: workspaceId,
      user_id: userId,
      task_id: taskId,
      session_id: sessionId,
      candidate_type: record.memory_type,
      scope,
      summary: record.summary,
      details: sanitizeDetails({
        ...record.details,
        ...migrationDetails,
        source_lite_record_id: record.id,
        source_lite_status: record.status,
        source_lite_updated_at: record.updated_at,
      }),
      importance: normalizeNumber(record.importance, 3, 1, 5),
      confidence: normalizeNumber(record.confidence, 0.7, 0, 1),
      write_reason: "migrated from lite mode",
      source: {
        source_type: "lite_migration",
        source_ref: record.id,
        service_name: "axis-cli",
        origin_workspace_id: workspaceId,
      },
      idempotency_key: buildIdempotencyKey(record),
      suggested_status: record.status === "active" ? "active" : "pending_confirmation",
    },
  };
}

function resolveMigrationScope(record: LiteMemoryRecord): LiteMemoryRecord["scope"] {
  if (record.scope === "task" && !record.task_id) {
    return record.user_id ? "user" : "workspace";
  }
  if (record.scope === "session" && !record.session_id) {
    return record.user_id ? "user" : "workspace";
  }
  return record.scope;
}

function sanitizeDetails(details: Record<string, unknown>) {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (["transcript", "messages", "conversation", "raw_transcript", "raw_messages", "dialogue"].includes(key)) {
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

function buildIdempotencyKey(record: LiteMemoryRecord) {
  const raw = `lite-migrate:${record.id}:${record.updated_at}`;
  if (raw.length <= 128) {
    return raw;
  }
  return `lite-migrate:${createHash("sha256").update(raw).digest("hex")}`;
}

function normalizeUuid(value: string, seed: string) {
  return UUID_PATTERN.test(value) ? value : deterministicUuid(seed);
}

function deterministicUuid(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  const variant = Number.parseInt(hex[16] ?? "8", 16);
  hex[16] = ((variant & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20, 32).join("")}`;
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isDeleteEntry(value: unknown): value is LiteMemoryDeleteEntry {
  return Boolean(
    value
    && typeof value === "object"
    && (value as Record<string, unknown>).action === "delete"
    && typeof (value as Record<string, unknown>).record_id === "string",
  );
}

function isLiteMemoryRecord(value: unknown): value is LiteMemoryRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string"
    && typeof record.workspace_id === "string"
    && (typeof record.user_id === "string" || record.user_id === null)
    && (typeof record.task_id === "string" || record.task_id === null)
    && (typeof record.session_id === "string" || record.session_id === null)
    && isMemoryType(record.memory_type)
    && isScope(record.scope)
    && isStatus(record.status)
    && typeof record.summary === "string"
    && typeof record.details === "object"
    && record.details !== null
    && typeof record.created_at === "string"
    && typeof record.updated_at === "string"
  );
}

function isMemoryType(value: unknown): value is LiteMemoryRecord["memory_type"] {
  return value === "fact" || value === "preference" || value === "task_state" || value === "episodic";
}

function isScope(value: unknown): value is LiteMemoryRecord["scope"] {
  return value === "workspace" || value === "user" || value === "task" || value === "session";
}

function isStatus(value: unknown): value is LiteMemoryRecord["status"] {
  return value === "active"
    || value === "pending_confirmation"
    || value === "superseded"
    || value === "archived"
    || value === "deleted";
}

async function readLiteMigrationState(): Promise<LiteMigrationState> {
  const filePath = axisLiteMigrationStatePath();
  if (!(await pathExists(filePath))) {
    return { version: 1 };
  }
  const parsed = parseJsonLine(await readFile(filePath, "utf8"));
  return parsed && typeof parsed === "object" ? parsed as LiteMigrationState : { version: 1 };
}

async function writeLiteMigrationState(state: LiteMigrationState) {
  const filePath = axisLiteMigrationStatePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
}

async function writeMigrationMap(value: Record<string, unknown>) {
  const filePath = axisLiteMigrationMappingPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}
