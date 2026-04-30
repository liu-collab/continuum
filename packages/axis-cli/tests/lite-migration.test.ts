import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  detectLiteMemoryData,
  runLiteToFullMigration,
} from "../src/lite-migration.js";

const tempDirs: string[] = [];
const originalAxisHome = process.env.AXIS_HOME;
const originalLiteMemoryDir = process.env.AXIS_LITE_MEMORY_DIR;

async function createTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "axis-lite-migration-"));
  tempDirs.push(dir);
  return dir;
}

function buildRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "lite-record-1",
    workspace_id: "11111111-1111-4111-8111-111111111111",
    user_id: "22222222-2222-4222-8222-222222222222",
    task_id: null,
    session_id: null,
    memory_type: "preference",
    scope: "user",
    status: "active",
    summary: "用户偏好：默认使用中文回答。",
    details: {
      subject: "user",
    },
    importance: 5,
    confidence: 0.92,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function writeJsonl(memoryDir: string, entries: unknown[]) {
  await mkdir(memoryDir, { recursive: true });
  await writeFile(
    path.join(memoryDir, "records.jsonl"),
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf8",
  );
}

describe("lite migration", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(async () => {
    process.env.AXIS_HOME = originalAxisHome;
    process.env.AXIS_LITE_MEMORY_DIR = originalLiteMemoryDir;
    vi.unstubAllGlobals();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("detects active lite records after applying tombstones", async () => {
    const axisHome = await createTempDir();
    const memoryDir = path.join(axisHome, "memory");
    await writeJsonl(memoryDir, [
      buildRecord({ id: "keep" }),
      buildRecord({ id: "remove" }),
      { action: "delete", record_id: "remove", deleted_at: "2026-01-01T00:00:01.000Z" },
      buildRecord({ id: "deleted-status", status: "deleted" }),
    ]);

    const detected = await detectLiteMemoryData(memoryDir);

    expect(detected.exists).toBe(true);
    expect(detected.count).toBe(1);
  });

  it("submits lite records to storage in full-mode batches", async () => {
    const axisHome = await createTempDir();
    const memoryDir = path.join(axisHome, "memory");
    process.env.AXIS_HOME = axisHome;
    await writeJsonl(memoryDir, [
      buildRecord({ id: "pref-1", updated_at: "2026-01-01T00:00:00.000Z" }),
      buildRecord({ id: "pref-2", summary: "用户偏好：说明先给结论。", updated_at: "2026-01-01T00:00:01.000Z" }),
    ]);
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({
        jobs: [
          { job_id: "job-1", status: "accepted_async" },
          { job_id: "job-2", status: "accepted_async" },
        ],
      }),
    } as Response);

    const result = await runLiteToFullMigration({
      memoryDir,
      storageUrl: "http://storage.test",
      batchSize: 50,
    });

    expect(result.submitted).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://storage.test/v1/storage/write-back-candidates",
      expect.objectContaining({
        method: "POST",
        body: expect.any(String),
      }),
    );
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      candidates: Array<{
        idempotency_key: string;
        source: { source_type: string; source_ref: string };
        details: Record<string, unknown>;
      }>;
    };
    expect(request.candidates).toHaveLength(2);
    expect(request.candidates[0]?.idempotency_key).toBe("lite-migrate:pref-1:2026-01-01T00:00:00.000Z");
    expect(request.candidates[0]?.source).toEqual(
      expect.objectContaining({
        source_type: "lite_migration",
        source_ref: "pref-1",
      }),
    );
    expect(request.candidates[0]?.details.source_lite_record_id).toBe("pref-1");

    const mapping = JSON.parse(await readFile(result.mappingPath, "utf8")) as {
      records: Array<{ lite_record_id: string }>;
    };
    expect(mapping.records.map((item) => item.lite_record_id)).toEqual(["pref-1", "pref-2"]);
  });

  it("downgrades task or session scope when lite records lack required ids", async () => {
    const axisHome = await createTempDir();
    const memoryDir = path.join(axisHome, "memory");
    process.env.AXIS_HOME = axisHome;
    await writeJsonl(memoryDir, [
      buildRecord({
        id: "task-without-task-id",
        scope: "task",
        task_id: null,
        summary: "任务进度：迁移开发到第三步。",
        memory_type: "task_state",
      }),
      buildRecord({
        id: "session-without-user",
        scope: "session",
        user_id: null,
        session_id: null,
        summary: "本轮讨论过迁移策略。",
        memory_type: "episodic",
      }),
    ]);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ jobs: [{ job_id: "job-1" }, { job_id: "job-2" }] }),
    } as Response);

    await runLiteToFullMigration({
      memoryDir,
      storageUrl: "http://storage.test",
    });

    const request = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)) as {
      candidates: Array<{
        scope: string;
        user_id: string | null;
        task_id: string | null;
        session_id: string | null;
        details: Record<string, unknown>;
      }>;
    };
    expect(request.candidates[0]).toEqual(
      expect.objectContaining({
        scope: "user",
        task_id: null,
      }),
    );
    expect(request.candidates[0]?.details.lite_migration_scope_downgraded).toBe(true);
    expect(request.candidates[1]).toEqual(
      expect.objectContaining({
        scope: "workspace",
        user_id: null,
        session_id: null,
      }),
    );
  });
});
