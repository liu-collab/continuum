import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import { resolveMnaHomeDirectory } from "../shared/token.js";
import type {
  AppendMessageInput,
  CreateSessionInput,
  DispatchedMessagesPayload,
  Message,
  OpenTurnInput,
  PlanRevision,
  Session,
  SessionListFilter,
  SessionStore,
  SessionSummary,
  ToolInvocation,
  ToolInvocationInput,
  Turn,
} from "./types.js";

const DEFAULT_DB_FILENAME = "sessions.db";

type SqliteRow = Record<string, unknown>;
const currentDir = path.dirname(fileURLToPath(import.meta.url));

export interface SqliteSessionStoreOptions {
  dbPath?: string;
  artifactsRoot?: string;
}

export class SqliteSessionStore implements SessionStore {
  private readonly db: Database.Database;
  private readonly dbPath: string;
  private readonly artifactsRoot: string | null;

  constructor(options: SqliteSessionStoreOptions = {}) {
    this.dbPath = options.dbPath ?? path.join(resolveMnaHomeDirectory(), DEFAULT_DB_FILENAME);
    this.artifactsRoot = options.artifactsRoot ?? null;

    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.pragma("foreign_keys = ON");
    this.runMigrations();
  }

  createSession(input: CreateSessionInput): Session {
    const createdAt = input.created_at ?? new Date().toISOString();
    this.db
      .prepare(
        `
          INSERT INTO sessions (id, workspace_id, user_id, title, memory_mode, locale, created_at, last_active_at, closed_at)
          VALUES (@id, @workspace_id, @user_id, @title, @memory_mode, @locale, @created_at, @last_active_at, NULL)
        `,
      )
      .run({
        ...input,
        title: input.title ?? null,
        created_at: createdAt,
        last_active_at: createdAt,
      });

    return this.getSession(input.id)!;
  }

  getSession(id: string): Session | null {
    const row = this.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as SqliteRow | undefined;
    return row ? mapSession(row) : null;
  }

