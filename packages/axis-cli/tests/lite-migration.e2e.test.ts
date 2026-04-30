import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  maybePromptLiteMigrationBeforeFullStart,
  runLiteToFullMigration,
} from "../src/lite-migration.js";

const tempDirs: string[] = [];
const originalAxisHome = process.env.AXIS_HOME;
const originalLiteMemoryDir = process.env.AXIS_LITE_MEMORY_DIR;

async function createAxisHome() {
  const axisHome = await mkdtemp(path.join(os.tmpdir(), "axis-lite-migration-e2e-"));
  tempDirs.push(axisHome);
  process.env.AXIS_HOME = axisHome;
  process.env.AXIS_LITE_MEMORY_DIR = path.join(axisHome, "memory");
  await mkdir(process.env.AXIS_LITE_MEMORY_DIR, { recursive: true });
  return axisHome;
}

async function seedLiteRecord(summary = "用户偏好：默认使用中文回答。") {
  const memoryDir = process.env.AXIS_LITE_MEMORY_DIR!;
  await writeFile(
    path.join(memoryDir, "records.jsonl"),
    `${JSON.stringify({
      id: "lite-record-1",
      workspace_id: "11111111-1111-4111-8111-111111111111",
      user_id: "22222222-2222-4222-8222-222222222222",
      task_id: null,
      session_id: null,
      memory_type: "preference",
      scope: "user",
      status: "active",
      summary,
      details: {
        subject: "user",
      },
      importance: 5,
      confidence: 0.92,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    })}\n`,
    "utf8",
  );
}

function createTtyPair(answer: string) {
  const input = new PassThrough() as PassThrough & { isTTY: boolean };
  const output = new PassThrough() as PassThrough & { isTTY: boolean };
  input.isTTY = true;
  output.isTTY = true;
  setImmediate(() => {
    input.write(`${answer}\n`);
  });
  return {
    stdin: input as unknown as NodeJS.ReadStream,
    stdout: output as unknown as NodeJS.WriteStream,
  };
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

describe("lite to full migration e2e", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(async () => {
    restoreEnv("AXIS_HOME", originalAxisHome);
    restoreEnv("AXIS_LITE_MEMORY_DIR", originalLiteMemoryDir);
    vi.unstubAllGlobals();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("chooses migration and imports lite records into full storage", async () => {
    await createAxisHome();
    await seedLiteRecord();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ jobs: [{ job_id: "job-1", status: "accepted_async" }] }),
    } as Response);

    const shouldMigrate = await maybePromptLiteMigrationBeforeFullStart(createTtyPair("Y"));
    const result = shouldMigrate
      ? await runLiteToFullMigration({ storageUrl: "http://storage.test" })
      : null;

    expect(shouldMigrate).toBe(true);
    expect(result?.submitted).toBe(1);
    const payload = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)) as {
      candidates: Array<{ details: Record<string, unknown> }>;
    };
    expect(payload.candidates[0]?.details.source_lite_record_id).toBe("lite-record-1");
  });

  it("declines migration once and does not prompt again", async () => {
    const axisHome = await createAxisHome();
    await seedLiteRecord();

    const first = await maybePromptLiteMigrationBeforeFullStart(createTtyPair("N"));
    const second = await maybePromptLiteMigrationBeforeFullStart(createTtyPair("Y"));

    expect(first).toBe(false);
    expect(second).toBe(false);
    const state = JSON.parse(
      await readFile(path.join(axisHome, "managed", "lite-migration-state.json"), "utf8"),
    ) as { skipFullPrompt?: boolean };
    expect(state.skipFullPrompt).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps lite files when storage import fails so full startup can continue empty", async () => {
    await createAxisHome();
    await seedLiteRecord("用户偏好：先给结论。");
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: { message: "storage unavailable" } }),
    } as Response);

    const shouldMigrate = await maybePromptLiteMigrationBeforeFullStart(createTtyPair("Y"));
    await expect(runLiteToFullMigration({ storageUrl: "http://storage.test" })).rejects.toThrow(
      "storage unavailable",
    );

    expect(shouldMigrate).toBe(true);
    await expect(readFile(path.join(process.env.AXIS_LITE_MEMORY_DIR!, "records.jsonl"), "utf8"))
      .resolves
      .toContain("先给结论");
  });
});
