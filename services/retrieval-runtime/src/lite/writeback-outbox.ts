import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { LiteMemoryRecord } from "./file-store.js";
import { LiteWriteQueue } from "./write-queue.js";

export interface LiteWritebackOutboxEntry {
  id: string;
  trace_id: string;
  record: LiteMemoryRecord;
  status: "pending" | "submitted" | "dead_letter";
  retry_count: number;
  last_error?: string;
  created_at: string;
  updated_at: string;
  submitted_at?: string;
}

export interface LiteWritebackOutboxRetryResult {
  attempted: number;
  submitted: number;
  failed: number;
}

export interface LiteWritebackOutboxOptions {
  memoryDir: string;
  fileName?: string;
  writeQueue?: LiteWriteQueue;
}

const DEFAULT_OUTBOX_FILE_NAME = "writeback-outbox.jsonl";
const MAX_RETRY_COUNT = 5;

export class LiteWritebackOutbox {
  private readonly outboxPath: string;
  private readonly writeQueue: LiteWriteQueue;
  private readonly entriesById = new Map<string, LiteWritebackOutboxEntry>();
  private loaded = false;

  constructor(options: LiteWritebackOutboxOptions) {
    this.outboxPath = path.join(options.memoryDir, options.fileName ?? DEFAULT_OUTBOX_FILE_NAME);
    this.writeQueue = options.writeQueue ?? new LiteWriteQueue();
  }

  get path() {
    return this.outboxPath;
  }

  async load(): Promise<void> {
    this.entriesById.clear();
    const content = await readFile(this.outboxPath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return "";
      }
      throw error;
    });

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const parsed = parseJsonLine(trimmed);
      if (isOutboxEntry(parsed)) {
        this.entriesById.set(parsed.id, parsed);
      }
    }

    this.loaded = true;
  }

  async enqueue(input: {
    trace_id: string;
    record: LiteMemoryRecord;
    error: string;
    now: string;
  }): Promise<LiteWritebackOutboxEntry> {
    await this.ensureLoaded();
    const id = `outbox_${input.record.id}`;
    const existing = this.entriesById.get(id);
    const entry: LiteWritebackOutboxEntry = {
      id,
      trace_id: input.trace_id,
      record: input.record,
      status: "pending",
      retry_count: existing?.retry_count ?? 0,
      last_error: input.error,
      created_at: existing?.created_at ?? input.now,
      updated_at: input.now,
    };

    await this.appendEntry(entry);
    this.entriesById.set(entry.id, entry);
    return entry;
  }

  async pending(): Promise<LiteWritebackOutboxEntry[]> {
    await this.ensureLoaded();
    return [...this.entriesById.values()]
      .filter((entry) => entry.status === "pending")
      .sort((left, right) =>
        Date.parse(left.created_at) - Date.parse(right.created_at) || left.id.localeCompare(right.id),
      );
  }

  async retryPending(
    writer: (record: LiteMemoryRecord) => Promise<void>,
    now: () => string,
  ): Promise<LiteWritebackOutboxRetryResult> {
    const pendingEntries = await this.pending();
    let submitted = 0;
    let failed = 0;

    for (const entry of pendingEntries) {
      try {
        await writer(entry.record);
        await this.markSubmitted(entry, now());
        submitted += 1;
      } catch (error) {
        await this.markFailed(entry, error instanceof Error ? error.message : String(error), now());
        failed += 1;
      }
    }

    return {
      attempted: pendingEntries.length,
      submitted,
      failed,
    };
  }

  async size(): Promise<number> {
    await this.ensureLoaded();
    return this.entriesById.size;
  }

  private async markSubmitted(entry: LiteWritebackOutboxEntry, now: string): Promise<void> {
    const updated: LiteWritebackOutboxEntry = {
      ...entry,
      status: "submitted",
      updated_at: now,
      submitted_at: now,
    };
    await this.appendEntry(updated);
    this.entriesById.set(updated.id, updated);
  }

  private async markFailed(entry: LiteWritebackOutboxEntry, error: string, now: string): Promise<void> {
    const retryCount = entry.retry_count + 1;
    const updated: LiteWritebackOutboxEntry = {
      ...entry,
      status: retryCount >= MAX_RETRY_COUNT ? "dead_letter" : "pending",
      retry_count: retryCount,
      last_error: error,
      updated_at: now,
    };
    await this.appendEntry(updated);
    this.entriesById.set(updated.id, updated);
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }
  }

  private async appendEntry(entry: LiteWritebackOutboxEntry): Promise<void> {
    await this.writeQueue.enqueue(async () => {
      await mkdir(path.dirname(this.outboxPath), { recursive: true });
      await appendFile(this.outboxPath, `${JSON.stringify(entry)}\n`, "utf8");
    });
  }
}

function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isOutboxEntry(value: unknown): value is LiteWritebackOutboxEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const entry = value as Partial<LiteWritebackOutboxEntry>;
  return (
    typeof entry.id === "string"
    && typeof entry.trace_id === "string"
    && typeof entry.record === "object"
    && entry.record !== null
    && (
      entry.status === "pending"
      || entry.status === "submitted"
      || entry.status === "dead_letter"
    )
    && typeof entry.retry_count === "number"
    && typeof entry.created_at === "string"
    && typeof entry.updated_at === "string"
  );
}