  listSessions(filter: SessionListFilter = {}): { items: SessionSummary[]; next_cursor: string | null } {
    const limit = filter.limit ?? 20;
    const params: unknown[] = [];
    const where: string[] = [];

    if (filter.workspace_id) {
      where.push("s.workspace_id = ?");
      params.push(filter.workspace_id);
    }

    if (filter.cursor) {
      where.push("s.last_active_at < ?");
      params.push(filter.cursor);
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            s.*,
            (
              SELECT t.id
              FROM turns t
              WHERE t.session_id = s.id
              ORDER BY t.turn_index DESC
              LIMIT 1
            ) AS latest_turn_id
          FROM sessions s
          ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
          ORDER BY s.last_active_at DESC
          LIMIT ?
        `,
      )
      .all(...params, limit + 1) as SqliteRow[];

    const next = rows.length > limit ? rows[limit] : undefined;
    const items = rows.slice(0, limit).map(mapSessionSummary);
    return {
      items,
      next_cursor: typeof next?.last_active_at === "string" ? next.last_active_at : null,
    };
  }

  updateSession(id: string, patch: Partial<Pick<Session, "title" | "memory_mode" | "closed_at">>): void {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (patch.title !== undefined) {
      updates.push("title = ?");
      values.push(patch.title);
    }
    if (patch.memory_mode !== undefined) {
      updates.push("memory_mode = ?");
      values.push(patch.memory_mode);
    }
    if (patch.closed_at !== undefined) {
      updates.push("closed_at = ?");
      values.push(patch.closed_at);
    }

    if (updates.length === 0) {
      return;
    }

    this.db.prepare(`UPDATE sessions SET ${updates.join(", ")} WHERE id = ?`).run(...values, id);
  }

  deleteSession(id: string, opts: { purgeArtifacts: boolean }): void {
    this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);

    if (opts.purgeArtifacts && this.artifactsRoot) {
      fs.rmSync(path.join(this.artifactsRoot, id), { recursive: true, force: true });
    }
  }

  openTurn(input: OpenTurnInput): Turn {
    const createdAt = input.created_at ?? new Date().toISOString();
    const nextTurnIndex = (
      this.db
        .prepare(`SELECT COALESCE(MAX(turn_index), 0) + 1 AS next_turn_index FROM turns WHERE session_id = ?`)
        .get(input.session_id) as { next_turn_index: number }
    ).next_turn_index;

    this.db
      .prepare(
        `
          INSERT INTO turns (id, session_id, turn_index, task_id, trace_id, created_at, finish_reason)
          VALUES (@id, @session_id, @turn_index, @task_id, NULL, @created_at, NULL)
        `,
      )
      .run({
        id: input.id,
        session_id: input.session_id,
        turn_index: nextTurnIndex,
        task_id: input.task_id ?? null,
        created_at: createdAt,
      });

    this.touchSession(input.session_id, createdAt);

    return this.requireTurn(input.id);
  }

  appendMessage(input: AppendMessageInput): void {
    const createdAt = input.created_at ?? new Date().toISOString();
    this.db
      .prepare(
        `
          INSERT INTO messages (id, session_id, turn_id, role, content, tool_call_id, token_in, token_out, created_at)
          VALUES (@id, @session_id, @turn_id, @role, @content, @tool_call_id, @token_in, @token_out, @created_at)
        `,
      )
      .run({
        ...input,
        tool_call_id: input.tool_call_id ?? null,
        token_in: input.token_in ?? null,
        token_out: input.token_out ?? null,
        created_at: createdAt,
      });

    this.touchSession(input.session_id, createdAt);
  }

  closeTurn(turn_id: string, finish_reason: string, trace_id?: string): void {
    this.db
      .prepare(`UPDATE turns SET finish_reason = ?, trace_id = COALESCE(?, trace_id) WHERE id = ?`)
      .run(finish_reason, trace_id ?? null, turn_id);
  }

  getTurn(turn_id: string): { turn: Turn; messages: Message[]; tool_invocations: ToolInvocation[] } | null {
    const turnRow = this.db.prepare(`SELECT * FROM turns WHERE id = ?`).get(turn_id) as SqliteRow | undefined;
    if (!turnRow) {
      return null;
    }

    const messages = this.db
      .prepare(`SELECT * FROM messages WHERE turn_id = ? ORDER BY created_at ASC`)
      .all(turn_id)
      .map((row: unknown) => mapMessage(row as SqliteRow));

    const toolInvocations = this.db
      .prepare(`SELECT * FROM tool_invocations WHERE turn_id = ? ORDER BY created_at ASC`)
      .all(turn_id)
      .map((row: unknown) => mapToolInvocation(row as SqliteRow));

    return {
      turn: mapTurn(turnRow),
      messages,
      tool_invocations: toolInvocations,
    };
  }

  getMessages(session_id: string, opts?: { before_turn_index?: number; limit?: number }): Message[] {
    const limit = opts?.limit ?? 100;
    const beforeTurnIndex = opts?.before_turn_index;

    const rows = beforeTurnIndex === undefined
      ? this.db
          .prepare(
            `
              SELECT m.*
              FROM messages m
              WHERE m.session_id = ?
              ORDER BY m.created_at DESC
              LIMIT ?
            `,
          )
          .all(session_id, limit)
      : this.db
          .prepare(
            `
              SELECT m.*
              FROM messages m
              JOIN turns t ON t.id = m.turn_id
              WHERE m.session_id = ? AND t.turn_index < ?
              ORDER BY m.created_at DESC
              LIMIT ?
            `,
          )
          .all(session_id, beforeTurnIndex, limit);

    return (rows as SqliteRow[]).reverse().map(mapMessage);
  }

  recordToolInvocation(input: ToolInvocationInput): void {
    const createdAt = input.created_at ?? new Date().toISOString();
    this.db
      .prepare(
        `
          INSERT INTO tool_invocations (
            call_id,
            session_id,
            turn_id,
            tool_name,
            args_hash,
            args_preview,
            permission_decision,
            exit_code,
            ok,
            error_code,
            artifact_ref,
            duration_ms,
            created_at
          ) VALUES (
            @call_id,
            @session_id,
            @turn_id,
            @tool_name,
            @args_hash,
            @args_preview,
            @permission_decision,
            @exit_code,
            @ok,
            @error_code,
            @artifact_ref,
            @duration_ms,
            @created_at
          )
        `,
      )
      .run({
        ...input,
        args_preview: truncate(input.args_preview ?? null, 512),
        exit_code: input.exit_code ?? null,
        ok: input.ok ? 1 : 0,
        error_code: input.error_code ?? null,
        artifact_ref: input.artifact_ref ?? null,
        created_at: createdAt,
      });
  }

  savePlanRevision(input: {
    id: string;
    session_id: string;
    turn_id: string;
    plan_id: string;
    revision: number;
    status: PlanRevision["status"];
    goal: string;
    revision_reason?: string | null;
    plan_json: string;
    created_at?: string;
  }): void {
    const createdAt = input.created_at ?? new Date().toISOString();
    this.db
      .prepare(
        `
          INSERT INTO plans (id, session_id, turn_id, plan_id, revision, status, goal, revision_reason, plan_json, created_at)
          VALUES (@id, @session_id, @turn_id, @plan_id, @revision, @status, @goal, @revision_reason, @plan_json, @created_at)
        `,
      )
      .run({
        ...input,
        revision_reason: input.revision_reason ?? null,
        created_at: createdAt,
      });
  }

  saveDispatchedMessages(turn_id: string, payload: DispatchedMessagesPayload): void {
    const createdAt = payload.created_at ?? new Date().toISOString();
    this.db
      .prepare(
        `
          INSERT INTO dispatched_messages (
            turn_id,
            messages_json,
            tools_json,
            prompt_segments_json,
            phase_results_json,
            budget_plan_json,
            plan_json,
            trace_spans_json,
            evaluation_json,
            provider_id,
            model,
            round,
            created_at
          )
          VALUES (
            @turn_id,
            @messages_json,
            @tools_json,
            @prompt_segments_json,
            @phase_results_json,
            @budget_plan_json,
            @plan_json,
            @trace_spans_json,
            @evaluation_json,
            @provider_id,
            @model,
            @round,
            @created_at
          )
          ON CONFLICT(turn_id) DO UPDATE SET
            messages_json = excluded.messages_json,
            tools_json = excluded.tools_json,
            prompt_segments_json = excluded.prompt_segments_json,
            phase_results_json = excluded.phase_results_json,
            budget_plan_json = excluded.budget_plan_json,
            plan_json = excluded.plan_json,
            trace_spans_json = excluded.trace_spans_json,
            evaluation_json = excluded.evaluation_json,
            provider_id = excluded.provider_id,
            model = excluded.model,
            round = excluded.round,
            created_at = excluded.created_at
        `,
      )
      .run({
        turn_id,
        messages_json: payload.messages_json,
        tools_json: payload.tools_json,
        prompt_segments_json: payload.prompt_segments_json ?? null,
        phase_results_json: payload.phase_results_json ?? null,
        budget_plan_json: payload.budget_plan_json ?? null,
        plan_json: payload.plan_json ?? null,
        trace_spans_json: payload.trace_spans_json ?? null,
        evaluation_json: payload.evaluation_json ?? null,
        provider_id: payload.provider_id,
        model: payload.model,
        round: payload.round,
        created_at: createdAt,
      });
  }

  getDispatchedMessages(turn_id: string): DispatchedMessagesPayload | null {
    const row = this.db.prepare(`SELECT * FROM dispatched_messages WHERE turn_id = ?`).get(turn_id) as
      | SqliteRow
      | undefined;
    if (!row) {
      return null;
    }

    return {
      messages_json: readString(row.messages_json),
      tools_json: readString(row.tools_json),
      prompt_segments_json: readNullableString(row.prompt_segments_json),
      phase_results_json: readNullableString(row.phase_results_json),
      budget_plan_json: readNullableString(row.budget_plan_json),
      plan_json: readNullableString(row.plan_json),
      trace_spans_json: readNullableString(row.trace_spans_json),
      evaluation_json: readNullableString(row.evaluation_json),
      provider_id: readString(row.provider_id),
      model: readString(row.model),
      round: readNumber(row.round),
      created_at: readString(row.created_at),
    };
  }

  getPlanRevisions(turn_id: string): PlanRevision[] {
    return this.db
      .prepare(`SELECT * FROM plans WHERE turn_id = ? ORDER BY revision ASC, created_at ASC`)
      .all(turn_id)
      .map((row: unknown) => mapPlanRevision(row as SqliteRow));
  }

  markInterruptedTurnsAsCrashed(): number {
    const result = this.db
      .prepare(`UPDATE turns SET finish_reason = 'crashed' WHERE finish_reason IS NULL`)
      .run();
    return result.changes;
  }

  close(): void {
    this.db.close();
  }

  private runMigrations() {
    const sql = fs.readFileSync(path.join(currentDir, "migrations", "0001-init.sql"), "utf8");
    this.db.exec(sql);
    this.ensureColumn("dispatched_messages", "round", "INTEGER NOT NULL DEFAULT 1");
    this.ensureColumn("dispatched_messages", "prompt_segments_json", "TEXT");
    this.ensureColumn("dispatched_messages", "phase_results_json", "TEXT");
    this.ensureColumn("dispatched_messages", "budget_plan_json", "TEXT");
    this.ensureColumn("dispatched_messages", "plan_json", "TEXT");
    this.ensureColumn("dispatched_messages", "trace_spans_json", "TEXT");
    this.ensureColumn("dispatched_messages", "evaluation_json", "TEXT");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
        plan_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        status TEXT NOT NULL,
        goal TEXT NOT NULL,
        revision_reason TEXT,
        plan_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_plans_turn_revision
        ON plans(turn_id, revision ASC, created_at ASC);
    `);
  }

  private ensureColumn(table: string, column: string, definition: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>;
    if (columns.some((item) => item.name === column)) {
      return;
    }

    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  private touchSession(sessionId: string, timestamp: string) {
    this.db.prepare(`UPDATE sessions SET last_active_at = ? WHERE id = ?`).run(timestamp, sessionId);
  }

  private requireTurn(turnId: string): Turn {
    const row = this.db.prepare(`SELECT * FROM turns WHERE id = ?`).get(turnId) as SqliteRow | undefined;
    if (!row) {
      throw new Error(`Turn ${turnId} was not persisted.`);
    }

    return mapTurn(row);
  }
}

function mapSession(row: SqliteRow): Session {
  return {
    id: readString(row.id),
    workspace_id: readString(row.workspace_id),
    user_id: readString(row.user_id),
    title: readNullableString(row.title),
    memory_mode: readString(row.memory_mode) as Session["memory_mode"],
    locale: readString(row.locale) as Session["locale"],
    created_at: readString(row.created_at),
    last_active_at: readString(row.last_active_at),
    closed_at: readNullableString(row.closed_at),
  };
}

function mapSessionSummary(row: SqliteRow): SessionSummary {
  return {
    ...mapSession(row),
    latest_turn_id: readNullableString(row.latest_turn_id),
  };
}

function mapTurn(row: SqliteRow): Turn {
  return {
    id: readString(row.id),
    session_id: readString(row.session_id),
    turn_index: readNumber(row.turn_index),
    task_id: readNullableString(row.task_id),
    trace_id: readNullableString(row.trace_id),
    created_at: readString(row.created_at),
    finish_reason: readNullableString(row.finish_reason),
  };
}

function mapMessage(row: SqliteRow): Message {
  return {
    id: readString(row.id),
    session_id: readString(row.session_id),
    turn_id: readString(row.turn_id),
    role: readString(row.role) as Message["role"],
    content: readString(row.content),
    tool_call_id: readNullableString(row.tool_call_id),
    token_in: readNullableNumber(row.token_in),
    token_out: readNullableNumber(row.token_out),
    created_at: readString(row.created_at),
  };
}

function mapToolInvocation(row: SqliteRow): ToolInvocation {
  return {
    call_id: readString(row.call_id),
    session_id: readString(row.session_id),
    turn_id: readString(row.turn_id),
    tool_name: readString(row.tool_name),
    args_hash: readString(row.args_hash),
    args_preview: readNullableString(row.args_preview),
    permission_decision: readString(row.permission_decision),
    exit_code: readNullableNumber(row.exit_code),
    ok: Boolean(row.ok),
    error_code: readNullableString(row.error_code),
    artifact_ref: readNullableString(row.artifact_ref),
    duration_ms: readNumber(row.duration_ms),
    created_at: readString(row.created_at),
  };
}

function mapPlanRevision(row: SqliteRow): PlanRevision {
  return {
    id: readString(row.id),
    session_id: readString(row.session_id),
    turn_id: readString(row.turn_id),
    plan_id: readString(row.plan_id),
    revision: readNumber(row.revision),
    status: readString(row.status) as PlanRevision["status"],
    goal: readString(row.goal),
    revision_reason: readNullableString(row.revision_reason),
    plan_json: readString(row.plan_json),
    created_at: readString(row.created_at),
  };
}

function readString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error(`Expected string, received ${typeof value}.`);
  }
  return value;
}

function readNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return readString(value);
}

function readNumber(value: unknown): number {
  if (typeof value !== "number") {
    throw new Error(`Expected number, received ${typeof value}.`);
  }
  return value;
}

function readNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return readNumber(value);
}

function truncate(value: string | null, maxLength: number): string | null {
  if (value === null) {
    return null;
  }

  return value.length <= maxLength ? value : value.slice(0, maxLength);
}
